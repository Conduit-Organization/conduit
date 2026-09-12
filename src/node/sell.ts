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
import { verifyMessage, JsonRpcProvider, HDNodeWallet, type BaseWallet } from 'ethers';
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
const { createEscrowClient, loadEscrowDeployment } = await import('../core/escrow');
const sdk: any = await import('@qvac/sdk');

const cfg = loadConfig();
// Wallet source: the engine (seller mode) injects the unlocked wallet via CONDUIT_SELLER_MNEMONIC;
// the CLI/demo path falls back to the .env dev mnemonic. Account 1 = the seller's earnings address
// (must differ from the buyer's account 0 so a single machine can buy from its own seller).
const sellerMnemonic = process.env.CONDUIT_SELLER_MNEMONIC || cfg.mnemonic;
if (!sellerMnemonic) {
  console.error('[seller] no wallet mnemonic — set CONDUIT_SELLER_MNEMONIC (engine passes the unlocked wallet) or a .env mnemonic');
  process.exit(1);
}
const seller = await getAccount(sellerMnemonic, cfg.rpcUrl, 1); // seller earnings = account 1 of the wallet

const here = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES = process.env.CONDUIT_RESOURCES || path.join(here, '../..');
let offer = { model: 'QWEN3_4B_INST_Q4_K_M', priceBaseUnits: priceFor('QWEN3_4B_INST_Q4_K_M'), tps: 0 };
try {
  const profile = JSON.parse(readFileSync(path.join(RESOURCES, 'bench-profile.json'), 'utf8'));
  offer = offerFromProfile(profile) ?? offer;
  // The seller may override the prober's pick (CONDUIT_SELLER_MODEL) — but ONLY to a model this
  // machine actually benchmarked as runnable (no "might crash" choices). Price follows the model.
  const chosen = process.env.CONDUIT_SELLER_MODEL;
  if (chosen) {
    const m = profile.models?.find((x: any) => x.id === chosen && x.loaded);
    if (m) offer = { model: chosen, priceBaseUnits: priceFor(chosen), tps: m.tps ?? 0 };
    else console.log(`[seller] requested model ${chosen} not in this machine's runnable set — keeping ${offer.model}`);
  }
} catch { /* default */ }

// nonce → seller USD₮ balance at quote time (for confirm-by-delta); used nonces can't be replayed.
const quotes = new Map<string, { balanceBefore: bigint }>();
const used = new Set<string>();
let providerPub: string | undefined;

// ── Escrow (payment-channel) mode — opt-in via CONDUIT_ESCROW=1 + a deployed contract. The seller
// verifies the buyer's on-chain channel, serves per signed voucher, and redeems in the background.
const escrowDep = cfg.escrow ? loadEscrowDeployment(cfg.network.name) : null;
const esc = escrowDep ? createEscrowClient(cfg.rpcUrl, escrowDep.address, escrowDep.chainId) : null;
const escrowWallet: BaseWallet | null = esc
  ? HDNodeWallet.fromPhrase(sellerMnemonic, undefined, "m/44'/60'/0'/0/1").connect(new JsonRpcProvider(cfg.rpcUrl))
  : null;
// buyerWallet(lower) → live session
const sessions = new Map<string, { buyerPub: string; epoch: bigint; deposit: bigint; cumulative: bigint; lastSig: string; claimed: bigint; claiming: boolean }>();
const CLAIM_THRESHOLD = 50_000n; // redeem on-chain once unclaimed earnings reach 0.05 USD₮

// ── ETHOnline 2026: who the buyer is ───────────────────────────────────────────
// Seller-side POLICY, both opt-in. A seller who wants to sell to any funded keypair
// changes nothing and behaves exactly as before; a seller who only wants to sell to
// verified humans sets CONDUIT_REQUIRE_HUMAN=1. That choice is what makes this a market
// rather than a rule imposed on everyone.
const { createHumanity } = await import('../core/humanity');
const { createGraphReputation } = await import('../core/graph-reputation');
const { createReputation } = await import('../core/reputation');

const requireHuman = cfg.requireHuman;
const humanity = requireHuman
  ? createHumanity({ worldChainRpcUrl: cfg.worldChainRpcUrl, log: (m) => console.log(m) })
  : null;

