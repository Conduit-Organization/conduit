// Phase 3 demo — launches an independent SELLER and BUYER (no coordination); they find each other
// on the storefront topic and run the whole negotiation + paid delegation over P2P. Run: npm run market
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomSeedHex } from '../core/identity';

const here = path.dirname(fileURLToPath(import.meta.url));

function run(rel: string, env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', path.join(here, rel)], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const noise = (label: string) => (d: Buffer) => {
  const s = d.toString();
  // keep only the protocol/answer lines, drop the SDK firehose
  for (const line of s.split('\n')) {
    if (!line.trim()) continue;
    if (/\[(seller|buyer)\]|ANSWER|MARKET_OK|REJECT|stats:|error|Error/i.test(line) && !/\[sdk:|llamacpp|QVACRegistry|bootstrap|IPC|Bare worker/.test(line)) {
      process.stdout.write(`${label} ${line}\n`);
    }
  }
};

console.log('=== Conduit — Phase 3: P2P storefront (independent seller + buyer) ===\n');
const seller = run('../node/sell.ts', { PROVIDER_SEED: randomSeedHex() });
seller.stdout?.on('data', noise(''));
seller.stderr?.on('data', (d: Buffer) => process.stderr.write('[seller!] ' + d));

// give the seller a head start to announce on the DHT, then launch the buyer
setTimeout(() => {
  const buyer = run('../node/buy.ts', { CONSUMER_SEED: randomSeedHex() });
  let buf = '';
  buyer.stdout?.on('data', (d: Buffer) => { buf += d.toString(); noise('')(d); });
  buyer.stderr?.on('data', (d: Buffer) => process.stderr.write('[buyer!] ' + d));
  buyer.on('exit', () => {
    seller.kill('SIGTERM');
    const ok = /MARKET_OK/.test(buf);
    console.log('\nPHASE 3:', ok
      ? 'PASS ✅  independent buyer discovered the seller, negotiated a quote+nonce, paid (identity-bound), and got the delegated answer — no orchestrator.'
      : 'INCOMPLETE — inspect the output above.');
    setTimeout(() => process.exit(0), 400);
  });
}, 6000);
