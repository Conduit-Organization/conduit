// Spike #1 orchestrator — proves "payment = the gate opens" + "no pay = refused at handshake".
//
// Generates fresh identities, starts a provider that allow-lists ONLY the buyer, then runs:
//   1) the freeloader (not allow-listed)  -> expect REJECTED at the handshake, 0 tokens
//   2) the buyer      (allow-listed)      -> expect GRANTED_SERVED (tokens stream back)
//
// Run: npm run spike:firewall
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomSeedHex, publicKeyHexFromSeed } from '../../core/identity';

const here = path.dirname(fileURLToPath(import.meta.url));
const providerScript = path.join(here, 'provider.ts');
const consumerScript = path.join(here, 'consumer.ts');

function runNode(script: string, env: Record<string, string>) {
  return spawn(process.execPath, ['--import', 'tsx', script], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function startProvider(allowedPub: string): Promise<{ pub: string; proc: ReturnType<typeof spawn> }> {
  const seed = randomSeedHex();
  const proc = runNode(providerScript, { PROVIDER_SEED: seed, ALLOWED_PUB: allowedPub });
  proc.stderr?.on('data', (d) => process.stderr.write('[provider] ' + d));
  return new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('provider not ready in 120s')), 120000);
    proc.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      process.stdout.write('[provider] ' + d);
      const m = buf.match(/PROVIDER_PUBKEY=([0-9a-f]+)/);
      if (m && /PROVIDER_READY/.test(buf)) {
        clearTimeout(to);
        resolve({ pub: m[1]!, proc });
      }
    });
    proc.on('exit', (c) => { clearTimeout(to); reject(new Error('provider exited early, code ' + c)); });
  });
}

function runConsumer(label: string, seed: string, providerPub: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = runNode(consumerScript, { LABEL: label, CONSUMER_SEED: seed, PROVIDER_PUBKEY: providerPub });
    let buf = '';
    proc.stdout?.on('data', (d: Buffer) => { buf += d.toString(); process.stdout.write(`[${label}] ` + d); });
    proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${label}] ` + d));
    proc.on('exit', () => {
      const m = buf.match(/RESULT .*/);
      resolve(m ? m[0] : `RESULT label=${label} outcome=NO_RESULT`);
    });
  });
}

console.log('=== Spike #1 — payment-gated firewall ===\n');
const buyerSeed = randomSeedHex();
const freeloaderSeed = randomSeedHex();
const buyerPub = publicKeyHexFromSeed(buyerSeed);
console.log('buyer pubkey (allow-listed): ' + buyerPub.slice(0, 24) + '…');

const { pub: providerPub, proc: provider } = await startProvider(buyerPub);
console.log('provider pubkey:             ' + providerPub.slice(0, 24) + '…\n');

console.log('--- freeloader (NOT allow-listed) ---');
const freeloaderResult = await runConsumer('freeloader', freeloaderSeed, providerPub);
console.log('\n--- buyer (allow-listed) ---');
const buyerResult = await runConsumer('buyer', buyerSeed, providerPub);

provider.kill('SIGTERM');

console.log('\n=== RESULTS ===');
console.log('  ' + buyerResult);
console.log('  ' + freeloaderResult);
const pass = /buyer outcome=GRANTED/.test(buyerResult) && /freeloader outcome=REJECTED/.test(freeloaderResult);
console.log('\nSPIKE #1: ' + (pass
  ? 'PASS ✅  paid buyer granted, freeloader refused at the handshake'
  : 'INCONCLUSIVE — inspect the results above'));
setTimeout(() => process.exit(0), 300);