/** Reject a buyer whose qualified abandonment rate exceeds this. 0.5 = half their channels. */
const MAX_BUYER_ABANDONMENT = cfg.maxBuyerAbandonment;
const graphEndpoint = cfg.subgraphUrl;
const graphRep = graphEndpoint
  ? createGraphReputation({
      endpoint: graphEndpoint,
      local: createReputation(),
      humanity,
      log: (m) => console.log(m),
    })
  : null;
if (graphRep) void graphRep.refresh(); // warm the cache; never blocks a session
console.log(`[seller] policy: requireHuman=${requireHuman ? 'on' : 'off'}, buyerHistory=${graphRep ? 'on' : 'off'}`);

// Total earnings signed-for but not yet redeemed on-chain, across all live sessions. Vouchers are
// settled in batches (CLAIM_THRESHOLD) to save gas, so a freshly-served request earns USD₮ that
// won't hit the wallet for a while. The engine adds this to the on-chain delta so the seller's live
// "earned" reflects money actually owed, not just what's been claimed. Emitted on every change.
function totalPendingBaseUnits(): bigint {
  let p = 0n;
  for (const s of sessions.values()) p += s.cumulative - s.claimed;
  return p;
}
function emitPending() {
  console.log(`[seller] earned-pending ${totalPendingBaseUnits()}`);
}

// Background redeem — never blocks serving the buyer; fire-and-forget when earnings cross the threshold.
function maybeClaim(buyerWallet: string) {
  const s = sessions.get(buyerWallet.toLowerCase());
  if (!s || !esc || !escrowWallet || s.claiming) return;
  if (s.cumulative - s.claimed < CLAIM_THRESHOLD) return;
  s.claiming = true;
  const target = s.cumulative, sig = s.lastSig;
  esc.claim(escrowWallet, buyerWallet, target, sig)
    .then((tx) => { s.claimed = target; console.log(`[seller] claimed ${target} on-chain (tx ${tx.slice(0, 12)}…)`); emitPending(); })
    .catch((e: any) => console.log('[seller] claim failed (will retry):', e?.message ?? e))
    .finally(() => { s.claiming = false; });
}

// Read the seller's USD₮ balance, surviving transient RPC timeouts (a public testnet RPC blips).
// A seller daemon must never crash on a flaky balance read — degrade the negotiation instead.
async function balanceOrNull(): Promise<bigint | null> {
  try { return await seller.tokenBalance(cfg.usdtAddress); }
  catch (e: any) { console.log('[seller] rpc error reading balance:', e?.message ?? e); return null; }
}

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
  let bal = await balanceOrNull();
  for (let i = 0; i < 40 && (bal === null || bal < q.balanceBefore + price); i++) { await sleep(2000); bal = await balanceOrNull(); }
  if (bal === null || bal < q.balanceBefore + price) return { ok: false, reason: 'payment not confirmed on-chain' };
  used.add(m.nonce);
  return { ok: true };
}

