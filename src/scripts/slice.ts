// Conduit — Phase 1 vertical slice (scripted, no agent yet).
//
//   1) buyer pays USD₮ → seller            (real on-chain, WDK)
//   2) seller verifies the payment          (on-chain balance delta)
//   3) payment confirmed → seller opens a firewall-gated provider for ONLY the buyer  (Mechanism A)
//   4) buyer delegates the real inference   (the prober's topSellable model, on the seller's GPU, E2E)
//   5) freeloader (no payment) tries it     → refused at the Noise handshake, 0 bytes
//
// Everything is logged to AUDIT_LOG.jsonl from this one run. Run: npm run slice
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatUnits } from 'ethers';
import { loadConfig } from '../core/config';
import { getAccount } from '../core/wallet';
import { randomSeedHex, publicKeyHexFromSeed } from '../core/identity';
import { makeAudit } from '../core/audit';

const here = path.dirname(fileURLToPath(import.meta.url));
const providerScript = path.join(here, '../sell/provider.ts');
const consumerScript = path.join(here, '../buy/consumer.ts');

const DEC = 6;
const PRICE = 10_000n; // 0.01 USD₮ per inference
const PROMPT = 'In two sentences, explain why settling a payment in a stablecoin is useful when two strangers transact.';

function runNode(script: string, env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', script], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function startProvider(seed: string, allowedPub: string): Promise<{ pub: string; proc: ChildProcess }> {
  const proc = runNode(providerScript, { PROVIDER_SEED: seed, ALLOWED_PUB: allowedPub });
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write('[seller] ' + d));
  return new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('provider not ready in 120s')), 120000);
    proc.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      process.stdout.write('[seller] ' + d);
      const m = buf.match(/PROVIDER_PUBKEY=([0-9a-f]+)/);
      if (m && /PROVIDER_READY/.test(buf)) {
        clearTimeout(to);
        resolve({ pub: m[1]!, proc });
      }
    });
    proc.on('exit', (c) => { clearTimeout(to); reject(new Error('provider exited early, code ' + c)); });
  });
}

