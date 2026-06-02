// Conduit SELLER node — discovery + negotiation + payment-gated provider, all over P2P.
//
// Reads its capability profile → advertises an offer on a Hyperswarm topic. For each buyer:
// quote (single-use nonce) → verify a signed, on-chain-confirmed payment → open a firewall-gated
// QVAC provider for exactly that buyer → grant the provider pubkey. No orchestrator.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Hyperswarm from 'hyperswarm';
import { verifyMessage } from 'ethers';
import { randomSeedHex } from '../core/identity';

const TOPIC = crypto.createHash('sha256').update('conduit:market:v1').digest();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// This process's QVAC provider identity — set before the SDK touches the swarm.
const providerSeed = process.env.PROVIDER_SEED || randomSeedHex();
process.env.QVAC_HYPERSWARM_SEED = providerSeed;

const { loadConfig } = await import('../core/config');
const { getAccount } = await import('../core/wallet');
const { offerFromProfile, priceFor } = await import('../core/pricing');
const { send, onMessages, bindMessage } = await import('../core/protocol');
const sdk: any = await import('@qvac/sdk');

const cfg = loadConfig();
const seller = await getAccount(cfg.mnemonic, cfg.rpcUrl, 1); // seller wallet = account 1

const here = path.dirname(fileURLToPath(import.meta.url));
let offer = { model: 'QWEN3_4B_INST_Q4_K_M', priceBaseUnits: priceFor('QWEN3_4B_INST_Q4_K_M'), tps: 0 };
try {
  const profile = JSON.parse(readFileSync(path.join(here, '../../bench-profile.json'), 'utf8'));
  offer = offerFromProfile(profile) ?? offer;
} catch { /* default */ }

// nonce → seller USD₮ balance at quote time (for confirm-by-delta); used nonces can't be replayed.
const quotes = new Map<string, { balanceBefore: bigint }>();
const used = new Set<string>();
let providerPub: string | undefined;

async function ensureProvider(buyerPub: string): Promise<string> {
  if (!providerPub) {
    const res = await sdk.startQVACProvider({ firewall: { mode: 'allow', publicKeys: [buyerPub] } });
    providerPub = res.publicKey;
  }
  return providerPub!;
}

async function verifyReceipt(m: any): Promise<{ ok: boolean; reason?: string }> {
  const q = quotes.get(m.nonce);
  if (!q) return { ok: false, reason: 'unknown nonce' };
  if (used.has(m.nonce)) return { ok: false, reason: 'nonce already used' };
  let signer: string;
  try { signer = verifyMessage(bindMessage(m.nonce, m.buyerConsumerPub, m.buyerWallet), m.signature); }
  catch { return { ok: false, reason: 'bad signature' }; }
  if (signer.toLowerCase() !== String(m.buyerWallet).toLowerCase()) return { ok: false, reason: 'signature ≠ wallet' };
  const price = offer.priceBaseUnits;
  let bal = await seller.tokenBalance(cfg.usdtAddress);
  for (let i = 0; i < 40 && bal < q.balanceBefore + price; i++) { await sleep(2000); bal = await seller.tokenBalance(cfg.usdtAddress); }
  if (bal < q.balanceBefore + price) return { ok: false, reason: 'payment not confirmed on-chain' };
  used.add(m.nonce);
  return { ok: true };
}

const swarm = new Hyperswarm();
swarm.on('connection', (conn: any) => {
  console.log('[seller] buyer connected on storefront');
  send(conn, { type: 'offer', sellerWallet: seller.address, model: offer.model, priceBaseUnits: String(offer.priceBaseUnits), tps: offer.tps, token: cfg.usdtAddress, chainId: cfg.chainId });
  onMessages(conn, async (m) => {
    if (m.type === 'quoteReq') {
      const nonce = crypto.randomBytes(16).toString('hex');
      quotes.set(nonce, { balanceBefore: await seller.tokenBalance(cfg.usdtAddress) });
      send(conn, { type: 'quote', price: String(offer.priceBaseUnits), sellerWallet: seller.address, nonce, token: cfg.usdtAddress, chainId: cfg.chainId });
      console.log('[seller] quoted', String(offer.priceBaseUnits), 'nonce', nonce.slice(0, 12) + '…');
    } else if (m.type === 'receipt') {
      const v = await verifyReceipt(m);
      if (!v.ok) { console.log('[seller] REJECT:', v.reason); send(conn, { type: 'reject', reason: v.reason! }); return; }
      const pub = await ensureProvider(m.buyerConsumerPub);
      send(conn, { type: 'grant', providerPub: pub });
      console.log('[seller] payment verified → GRANTED, provider', pub.slice(0, 16) + '…');
    }
  });
});

await swarm.join(TOPIC, { server: true, client: false }).flushed();
console.log(`[seller] online. offer: ${offer.model} @ ${offer.priceBaseUnits} base-units, ~${offer.tps} tps. wallet ${seller.address}`);

async function shutdown() { try { await sdk.stopQVACProvider(); } catch {} try { await sdk.close(); } catch {} try { await swarm.destroy(); } catch {} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
