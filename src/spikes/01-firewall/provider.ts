// Spike #1 — PROVIDER. Starts a QVAC delegated-inference provider whose firewall allow-lists
// exactly one consumer pubkey (the "paid buyer"). Prints its provider public key, then stays up.
//
// Env in:  PROVIDER_SEED (hex, optional), ALLOWED_PUB (hex consumer key, optional)
// Stdout:  PROVIDER_PUBKEY=<hex>   (QVAC's reported key)
//          PROVIDER_DERIVED=<hex>  (our local derivation — should equal the above)
//          PROVIDER_READY
import { publicKeyHexFromSeed, randomSeedHex } from '../../core/identity';

const seedHex = process.env.PROVIDER_SEED || randomSeedHex();
const allowedPub = (process.env.ALLOWED_PUB || '').trim();

// Identity MUST be set before the SDK touches the swarm.
process.env.QVAC_HYPERSWARM_SEED = seedHex;

const { startQVACProvider, stopQVACProvider, close } = await import('@qvac/sdk');

const res = await startQVACProvider(
  allowedPub ? { firewall: { mode: 'allow', publicKeys: [allowedPub] } } : undefined,
);

if (!res?.success || !res.publicKey) {
  console.error('PROVIDER_ERROR=' + JSON.stringify(res));
  process.exit(1);
}

console.log('PROVIDER_PUBKEY=' + res.publicKey);
console.log('PROVIDER_DERIVED=' + publicKeyHexFromSeed(seedHex));
console.log('PROVIDER_FIREWALL=' + (allowedPub ? `allow:[${allowedPub.slice(0, 16)}…]` : 'none(open)'));
console.log('PROVIDER_READY');

async function shutdown() {
  try { await stopQVACProvider(); } catch {}
  try { await close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.env.SMOKE) {
  setTimeout(shutdown, 1200); // smoke mode: report identity, then exit
} else {
  setInterval(() => {}, 1 << 30); // stay up to serve consumers
}
