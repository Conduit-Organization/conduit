// Conduit local web app — the consumer (buyer) face. A tiny Node server wraps the proven engine
// (confidence router + spend policy) and the live P2P storefront, and serves a chat + wallet UI.
//
// The wallet is a per-user encrypted keystore (src/core/keystore.ts): the app is LOCKED until the
// user creates/imports + unlocks it; the buyer account + storefront are built on unlock. The local
// router warms independently (free answers need no wallet). A `.env` mnemonic auto-unlocks in dev.
// Run: npm run web
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatUnits } from 'ethers';
import { randomSeedHex, publicKeyHexFromSeed } from '../core/identity';

const PORT = Number(process.env.PORT || 8788);
const buyerSeed = process.env.QVAC_HYPERSWARM_SEED || randomSeedHex();
const buyerPub = publicKeyHexFromSeed(buyerSeed);
process.env.QVAC_HYPERSWARM_SEED = buyerSeed; // this process = buyer (set before the SDK loads)

const { loadConfig } = await import('../core/config');
const { getAccount } = await import('../core/wallet');
const { SpendPolicy } = await import('../buy/policy');
const { createRouter } = await import('../buy/router');
const { createStorefront } = await import('../buy/storefront');
const { createMarketAgent } = await import('../buy/market-agent');
const { loadEscrowDeployment } = await import('../core/escrow');
const { createReputation } = await import('../core/reputation');
const { createGraphReputation } = await import('../core/graph-reputation');
const { createHumanity } = await import('../core/humanity');
// Canonical AgentBook deployment on World Chain (see src/core/humanity.ts).
const AGENT_BOOK_ADDRESS = '0xA23aB2712eA7BBa896930544C7d6636a96b944dA';
const { reliability, globalScore } = await import('../core/qualification');
const { labelForChainId } = await import('../core/networks');
const { createSellerManager } = await import('./seller');
const { createHumanityRegistrar } = await import('./humanity-register');
const { offerFromProfile, priceFor } = await import('../core/pricing');
const keystore = await import('../core/keystore');
const sdk: any = await import('@qvac/sdk');

const here = path.dirname(fileURLToPath(import.meta.url));
// Where the static assets + bench profile live. In dev this resolves to the repo root (here =
// src/web). In the packaged app the engine runs as a compiled bundle from a different dir, so
// Electron passes CONDUIT_RESOURCES pointing at the bundled resources (see electron/main.ts).
const RESOURCES = process.env.CONDUIT_RESOURCES || path.join(here, '../..');
const appDist = path.join(RESOURCES, 'app/dist'); // built React app (npm run app:build)

// Shown only when the React app hasn't been built yet (app/dist missing) — a short prompt, not a 404.
const buildPrompt = `<!doctype html><html><head><meta charset="utf-8"><title>Conduit</title>
<style>html,body{height:100%;margin:0}body{background:#0E1217;color:#E7F0EF;font:16px/1.6 system-ui,-apple-system,sans-serif;display:grid;place-items:center}
.c{max-width:460px;padding:32px;text-align:center}h1{color:#2BE3A8;font-weight:600;margin:0 0 14px}
code{background:#16202b;border:1px solid #22303a;border-radius:6px;padding:3px 9px;color:#2BE3A8;font-family:ui-monospace,monospace;font-size:14px}
p{color:#8A9AA6;margin:10px 0}</style></head>
<body><div class="c"><h1>⬡ Conduit</h1><p>The web UI isn't built yet. Run:</p>
<p><code>npm run app:install</code></p><p><code>npm run app:build</code></p>
<p>then refresh — or <code>npm run start</code> to build &amp; serve in one step.</p></div></body></html>`;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const DEC = 6;
const MAX_PER_CALL = 100_000n; // 0.1 USD₮ hard cap per single inference
const MAX_BUDGET = 1_000_000n; // 1 USD₮ session budget
const MIN_PW = 8;

