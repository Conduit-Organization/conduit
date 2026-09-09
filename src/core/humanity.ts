// Human-proof verification via World AgentKit — ETHOnline 2026 (new work).
//
// THE GAP THIS FILLS
//
// src/node/sell.ts:146-159 is the seller's entire admission test for a session. Six
// checks, and every one of them is economic: is there a channel, is the deposit big
// enough, has it expired, does the epoch match. Not one asks WHO the buyer is. The buyer
// is `m.buyerWallet` — an address. Addresses are free, so one actor can be a thousand
// customers, and a seller cannot rate-limit, price-discriminate or ban anyone: the banned
// party returns as a fresh address in one line of code.
//
// This module adds the missing question, as a peer of the economic checks rather than a
// wrapper around them. A verified human with no funded channel is still rejected; a
// funded channel with no proof is now also rejected. Payment and personhood are
// independent requirements.
//
// WHY IT IS A `view` CALL AND NOT A LOGIN
//
// AgentKit is documented mainly as an x402 HTTP extension, but its core primitive is a
// plain contract read: `AgentBook.lookupHuman(address) → uint256`, returning a stable
// ANONYMOUS human identifier, or 0 when the wallet is not registered. That needs no HTTP
// server, no API key and no sandbox — which is what lets it live inside a Hyperswarm
// session grant instead of in front of a web UI.
//
// It also returns an identifier rather than a boolean, and that matters: N wallets backed
// by the SAME human collapse to ONE id. So a seller can count unique *humans* instead of
// unique *addresses*, which is the scarcity the reputation rules actually need.
//
// Verified against the published source of @worldcoin/agentkit-core@0.2.1 and live reads
// of World Chain. See docs/ethonline/VERIFIED-CONSTANTS.md.
import {
  createAgentBookVerifier,
  validateAgentkitMessage,
  verifyAgentkitSignature,
  formatSIWEMessage,
  AgentkitPayloadSchema,
  type AgentkitPayload,
} from '@worldcoin/agentkit-core';

/** The proof a buyer attaches to `sessionOpen`. A SIWE-shaped, wallet-signed message. */
export type HumanProof = AgentkitPayload;

/** World Chain — where AgentBook lookups always resolve, whatever chain signed. */
export const WORLD_CHAIN_ID = 480;

/**
 * The project's own domain, used as the SIWE `domain`/`uri` host. Both sides derive the
 * resource URI from the seller's wallet address, so no extra wire field is needed and a
 * proof is bound to the seller it was produced for.
 */
export const CONDUIT_DOMAIN = 'conduitt.xyz';

/** How long a proof stays fresh. AgentKit's own default is 5 minutes. */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/** Nonces we have already accepted, so a captured proof cannot be replayed. */
const REPLAY_WINDOW = 4096;

export function resourceUriFor(sellerWallet: string): string {
  return `https://${CONDUIT_DOMAIN}/seller/${sellerWallet.toLowerCase()}`;
}

export interface VerifyResult {
  ok: boolean;
  /** Anonymous human identifier — stable across every wallet the same human backs. */
  humanId?: string;
  /** Short, specific reason, suitable for the `reject` message on the wire. */
  reason?: string;
}

export interface Humanity {
  /** Seller side: is this proof valid, fresh, bound to this wallet, and human-backed? */
  verify(proof: HumanProof | undefined, buyerWallet: string, sellerWallet: string): Promise<VerifyResult>;
  /** Anonymous human id for a wallet, or null. Used by the reputation layer. */
  humanId(wallet: string): Promise<string | null>;
  /** Buyer side: produce a proof for this seller. `sign` is an EIP-191 personal_sign. */
  prove(
    buyerWallet: string,
    sellerWallet: string,
    sign: (message: string) => Promise<string>,
    opts?: { chainId?: number; epoch?: string }
  ): Promise<HumanProof>;
}

export interface HumanityOpts {
  /** World Chain RPC. Defaults to agentkit-core's built-in public endpoint. */
  worldChainRpcUrl?: string;
  /** Override the AgentBook address (testing / a custom deployment). */
  agentBookAddress?: `0x${string}`;
  maxAgeMs?: number;
  /** Cache AgentBook results for this long. Registration does not flip back and forth. */
  cacheTtlMs?: number;
  log?: (m: string) => void;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function isZeroAddress(a: string): boolean {
  return a.toLowerCase() === ZERO_ADDRESS;
}

export function createHumanity(opts: HumanityOpts = {}): Humanity {
  const log = opts.log ?? (() => {});
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const cacheTtl = opts.cacheTtlMs ?? 10 * 60 * 1000;

  const verifier = createAgentBookVerifier({
    rpcUrl: opts.worldChainRpcUrl,
    contractAddress: opts.agentBookAddress,
  });

  const cache = new Map<string, { id: string | null; at: number }>();
  const seenNonces = new Set<string>();
  const nonceOrder: string[] = [];

  function rememberNonce(n: string): void {
    seenNonces.add(n);
    nonceOrder.push(n);
    while (nonceOrder.length > REPLAY_WINDOW) {
      const old = nonceOrder.shift();
      if (old !== undefined) seenNonces.delete(old);
    }
  }

  async function humanId(wallet: string): Promise<string | null> {
    // ⚠️ AgentBook returns a NON-ZERO id for the zero address on World Chain (verified
    // 2026-09-09). Without this guard, `buyerWallet: 0x0` would read as human-backed.
    if (!wallet || isZeroAddress(wallet)) return null;

    const key = wallet.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheTtl) return hit.id;

    const id = await verifier.lookupHuman(wallet);
    cache.set(key, { id, at: Date.now() });
    return id;
  }

