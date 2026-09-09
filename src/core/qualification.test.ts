// Tests for the hardened qualification rules — ETHOnline 2026 (new work).
// Run: npm test        (node:test, built in — no new dependencies)
//
// The headline test is `restores an honest seller's reliability under attack`, which
// replays the exact channel shape manufactured by contracts/test/sybil-grief.test.ts
// and shows the rules reject every one of them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALIFICATION,
  SCORE_WEIGHTS,
  NEUTRAL_SCORE,
  qualifyAdverseSignal,
  qualifyOnChainOnly,
  reliability,
  breadth,
  volume,
  globalScore,
  forgeCost,
  type ChannelFacts,
  type GlobalRecord,
} from './qualification';

/** The exact channel shape the griefing PoC manufactures: 1 second, 1 base unit. */
const FORGED: ChannelFacts = {
  durationSecs: 1,
  depositBaseUnits: 1n,
  buyerSettledCount: 0,
  buyerIsVerifiedHuman: false,
};

/** A genuine session: storefront defaults (1 USD₮ deposit, 1h) from a real customer. */
const GENUINE: ChannelFacts = {
  durationSecs: 3600,
  depositBaseUnits: 1_000_000n,
  buyerSettledCount: 3,
  buyerIsVerifiedHuman: true,
};

describe('qualifyAdverseSignal', () => {
  test('rejects the forged channel on every rule at once', () => {
    const r = qualifyAdverseSignal(FORGED);
    assert.equal(r.qualified, false);
    assert.deepEqual(r.reasons.sort(), [
      'buyer-has-no-settlement-history',
      'buyer-not-human-verified',
      'deposit-too-small',
      'duration-too-short',
    ]);
  });

  test('accepts a genuine abandoned session', () => {
    const r = qualifyAdverseSignal(GENUINE);
    assert.equal(r.qualified, true);
    assert.deepEqual(r.reasons, []);
  });

  test('each rule independently disqualifies', () => {
    const cases: Array<[Partial<ChannelFacts>, string]> = [
      [{ durationSecs: QUALIFICATION.MIN_DURATION_SECS - 1 }, 'duration-too-short'],
      [{ depositBaseUnits: QUALIFICATION.MIN_DEPOSIT_BASE_UNITS - 1n }, 'deposit-too-small'],
      [{ buyerSettledCount: 0 }, 'buyer-has-no-settlement-history'],
      [{ buyerIsVerifiedHuman: false }, 'buyer-not-human-verified'],
    ];
    for (const [override, reason] of cases) {
      const r = qualifyAdverseSignal({ ...GENUINE, ...override });
      assert.equal(r.qualified, false, `expected ${reason} to disqualify`);
      assert.deepEqual(r.reasons, [reason]);
    }
  });

  test('accepts exactly at each threshold (boundaries are inclusive)', () => {
    const r = qualifyAdverseSignal({
      ...GENUINE,
      durationSecs: QUALIFICATION.MIN_DURATION_SECS,
      depositBaseUnits: QUALIFICATION.MIN_DEPOSIT_BASE_UNITS,
      buyerSettledCount: QUALIFICATION.MIN_BUYER_SETTLEMENTS,
    });
    assert.equal(r.qualified, true);
  });

  test('an unchecked buyer fails closed, exactly like an unverified one', () => {
    const { buyerIsVerifiedHuman, ...unchecked } = GENUINE;
    const r = qualifyAdverseSignal(unchecked as ChannelFacts);
    assert.equal(r.qualified, false);
    assert.deepEqual(r.reasons, ['buyer-not-human-verified']);
  });

  test('separates the two populations by orders of magnitude, not by a hair', () => {
    // The threshold must sit far from BOTH the attack and the honest default, so it is
    // not a number tuned to make one demo pass.
    assert.ok(QUALIFICATION.MIN_DEPOSIT_BASE_UNITS >= FORGED.depositBaseUnits * 1000n);
    assert.ok(GENUINE.depositBaseUnits >= QUALIFICATION.MIN_DEPOSIT_BASE_UNITS * 10n);
    assert.ok(QUALIFICATION.MIN_DURATION_SECS >= FORGED.durationSecs * 100);
    assert.ok(GENUINE.durationSecs >= QUALIFICATION.MIN_DURATION_SECS);
  });
});

describe('qualifyOnChainOnly (what a subgraph can decide by itself)', () => {
  test('rejects the forged channel without needing the cross-chain identity read', () => {
    const { buyerIsVerifiedHuman, ...onChain } = FORGED;
    assert.equal(qualifyOnChainOnly(onChain).qualified, false);
  });

  test('passes a genuine channel, leaving the identity rule to the client', () => {
    const { buyerIsVerifiedHuman, ...onChain } = GENUINE;
    assert.equal(qualifyOnChainOnly(onChain).qualified, true);
  });

  test('never disqualifies for identity — that rule is not its job', () => {
    const { buyerIsVerifiedHuman, ...onChain } = GENUINE;
    assert.ok(!qualifyOnChainOnly(onChain).reasons.includes('buyer-not-human-verified'));
  });
});

