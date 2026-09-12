import test from 'node:test';
import assert from 'node:assert/strict';
import { explainPurchaseFailure } from './explain';

// The rule this file defends: a seller's own words survive untouched, and the plumbing
// underneath never reaches the buyer in the library's vocabulary.

test('a seller refusal is passed through exactly', () => {
  // These reasons ARE the accountability layers becoming visible. Rewriting them would
  // hide the thing the product exists to show.
  for (const reason of [
    'seller rejected: unverified human',
    'seller rejected: buyer abandonment history',
    'seller rejected: seller rpc unavailable, retry',
  ]) {
    const { note } = explainPurchaseFailure(new Error(reason));
    assert.equal(note, reason);
  }
});

test('the wrong-network decode error becomes a network explanation', () => {
  // The exact text a buyer saw when the app was pointed at the wrong chain.
  const err = new Error('could not decode result data (value="0x", info={ "method": "channels", "signature": "channels(address,address)" }, code=BAD_DATA, version=6.13.4)');
  const { note, raw } = explainPurchaseFailure(err);
  assert.match(note, /escrow contract did not answer on this network/i);
  assert.doesNotMatch(note, /BAD_DATA|decode result data/, 'library vocabulary leaked to the buyer');
  assert.equal(raw, err.message, 'the original must be kept for the log');
});

test('a funding shortfall names the settlement asset', () => {
  const arc = explainPurchaseFailure(new Error('insufficient funds for intrinsic transaction cost'), 'USDC');
  assert.match(arc.note, /Not enough USDC/);
  // On a chain where gas is a different asset the advice still has to name the right one.
  const sep = explainPurchaseFailure(new Error('ERC20: transfer amount exceeds balance'), 'USD₮');
  assert.match(sep.note, /Not enough USD₮/);
});

test('a transport failure says nothing was charged', () => {
  const { note } = explainPurchaseFailure(new Error('connect ETIMEDOUT 10.0.0.1:443'));
  assert.match(note, /nothing was charged/i);
});

test('an unrecognised error is not dressed up as something it is not', () => {
  const weird = 'thermal runaway in the flux capacitor';
  const { note } = explainPurchaseFailure(new Error(weird));
  assert.equal(note, weird, 'inventing a friendlier message would be a lie about the cause');
});

test('a non-Error throw does not crash the explainer', () => {
  assert.equal(explainPurchaseFailure('plain string').note, 'plain string');
  assert.equal(explainPurchaseFailure(undefined).note, 'unknown error');
});