const swarm = new Hyperswarm();
swarm.on('connection', (conn: any) => {
  console.log('[seller] buyer connected on storefront');
  send(conn, { type: 'offer', sellerWallet: seller.address, model: offer.model, priceBaseUnits: String(offer.priceBaseUnits), tps: offer.tps, token: cfg.usdtAddress, chainId: cfg.chainId, ...(escrowDep ? { escrow: escrowDep.address } : {}), requireHuman });
  onMessages(conn, async (m) => {
   // Every branch below answers, on every path. This wrapper is what guarantees it even
   // when something underneath throws — a buyer has usually already committed an on-chain
   // deposit by the time we are asked to grant, so going quiet is the one response that
   // costs them real money and explains nothing.
   try {
    if (m.type === 'quoteReq') {
      const balanceBefore = await balanceOrNull();
      if (balanceBefore === null) { send(conn, { type: 'reject', reason: 'seller rpc unavailable, retry' }); return; }
      const nonce = crypto.randomBytes(16).toString('hex');
      quotes.set(nonce, { balanceBefore });
      send(conn, { type: 'quote', price: String(offer.priceBaseUnits), sellerWallet: seller.address, nonce, token: cfg.usdtAddress, chainId: cfg.chainId });
      console.log('[seller] quoted', String(offer.priceBaseUnits), 'nonce', nonce.slice(0, 12) + '…');
    } else if (m.type === 'receipt') {
      const v = await verifyReceipt(m);
      if (!v.ok) { console.log('[seller] REJECT:', v.reason); send(conn, { type: 'reject', reason: v.reason! }); return; }
      const pub = await ensureProvider(m.buyerConsumerPub);
      send(conn, { type: 'grant', providerPub: pub });
      console.log('[seller] payment verified → GRANTED, provider', pub.slice(0, 16) + '…');
    } else if (m.type === 'sessionProbe') {
      // "Would you serve me, if I paid?" Every check that does not need the channel to
      // exist yet, run in the same order and with the same reasons as sessionOpen — so a
      // yes here means the only thing still standing between the buyer and an answer is
      // the deposit itself.
      if (!esc) { send(conn, { type: 'sessionProbeAck', ok: false, reason: 'seller does not accept escrow channels' }); return; }
      if (humanity) {
        const h = await humanity.verify(m.humanProof, m.buyerWallet, seller.address);
        if (!h.ok) {
          console.log('[seller] probe → no (unverified human):', h.reason);
          send(conn, { type: 'sessionProbeAck', ok: false, reason: 'unverified human' });
          return;
        }
      }
      if (graphRep) {
        const rate = graphRep.buyerAbandonmentRate(m.buyerWallet);
        if (rate > MAX_BUYER_ABANDONMENT) {
          console.log(`[seller] probe → no (abandonment ${(rate * 100).toFixed(0)}%)`);
          send(conn, { type: 'sessionProbeAck', ok: false, reason: 'buyer abandonment history' });
          return;
        }
      }
      // Deliberately NOT starting the provider here. Starting it is what authorizes a
      // buyer's pubkey through the firewall, and doing that for an unpaid probe would
      // hand out the grant that payment is supposed to buy. Model health is established
      // once at startup instead (see preflightModel), before this seller ever advertises.
      console.log('[seller] probe → yes');
      send(conn, { type: 'sessionProbeAck', ok: true });
    } else if (m.type === 'sessionOpen') {
      // Verify the buyer's escrow channel on-chain, then grant the gated provider (the channel = the grant).
      if (!esc) { send(conn, { type: 'reject', reason: 'seller does not accept escrow channels' }); return; }
      let ch;
      try { ch = await esc.channel(m.buyerWallet, seller.address); }
      catch (e: any) { send(conn, { type: 'reject', reason: 'channel read failed: ' + (e?.message ?? e) }); return; }
      const now = Math.floor(Date.now() / 1000);
      if (!ch.open) { send(conn, { type: 'reject', reason: 'no open channel' }); return; }
      if (ch.deposit < offer.priceBaseUnits) { send(conn, { type: 'reject', reason: 'deposit below price' }); return; }
      if (Number(ch.expiry) <= now) { send(conn, { type: 'reject', reason: 'channel expired' }); return; }
      if (ch.epoch.toString() !== m.epoch) { send(conn, { type: 'reject', reason: 'epoch mismatch' }); return; }
      // ── ETHOnline 2026: the checks above are all ECONOMIC. These two ask who the
      // buyer is. They sit here, after payment is established and before the grant, as
      // peers of the economic checks — a verified human with no funded channel is still
      // rejected above, and a funded channel is now not enough on its own.
      if (humanity) {
        const h = await humanity.verify(m.humanProof, m.buyerWallet, seller.address);
        if (!h.ok) {
          console.log('[seller] REJECT unverified human:', h.reason);
          send(conn, { type: 'reject', reason: 'unverified human' });
          return;
        }
        console.log(`[seller] human verified (id ${h.humanId!.slice(0, 10)}…)`);
      }
      // Accountability runs both ways: the buyer reads the seller's settlement record
      // before choosing, and the seller reads the buyer's before granting.
      if (graphRep) {
        const rate = graphRep.buyerAbandonmentRate(m.buyerWallet);
        if (rate > MAX_BUYER_ABANDONMENT) {
          console.log(`[seller] REJECT buyer abandonment history: ${(rate * 100).toFixed(0)}%`);
          send(conn, { type: 'reject', reason: 'buyer abandonment history' });
          return;
        }
      }
      sessions.set(m.buyerWallet.toLowerCase(), { buyerPub: m.buyerConsumerPub, epoch: ch.epoch, deposit: ch.deposit, cumulative: ch.claimed, lastSig: '', claimed: ch.claimed, claiming: false });
      const pub = await ensureProvider(m.buyerConsumerPub);
      send(conn, { type: 'sessionGrant', providerPub: pub, epoch: ch.epoch.toString() });
      console.log(`[seller] channel verified → GRANTED, deposit ${ch.deposit}, provider ${pub.slice(0, 16)}…`);
    } else if (m.type === 'draw') {
      // A per-inference voucher: verify the cumulative is signed by the buyer, increasing, and within deposit.
      if (!esc) { send(conn, { type: 'reject', reason: 'escrow not supported' }); return; }
      const s = sessions.get(m.buyerWallet.toLowerCase());
      if (!s) { send(conn, { type: 'reject', reason: 'no session' }); return; }
      const cumulative = BigInt(m.cumulative);
      let signer: string;
      try { signer = esc.recoverVoucher(m.buyerWallet, seller.address, s.epoch, cumulative, m.signature); }
      catch { send(conn, { type: 'reject', reason: 'bad voucher' }); return; }
      if (signer.toLowerCase() !== m.buyerWallet.toLowerCase()) { send(conn, { type: 'reject', reason: 'voucher signer mismatch' }); return; }
      if (cumulative <= s.cumulative) { send(conn, { type: 'reject', reason: 'voucher not increasing' }); return; }
      if (cumulative > s.deposit) { send(conn, { type: 'reject', reason: 'voucher exceeds deposit' }); return; }
      s.cumulative = cumulative;
      s.lastSig = m.signature;
      send(conn, { type: 'drawAck', cumulative: cumulative.toString() });
      console.log(`[seller] draw ${cumulative} verified → GRANTED (served)`);
      emitPending(); // a voucher just landed — surface the earned delta even before it's claimed
      maybeClaim(m.buyerWallet);
    }
   } catch (e: any) {
     // Answer with the failure rather than leaving the buyer to time out. 'reject' is the
     // protocol's way of saying no; the buyer surfaces the reason and can stop waiting.
     const reason = e?.message ?? String(e);
     console.error(`[seller] handling '${m.type}' failed: ${reason}`);
     try { send(conn, { type: 'reject', reason: `seller error: ${reason}` }); } catch { /* conn gone */ }
   }
  });
});

