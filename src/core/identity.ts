// Conduit identity = a Holepunch (Hyperswarm) keypair derived from a 32-byte seed.
//
// QVAC sets a node's P2P identity from the QVAC_HYPERSWARM_SEED env var and builds its swarm
// with `new Hyperswarm({ seed })` (verified in @qvac/sdk@0.12 dist source). We confirmed that
//   Hyperswarm({ seed }).keyPair.publicKey === HyperDHT.keyPair(seed).publicKey
// so we can derive a peer's public key from its seed locally. This replaces the
// `getConsumerPublicKey` helper that the docs referenced but 0.12 does not export.
import HyperDHT from 'hyperdht';
import b4a from 'b4a';
import crypto from 'node:crypto';

export type Hex = string;

/** A fresh random 32-byte seed as 64 hex chars. */
export function randomSeedHex(): Hex {
  return crypto.randomBytes(32).toString('hex');
}

/** The 32-byte seed buffer for a hex seed. */
export function seedBuf(seedHex: Hex): Buffer {
  return Buffer.from(seedHex, 'hex');
}

/** The Hyperswarm/QVAC public key (hex) for a given seed — matches QVAC's own identity. */
export function publicKeyHexFromSeed(seedHex: Hex): Hex {
  const kp = HyperDHT.keyPair(b4a.from(seedHex, 'hex'));
  return b4a.toString(kp.publicKey, 'hex');
}

/** Set this process's QVAC P2P identity. MUST be called before importing/using @qvac/sdk P2P. */
export function useQvacSeed(seedHex: Hex): { seedHex: Hex; publicKeyHex: Hex } {
  process.env.QVAC_HYPERSWARM_SEED = seedHex;
  return { seedHex, publicKeyHex: publicKeyHexFromSeed(seedHex) };
}
