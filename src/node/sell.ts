// Conduit SELLER node — discovery + negotiation + payment-gated provider, all over P2P.
//
// Reads its capability profile → advertises an offer on a Hyperswarm topic. For each buyer:
// quote (single-use nonce) → verify a signed, on-chain-confirmed payment → open a firewall-gated
// QVAC provider for exactly that buyer → grant the provider pubkey. No orchestrator.
import crypto from 'node:crypto';
import { recoverWorkerLock } from '../core/worker-lock';
import { profileForThisMachine } from '../core/bench-profile';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
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

// ── Can this machine serve, right now? ────────────────────────────────────────────────
//
// bench-profile.json is a record of what was true on some machine at some point. Matching
// its platform/arch proves only that the record is OURS — not that it is still true. A
// machine whose model cache has been emptied, or whose inference runtime cannot load at
// all, still passes that check and still advertises. The buyer discovers otherwise after
// paying.
//
// So before advertising, the seller proves it can serve by doing it: start the provider,
// load the model it intends to sell, unload, exit. Only starting the runtime is evidence
// about now.
//
// This runs in a CHILD process, re-entering this same file with CONDUIT_SELLER_SELFCHECK=1.
// Two reasons it cannot be done in-process: the SDK does not survive a provider stop/start
// cycle (the second start never returns), and a runtime that dies on dlopen takes the
// process with it. A child contains both.
if (process.env.CONDUIT_SELLER_SELFCHECK === '1') {
  const model = process.env.CONDUIT_SELFCHECK_MODEL || '';
  const fail = (why: string) => { console.error(why); process.exit(1); };
  try {
    // The firewall admits nobody: this is a health check, not a grant.
    await sdk.startQVACProvider({ firewall: { mode: 'allow', publicKeys: [] } });
    if (model) {
      const modelSrc = sdk[model];
      if (!modelSrc) fail(`the SDK has no model named ${model}`);
      const modelId = await sdk.loadModel({ modelSrc, modelType: 'llm' });
      await sdk.unloadModel({ modelId, clearStorage: false });
    }
    // Tear the provider down explicitly. This child announces on the DHT like any other,
    // and an announcement that outlives the process is one buyers can still be routed to —
    // to a provider whose firewall admits no one.
    try { await sdk.stopQVACProvider(); } catch { /* going away regardless */ }
    console.error('ok');
    process.exit(0);
  } catch (e: any) {
    fail(String(e?.message ?? e).split('\n')[0]!);
  }
}

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
interface SellerOfferSpec { model: string; priceBaseUnits: bigint; tps: number }

/**
 * What this machine will advertise — or nothing, if it cannot honestly advertise anything.
 *
 * `bench-profile.json` is committed and shipped inside the package so a fresh install has
 * something to read, which also means every install begins holding the numbers of whatever
 * machine generated it. A seller that trusts those advertises capability it has never
 * demonstrated: the offer looks ordinary, the economic checks pass, and the model fails to
 * load only after a buyer has paid. Refusing to start is the honest failure.
 */
function resolveOffer(): SellerOfferSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(RESOURCES, 'bench-profile.json'), 'utf8'));
  } catch (e: any) {
    console.error(`\n[seller] no benchmark for this machine (${e?.message ?? e}).`);
    console.error('[seller] run `npm run bench` here, then start the seller again.\n');
    process.exit(1);
  }

  const { profile, reason } = profileForThisMachine(raw);
  if (!profile) {
    console.error(`\n[seller] will not advertise: ${reason}.`);
    console.error('[seller] run `npm run bench` on THIS machine first — it measures which models');
    console.error('[seller] actually run here and how fast, which is what buyers are shown.\n');
    process.exit(1);
  }

  const best = offerFromProfile(profile);
  // The seller may override the prober's pick (CONDUIT_SELLER_MODEL) — but ONLY to a model
  // this machine actually benchmarked as runnable (no "might crash" choices). Price follows
  // the model.
  const chosen = process.env.CONDUIT_SELLER_MODEL;
  if (chosen) {
    const m = profile.models?.find((x) => x.id === chosen && x.loaded);
    if (m) return { model: chosen, priceBaseUnits: priceFor(chosen), tps: m.tps ?? 0 };
    console.log(`[seller] requested model ${chosen} is not in this machine's runnable set`);
  }
  if (best) return best;

  console.error('\n[seller] this machine benchmarked no model it can serve — run `npm run bench`.\n');
  process.exit(1);
}

const offer = resolveOffer();

// nonce → seller USD₮ balance at quote time (for confirm-by-delta); used nonces can't be replayed.
const quotes = new Map<string, { balanceBefore: bigint }>();
const used = new Set<string>();
let providerPub: string | undefined;
// Exactly who the running provider's firewall admits — fixed at the moment it started.
let providerStartedWith = new Set<string>();

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