  return {
    humanId,

    async verify(proof, buyerWallet, sellerWallet): Promise<VerifyResult> {
      if (!proof) return { ok: false, reason: 'no human proof supplied' };
      if (!buyerWallet || isZeroAddress(buyerWallet)) return { ok: false, reason: 'invalid buyer wallet' };

      // 1. Shape. Reject anything that is not an AgentKit payload before touching it.
      const parsed = AgentkitPayloadSchema.safeParse(proof);
      if (!parsed.success) return { ok: false, reason: 'malformed human proof' };
      const payload = parsed.data;

      // 2. The proof must be FOR THIS SELLER.
      //
      //    ⚠️ This check cannot be delegated to AgentKit. `validateAgentkitMessage`
      //    compares only the URI's HOST against the expected resource — it ignores the
      //    path. Since every Conduit seller shares the host `conduitt.xyz` and is
      //    distinguished only by the `/seller/<address>` path, relying on AgentKit alone
      //    would let a proof minted for seller A open a session with seller B.
      //    Verified by src/scripts/humanity-check.ts, which caught exactly that.
      const expected = resourceUriFor(sellerWallet);
      if (payload.uri.toLowerCase() !== expected.toLowerCase()) {
        return { ok: false, reason: 'human proof was issued for a different seller' };
      }

      // 3. Freshness, host binding, and single use.
      const validation = await validateAgentkitMessage(payload, expected, {
        maxAge,
        checkNonce: (nonce: string) => !seenNonces.has(nonce),
      });
      if (!validation.valid) return { ok: false, reason: validation.error ?? 'proof failed validation' };

      // 4. The signature must actually be the buyer's. This is what binds the proof to
      //    the wallet that funded the channel — without it, anyone could present anyone
      //    else's proof.
      if (payload.address.toLowerCase() !== buyerWallet.toLowerCase()) {
        return { ok: false, reason: 'proof address does not match buyer wallet' };
      }
      const sig = await verifyAgentkitSignature(payload, { rpcUrl: opts.worldChainRpcUrl });
      if (!sig.valid) return { ok: false, reason: 'bad human proof signature' };

      // 5. And the wallet must be registered in AgentBook to a unique human.
      let id: string | null;
      try {
        id = await humanId(buyerWallet);
      } catch (e: any) {
        // Fail CLOSED. An RPC blip must not become a free pass through the gate.
        log(`[humanity] AgentBook lookup failed: ${e?.message ?? e}`);
        return { ok: false, reason: 'human registry unavailable' };
      }
      if (!id) return { ok: false, reason: 'wallet not registered to a verified human' };

      rememberNonce(payload.nonce);
      return { ok: true, humanId: id };
    },

    async prove(buyerWallet, sellerWallet, sign, o = {}): Promise<HumanProof> {
      const uri = resourceUriFor(sellerWallet);
      const now = new Date();
      const payload: AgentkitPayload = {
        domain: CONDUIT_DOMAIN,
        address: buyerWallet,
        statement: 'Prove a unique human is behind this Conduit inference purchase.',
        uri,
        version: '1',
        chainId: `eip155:${o.chainId ?? WORLD_CHAIN_ID}`,
        type: 'eip191',
        nonce: randomNonce(),
        issuedAt: now.toISOString(),
        expirationTime: new Date(now.getTime() + maxAge).toISOString(),
        // Binds the proof to one session, so it cannot be reused for a later epoch.
        requestId: o.epoch ? `epoch:${o.epoch}` : undefined,
        signature: '0x',
      };
      // Sign EXACTLY the message the verifier will reconstruct.
      payload.signature = await sign(formatSIWEMessage(payload, buyerWallet));
      return payload;
    },
  };
}

function randomNonce(): string {
  // SIWE nonces must be alphanumeric and at least 8 characters. `crypto` is global from
  // Node 18 on, and this package already requires Node >= 22.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
