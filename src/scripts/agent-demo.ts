// Conduit — Phase 2 demo: the autonomous buyer agent.
//
// This process IS the buyer (its QVAC identity = buyerSeed). It runs the confidence router locally,
// and on low confidence pays + delegates to a firewall-gated seller provider (spawned subprocess) —
// all under a hard spend budget. Watch it answer easy prompts free, pay to escalate hard ones, and
// REFUSE to escalate once the budget is spent.  Run: npm run agent
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { formatUnits } from 'ethers';
import { randomSeedHex, publicKeyHexFromSeed } from '../core/identity';

// Set this process's QVAC identity = the buyer, BEFORE any QVAC use (router/agent import the SDK lazily).
const buyerSeed = randomSeedHex();
const buyerPub = publicKeyHexFromSeed(buyerSeed);
process.env.QVAC_HYPERSWARM_SEED = buyerSeed;

const { loadConfig } = await import('../core/config');
const { getAccount } = await import('../core/wallet');
const { makeAudit } = await import('../core/audit');
const { SpendPolicy } = await import('../buy/policy');
const { createRouter } = await import('../buy/router');
const { createAgent } = await import('../buy/agent');

const here = path.dirname(fileURLToPath(import.meta.url));
const providerScript = path.join(here, '../sell/provider.ts');

const DEC = 6;
const PRICE = 10_000n; // 0.01 USD₮ per escalation
const MAX_PER_CALL = 50_000n; // 0.05 USD₮
const MAX_BUDGET = 10_000n; // 0.01 USD₮ total → exactly ONE escalation (so the 2nd hard prompt is refused)

// Mix of clearly-easy (stable → LOCAL/free) and open-ended (divergent → ESCALATE/pay) prompts.
// Self-consistency reliably flags creative/ambiguous prompts (where a small model's samples diverge);
// factual-but-hard prompts where a tiny model confidently converges are a known limitation (a product
// signal would add self-assessment/verification — see findings).
const PROMPTS = [
  'What is the capital of France? Answer in one word.',
  'Write a single original, never-before-seen one-line aphorism about time.',
  'What is 12 + 12? Reply with only the number.',
  'Invent an original brand name for a peer-to-peer GPU-rental marketplace, and justify it in one sentence.',
];

function startProvider(seed: string, allowedPub: string): Promise<{ pub: string; proc: ChildProcess }> {
  const proc = spawn(process.execPath, ['--import', 'tsx', providerScript], {
    env: { ...process.env, PROVIDER_SEED: seed, ALLOWED_PUB: allowedPub },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write('[seller] ' + d));
  return new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('provider not ready in 120s')), 120000);
    proc.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/PROVIDER_PUBKEY=([0-9a-f]+)/);
      if (m && /PROVIDER_READY/.test(buf)) { clearTimeout(to); resolve({ pub: m[1]!, proc }); }
    });
    proc.on('exit', (c) => { clearTimeout(to); reject(new Error('provider exited early, code ' + c)); });
  });
}

async function main() {
  const cfg = loadConfig();
  const audit = makeAudit(path.join(here, '../../AUDIT_LOG.jsonl'));
  let sellerModel = 'QWEN3_4B_INST_Q4_K_M';
  try {
    const p = JSON.parse(readFileSync(path.join(here, '../../bench-profile.json'), 'utf8'));
    if (p.topSellable) sellerModel = p.topSellable;
  } catch { /* default */ }

  const sellerSeed = randomSeedHex();
  const buyer = await getAccount(cfg.mnemonic, cfg.rpcUrl, 0);
  const seller = await getAccount(cfg.mnemonic, cfg.rpcUrl, 1);

  console.log('=== Conduit — Phase 2: autonomous buyer agent ===');
  console.log('buyer :', buyer.address, '| seller:', seller.address);
  console.log(`budget: ${formatUnits(PRICE, DEC)} USD₮/escalation · ${formatUnits(MAX_BUDGET, DEC)} total · ${formatUnits(MAX_PER_CALL, DEC)} per-call cap`);
  console.log('seller model:', sellerModel, '\n');

  const { pub: providerPub, proc: provider } = await startProvider(sellerSeed, buyerPub);
  audit.log('p2p', { sub: 'gate_opened', provider: providerPub, allowed_buyer: buyerPub });

  const policy = new SpendPolicy(MAX_PER_CALL, MAX_BUDGET);
  const router = await createRouter({ k: 5 });
  const agent = await createAgent({ router, buyer, sellerAccount: seller, token: cfg.usdtAddress, sellerModel, providerPub, price: PRICE, policy, log: (m) => console.log(m) });

  for (const prompt of PROMPTS) {
    console.log('\n────────────────────────────────────────');
    console.log('Q:', prompt);
    const res = await agent.ask(prompt);
    const tag = res.source === 'local' ? 'LOCAL · free'
      : res.source === 'paid' ? `PAID · ${formatUnits(res.cost, DEC)} USD₮`
      : 'DECLINED → local';
    console.log(`  router consistency=${res.consistency.toFixed(3)}  →  ${tag}`);
    if (res.note) console.log('  note:', res.note);
    console.log('  A:', res.answer.slice(0, 240).replace(/\s+/g, ' '));

    if (res.source === 'paid') {
      audit.log('settlement', { network: 'sepolia', amount_usdt: formatUnits(res.cost, DEC), to: seller.address, tx: res.tx, status: 'confirmed' });
      audit.log('p2p', { sub: 'handshake_granted', peer: buyerPub, cloud_bytes: 0 });
      audit.log('inference', { model: sellerModel, role: 'delegated', ttft_ms: res.stats?.ttftMs ?? null, tps: res.stats?.tps ?? null, prompt_tokens: res.stats?.promptTokens ?? null, answer_chars: res.answer.length, cost_usdt: formatUnits(res.cost, DEC), cloud_bytes: 0 });
    } else {
      audit.log('inference', { model: 'QWEN3_600M_INST_Q4', role: 'local', consistency: Number(res.consistency.toFixed(3)), decision: res.source, cost_usdt: '0', cloud_bytes: 0 });
    }
  }

  await router.close();
  provider.kill('SIGTERM');
  console.log('\n=== summary ===');
  console.log(`spent ${formatUnits(policy.spent, DEC)} / ${formatUnits(MAX_BUDGET, DEC)} USD₮ budget · audit: ${audit.path}`);
}

main()
  .then(() => setTimeout(() => process.exit(0), 400))
  .catch((e) => { console.error('PHASE 2 ERROR:', e?.message ?? e); process.exit(1); });