/**
 * The firewall-gated provider, admitting every buyer that has paid.
 *
 * This used to start the provider on the first grant and cache the pubkey, so the
 * allow-list was frozen to whoever paid first. Every later buyer received a provider key
 * they were not admitted to and failed at the DHT with PEER_CONNECTION_FAILED — after
 * their voucher had already been drawn. A seller could serve exactly one buyer per run,
 * and the second one paid for the privilege of finding out.
 *
 * The SDK exposes no way to amend a running provider's firewall, and it cannot survive a
 * stop/start cycle in one process (the second start never returns). So the allow-list is
 * accumulated and the provider is started ONCE, on the first grant, admitting every buyer
 * granted so far; a buyer who arrives later and is not on that list is refused honestly
 * instead of being handed a key that cannot work.
 */
const admitted = new Set<string>();

async function ensureProvider(buyerPub: string): Promise<string> {
  admitted.add(buyerPub);
  if (!providerPub) {
    const res = await sdk.startQVACProvider({ firewall: { mode: 'allow', publicKeys: [...admitted] } });
    providerPub = res.publicKey;
    providerStartedWith = new Set(admitted);
    return providerPub!;
  }
  if (!providerStartedWith.has(buyerPub)) {
    throw new Error(
      'this seller is already serving another buyer and cannot admit a second one in this ' +
      'session — the inference runtime does not allow its firewall to be amended once running. ' +
      'Restart the seller to serve you.',
    );
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
      // hand out the grant that payment is supposed to buy. Model health was established
      // by proveCanServe() before this seller advertised at all.
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

recoverWorkerLock('[seller]');

/**
 * Prove this machine can serve the model it is about to advertise — by serving it.
 *
 * Re-enters this same file in a child process with CONDUIT_SELLER_SELFCHECK=1, which starts
 * the provider, loads the model, unloads it and exits. The child's exit code is the answer.
 *
 * A child is what makes this safe: an inference runtime that cannot link its native addon
 * kills the process it loads in, and the SDK cannot start a provider twice in one process.
 * Neither can touch the seller here.
 *
 * `process.execArgv` is carried across so the dev path (tsx, which registers a TypeScript
 * loader through --import) re-enters correctly; packaged, it is empty and argv[1] is the
 * bundled sell.mjs.
 */
async function proveCanServe(model: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  console.log(`[seller] proving this machine can serve ${model}…`);

  const result = await new Promise<{ ok: boolean; reason: string; ran: boolean }>((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        env: {
          ...process.env,
          CONDUIT_SELLER_SELFCHECK: '1',
          CONDUIT_SELFCHECK_MODEL: model,
          // A fresh DHT identity. Without this the child inherits QVAC_HYPERSWARM_SEED from
          // the parent and announces the SAME provider key the seller will later use — with
          // a firewall that admits nobody.
          QVAC_HYPERSWARM_SEED: randomSeedHex(),
          PROVIDER_SEED: '',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (e: any) {
      resolve({ ok: false, ran: false, reason: String(e?.message ?? e) });
      return;
    }
    let err = '';
    child.stderr?.on('data', (b: Buffer) => { err += b.toString(); });
    child.on('error', (e) => resolve({ ok: false, ran: false, reason: e.message }));

    // A first run may download weights, so this is generous. A hang is still a failure —
    // an unbounded wait here is exactly the silence being designed out.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, ran: true, reason: 'the check did not finish within 10 minutes' });
    }, 600_000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      const last = err.trim().split('\n').filter(Boolean).pop() ?? '';
      resolve({ ok: code === 0, ran: true, reason: last });
    });
  });

  if (result.ok) { console.log(`[seller] ✔ ${model} loads and serves on this machine`); return; }

  if (!result.ran) {
    // The check itself could not be started. That is not evidence of failure, so it must
    // not be reported as one — but advertising on an unverified claim is what caused a
    // buyer to pay for a model that never loaded, so say so loudly.
    console.warn(`[seller] WARNING: could not run the serve check (${result.reason}).`);
    console.warn('[seller] going online on an UNVERIFIED capability claim.');
    return;
  }

  console.error(`\n[seller] cannot serve ${model}: ${result.reason}`);
  console.error('[seller] NOT going online — a seller that cannot serve takes buyers\' deposits');
  console.error('[seller] and returns nothing. Run `npm run bench` to re-measure this machine.\n');
  process.exit(1);
}

await proveCanServe(offer.model);

await swarm.join(TOPIC, { server: true, client: false }).flushed();
console.log(`[seller] online. offer: ${offer.model} @ ${offer.priceBaseUnits} base-units, ~${offer.tps} tps. wallet ${seller.address}`);

async function shutdown() { try { await sdk.stopQVACProvider(); } catch {} try { await sdk.close(); } catch {} try { await swarm.destroy(); } catch {} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// A seller is a long-running daemon — never let a stray error (e.g. a flaky RPC) take it down.
process.on('uncaughtException', (e: any) => console.error('[seller] uncaught (staying up):', e?.message ?? e));
process.on('unhandledRejection', (e: any) => console.error('[seller] unhandled (staying up):', e?.message ?? e));