/**
 * Prove this machine can actually serve, before telling anyone it can.
 *
 * A seller whose model will not load is indistinguishable from a healthy one in the
 * marketplace: it announces, it quotes, it passes every economic check. The buyer only
 * discovers otherwise after committing an on-chain deposit — and then waits out a timeout,
 * because the failure happens deep inside the grant.
 *
 * Starting the provider is what loads the model. The firewall is opened to nobody here, so
 * this authorizes no one: it answers "can this machine serve?" and nothing else. The
 * provider is then stopped, leaving the grant path exactly as it was — the first paying
 * buyer still starts it under a firewall naming only them.
 */
async function preflightModel(): Promise<void> {
  console.log(`[seller] checking ${offer.model} loads on this machine…`);
  const started = Date.now();
  const res = await sdk.startQVACProvider({ firewall: { mode: 'allow', publicKeys: [] } });
  await sdk.stopQVACProvider();
  console.log(`[seller] ${offer.model} loads OK (${((Date.now() - started) / 1000).toFixed(1)}s) — provider ${String(res.publicKey).slice(0, 16)}…`);
}

try {
  await preflightModel();
} catch (e: any) {
  // Refuse to advertise. A seller in the marketplace that cannot serve costs buyers real
  // money — they pay to open a channel and get nothing back — so being absent is strictly
  // better than being present and broken.
  console.error(`\n[seller] cannot start ${offer.model}: ${e?.message ?? e}`);
  console.error('[seller] NOT going online — a seller that cannot serve would take buyers\' deposits and return nothing.');
  console.error('[seller] fix the model load (see the error above), then start the seller again.\n');
  process.exit(1);
}

await swarm.join(TOPIC, { server: true, client: false }).flushed();
console.log(`[seller] online. offer: ${offer.model} @ ${offer.priceBaseUnits} base-units, ~${offer.tps} tps. wallet ${seller.address}`);

async function shutdown() { try { await sdk.stopQVACProvider(); } catch {} try { await sdk.close(); } catch {} try { await swarm.destroy(); } catch {} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// A seller is a long-running daemon — never let a stray error (e.g. a flaky RPC) take it down.
process.on('uncaughtException', (e: any) => console.error('[seller] uncaught (staying up):', e?.message ?? e));
process.on('unhandledRejection', (e: any) => console.error('[seller] unhandled (staying up):', e?.message ?? e));
