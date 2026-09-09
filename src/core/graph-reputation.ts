// Global seller reputation, derived from ConduitEscrow settlement history via The Graph.
// ETHOnline 2026 (new work).
//
// Complements src/core/reputation.ts rather than replacing it. That one answers "how has
// this seller treated ME?" — first-party, unforgeable, and strictly better evidence when
// you have it. This one answers "how has this seller treated EVERYONE?" — which is what
// fills the cold-start hole where the local module returns 0.5 for every seller the buyer
// has never met.
//
// The two are blended, not swapped: local experience dominates as soon as it exists.
//
// It implements the EXISTING `Reputation` interface, so it drops straight into
// `StorefrontDeps.reputation` (src/buy/storefront.ts:70) and is picked up unchanged by
// the "Auto" sort at src/buy/storefront.ts:126-128. That seam was built in June; this
// fills it.
//
// DEGRADATION IS A FEATURE: with no endpoint configured, or the endpoint unreachable,
// every method falls through to the local implementation and the marketplace behaves
// exactly as it did before. Nothing here is allowed to break a purchase.
import type { Reputation, SellerRep } from './reputation';
import {
  type GlobalRecord,
  globalScore,
  reliability,
  forgeCost,
  type ForgeCost,
} from './qualification';

/** How much local evidence is needed before it outweighs the global signal. */
const LOCAL_CONFIDENCE_K = 5;

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;
/** Cap the seller page — a marketplace this size is already far beyond demo scale. */
const SELLER_PAGE_SIZE = 200;

/** Resolves whether a wallet is a World-verified unique human. See ./humanity.ts. */
export interface HumanityLookup {
  /** Anonymous human id for this wallet, or null when it is not registered. */
  humanId(wallet: string): Promise<string | null>;
}

