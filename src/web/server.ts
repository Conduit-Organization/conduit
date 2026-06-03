// Conduit local web app — the consumer (buyer) face. A tiny Node server wraps the proven engine
// (confidence router + spend policy) and the live P2P storefront, and serves a chat + wallet UI.
// This process is the BUYER. Sellers are separate processes/machines (`npm run sell`) discovered
// over Hyperswarm; the buyer pays one of them per inference. Run: npm run web
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

const cfg = loadConfig();
const buyer = await getAccount(cfg.mnemonic, cfg.rpcUrl, 0); // this process = buyer = account 0
const policy = new SpendPolicy(MAX_PER_CALL, MAX_BUDGET);

// The live marketplace client — discovers sellers immediately so the UI can browse before asking.
const storefront = await createStorefront({ buyer, signerPhrase: cfg.mnemonic, consumerPub: buyerPub, sdk });

let setupErr: string | undefined;

// Lazy, warm-on-boot: load the local router + market agent without blocking the UI.
let agentPromise: Promise<any> | null = null;
let agentReady = false;
function ensureAgent(): Promise<any> {
  if (!agentPromise) {
    agentPromise = (async () => {
      const router = await createRouter({ k: 5 });
      const agent = createMarketAgent({ router, policy, storefront });
      agentReady = true;
      return agent;
    })().catch((e) => { setupErr = String(e?.message ?? e); throw e; });
  }
  return agentPromise;
}

function json(res: http.ServerResponse, code: number, obj: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function offerJson(o: { id: string; sellerWallet: string; model: string; priceBaseUnits: bigint; tps: number; online: boolean }) {
  return { id: o.id, address: o.sellerWallet, model: o.model, price: formatUnits(o.priceBaseUnits, DEC), tps: o.tps, online: o.online };
}

// Serve a file from the built React app; returns false if it's not a real file under appDist.
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

// Serve the consumer UI: built React app if present (SPA fallback to its index.html),
// else a short build-prompt page so `npm run web` before `npm run app:build` is self-explanatory.
function serveApp(res: http.ServerResponse, pathname: string) {
  if (serveStatic(res, pathname)) return;
  if (existsSync(path.join(appDist, 'index.html'))) { serveStatic(res, '/'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(buildPrompt);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  void (async () => {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const active = storefront.getActive();
      const [bU, bE] = await Promise.all([buyer.tokenBalance(cfg.usdtAddress), buyer.ethBalance()]);
      json(res, 200, {
        buyer: { address: buyer.address, usdt: formatUnits(bU, DEC), eth: formatUnits(bE, 18) },
        cloudBytes: 0,
        spent: formatUnits(policy.spent, DEC),
        budget: formatUnits(MAX_BUDGET, DEC),
        sellerModel: active?.model ?? null,
        price: active ? formatUnits(active.priceBaseUnits, DEC) : null,
        peer: active ? offerJson(active) : null,
        sellersOnline: storefront.list().filter((o) => o.online).length,
        selected: storefront.selectedId(),
        ready: agentReady && !setupErr,
        setupErr: setupErr ?? null,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sellers') {
      json(res, 200, { sellers: storefront.list().map(offerJson), selected: storefront.selectedId() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/select') {
      const body = await readBody(req);
      let id = 'auto';
      try { id = JSON.parse(body).id || 'auto'; } catch {}
      const active = storefront.select(id);
      json(res, 200, { ok: true, selected: storefront.selectedId(), active: active ? offerJson(active) : null });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      const body = await readBody(req);
      let prompt = '';
      try { prompt = JSON.parse(body).prompt || ''; } catch {}
      if (!prompt.trim()) { json(res, 400, { error: 'empty prompt' }); return; }
      try {
        const agent = await ensureAgent();
        const r = await agent.ask(prompt);
        json(res, 200, {
          source: r.source, answer: r.answer, note: r.note ?? null,
          consistency: Number(r.consistency.toFixed(3)), cost: formatUnits(r.cost, DEC),
          stats: { ttftMs: r.stats?.ttftMs ?? null, tps: r.stats?.tps ?? null },
        });
      } catch (e: any) { json(res, 500, { error: String(e?.message ?? e) }); }
      return;
    }
    if (req.method === 'GET') { serveApp(res, url.pathname); return; }
    res.writeHead(404); res.end('not found');
  })();
});

server.listen(PORT, () => {
  const built = existsSync(path.join(appDist, 'index.html'));
  console.log(`\n  ⬡ Conduit — open  →  http://localhost:${PORT}\n`);
  console.log(`  buyer ${buyer.address} · searching the storefront for sellers (run \`npm run sell\` on a GPU peer)…`);
  if (!built) console.log('  note: React app not built — run `npm run app:build` for the UI (showing a build prompt until then).');
  console.log('  warming up the local model…\n');
  void ensureAgent(); // warm the local router so the first free answer is fast
});

async function shutdown() {
  try { await storefront.close(); } catch {}
  try { await sdk.close?.(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