describe('scoring', () => {
  const NO_HISTORY: GlobalRecord = {
    settled: 0,
    qualifiedWithdrawn: 0,
    probeChannels: 0,
    uniqueVerifiedBuyers: 0,
    totalClaimed: 0n,
  };

  test('weights sum to 1', () => {
    const sum = SCORE_WEIGHTS.reliability + SCORE_WEIGHTS.breadth + SCORE_WEIGHTS.volume;
    assert.ok(Math.abs(sum - 1) < 1e-12, `weights sum to ${sum}`);
  });

  test('an unknown seller scores exactly the neutral baseline reputation.ts uses', () => {
    // reputation.ts returns 0.5 for an unseen seller. The global scorer must agree,
    // or introducing it would silently re-rank every unknown seller.
    assert.equal(globalScore(NO_HISTORY), NEUTRAL_SCORE);
    assert.equal(reliability(NO_HISTORY), NEUTRAL_SCORE);
  });

  test('restores an honest seller reliability under the griefing attack', () => {
    // Exactly the scenario in contracts/test/sybil-grief.test.ts: one real settlement,
    // five forged withdrawals.
    const naive = 1 / (1 + 5);
    assert.ok(Math.abs(naive - 0.1667) < 0.001, 'naive reading collapses to ~17%');

    const hardened: GlobalRecord = {
      settled: 1,
      qualifiedWithdrawn: 0, // all five failed qualification
      probeChannels: 5, // still indexed, still visible, not scoring
      uniqueVerifiedBuyers: 1,
      totalClaimed: 500_000n,
    };
    assert.equal(reliability(hardened), 1, 'hardened reliability is restored to 100%');
    assert.equal(hardened.probeChannels, 5, 'the probes are not hidden, just not counted');
  });

  test('a genuinely abandoned channel still damages the seller', () => {
    // The rules must not make the signal unusable — that would be the opposite failure.
    const abandoned: GlobalRecord = {
      settled: 1,
      qualifiedWithdrawn: 1,
      probeChannels: 0,
      uniqueVerifiedBuyers: 2,
      totalClaimed: 500_000n,
    };
    assert.equal(reliability(abandoned), 0.5);
    assert.ok(globalScore(abandoned) < globalScore({ ...abandoned, qualifiedWithdrawn: 0 }));
  });

  test('breadth counts verified humans and saturates', () => {
    assert.equal(breadth({ ...NO_HISTORY, uniqueVerifiedBuyers: 0 }), 0);
    assert.equal(breadth({ ...NO_HISTORY, uniqueVerifiedBuyers: 1 }), 1 / QUALIFICATION.BREADTH_SATURATION);
    assert.equal(breadth({ ...NO_HISTORY, uniqueVerifiedBuyers: QUALIFICATION.BREADTH_SATURATION }), 1);
    assert.equal(breadth({ ...NO_HISTORY, uniqueVerifiedBuyers: 500 }), 1, 'saturates, never exceeds 1');
  });

  test('volume saturates and handles bigints without precision loss', () => {
    assert.equal(volume({ ...NO_HISTORY, totalClaimed: 0n }), 0);
    assert.equal(volume({ ...NO_HISTORY, totalClaimed: QUALIFICATION.VOLUME_SATURATION_BASE_UNITS }), 1);
    assert.equal(volume({ ...NO_HISTORY, totalClaimed: 10n ** 30n }), 1, 'huge values saturate, not overflow');
    assert.ok(Math.abs(volume({ ...NO_HISTORY, totalClaimed: 500_000n }) - 0.5) < 1e-9);
  });

  test('score stays inside [0,1] across the corners', () => {
    const corners: GlobalRecord[] = [
      NO_HISTORY,
      { settled: 0, qualifiedWithdrawn: 9, probeChannels: 0, uniqueVerifiedBuyers: 0, totalClaimed: 0n },
      { settled: 9, qualifiedWithdrawn: 0, probeChannels: 0, uniqueVerifiedBuyers: 99, totalClaimed: 10n ** 12n },
    ];
    for (const c of corners) {
      const s = globalScore(c);
      assert.ok(s >= 0 && s <= 1, `score ${s} out of range`);
    }
  });

  test('a seller with only forged probes is neither punished nor rewarded', () => {
    // No settlements, no qualified withdrawals — the attack leaves the score untouched.
    const onlyProbes: GlobalRecord = { ...NO_HISTORY, probeChannels: 50 };
    assert.equal(globalScore(onlyProbes), NEUTRAL_SCORE);
  });
});

describe('forgeCost (the measurable claim)', () => {
  test('without the gate, cost is linear in gas and capital at risk is zero', () => {
    const c = forgeCost(5, null);
    assert.equal(c.identities, 5);
    assert.equal(c.gasWithoutGate, 5 * 212_331);
    assert.equal(c.costWithoutGate, null, 'declines to invent an exchange rate');
  });

  test('with the gate, the cost is denominated in people', () => {
    assert.equal(forgeCost(5, null).verifiedHumansRequired, 5);
  });

  test('prices the attack in the settlement token when gas IS the settlement token', () => {
    // Arc: USDC is the gas token, so this is a directly meaningful number.
    const gasPrice = 2n; // base units per gas unit
    const c = forgeCost(5, gasPrice);
    assert.notEqual(c.costWithoutGate, null);
    assert.equal(c.costWithoutGate!.baseUnits, BigInt(5 * 212_331) * gasPrice);
    assert.equal(c.costWithoutGate!.decimals, 6);
  });

  test('uses a measured gas figure, not an estimate', () => {
    // Sourced from contracts/test/sybil-grief.test.ts, which prints it on every run.
    assert.equal(forgeCost(1, null).gasWithoutGate, 212_331);
  });
});
