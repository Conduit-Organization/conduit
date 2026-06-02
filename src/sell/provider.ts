// Conduit seller — a payment-gated QVAC delegated-inference provider (Mechanism A).
// Started by the seller AFTER it has verified the buyer's payment; the firewall allow-lists
// exactly the paying buyer's consumer pubkey, so only that buyer's Noise handshake succeeds.
// Run as a subprocess:  env PROVIDER_SEED (hex), ALLOWED_PUB (buyer consumer pubkey hex).
import { randomSeedHex } from '../core/identity';

const seedHex = process.env.PROVIDER_SEED || randomSeedHex();
const allowedPub = (process.env.ALLOWED_PUB || '').trim();
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
console.log('PROVIDER_FIREWALL=' + (allowedPub ? 'allow:[' + allowedPub.slice(0, 16) + '…]' : 'OPEN'));
console.log('PROVIDER_READY');

async function shutdown() {
  try { await stopQVACProvider(); } catch {}
  try { await close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30); // stay up to serve the buyer
