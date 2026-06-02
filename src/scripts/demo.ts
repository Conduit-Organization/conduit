// Conduit — the headline demo (the ≤5-min story), in one run:
//   ① free local answer (cheap 0.6B, $0, 0 cloud bytes)
//   ② the agent detects low confidence → pays USD₮ → gets a SoTA answer from the seller's 4B over E2E
//   ③ a freeloader (never paid) is refused at the Noise handshake — 0 bytes served
// with a live USD₮ ledger + cloud_bytes=0 counter, and a one-run JSONL audit. Run: npm run demo
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { formatUnits } from 'ethers';
import { randomSeedHex, publicKeyHexFromSeed } from '../core/identity';

// this process = the buyer (set QVAC identity before the SDK loads)
const buyerSeed = randomSeedHex();
const buyerPub = publicKeyHexFromSeed(buyerSeed);
process.env.QVAC_HYPERSWARM_SEED = buyerSeed;

const { loadConfig } = await import('../core/config');
const { getAccount } = await import('../core/wallet');
const { makeAudit } = await import('../core/audit');
const { renderLedger } = await import('../core/ledger');
const { SpendPolicy } = await import('../buy/policy');
const { createRouter } = await import('../buy/router');
const { createAgent } = await import('../buy/agent');

const here = path.dirname(fileURLToPath(import.meta.url));
const providerScript = path.join(here, '../sell/provider.ts');
const consumerScript = path.join(here, '../buy/consumer.ts');

const DEC = 6;
const PRICE = 10_000n; // 0.01 USD₮
const MAX_PER_CALL = 50_000n;
const MAX_BUDGET = 20_000n; // up to 2 escalations
const EASY = 'What is the capital of France? Answer in one word.';
const HARD = 'Write a single original, never-before-seen one-line aphorism about trust.';

function runNode(script: string, env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}
function startProvider(seed: string, allowedPub: string): Promise<{ pub: string; proc: ChildProcess }> {
  const proc = runNode(providerScript, { PROVIDER_SEED: seed, ALLOWED_PUB: allowedPub });
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write('[seller] ' + d));
  return new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('provider not ready in 120s')), 120000);
    proc.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/PROVIDER_PUBKEY=([0-9a-f]+)/);
      if (m && /PROVIDER_READY/.test(buf)) { clearTimeout(to); resolve({ pub: m[1]!, proc }); }
    });
    proc.on('exit', (c) => { clearTimeout(to); reject(new Error('provider exited early ' + c)); });
  });
}
function runConsumer(label: string, env: Record<string, string>): Promise<string> {
  const proc = runNode(consumerScript, { LABEL: label, ...env });
  let buf = '';
  proc.stdout?.on('data', (d: Buffer) => { buf += d.toString(); });
  proc.stderr?.on('data', () => {});
  return new Promise((resolve) => proc.on('exit', () => {
    const m = buf.match(/RESULT .*/);
    resolve(m ? m[0] : 'RESULT outcome=NO_RESULT');
  }));
}

async function main() {
  const cfg = loadConfig();
  const audit = makeAudit(path.join(here, '../../AUDIT_LOG.jsonl'));
  let sellerModel = 'QWEN3_4B_INST_Q4_K_M';
  try { const p = JSON.parse(readFileSync(path.join(here, '../../bench-profile.json'), 'utf8')); if (p.topSellable) sellerModel = p.topSellable; } catch {}

  const sellerSeed = randomSeedHex();
  const freeSeed = randomSeedHex();
  const freePub = publicKeyHexFromSeed(freeSeed);
  const buyer = await getAccount(cfg.mnemonic, cfg.rpcUrl, 0);
  const seller = await getAccount(cfg.mnemonic, cfg.rpcUrl, 1);

  console.log('=== Conduit — pay-to-access P2P inference ===');
  console.log(`seller model: ${sellerModel} · price ${formatUnits(PRICE, DEC)} USD₮/call\n`);
  const buyer0 = await buyer.tokenBalance(cfg.usdtAddress);
  const seller0 = await seller.tokenBalance(cfg.usdtAddress);

  const { pub: providerPub, proc: provider } = await startProvider(sellerSeed, buyerPub);
  audit.log('p2p', { sub: 'gate_opened', provider: providerPub, allowed_buyer: buyerPub });

  const policy = new SpendPolicy(MAX_PER_CALL, MAX_BUDGET);
  const router = await createRouter({ k: 5 });
  const agent = await createAgent({ router, buyer, sellerAccount: seller, token: cfg.usdtAddress, sellerModel, providerPub, price: PRICE, policy, log: (m) => console.log(m) });

  // ① free local
  console.log('① local · free  —', JSON.stringify(EASY));
  const r1 = await agent.ask(EASY);
  console.log(`   ${r1.source.toUpperCase()} · consistency ${r1.consistency.toFixed(3)} · cost $0`);
  console.log('   A:', r1.answer.slice(0, 140).replace(/\s+/g, ' '));
  audit.log('inference', { model: 'QWEN3_600M_INST_Q4', role: 'local', decision: r1.source, cost_usdt: '0', cloud_bytes: 0 });

  // ② pay to escalate
  console.log('\n② escalate · pay  —', JSON.stringify(HARD));
  const r2 = await agent.ask(HARD);
  console.log(`   ${r2.source.toUpperCase()} · consistency ${r2.consistency.toFixed(3)}${r2.cost ? ` · paid ${formatUnits(r2.cost, DEC)} USD₮` : ''}`);
  console.log('   A:', r2.answer.slice(0, 220).replace(/\s+/g, ' '));
  if (r2.source === 'paid') {
    audit.log('settlement', { network: 'sepolia', amount_usdt: formatUnits(r2.cost, DEC), to: seller.address, tx: r2.tx, status: 'confirmed' });
    audit.log('p2p', { sub: 'handshake_granted', peer: buyerPub, cloud_bytes: 0 });
    audit.log('inference', { model: sellerModel, role: 'delegated', ttft_ms: r2.stats?.ttftMs ?? null, tps: r2.stats?.tps ?? null, prompt_tokens: r2.stats?.promptTokens ?? null, cost_usdt: formatUnits(r2.cost, DEC), cloud_bytes: 0 });
  }

  // ③ freeloader refused
  console.log('\n③ freeloader · no payment');
  const fres = await runConsumer('freeloader', { CONSUMER_SEED: freeSeed, PROVIDER_PUBKEY: providerPub, MODEL: sellerModel });
  const rejected = /outcome=REJECTED/.test(fres);
  console.log('  ', rejected ? 'REJECTED at the Noise handshake — 0 bytes served' : '(unexpected) ' + fres);
  if (rejected) audit.log('p2p', { sub: 'handshake_rejected', peer: freePub, reason: 'not_allow_listed', bytes_served: 0 });

  const buyer1 = await buyer.tokenBalance(cfg.usdtAddress);
  const seller1 = await seller.tokenBalance(cfg.usdtAddress);
  await router.close();
  provider.kill('SIGTERM');

  console.log('\n' + renderLedger({ buyerStart: buyer0, sellerStart: seller0, buyerNow: buyer1, sellerNow: seller1, cloudBytes: 0 }, DEC));
  console.log('\naudit log:', audit.path);
  const ok = r1.source === 'local' && r2.source === 'paid' && rejected;
  console.log('\nDEMO:', ok ? 'PASS ✅  free local · paid 4B escalation · freeloader refused · 0 cloud bytes' : 'see beats above');
}

main()
  .then(() => setTimeout(() => process.exit(0), 400))
  .catch((e) => { console.error('DEMO ERROR:', e?.message ?? e); process.exit(1); });
