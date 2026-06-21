// Conduit buyer storefront — the live marketplace of sellers + the purchase flow.
//
// One Hyperswarm client joined to the market topic discovers sellers (each sends an `offer`),
// keeps a registry the UI can browse, and `purchase()` runs the proven negotiation against a
// chosen seller: quoteReq → quote(nonce) → sign-bind + pay USD₮ → receipt → grant → delegate.
// (Generalises src/node/buy.ts to many sellers + a long-lived process.)
import crypto from 'node:crypto';
import Hyperswarm from 'hyperswarm';
import { Wallet as EthWallet, JsonRpcProvider } from 'ethers';
import { send, onMessages, bindMessage, type Msg } from '../core/protocol';
import { createEscrowClient, type EscrowClient } from '../core/escrow';
import type { Reputation } from '../core/reputation';
import type { ConduitAccount } from '../core/wallet';

const TOPIC = crypto.createHash('sha256').update('conduit:market:v1').digest();

export interface SellerOffer {
  id: string; // storefront peer key (hex) — stable marketplace id
  sellerWallet: string;
  model: string;
  priceBaseUnits: bigint;
  tps: number;
  token: string;
  chainId: number;
  escrow?: string; // escrow contract address, if this seller accepts payment-channel sessions
  online: boolean;
  lastSeen: number;
  // first-party reputation (this buyer's own experience with the seller):
  served: number;
  failed: number;
  successRate: number; // [0,1], neutral 0.5 when no history
}

export interface PurchaseResult {
  answer: string;
  cost: bigint;
  txHash?: string;
  via: 'channel' | 'per-inference'; // how it settled (escrow voucher vs one on-chain payment)
  model: string;
  sellerWallet: string;
  stats?: { ttftMs?: number; tps?: number; promptTokens?: number };
}

export interface SessionInfo {
  seller: string; // seller wallet
  deposit: string; // base units
  cumulative: string; // total drawn (signed) so far
  remaining: string; // deposit − cumulative
}

export interface Storefront {
  list(): SellerOffer[];
  getActive(): SellerOffer | null;
  select(id: string): SellerOffer | null; // an offer id, or 'auto'
  selectedId(): string;
  sessions(): SessionInfo[]; // open escrow channels (for the UI session chip)
  purchase(seller: SellerOffer, prompt: string, opts?: { predict?: number }): Promise<PurchaseResult>;
  close(): Promise<void>;
}

export interface StorefrontDeps {
  buyer: ConduitAccount; // pays + address
  signerPhrase: string; // BIP-39 phrase for the off-chain bind signature (buyer = account 0)
  consumerPub: string; // QVAC consumer pubkey (the key the seller firewall-allows on grant)
  sdk: any; // @qvac/sdk (for the delegated loadModel/completion)
  rpcUrl: string; // EVM RPC (for escrow on-chain open/topUp)
  escrow?: { address: string; chainId: number } | null; // deployed ConduitEscrow (enables channel mode)
  depositBaseUnits?: bigint; // per-channel deposit (default 0.05 USD₮)
  sessionDurationSecs?: number; // channel expiry (default 1h)
  reputation?: Reputation; // first-party seller reputation (ranks "Auto", shown in the marketplace)
  log?: (m: string) => void;
}

interface SessionState {
  epoch: bigint;
  cumulative: bigint; // total drawn (signed) this session
  deposit: bigint;
  providerPub: string;
  expiry: bigint; // on-chain channel expiry (unix secs) — past this the seller rejects vouchers
}

interface ConnRec {
  id: string;
  conn: any;
  offer?: SellerOffer;
  pending: Map<string, { resolve: (m: any) => void; reject: (e: Error) => void }>;
}

// cheapest, then fastest (display order / tiebreak)
function byPriceThenSpeed(a: SellerOffer, b: SellerOffer): number {
  if (a.priceBaseUnits !== b.priceBaseUnits) return a.priceBaseUnits < b.priceBaseUnits ? -1 : 1;
  return b.tps - a.tps;
}