export interface GraphReputationOpts {
  /** Subgraph Studio query URL (API key in the path). Falsy disables the global layer. */
  endpoint?: string | null;
  /** The existing first-party reputation. We blend with it, never replace it. */
  local: Reputation;
  /**
   * Optional AgentBook lookup. Supplying it enables the identity half of the
   * qualification rules: `uniqueVerifiedBuyers` counts distinct HUMANS rather than
   * distinct addresses. Without it, breadth falls back to distinct addresses and says so.
   */
  humanity?: HumanityLookup | null;
  ttlMs?: number;
  timeoutMs?: number;
  log?: (m: string) => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface BuyerRecord {
  channelsOpened: number;
  channelsSettled: number;
  channelsWithdrawn: number;
  channelsAbandoned: number;
}

export interface GraphReputation extends Reputation {
  /** The seller's global settlement record, or null if the subgraph has never seen them. */
  globalRecord(wallet: string): GlobalRecord | null;
  /** The buyer-side record, for the seller's bilateral admission check. */
  buyerRecord(wallet: string): BuyerRecord | null;
  /**
   * Fraction of this buyer's channels that ended in a qualified abandonment.
   * 0 when the buyer is unknown — an unknown buyer is not accused of anything.
   */
  buyerAbandonmentRate(wallet: string): number;
  /** What it would cost to forge `n` adverse signals, gate off vs gate on. */
  forgeCost(n: number, gasPriceBaseUnits: bigint | null): ForgeCost;
  /** Pull fresh data from the subgraph. Never throws. */
  refresh(): Promise<void>;
  /** True once a refresh has succeeded — i.e. the global layer is actually live. */
  isLive(): boolean;
  /** Whether breadth is counting verified humans or merely distinct addresses. */
  breadthCountsHumans(): boolean;
  lastError(): string | null;
}

const SELLERS_QUERY = `
  query ConduitSettlementHistory($first: Int!) {
    sellers(first: $first, orderBy: channelsOpened, orderDirection: desc) {
      id
      channelsOpened
      channelsSettled
      qualifiedWithdrawn
      probeChannels
      renewals
      withdrawnTotal
      totalClaimed
      uniqueBuyers
      channels(first: 100) {
        status
        buyer { id }
      }
    }
    buyers(first: $first) {
      id
      channelsOpened
      channelsSettled
      channelsWithdrawn
      channelsAbandoned
    }
  }
`;

interface RawSeller {
  id: string;
  channelsOpened: string;
  channelsSettled: string;
  qualifiedWithdrawn: string;
  probeChannels: string;
  renewals: string;
  withdrawnTotal: string;
  totalClaimed: string;
  uniqueBuyers: string;
  channels: Array<{ status: string; buyer: { id: string } }>;
}

interface RawBuyer {
  id: string;
  channelsOpened: string;
  channelsSettled: string;
  channelsWithdrawn: string;
  channelsAbandoned: string;
}

export function createGraphReputation(o: GraphReputationOpts): GraphReputation {
  const log = o.log ?? (() => {});
  const local = o.local;
  const ttlMs = o.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = o.fetchImpl ?? globalThis.fetch;
  const key = (w: string) => w.toLowerCase();

  const sellers = new Map<string, GlobalRecord>();
  const buyers = new Map<string, BuyerRecord>();
  const humanIds = new Map<string, string | null>(); // wallet → anonymous human id
  let live = false;
  let lastErr: string | null = null;
  let lastRefresh = 0;
  let inFlight: Promise<void> | null = null;

  const enabled = !!o.endpoint;
  if (!enabled) {
    log('[graph-rep] no subgraph endpoint configured — global reputation disabled, using local only');
  }

  async function query(): Promise<{ sellers: RawSeller[]; buyers: RawBuyer[] } | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await doFetch(o.endpoint!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: SELLERS_QUERY, variables: { first: SELLER_PAGE_SIZE } }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
      const body: any = await res.json();
      if (body.errors?.length) throw new Error(body.errors.map((e: any) => e.message).join('; '));
      if (!body.data) throw new Error('subgraph returned no data');
      return { sellers: body.data.sellers ?? [], buyers: body.data.buyers ?? [] };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve each distinct buyer to a World-verified human. Results are cached for the
   * process lifetime: AgentBook registration is not something that flips back and forth,
   * and a seller-selection path must not make N chain calls per keystroke.
   */
  async function resolveHumans(wallets: string[]): Promise<void> {
    if (!o.humanity) return;
    const unknown = wallets.filter((w) => !humanIds.has(key(w)));
    for (const w of unknown) {
      try {
        humanIds.set(key(w), await o.humanity.humanId(w));
      } catch {
        // A failed lookup must not be cached as "not human" — leave it unknown so a
        // later refresh can retry, and fail closed for now.
        log(`[graph-rep] AgentBook lookup failed for ${w.slice(0, 10)}…`);
      }
    }
  }

  function countVerifiedBuyers(s: RawSeller): { count: number; countsHumans: boolean } {
    const wallets = [...new Set(s.channels.map((c) => key(c.buyer.id)))];
    if (!o.humanity) return { count: wallets.length, countsHumans: false };
    // Distinct HUMANS, not distinct wallets: N wallets backed by one human collapse to
    // one id. That collapse is the entire point of the World gate.
    const ids = new Set<string>();
    for (const w of wallets) {
      const id = humanIds.get(w);
      if (id) ids.add(id);
    }
    return { count: ids.size, countsHumans: true };
  }

  async function doRefresh(): Promise<void> {
    if (!enabled) return;
    try {
      const data = await query();
      if (!data) return;

      const allBuyers = new Set<string>();
      for (const s of data.sellers) for (const c of s.channels) allBuyers.add(c.buyer.id);
      await resolveHumans([...allBuyers]);

      sellers.clear();
      for (const s of data.sellers) {
        const verified = countVerifiedBuyers(s);
        sellers.set(key(s.id), {
          settled: Number(s.channelsSettled),
          qualifiedWithdrawn: Number(s.qualifiedWithdrawn),
          probeChannels: Number(s.probeChannels),
          renewals: Number(s.renewals),
          uniqueVerifiedBuyers: verified.count,
          totalClaimed: BigInt(s.totalClaimed),
        });
      }

      buyers.clear();
      for (const b of data.buyers) {
        buyers.set(key(b.id), {
          channelsOpened: Number(b.channelsOpened),
          channelsSettled: Number(b.channelsSettled),
          channelsWithdrawn: Number(b.channelsWithdrawn),
          channelsAbandoned: Number(b.channelsAbandoned),
        });
      }

      live = true;
      lastErr = null;
      lastRefresh = Date.now();
      log(`[graph-rep] synced ${sellers.size} sellers, ${buyers.size} buyers from the subgraph`);
    } catch (e: any) {
      lastErr = String(e?.message ?? e);
      // Keep whatever we last had; stale global data still beats no global data, and
      // falling back to local is always safe.
      log(`[graph-rep] refresh failed (${lastErr}) — continuing on ${live ? 'stale' : 'local-only'} data`);
    } finally {
      inFlight = null;
    }
  }

  /** Kick a background refresh when the cache is stale. Never blocks the caller. */
  function maybeRefresh(): void {
    if (!enabled || inFlight) return;
    if (Date.now() - lastRefresh < ttlMs) return;
    inFlight = doRefresh();
    void inFlight;
  }

  function record(wallet: string): GlobalRecord | null {
    maybeRefresh();
    return sellers.get(key(wallet)) ?? null;
  }

  return {
    // ── the existing Reputation interface, unchanged ──
    get(wallet: string): SellerRep | null {
      return local.get(wallet);
    },

    successRate(wallet: string): number {
      const r = local.get(wallet);
      const n = r ? r.served + r.failed : 0;
      if (n > 0) return local.successRate(wallet);
      // No first-party history — answer with the global signal if we have one.
      const g = record(wallet);
      return g ? reliability(g) : local.successRate(wallet);
    },

    /**
     * The sort key for "Auto" (src/buy/storefront.ts:126-128).
     *
     * Blend: w_local = n / (n + K) with K = 5. A buyer who has never met this seller
     * gets a purely global score; after ~5 interactions their own experience dominates.
     * First-party evidence is strictly better when it exists — saying so out loud is the
     * reason this is a blend and not a replacement.
     */
    score(wallet: string): number {
      const g = record(wallet);
      if (!g) return local.score(wallet);
      const r = local.get(wallet);
      const n = r ? r.served + r.failed : 0;
      const wLocal = n / (n + LOCAL_CONFIDENCE_K);
      return wLocal * local.score(wallet) + (1 - wLocal) * globalScore(g);
    },

    recordServed(wallet: string, tps?: number | null): void {
      local.recordServed(wallet, tps);
    },
    recordFailed(wallet: string): void {
      local.recordFailed(wallet);
    },
    snapshot(): Record<string, SellerRep> {
      return local.snapshot();
    },

    // ── the global additions ──
    globalRecord: record,

    buyerRecord(wallet: string): BuyerRecord | null {
      maybeRefresh();
      return buyers.get(key(wallet)) ?? null;
    },

    buyerAbandonmentRate(wallet: string): number {
      maybeRefresh();
      const b = buyers.get(key(wallet));
      if (!b || b.channelsOpened === 0) return 0; // unknown buyer accused of nothing
      return b.channelsAbandoned / b.channelsOpened;
    },

    forgeCost(n: number, gasPriceBaseUnits: bigint | null): ForgeCost {
      return forgeCost(n, gasPriceBaseUnits);
    },

    refresh: doRefresh,
    isLive: () => live,
    breadthCountsHumans: () => !!o.humanity,
    lastError: () => lastErr,
  };
}
