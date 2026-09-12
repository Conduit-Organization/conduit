import test from 'node:test';
import assert from 'node:assert/strict';
import { NETWORKS, DEFAULT_NETWORK, sameSettlementNetwork } from './networks';
import { loadEscrowDeployment } from './escrow';

// A packaged build once shipped a Sepolia escrow address paired with Arc's RPC: every
// purchase died on `could not decode result data (method "channels")`, because the address
// held no code on that chain. These tests pin the two invariants that make that
// unrepresentable.

test('every network profile pairs its escrow with its own chain id', () => {
  for (const [name, p] of Object.entries(NETWORKS)) {
    assert.equal(p.name, name, `${name}: profile key and name disagree`);
    assert.ok(Number.isInteger(p.chainId) && p.chainId > 0, `${name}: bad chainId`);
    if (p.escrow) assert.match(p.escrow, /^0x[0-9a-fA-F]{40}$/, `${name}: bad escrow address`);
  }
});

test('the default network resolves to an escrow on that same chain', () => {
  const profile = NETWORKS[DEFAULT_NETWORK];
  assert.ok(profile, `DEFAULT_NETWORK ${DEFAULT_NETWORK} has no profile`);

  const env = { ...process.env };
  delete process.env.CONDUIT_ESCROW_ADDRESS;
  delete process.env.CONDUIT_CHAIN_ID;
  delete process.env.CONDUIT_NETWORK;
  try {
    const dep = loadEscrowDeployment();
    assert.ok(dep, 'default network resolved no escrow deployment');
    assert.equal(dep.address, profile.escrow);
    // The bug: a real address carrying some OTHER network's chain id.
    assert.equal(dep.chainId, profile.chainId);
  } finally {
    process.env = env;
  }
});

test('an address override does not drag a foreign chain id along with it', () => {
  const env = { ...process.env };
  process.env.CONDUIT_NETWORK = 'arc-testnet';
  process.env.CONDUIT_ESCROW_ADDRESS = '0x' + '11'.repeat(20);
  delete process.env.CONDUIT_CHAIN_ID;
  try {
    const dep = loadEscrowDeployment();
    assert.equal(dep?.chainId, NETWORKS['arc-testnet']!.chainId,
      'override inherited the wrong chain id');
  } finally {
    process.env = env;
  }
});

test('cross-network sellers are unreachable, same-network ones are reachable', () => {
  const arc = NETWORKS['arc-testnet']!.chainId;
  const sep = NETWORKS['sepolia']!.chainId;
  assert.equal(sameSettlementNetwork(arc, arc), true);
  assert.equal(sameSettlementNetwork(sep, arc), false, 'a Sepolia seller must not be routable from Arc');
  assert.equal(sameSettlementNetwork(arc, sep), false);
  // Tolerances, which must match on both sides of the UI/router boundary.
  assert.equal(sameSettlementNetwork(undefined, arc), true, 'a silent peer is assumed local');
  assert.equal(sameSettlementNetwork(sep, undefined), true, 'no escrow of our own → nothing to mismatch');
});