export async function createStorefront(deps: StorefrontDeps): Promise<Storefront> {
  const log = deps.log ?? (() => {});
  const signer = EthWallet.fromPhrase(deps.signerPhrase);
  const swarm = new Hyperswarm();
  const conns = new Map<string, ConnRec>();
  const delegated = new Map<string, string>(); // providerPub → delegated modelId (reuse per seller)
  let selected = 'auto';

  // Escrow (channel) mode — opt-in, only when a deployment is configured. The buyer's on-chain
  // signer (account 0) is provider-connected for open/topUp; sessions are kept per seller wallet.
  const esc: EscrowClient | null = deps.escrow
    ? createEscrowClient(deps.rpcUrl, deps.escrow.address, deps.escrow.chainId)
    : null;
  const escrowWallet = esc ? signer.connect(new JsonRpcProvider(deps.rpcUrl)) : null;
  const sessionStates = new Map<string, SessionState>(); // sellerWallet(lower) → session
  const deposit = deps.depositBaseUnits ?? 1_000_000n; // 1 USD₮ — generous so long sessions/demos don't exhaust (~100 answers @ 0.01)
  const duration = deps.sessionDurationSecs ?? 3600;

  function offers(): SellerOffer[] {
    return [...conns.values()].map((c) => c.offer).filter((o): o is SellerOffer => !!o);
  }

  function activeOffer(): SellerOffer | null {
    const online = offers().filter((o) => o.online);
    if (!online.length) return null;
    if (selected !== 'auto') {
      const sel = online.find((o) => o.id === selected);
      if (sel) return sel; // selected seller still online
    }
    // 'auto' (or selected went offline) → best reputation, then cheapest, then fastest.
    return [...online].sort((a, b) => {
      const sa = deps.reputation?.score(a.sellerWallet) ?? 0.5;
      const sb = deps.reputation?.score(b.sellerWallet) ?? 0.5;
      if (Math.abs(sa - sb) > 0.02) return sb - sa; // meaningfully better reputation wins
      return byPriceThenSpeed(a, b);
    })[0]!;
  }

  function resolvePending(rec: ConnRec, kind: string, m: any) {
    const p = rec.pending.get(kind);
    if (p) { rec.pending.delete(kind); p.resolve(m); }
  }

  function handle(rec: ConnRec, m: Msg) {
    if (m.type === 'offer') {
      const rep = deps.reputation?.get(m.sellerWallet);
      rec.offer = {
        id: rec.id,
        sellerWallet: m.sellerWallet,
        model: m.model,
        priceBaseUnits: BigInt(m.priceBaseUnits),
        tps: m.tps,
        token: m.token,
        chainId: m.chainId,
        escrow: m.escrow,
        online: true,
        lastSeen: Date.now(),
        served: rep?.served ?? 0,
        failed: rep?.failed ?? 0,
        successRate: deps.reputation?.successRate(m.sellerWallet) ?? 0.5,
      };
      log(`[storefront] seller ${rec.id.slice(0, 10)}… offers ${m.model} @ ${m.priceBaseUnits} (~${m.tps} tps)${m.escrow ? ' [escrow]' : ''}`);
    } else if (m.type === 'quote') {
      resolvePending(rec, 'quote', m);
    } else if (m.type === 'grant') {
      resolvePending(rec, 'grant', m);
    } else if (m.type === 'sessionGrant') {
      resolvePending(rec, 'sessionGrant', m);
    } else if (m.type === 'drawAck') {
      resolvePending(rec, 'drawAck', m);
    } else if (m.type === 'reject') {
      const e = new Error('seller rejected: ' + m.reason);
      for (const [k, p] of rec.pending) { rec.pending.delete(k); p.reject(e); }
    }
  }

  swarm.on('connection', (conn: any) => {
    const id = Buffer.from(conn.remotePublicKey).toString('hex');
    const rec: ConnRec = { id, conn, pending: new Map() };
    conns.set(id, rec);
    onMessages(conn, (m) => handle(rec, m));
    conn.on('close', () => {
      if (rec.offer) rec.offer.online = false;
      for (const [k, p] of rec.pending) { rec.pending.delete(k); p.reject(new Error('seller disconnected')); }
    });
    conn.on('error', () => {});
  });

  await swarm.join(TOPIC, { server: false, client: true }).flushed();
  log('[storefront] searching for sellers…');

  function waitFor(rec: ConnRec, kind: string, ms: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { rec.pending.delete(kind); reject(new Error(`timeout waiting for ${kind}`)); }, ms);
      rec.pending.set(kind, {
        resolve: (m: any) => { clearTimeout(to); resolve(m); },
        reject: (e: Error) => { clearTimeout(to); reject(e); },
      });
    });
  }

  // Reuse a delegated model handle per provider pubkey, then run the completion.
  async function delegateAndRun(providerPub: string, model: string, prompt: string, predict?: number) {
    let modelId = delegated.get(providerPub);
    if (!modelId) {
      modelId = await deps.sdk.loadModel({
        modelSrc: deps.sdk[model],
        modelType: 'llm',
        delegate: { providerPublicKey: providerPub, timeout: 60_000, fallbackToLocal: false },
      });
      delegated.set(providerPub, modelId!);
    }
    const run = deps.sdk.completion({
      modelId,
      history: [{ role: 'user', content: prompt }],
      stream: true,
      captureThinking: true,
      kvCache: false,
      generationParams: { predict: predict ?? 1024, reasoning_budget: 0 },
    });
    let answer = '';
    for await (const ev of run.events) { if (ev.type === 'contentDelta') answer += ev.text; }
    const final = await run.final.catch(() => null);
    return {
      answer: answer.trim(),
      stats: { ttftMs: final?.stats?.timeToFirstToken, tps: final?.stats?.tokensPerSecond, promptTokens: final?.stats?.promptTokens },
    };
  }

  // Open (or resume) an escrow channel to this seller and get the granted provider pubkey.
  async function ensureSession(rec: ConnRec, offer: SellerOffer): Promise<SessionState> {
    const key = offer.sellerWallet.toLowerCase();
    // small safety margin so we never start a draw against a channel that expires moments later
    const now = BigInt(Math.floor(Date.now() / 1000)) + 30n;

    // Reuse a cached session only while it's still within its on-chain expiry. A channel that has
    // expired can't be reused — the seller rejects vouchers against it ("channel expired") — so
    // drop the stale cache and reopen below.
    const have = sessionStates.get(key);
    if (have && now < have.expiry) return have;
    if (have) sessionStates.delete(key);
    if (!esc || !escrowWallet) throw new Error('escrow not configured');

    let ch = await esc.channel(escrowWallet.address, offer.sellerWallet);

    // An expired-but-still-open channel is unusable, and the contract refuses to open a new one over
    // it ("already open"). Reclaim the unspent remainder via withdraw — allowed at/after expiry,
    // which closes the channel — then open a fresh one below. open() bumps the epoch, so vouchers
    // from the old channel can't be replayed.
    if (ch.open && BigInt(Math.floor(Date.now() / 1000)) >= ch.expiry) {
      log(`[storefront] channel → ${offer.sellerWallet.slice(0, 10)}… expired; reclaiming remainder + reopening`);
      await esc.withdraw(escrowWallet, offer.sellerWallet);
      ch = await esc.channel(escrowWallet.address, offer.sellerWallet);
    }

    if (!ch.open) {
      log(`[storefront] opening escrow channel → ${offer.sellerWallet.slice(0, 10)}… (deposit ${deposit})`);
      await esc.open(escrowWallet, offer.token, offer.sellerWallet, deposit, duration);
      ch = await esc.channel(escrowWallet.address, offer.sellerWallet);
    }
    // ask the seller to verify the channel on-chain and grant the gated provider
    send(rec.conn, { type: 'sessionOpen', buyerConsumerPub: deps.consumerPub, buyerWallet: escrowWallet.address, epoch: ch.epoch.toString() });
    const grant = await waitFor(rec, 'sessionGrant', 120_000);
    const sess: SessionState = { epoch: ch.epoch, cumulative: ch.claimed, deposit: ch.deposit, providerPub: grant.providerPub, expiry: ch.expiry };
    sessionStates.set(key, sess);
    return sess;
  }

  // Re-pull a seller's reputation into its live offer so the marketplace reflects the latest outcome.
  function refreshOfferRep(sellerWallet: string) {
    const rep = deps.reputation?.get(sellerWallet);
    for (const c of conns.values()) {
      if (c.offer && c.offer.sellerWallet.toLowerCase() === sellerWallet.toLowerCase()) {
        c.offer.served = rep?.served ?? 0;
        c.offer.failed = rep?.failed ?? 0;
        c.offer.successRate = deps.reputation?.successRate(sellerWallet) ?? 0.5;
      }
    }
  }

  async function runPurchase(seller: SellerOffer, prompt: string, opts?: { predict?: number }): Promise<PurchaseResult> {
    const rec = conns.get(seller.id);
    if (!rec || !rec.offer?.online) throw new Error('seller offline');
    const conn = rec.conn;
    const price = seller.priceBaseUnits;

    // ── ESCROW CHANNEL PATH ── (when both sides support it): open once, then instant vouchers.
    if (esc && escrowWallet && seller.escrow) {
      const sess = await ensureSession(rec, seller);
      if (sess.cumulative + price > sess.deposit) {
        // Channel nearly drained — top it up on-chain so a long session/demo never stalls mid-answer.
        log(`[storefront] channel low — auto top-up ${deposit} → ${seller.sellerWallet.slice(0, 10)}…`);
        await esc.topUp(escrowWallet, seller.token, seller.sellerWallet, deposit);
        const ch = await esc.channel(escrowWallet.address, seller.sellerWallet);
        sess.deposit = ch.deposit;
      }
      sess.cumulative += price; // running total owed
      const sig = await esc.signVoucher(escrowWallet, seller.sellerWallet, sess.epoch, sess.cumulative);
      send(conn, { type: 'draw', buyerWallet: escrowWallet.address, cumulative: sess.cumulative.toString(), signature: sig });
      await waitFor(rec, 'drawAck', 20_000); // seller verified + recorded the voucher (instant)
      const out = await delegateAndRun(sess.providerPub, seller.model, prompt, opts?.predict);
      return { ...out, cost: price, via: 'channel', model: seller.model, sellerWallet: seller.sellerWallet };
    }

    // ── PER-INFERENCE PATH ── (default): one on-chain payment per escalation.
    // 1) request a quote (the seller mints a single-use nonce)
    send(conn, { type: 'quoteReq', buyerConsumerPub: deps.consumerPub, buyerWallet: deps.buyer.address });
    const quote = await waitFor(rec, 'quote', 20_000);

    // 2) sign the identity bind + pay USD₮ to the seller's advertised wallet
    const signature = await signer.signMessage(bindMessage(quote.nonce, deps.consumerPub, deps.buyer.address));
    const qprice = BigInt(quote.price);
    log(`[storefront] paying ${quote.price} to ${String(quote.sellerWallet).slice(0, 10)}…`);
    const tx = await deps.buyer.transferToken(quote.token, quote.sellerWallet, qprice);
    send(conn, {
      type: 'receipt',
      nonce: quote.nonce,
      txHash: tx?.hash ?? '',
      buyerConsumerPub: deps.consumerPub,
      buyerWallet: deps.buyer.address,
      signature,
    });

    // 3) the seller confirms the payment on-chain (~10–15s) then grants the gated provider pubkey
    const grant = await waitFor(rec, 'grant', 120_000);

    // 4) delegate the seller's model over E2E
    const out = await delegateAndRun(grant.providerPub, seller.model, prompt, opts?.predict);
    return { ...out, cost: qprice, txHash: tx?.hash, via: 'per-inference', model: seller.model, sellerWallet: quote.sellerWallet };
  }

  return {
    list() {
      return offers().sort(byPriceThenSpeed);
    },
    getActive: activeOffer,
    selectedId() {
      return selected;
    },
    select(id: string) {
      selected = id;
      return activeOffer();
    },
    sessions() {
      return [...sessionStates.entries()].map(([seller, s]) => ({
        seller,
        deposit: s.deposit.toString(),
        cumulative: s.cumulative.toString(),
        remaining: (s.deposit - s.cumulative).toString(),
      }));
    },
    async purchase(seller, prompt, opts) {
      // Record the outcome against the seller's reputation (served on success, failed on any error)
      // and refresh the offer's displayed counts so the marketplace updates live.
      try {
        const res = await runPurchase(seller, prompt, opts);
        deps.reputation?.recordServed(seller.sellerWallet, res.stats?.tps ?? null);
        refreshOfferRep(seller.sellerWallet);
        return res;
      } catch (e) {
        deps.reputation?.recordFailed(seller.sellerWallet);
        refreshOfferRep(seller.sellerWallet);
        throw e;
      }
    },
    async close() {
      try { swarm.destroy(); } catch {}
    },
  };
}
