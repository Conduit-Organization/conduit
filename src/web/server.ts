// Conduit local web app — the consumer face. A tiny Node server wraps the proven engine
// (confidence router + agent + wallet) and serves a chat + wallet UI. Open the printed URL.
// This process is the buyer; it runs a local seller in the background for a self-contained demo.
// Run: npm run web
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { formatUnits } from 'ethers';
import { randomSeedHex, publicKeyHexFromSeed } from '../core/identity';

const PORT = Number(process.env.PORT || 8788);
const buyerSeed = randomSeedHex();
const buyerPub = publicKeyHexFromSeed(buyerSeed);
process.env.QVAC_HYPERSWARM_SEED = buyerSeed; // this process = buyer (set before SDK loads)

const { loadConfig } = await import('../core/config');
const { getAccount } = await import('../core/wallet');
const { SpendPolicy } = await import('../buy/policy');
const { createRouter } = await import('../buy/router');
const { createAgent } = await import('../buy/agent');

const here = path.dirname(fileURLToPath(import.meta.url));
const providerScript = path.join(here, '../sell/provider.ts');
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
const PRICE = 10_000n; // 0.01 USD₮ / escalation
const MAX_PER_CALL = 100_000n;
const MAX_BUDGET = 1_000_000n; // 1 USD₮ session budget

const cfg = loadConfig();
const buyer = await getAccount(cfg.mnemonic, cfg.rpcUrl, 0);
const seller = await getAccount(cfg.mnemonic, cfg.rpcUrl, 1);
const policy = new SpendPolicy(MAX_PER_CALL, MAX_BUDGET);
let sellerModel = 'QWEN3_4B_INST_Q4_K_M';
try { const p = JSON.parse(readFileSync(path.join(here, '../../bench-profile.json'), 'utf8')); if (p.topSellable) sellerModel = p.topSellable; } catch {}

let sellerProc: ChildProcess | undefined;
let setupErr: string | undefined;

// Lazy, warm-on-boot setup: spawn the local seller + load the router/agent without blocking the UI.
let agentPromise: Promise<any> | null = null;
let agentReady = false; // true only once the seller + router + agent are fully loaded
function ensureAgent(): Promise<any> {
  if (!agentPromise) {
    agentPromise = (async () => {
      const provided = await startProvider(randomSeedHex(), buyerPub);
      sellerProc = provided.proc;
      const router = await createRouter({ k: 5 });
      const agent = await createAgent({ router, buyer, sellerAccount: seller, token: cfg.usdtAddress, sellerModel, providerPub: provided.pub, price: PRICE, policy });
      agentReady = true;
      return agent;
    })().catch((e) => { setupErr = String(e?.message ?? e); throw e; });
  }
  return agentPromise;
}

function startProvider(seed: string, allowedPub: string): Promise<{ pub: string; proc: ChildProcess }> {
  const proc = spawn(process.execPath, ['--import', 'tsx', providerScript], { env: { ...process.env, PROVIDER_SEED: seed, ALLOWED_PUB: allowedPub }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr?.on('data', () => {});
  return new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('seller not ready in 120s')), 120000);
    proc.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/PROVIDER_PUBKEY=([0-9a-f]+)/);
      if (m && /PROVIDER_READY/.test(buf)) { clearTimeout(to); resolve({ pub: m[1]!, proc }); }
    });
    proc.on('exit', (c) => { clearTimeout(to); reject(new Error('seller exited ' + c)); });
  });
}

function json(res: http.ServerResponse, code: number, obj: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  void (async () => {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const [bU, bE, sU] = await Promise.all([buyer.tokenBalance(cfg.usdtAddress), buyer.ethBalance(), seller.tokenBalance(cfg.usdtAddress)]);
      json(res, 200, {
        buyer: { address: buyer.address, usdt: formatUnits(bU, DEC), eth: formatUnits(bE, 18) },
        cloudBytes: 0,
        spent: formatUnits(policy.spent, DEC),
        budget: formatUnits(MAX_BUDGET, DEC),
        sellerModel,
        price: formatUnits(PRICE, DEC),
        ready: agentReady && !setupErr,
        setupErr: setupErr ?? null,
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let prompt = '';
        try { prompt = JSON.parse(body).prompt || ''; } catch {}
        if (!prompt.trim()) return json(res, 400, { error: 'empty prompt' });
        try {
          const agent = await ensureAgent();
          const r = await agent.ask(prompt);
          json(res, 200, {
            source: r.source, answer: r.answer, note: r.note ?? null,
            consistency: Number(r.consistency.toFixed(3)), cost: formatUnits(r.cost, DEC),
            stats: { ttftMs: r.stats?.ttftMs ?? null, tps: r.stats?.tps ?? null },
          });
        } catch (e: any) { json(res, 500, { error: String(e?.message ?? e) }); }
      });
      return;
    }
    if (req.method === 'GET') { serveApp(res, url.pathname); return; }
    res.writeHead(404); res.end('not found');
  })();
});

server.listen(PORT, () => {
  const built = existsSync(path.join(appDist, 'index.html'));
  console.log(`\n  ⬡ Conduit — open  →  http://localhost:${PORT}\n`);
  console.log(`  buyer ${buyer.address} · seller model ${sellerModel} · ${formatUnits(PRICE, DEC)} USD₮/escalation`);
  if (!built) console.log('  note: React app not built — run `npm run app:build` for the UI (showing a build prompt until then).');
  console.log('  warming up the local model + seller…\n');
  void ensureAgent(); // warm in background so the first question is fast
});

function shutdown() { try { sellerProc?.kill('SIGTERM'); } catch {} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
