// Conduit buyer storefront — the live marketplace of sellers + the purchase flow.
//
// One Hyperswarm client joined to the market topic discovers sellers (each sends an `offer`),
// keeps a registry the UI can browse, and `purchase()` runs the proven negotiation against a
// chosen seller: quoteReq → quote(nonce) → sign-bind + pay USD₮ → receipt → grant → delegate.
// (Generalises src/node/buy.ts to many sellers + a long-lived process.)
import crypto from 'node:crypto';
import Hyperswarm from 'hyperswarm';
import { Wallet as EthWallet } from 'ethers';
import { send, onMessages, bindMessage, type Msg } from '../core/protocol';
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
  online: boolean;
  lastSeen: number;
}

export interface PurchaseResult {
  answer: string;
  cost: bigint;
  txHash?: string;
  model: string;
  sellerWallet: string;
  stats?: { ttftMs?: number; tps?: number; promptTokens?: number };
}

export interface Storefront {
  list(): SellerOffer[];
  getActive(): SellerOffer | null;
  select(id: string): SellerOffer | null; // an offer id, or 'auto'
  selectedId(): string;
  purchase(seller: SellerOffer, prompt: string, opts?: { predict?: number }): Promise<PurchaseResult>;
  close(): Promise<void>;
}

export interface StorefrontDeps {
  buyer: ConduitAccount; // pays + address
  signerPhrase: string; // BIP-39 phrase for the off-chain bind signature (buyer = account 0)
  consumerPub: string; // QVAC consumer pubkey (the key the seller firewall-allows on grant)
  sdk: any; // @qvac/sdk (for the delegated loadModel/completion)
  log?: (m: string) => void;
}

interface ConnRec {
  id: string;
  conn: any;
  offer?: SellerOffer;
  pendingQuote?: { resolve: (m: any) => void; reject: (e: Error) => void };
  pendingGrant?: { resolve: (m: any) => void; reject: (e: Error) => void };
}

// cheapest, then fastest
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
    return online.sort(byPriceThenSpeed)[0]!; // 'auto' (or selected went offline) → cheapest-then-fastest
  }

  function handle(rec: ConnRec, m: Msg) {
    if (m.type === 'offer') {
      rec.offer = {
        id: rec.id,
        sellerWallet: m.sellerWallet,
        model: m.model,
        priceBaseUnits: BigInt(m.priceBaseUnits),
        tps: m.tps,
        token: m.token,
        chainId: m.chainId,
        online: true,
        lastSeen: Date.now(),
      };
      log(`[storefront] seller ${rec.id.slice(0, 10)}… offers ${m.model} @ ${m.priceBaseUnits} (~${m.tps} tps)`);
    } else if (m.type === 'quote') {
      rec.pendingQuote?.resolve(m);
      rec.pendingQuote = undefined;
    } else if (m.type === 'grant') {
      rec.pendingGrant?.resolve(m);
      rec.pendingGrant = undefined;
    } else if (m.type === 'reject') {
      const e = new Error('seller rejected: ' + m.reason);
      rec.pendingQuote?.reject(e);
      rec.pendingGrant?.reject(e);
      rec.pendingQuote = undefined;
      rec.pendingGrant = undefined;
    }
  }

  swarm.on('connection', (conn: any) => {
    const id = Buffer.from(conn.remotePublicKey).toString('hex');
    const rec: ConnRec = { id, conn };
    conns.set(id, rec);
    onMessages(conn, (m) => handle(rec, m));
    conn.on('close', () => {
      if (rec.offer) rec.offer.online = false;
      rec.pendingQuote?.reject(new Error('seller disconnected'));
      rec.pendingGrant?.reject(new Error('seller disconnected'));
    });
    conn.on('error', () => {});
  });

  await swarm.join(TOPIC, { server: false, client: true }).flushed();
  log('[storefront] searching for sellers…');

  function waitFor(rec: ConnRec, kind: 'quote' | 'grant', ms: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        if (kind === 'quote') rec.pendingQuote = undefined;
        else rec.pendingGrant = undefined;
        reject(new Error(`timeout waiting for ${kind}`));
      }, ms);
      const wrap = {
        resolve: (m: any) => { clearTimeout(to); resolve(m); },
        reject: (e: Error) => { clearTimeout(to); reject(e); },
      };
      if (kind === 'quote') rec.pendingQuote = wrap;
      else rec.pendingGrant = wrap;
    });
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
    async purchase(seller, prompt, opts) {
      const rec = conns.get(seller.id);
      if (!rec || !rec.offer?.online) throw new Error('seller offline');
      const conn = rec.conn;

      // 1) request a quote (the seller mints a single-use nonce)
      send(conn, { type: 'quoteReq', buyerConsumerPub: deps.consumerPub, buyerWallet: deps.buyer.address });
      const quote = await waitFor(rec, 'quote', 20_000);

      // 2) sign the identity bind + pay USD₮ to the seller's advertised wallet
      const signature = await signer.signMessage(bindMessage(quote.nonce, deps.consumerPub, deps.buyer.address));
      const price = BigInt(quote.price);
      log(`[storefront] paying ${quote.price} to ${String(quote.sellerWallet).slice(0, 10)}…`);
      const tx = await deps.buyer.transferToken(quote.token, quote.sellerWallet, price);
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

      // 4) delegate the seller's model over E2E (reuse the delegated handle per provider)
      let modelId = delegated.get(grant.providerPub);
      if (!modelId) {
        modelId = await deps.sdk.loadModel({
          modelSrc: deps.sdk[seller.model],
          modelType: 'llm',
          delegate: { providerPublicKey: grant.providerPub, timeout: 60_000, fallbackToLocal: false },
        });
        delegated.set(grant.providerPub, modelId!);
      }
      const run = deps.sdk.completion({
        modelId,
        history: [{ role: 'user', content: prompt }],
        stream: true,
        captureThinking: true,
        kvCache: false,
        generationParams: { predict: opts?.predict ?? 1024, reasoning_budget: 0 },
      });
      let answer = '';
      for await (const ev of run.events) {
        if (ev.type === 'contentDelta') answer += ev.text;
      }
      const final = await run.final.catch(() => null);
      return {
        answer: answer.trim(),
        cost: price,
        txHash: tx?.hash,
        model: seller.model,
        sellerWallet: quote.sellerWallet,
        stats: {
          ttftMs: final?.stats?.timeToFirstToken,
          tps: final?.stats?.tokensPerSecond,
          promptTokens: final?.stats?.promptTokens,
        },
      };
    },
    async close() {
      try { swarm.destroy(); } catch {}
    },
  };
}
