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
const keystore = await import('../core/keystore');
const sdk: any = await import('@qvac/sdk');

const here = path.dirname(fileURLToPath(import.meta.url));
const appDist = path.join(here, '../../app/dist'); // built React app (npm run app:build)

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

// ---- wallet + dependent services (buyer / storefront / agent are built on unlock) ----
let wallet: { mnemonic: string; address: string } | null = null;
let buyer: any = null;
let storefront: any = null;
let agent: any = null;
let setupErr: string | undefined;

// The local router warms independently of the wallet (free, on-device answers need no key).
let router: any = null;
let routerReady = false;
const routerPromise = (async () => {
  try { router = await createRouter({ k: 5 }); routerReady = true; }
  catch (e: any) { setupErr = String(e?.message ?? e); }
})();

async function unlockWith(mnemonic: string): Promise<string> {
  const acct = await getAccount(mnemonic, cfg.rpcUrl, 0); // buyer = account 0 of this wallet
  const sf = await createStorefront({ buyer: acct, signerPhrase: mnemonic, consumerPub: buyerPub, sdk });
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
  if (!agent && routerReady && storefront) agent = createMarketAgent({ router, policy, storefront });
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

function offerJson(o: { id: string; sellerWallet: string; model: string; priceBaseUnits: bigint; tps: number; online: boolean }) {
  return { id: o.id, address: o.sellerWallet, model: o.model, price: formatUnits(o.priceBaseUnits, DEC), tps: o.tps, online: o.online };
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
    if (req.method === 'GET' && p === '/api/wallet/export') {
      if (!wallet) { json(res, 401, { error: 'wallet locked' }); return; }
      json(res, 200, { mnemonic: wallet.mnemonic });
      return;
    }

    // ---------- state ----------
    if (req.method === 'GET' && p === '/api/state') {
      const w = walletStatus();
      if (!wallet) {
        json(res, 200, { wallet: w, ready: false, sellersOnline: 0, peer: null, selected: 'auto', setupErr: setupErr ?? null });
        return;
      }
      const active = storefront.getActive();
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
        ready: routerReady && !setupErr,
        setupErr: setupErr ?? null,
      });
      return;
    }

    // ---------- marketplace ----------
    if (req.method === 'GET' && p === '/api/sellers') {
      if (!storefront) { json(res, 200, { sellers: [], selected: 'auto' }); return; }
      json(res, 200, { sellers: storefront.list().map(offerJson), selected: storefront.selectedId() });
      return;
    }
    if (req.method === 'POST' && p === '/api/select') {
      if (!storefront) { json(res, 409, { error: 'wallet locked' }); return; }
      const { id } = await readBody(req);
      const active = storefront.select(id || 'auto');
      json(res, 200, { ok: true, selected: storefront.selectedId(), active: active ? offerJson(active) : null });
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
          source: r.source, answer: r.answer, note: r.note ?? null,
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
  console.log('  warming up the local model…\n');
});

async function shutdown() {
  try { lock(); } catch {}
  try { await sdk.close?.(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