const cfg = loadConfig();
const policy = new SpendPolicy(MAX_PER_CALL, MAX_BUDGET);
// Escrow (payment-channel) mode is opt-in: CONDUIT_ESCROW=1 + a deployed contract. The seller child
// inherits CONDUIT_ESCROW via the spawned env, so enabling it here turns it on for both roles.
const escrowDep = cfg.escrow ? loadEscrowDeployment(cfg.network.name) : null;
// ── ETHOnline 2026 ─────────────────────────────────────────────────────────────
// First-party reputation (what I myself experienced) is unchanged and still the
// authority once it has evidence. The Graph layer wraps it to fill the cold-start hole:
// without it, every seller this buyer has never met scores a flat 0.5 and "Auto"
// degrades to price-then-speed. Both additions are opt-in by env; with neither set the
// app behaves exactly as it did before.
const localReputation = createReputation(); // persists to ~/.conduit/reputation.json
const humanity = cfg.humanProof
  ? createHumanity({ worldChainRpcUrl: cfg.worldChainRpcUrl, log: (m) => console.log(m) })
  : null;
const graphEndpoint = cfg.subgraphUrl;
const reputation = graphEndpoint
  ? createGraphReputation({ endpoint: graphEndpoint, local: localReputation, humanity, log: (m) => console.log(m) })
  : localReputation;