function runConsumer(label: string, env: Record<string, string>): Promise<string> {
  const proc = runNode(consumerScript, { LABEL: label, ...env });
  let buf = '';
  proc.stdout?.on('data', (d: Buffer) => { buf += d.toString(); process.stdout.write(`[${label}] ` + d); });
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${label}] ` + d));
  return new Promise((resolve) => proc.on('exit', () => {
    const m = buf.match(/RESULT .*/);
    resolve(m ? m[0] : `RESULT label=${label} outcome=NO_RESULT`);
  }));
}

function parseResult(line: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of line.matchAll(/(\w+)=("[^"]*"|\S+)/g)) o[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  return o;
}

async function main() {
  const cfg = loadConfig();
  const audit = makeAudit(path.join(here, '../../AUDIT_LOG.jsonl'));

  let sellerModel = 'QWEN3_4B_INST_Q4_K_M';
  try {
    const prof = JSON.parse(readFileSync(path.join(here, '../../bench-profile.json'), 'utf8'));
    if (prof.topSellable) sellerModel = prof.topSellable;
  } catch { /* fall back to default */ }

  console.log('=== Conduit — Phase 1 vertical slice ===\n');
  const buyerSeed = randomSeedHex();
  const sellerSeed = randomSeedHex();
  const freeSeed = randomSeedHex();
  const buyerPub = publicKeyHexFromSeed(buyerSeed);
  const freePub = publicKeyHexFromSeed(freeSeed);

  const buyer = await getAccount(cfg.mnemonic, cfg.rpcUrl, 0);
  const seller = await getAccount(cfg.mnemonic, cfg.rpcUrl, 1);
  console.log('buyer  wallet :', buyer.address);
  console.log('seller wallet :', seller.address);
  console.log('seller model  :', sellerModel, '(from bench-profile.json)\n');

  // 1) PAY
  console.log(`1) buyer pays ${formatUnits(PRICE, DEC)} USD₮ → seller …`);
  const s0 = await seller.tokenBalance(cfg.usdtAddress);
  const tx = await buyer.transferToken(cfg.usdtAddress, seller.address, PRICE);
  const hash = tx?.hash ?? String(tx);
  console.log('   tx:', hash);
  audit.log('settlement', { network: 'sepolia', amount_usdt: formatUnits(PRICE, DEC), to: seller.address, tx: hash, status: 'submitted' });

  // 2) SELLER VERIFIES (on-chain)
  console.log('2) seller verifies the payment on-chain …');
  let s1 = s0;
  for (let i = 0; i < 45 && s1 <= s0; i++) { await new Promise((r) => setTimeout(r, 2000)); s1 = await seller.tokenBalance(cfg.usdtAddress); }
  const paid = s1 - s0 >= PRICE;
  console.log(`   verified: ${paid}  (seller +${formatUnits(s1 - s0, DEC)} USD₮)`);
  audit.log('settlement', { tx: hash, status: paid ? 'confirmed' : 'unconfirmed' });
  if (!paid) throw new Error('payment not confirmed');

  // 3) GATE — exists only because payment confirmed
  console.log('3) payment confirmed → seller opens a firewall-gated provider for the buyer …');
  const { pub: providerPub, proc: provider } = await startProvider(sellerSeed, buyerPub);
  console.log('   provider pubkey:', providerPub.slice(0, 24) + '…');
  audit.log('p2p', { sub: 'gate_opened', provider: providerPub, allowed_buyer: buyerPub });

  // 4) BUYER DELEGATES the real inference
  console.log(`\n4) buyer delegates the ${sellerModel} inference over E2E P2P (runs on the seller's GPU) …`);
  const buyerOut = await runConsumer('buyer', { CONSUMER_SEED: buyerSeed, PROVIDER_PUBKEY: providerPub, MODEL: sellerModel, PROMPT });
  const br = parseResult(buyerOut);
  if (br.outcome === 'GRANTED_SERVED') {
    audit.log('p2p', { sub: 'handshake_granted', peer: buyerPub, cloud_bytes: 0 });
    audit.log('inference', {
      model: sellerModel, role: 'delegated',
      ttft_ms: Number(br.ttftMs) || null, tps: Number(br.tps) || null,
      total_tokens: Number(br.totalTokens) || null, answer_chars: Number(br.answerChars) || null,
      cloud_bytes: 0,
    });
  }

  // 5) FREELOADER — no payment, not allow-listed
  console.log(`\n5) freeloader (never paid) tries the same seller …`);
  const freeOut = await runConsumer('freeloader', { CONSUMER_SEED: freeSeed, PROVIDER_PUBKEY: providerPub, MODEL: sellerModel, PROMPT });
  const fr = parseResult(freeOut);
  if (fr.outcome === 'REJECTED') audit.log('p2p', { sub: 'handshake_rejected', peer: freePub, reason: 'not_allow_listed', bytes_served: 0 });

  provider.kill('SIGTERM');

  console.log('\n=== RESULT ===');
  console.log('  buyer     :', buyerOut);
  console.log('  freeloader:', freeOut);
  const ok = br.outcome === 'GRANTED_SERVED' && fr.outcome === 'REJECTED';
  console.log('\nPHASE 1:', ok
    ? `PASS ✅  paid buyer served the ${sellerModel} over E2E P2P; freeloader refused at the handshake. 0 cloud bytes.`
    : 'INCOMPLETE — inspect the results above');
  console.log('settlement tx:', hash);
  console.log('audit log    :', audit.path);
}

main()
  .then(() => setTimeout(() => process.exit(0), 400))
  .catch((e) => { console.error('PHASE 1 ERROR:', e?.message ?? e); process.exit(1); });