if (graphEndpoint) {
  console.log('[engine] global reputation: The Graph @ ' + graphEndpoint.replace(/\/[0-9a-f]{20,}\//i, '/<api-key>/'));
  void (reputation as any).refresh?.();
} else {
  console.log('[engine] global reputation: disabled (set CONDUIT_SUBGRAPH_URL) — local first-party only');
}

// Seller mode: the engine manages the proven sell.ts as a child (spawn/kill/inspect). It earns into
// account index 1 of the unlocked wallet (distinct from the buyer's index 0). See src/web/seller.ts.
// ETHOnline 2026: lets a user become human-verified from inside the app, instead of
// needing the AgentKit CLI by hand. See src/web/humanity-register.ts.
const registrar = createHumanityRegistrar({ log: (m) => console.log(m) });

const seller = createSellerManager({
  repoRoot: RESOURCES,
  rpcUrl: cfg.rpcUrl,
  usdtAddress: cfg.usdtAddress,
  makeEarningsAccount: (m: string) => getAccount(m, cfg.rpcUrl, 1),
  log: (msg) => console.log(msg),
});

// The seller's offer + this machine's capability profile (read from bench-profile.json), so the
// seller screen can show "you'll offer Qwen3 4B @ 0.01 · ~59 tps" before going online.
function sellerProfile() {
  try {
    const profile = JSON.parse(readFileSync(path.join(RESOURCES, 'bench-profile.json'), 'utf8'));
    const o = offerFromProfile(profile);
    return {
      backend: profile.backend ?? null,
      platform: profile.platform ?? null,
      topSellable: profile.topSellable ?? null,
      localDraft: profile.localDraft ?? null,
      ts: profile.ts ?? null,
      recommended: profile.topSellable ?? null, // the prober's optimal pick — highlighted in the UI
      offer: o
        ? { model: o.model, price: formatUnits(o.priceBaseUnits, DEC), priceBaseUnits: o.priceBaseUnits.toString(), tps: o.tps }
        : null,
      // Sellable models = those this machine actually benchmarked as runnable, with their tiered price.
      // The seller may pick any of these; the prober's `recommended` is pre-selected in the UI.
      models: (profile.models ?? [])
        .filter((m: any) => m.loaded)
        .map((m: any) => ({ id: m.id, loaded: true, tps: m.tps ?? null, backend: m.backend ?? null, price: formatUnits(priceFor(m.id), DEC) })),
    };
  } catch {
    return { backend: null, platform: null, topSellable: null, recommended: null, localDraft: null, ts: null, offer: null, models: [] };
  }
}

// ---- wallet + dependent services (buyer / storefront / agent are built on unlock) ----
let wallet: { mnemonic: string; address: string } | null = null;
let buyer: any = null;
let storefront: any = null;
let agent: any = null;
let setupErr: string | undefined;

// First-run model download/warm progress, surfaced to the UI (a multi-GB local model otherwise
// looks like a silent hang). Pushed live over SSE (/api/model/progress) + snapshotted in /api/state.
type ModelProgress = { phase: 'warming' | 'downloading' | 'ready' | 'error'; model?: string; percentage?: number; message?: string };
let modelProgress: ModelProgress = { phase: 'warming' };
const progressClients = new Set<http.ServerResponse>();
function setProgress(p: ModelProgress) {
  modelProgress = p;
  const line = `data: ${JSON.stringify(p)}\n\n`;
  for (const c of progressClients) { try { c.write(line); } catch { /* client gone */ } }
}

// The local router warms independently of the wallet (free, on-device answers need no key).
let router: any = null;
let routerReady = false;
// In always-pay mode every answer is bought from a peer, so the on-device router is
// never consulted. Warming it would download ~500 MB and hold the app in "warming up"
// for a model it will not use — so skip it entirely and be ready immediately.
const routerPromise = cfg.alwaysPay
  ? (setProgress({ phase: 'ready' }), Promise.resolve())
  : (async () => {
      try {
        router = await createRouter({ k: 5, verify: process.env.CONDUIT_VERIFY === '1', onProgress: (pr) => setProgress({ phase: 'downloading', model: pr.model, percentage: pr.percentage }) });
        routerReady = true;
        setProgress({ phase: 'ready' });
      } catch (e: any) {
        setupErr = String(e?.message ?? e);
        setProgress({ phase: 'error', message: setupErr });
      }
    })();

async function unlockWith(mnemonic: string): Promise<string> {
  const acct = await getAccount(mnemonic, cfg.rpcUrl, 0); // buyer = account 0 of this wallet
  const sf = await createStorefront({ buyer: acct, signerPhrase: mnemonic, consumerPub: buyerPub, sdk, rpcUrl: cfg.rpcUrl, escrow: escrowDep, reputation, humanity, log: (m) => console.log(m) });
  buyer = acct;
  storefront = sf;
  agent = null; // (re)created lazily once the router is warm
  wallet = { mnemonic, address: acct.address };
  return acct.address;
}

function lock(): void {
  const sf = storefront;
  wallet = null; buyer = null; storefront = null; agent = null;
  void sf?.close?.();
}

function getAgent(): any {
  // Always-pay needs a storefront and nothing else. Requiring routerReady here would gate
  // the whole product on a local model that never answers.
  const ready = cfg.alwaysPay ? !!storefront : routerReady && !!storefront;
  if (!agent && ready) agent = createMarketAgent({ router, policy, storefront, alwaysPay: cfg.alwaysPay, log: (m) => console.log(m) });
  return agent;
}

// Dev convenience only: no keystore on disk but `.env` has a mnemonic → auto-unlock the dev wallet.
// (The shipped app has no .env, so real users always go through create/import/unlock.)
// Set CONDUIT_NO_ENV_WALLET=1 to force the real onboarding/unlock flow even in dev.
if (!keystore.exists() && cfg.mnemonic && process.env.CONDUIT_NO_ENV_WALLET !== '1') {
  void unlockWith(cfg.mnemonic).catch((e) => { setupErr = String(e?.message ?? e); });
}

function walletStatus() {
  return { exists: keystore.exists(), unlocked: !!wallet, address: wallet?.address ?? keystore.readAddress() };
}

function json(res: http.ServerResponse, code: number, obj: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// ETHOnline 2026: the seller's GLOBAL settlement record, read from the subgraph.
// Returns null when the Graph layer is not configured or has not synced, so the UI can
// fall back to first-party counts exactly as it did before.
function globalJson(sellerWallet: string) {
  const rep: any = reputation;
  const g = rep.globalRecord?.(sellerWallet);
  if (!g) return null;
  return {
    settled: g.settled,
    // The only figure that scores against a seller. Withdrawals excluded by the
    // qualification rules are surfaced separately rather than hidden.
    qualifiedWithdrawn: g.qualifiedWithdrawn,
    probeChannels: g.probeChannels,
    renewals: g.renewals,
    uniqueVerifiedBuyers: g.uniqueVerifiedBuyers,
    totalClaimed: formatUnits(g.totalClaimed, DEC),
    reliability: reliability(g),
    globalScore: globalScore(g),
    // What a naive settled/(settled+withdrawn) tally would have produced. Shown beside
    // the hardened figure so the difference is visible rather than asserted.
    naiveReliability:
      g.settled + g.qualifiedWithdrawn + g.probeChannels + g.renewals === 0
        ? 0.5
        : g.settled / (g.settled + g.qualifiedWithdrawn + g.probeChannels + g.renewals),
  };
}

function offerJson(o: { id: string; sellerWallet: string; model: string; priceBaseUnits: bigint; tps: number; online: boolean; served?: number; failed?: number; successRate?: number; chainId?: number; token?: string; requireHuman?: boolean }) {
  // A seller's offer has always carried chainId + token on the wire, so cross-network
  // sellers were already distinguishable — the UI just never showed it. A buyer settling
  // on Sepolia cannot transact with a seller settling on Arc (different escrow
  // deployments), so this has to be visible rather than inferred from a failure.
  const sellerChain = o.chainId ?? cfg.chainId;
  return {
    id: o.id, address: o.sellerWallet, model: o.model, price: formatUnits(o.priceBaseUnits, DEC), tps: o.tps, online: o.online,
    served: o.served ?? 0, failed: o.failed ?? 0, successRate: o.successRate ?? 0.5,
    requireHuman: !!o.requireHuman,
    chainId: sellerChain,
    network: labelForChainId(sellerChain),
    sameNetwork: sellerChain === cfg.chainId,
    // The blended score the "Auto" sort actually uses (storefront.ts:126-128).
    score: reputation.score(o.sellerWallet),
    global: globalJson(o.sellerWallet),
  };
}

// Status of the global-reputation layer, so the UI can say plainly whether it is live
// rather than silently showing first-party numbers as if they were global.
// The buyer's own humanity, cached — /api/state is polled every few seconds and must not
// hit World Chain each time. Registration does not flip back and forth, so a long TTL is
// correct; `null` means "not looked up yet" rather than "not human".
let humanSelf: { verified: boolean; humanId: string | null; at: number } | null = null;
const HUMAN_SELF_TTL = 5 * 60 * 1000;

async function refreshHumanSelf(): Promise<void> {
  if (!humanity || !buyer) return;
  // A registration that just succeeded must not wait out the cache. Checking the
  // registrar here means /api/state alone is enough to flip the header — the UI does not
  // have to still be polling the registration endpoint for that to happen.
  const reg = registrar.status();
  const justRegistered =
    reg.phase === 'done' &&
    reg.address?.toLowerCase() === buyer.address.toLowerCase() &&
    humanSelf?.verified === false;
  if (justRegistered) humanSelf = null;
  if (humanSelf && Date.now() - humanSelf.at < HUMAN_SELF_TTL) return;
  try {
    const id = await humanity.humanId(buyer.address);
    humanSelf = { verified: !!id, humanId: id, at: Date.now() };
  } catch {
    // A failed lookup is not a verdict — leave the previous answer standing.
  }
}

function humanStatusJson() {
  return {
    // Whether this engine attaches a proof at all (buyer-side switch).
    enabled: !!humanity,
    // Whether THIS wallet resolves to a unique human in AgentBook on World Chain.
    verified: humanSelf?.verified ?? false,
    humanId: humanSelf?.humanId ?? null,
    checked: humanSelf !== null,
  };
}

/**
 * What the three integrations are actually doing, right now, with the addresses and
 * endpoints behind them. Surfaced so a judge can verify each claim independently instead
 * of taking the README's word for it — every value here is either live state or a link
 * that resolves on a public explorer.
 */
function integrationsJson() {
  const rep: any = reputation;
  const g = rep.globalRecord?.(buyer?.address ?? '') ?? null;
  return {
    arc: {
      network: cfg.network.label,
      chainId: cfg.chainId,
      settlementToken: cfg.usdtAddress,
      symbol: cfg.network.settlementSymbol,
      // On Arc the gas token IS the settlement token, so revenue and costs are one asset.
      gasIsSettlementToken: cfg.network.gasIsSettlementToken,
      escrow: escrowDep?.address ?? null,
      explorer: cfg.network.explorer,
      escrowUrl: escrowDep ? `${cfg.network.explorer}/address/${escrowDep.address}` : null,
    },
    graph: {
      ...graphStatusJson(),
      endpoint: cfg.subgraphUrl,
      network: cfg.network.graphNetwork ?? null,
    },
    world: {
      ...humanStatusJson(),
      agentBook: AGENT_BOOK_ADDRESS,
      chain: 'World Chain',
      agentBookUrl: `https://worldscan.org/address/${AGENT_BOOK_ADDRESS}`,
      walletUrl: buyer ? `https://worldscan.org/address/${buyer.address}` : null,
    },
    // Unused but kept honest: null when the seller has no global record yet.
    selfRecord: g,
  };
}

function graphStatusJson() {
  const rep: any = reputation;
  if (!graphEndpoint) return { enabled: false, live: false, countsHumans: false, error: null };
  return {
    enabled: true,
    live: !!rep.isLive?.(),
    countsHumans: !!rep.breadthCountsHumans?.(),
    error: rep.lastError?.() ?? null,
  };
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

// ---------- static (built React app) ----------
function serveStatic(res: http.ServerResponse, pathname: string): boolean {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.normalize(path.join(appDist, rel));
  if (!full.startsWith(appDist)) { res.writeHead(403); res.end('forbidden'); return true; }
  if (!existsSync(full) || !statSync(full).isFile()) return false;
  const ext = path.extname(full);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  res.end(readFileSync(full));
  return true;
}
function serveApp(res: http.ServerResponse, pathname: string) {
  if (serveStatic(res, pathname)) return;
  if (existsSync(path.join(appDist, 'index.html'))) { serveStatic(res, '/'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(buildPrompt);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;
  void (async () => {
    // ---------- wallet management ----------
    if (req.method === 'GET' && p === '/api/wallet') {
      json(res, 200, walletStatus());
      return;
    }
    if (req.method === 'POST' && p === '/api/wallet/create') {
      const { password } = await readBody(req);
      if (keystore.exists()) { json(res, 409, { error: 'a wallet already exists on this machine' }); return; }
      if (!password || String(password).length < MIN_PW) { json(res, 400, { error: `password must be at least ${MIN_PW} characters` }); return; }
      try {
        const w = await keystore.create(password);
        await unlockWith(w.mnemonic);
        json(res, 200, { address: w.address, mnemonic: w.mnemonic }); // mnemonic returned ONCE for backup
      } catch (e: any) { json(res, 500, { error: String(e?.message ?? e) }); }
      return;
    }
    if (req.method === 'POST' && p === '/api/wallet/import') {
      const { mnemonic, password } = await readBody(req);
      if (!password || String(password).length < MIN_PW) { json(res, 400, { error: `password must be at least ${MIN_PW} characters` }); return; }
      try {
        const w = await keystore.importMnemonic(String(mnemonic ?? ''), password);
        await unlockWith(w.mnemonic);
        json(res, 200, { address: w.address });
      } catch (e: any) { json(res, 400, { error: String(e?.message ?? e) }); }
      return;
    }
    if (req.method === 'POST' && p === '/api/wallet/unlock') {
      const { password } = await readBody(req);
      try {
        const w = await keystore.unlock(String(password ?? ''));
        await unlockWith(w.mnemonic);
        json(res, 200, { address: w.address });
      } catch (e: any) { json(res, 401, { error: String(e?.message ?? e) }); }
      return;
    }
    if (req.method === 'POST' && p === '/api/wallet/lock') {
      lock();
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && p === '/api/wallet/export') {
      if (!wallet) { json(res, 401, { error: 'wallet locked' }); return; }
      if (!keystore.exists()) { json(res, 200, { mnemonic: wallet.mnemonic }); return; } // dev .env fallback (no password)
      const { password } = await readBody(req);
      try {
        const w = await keystore.unlock(String(password ?? '')); // re-verify the password before revealing
        json(res, 200, { mnemonic: w.mnemonic });
      } catch { json(res, 401, { error: 'wrong password' }); }
      return;
    }

    // ---------- model load progress (SSE) ----------
    if (req.method === 'GET' && p === '/api/model/progress') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(modelProgress)}\n\n`);
      progressClients.add(res);
      req.on('close', () => progressClients.delete(res));
      return;
    }

    // ---------- state ----------
    if (req.method === 'GET' && p === '/api/state') {
      const w = walletStatus();
      if (!wallet) {
        // Locked is still a state worth describing. Which network this app settles on, and
        // whether the reputation layer is live, do not depend on a wallet — and a first-time
        // user staring at a lock screen should be able to see that the thing is configured
        // and working, not a blank shell.
        json(res, 200, {
          wallet: w, ready: false, sellersOnline: 0, peer: null, selected: 'auto',
          alwaysPay: cfg.alwaysPay,
          network: { name: cfg.network.name, label: cfg.network.label, explorer: cfg.network.explorer, symbol: cfg.network.settlementSymbol },
          integrations: integrationsJson(),
          setupErr: setupErr ?? null, modelProgress,
        });
        return;
      }
      const active = storefront.getActive();
      void refreshHumanSelf(); // background; never blocks the state poll
      const [bU, bE] = await Promise.all([buyer.tokenBalance(cfg.usdtAddress), buyer.ethBalance()]);
      json(res, 200, {
        wallet: w,
        buyer: { address: buyer.address, usdt: formatUnits(bU, DEC), eth: formatUnits(bE, 18) },
        cloudBytes: 0,
        spent: formatUnits(policy.spent, DEC),
        budget: formatUnits(MAX_BUDGET, DEC),
        sellerModel: active?.model ?? null,
        price: active ? formatUnits(active.priceBaseUnits, DEC) : null,
        peer: active ? offerJson(active) : null,
        sellersOnline: storefront.list().filter((o: any) => o.online).length,
        selected: storefront.selectedId(),
        escrow: !!escrowDep,
        sessions: storefront.sessions().map((s: any) => ({
          seller: s.seller,
          deposit: formatUnits(BigInt(s.deposit), DEC),
          spent: formatUnits(BigInt(s.cumulative), DEC),
          remaining: formatUnits(BigInt(s.remaining), DEC),
        })),
        graph: graphStatusJson(),
        human: humanStatusJson(),
        alwaysPay: cfg.alwaysPay,
        integrations: integrationsJson(),
        humanProof: !!humanity,
        network: { name: cfg.network.name, label: cfg.network.label, explorer: cfg.network.explorer, symbol: cfg.network.settlementSymbol },
        ready: (cfg.alwaysPay ? !!storefront : routerReady) && !setupErr,
        setupErr: setupErr ?? null,
        modelProgress,
      });
      return;
    }

    // ---------- marketplace ----------
    if (req.method === 'GET' && p === '/api/sellers') {
      if (!storefront) { json(res, 200, { sellers: [], selected: 'auto' }); return; }
      json(res, 200, { sellers: storefront.list().map(offerJson), selected: storefront.selectedId(), graph: graphStatusJson() });
      return;
    }
    if (req.method === 'POST' && p === '/api/select') {
      if (!storefront) { json(res, 409, { error: 'wallet locked' }); return; }
      const { id } = await readBody(req);
      const active = storefront.select(id || 'auto');
      json(res, 200, { ok: true, selected: storefront.selectedId(), active: active ? offerJson(active) : null });
      return;
    }

    // ---------- seller mode ----------
    if (req.method === 'GET' && p === '/api/seller/status') {
      json(res, 200, seller.status());
      return;
    }
    if (req.method === 'GET' && p === '/api/seller/profile') {
      json(res, 200, sellerProfile());
      return;
    }
    // ---------- human verification (World) ----------
    if (req.method === 'POST' && p === '/api/human/register') {
      if (!wallet || !buyer) { json(res, 401, { error: 'wallet locked' }); return; }
      json(res, 200, registrar.start(buyer.address));
      return;
    }
    if (req.method === 'GET' && p === '/api/human/register') {
      const st = registrar.status();
      // The moment registration lands, drop the cached humanity so the header flips on
      // the next poll instead of waiting out the 5-minute TTL.
      if (st.phase === 'done' && humanSelf) humanSelf = null;
      json(res, 200, st);
      return;
    }
    if (req.method === 'POST' && p === '/api/human/register/cancel') {
      registrar.cancel();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && p === '/api/seller/start') {
      if (!wallet) { json(res, 401, { error: 'wallet locked' }); return; }
      // `model` optional: the seller's chosen model (else the prober's pick).
      // `requireHuman` is seller policy — refuse buyers not backed by a verified human.
      const { model, requireHuman } = await readBody(req);
      try { json(res, 200, await seller.start(wallet.mnemonic, typeof model === 'string' ? model : undefined, { requireHuman: !!requireHuman })); }
      catch (e: any) { json(res, 500, { error: String(e?.message ?? e) }); }
      return;
    }
    if (req.method === 'POST' && p === '/api/seller/stop') {
      await seller.stop();
      json(res, 200, { ok: true });
      return;
    }

    // ---------- ask ----------
    if (req.method === 'POST' && p === '/api/ask') {
      const { prompt } = await readBody(req);
      if (!prompt || !String(prompt).trim()) { json(res, 400, { error: 'empty prompt' }); return; }
      if (!wallet) { json(res, 401, { error: 'wallet locked' }); return; }
      await routerPromise;
      const a = getAgent();
      if (!a) { json(res, 503, { error: setupErr ?? 'engine still warming up' }); return; }
      try {
        const r = await a.ask(String(prompt));
        json(res, 200, {

          source: r.source, reason: r.reason ?? null, answer: r.answer, note: r.note ?? null,
          consistency: Number(r.consistency.toFixed(3)), cost: formatUnits(r.cost, DEC),
          stats: { ttftMs: r.stats?.ttftMs ?? null, tps: r.stats?.tps ?? null },
        });
      } catch (e: any) { json(res, 500, { error: String(e?.message ?? e) }); }
      return;
    }

    if (req.method === 'GET') { serveApp(res, p); return; }
    res.writeHead(404); res.end('not found');
  })();
});

server.listen(PORT, () => {
  const built = existsSync(path.join(appDist, 'index.html'));
  const w = walletStatus();
  console.log(`\n  ⬡ Conduit — open  →  http://localhost:${PORT}\n`);
  console.log(`  wallet: ${w.unlocked ? `unlocked ${w.address}` : w.exists ? 'locked (enter password)' : 'none yet (create or import in the app)'}`);
  if (!built) console.log('  note: React app not built — run `npm run app:build` for the UI (showing a build prompt until then).');
  console.log(cfg.alwaysPay
    ? '  every answer is bought from a peer (CONDUIT_ALWAYS_PAY=0 restores free local routing)\n'
    : '  warming up the local model…\n');
});

async function shutdown() {
  try { await seller.stop(); } catch {}
  try { lock(); } catch {}
  try { await sdk.close?.(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
