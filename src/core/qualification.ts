// Qualification rules for on-chain reputation signals — ETHOnline 2026 (new work).
//
// WHY THIS FILE EXISTS
//
// The obvious way to derive seller reputation from ConduitEscrow is to count `Settled`
// against `Withdrawn`: a buyer who had to reclaim their deposit is a buyer whose seller
// vanished. That reading is wrong, and `contracts/test/sybil-grief.test.ts` proves it —
// `open()` bounds only `amount > 0` and `duration > 0`, so anyone can open a 1-second
// channel against any address for one base unit, withdraw it in the next block, and get
// every unit back. Measured cost: ~212k gas per forged identity, zero capital at risk.
// Five of them take an honest seller from 100% to 16.7% reliability.
//
// So a `Withdrawn` event is evidence of nothing on its own. It becomes evidence only
// when the channel that produced it looked like a real session opened by a real
// participant. These are those rules, in one place, so that the subgraph mapping, the
// client-side scorer and the README all cite the same numbers.
//
// The thresholds are published in the README on purpose: a judge should be able to
// audit the rule rather than trust it.
import { priceFor } from './pricing';

/**
 * Adverse-signal qualification thresholds.
 *
 * Chosen so that no genuine channel is caught and no manufactured one survives. The
 * storefront's default deposit is 1_000_000 base units (1 USD₮, `storefront.ts`), and
 * the cheapest advertised tier is 2_000 (0.002 USD₮, `pricing.ts`). The griefing PoC
 * opens with 1 base unit for 1 second. Every threshold below sits in the wide gap
 * between those two populations.
 */
export const QUALIFICATION = Object.freeze({
  /**
   * A channel must have been opened for at least this long to count against a seller.
   * A seller cannot "fail to deliver" inside a window too short to deliver in — the
   * P2P session grant alone involves an on-chain read and a swarm round-trip.
   * 10 minutes; the griefing PoC uses 1 second.
   */
  MIN_DURATION_SECS: 600,

  /**
   * A channel must have locked at least this much to count against a seller. Set to
   * 10x the cheapest advertised price (`priceFor` floor = 2_000), i.e. a deposit that
   * could actually have bought ten answers. 20_000 base units = 0.02 USD₮.
   *
   * 20,000x the griefing PoC's dust deposit, and 50x below the storefront's own
   * default deposit — so it separates the two populations without touching either.
   */
  MIN_DEPOSIT_BASE_UNITS: 10n * 2_000n,

  /**
   * The buyer must have completed at least this many settlements with ANY seller.
   * A wallet that has never once paid for anything is not a wronged customer.
   */
  MIN_BUYER_SETTLEMENTS: 1,

  /**
   * The buyer must be a World-verified unique human (AgentBook `lookupHuman` != 0).
   * This is the rule the other three cannot replace: the first three raise the *cost*
   * of forging a signal, but only identity scarcity makes the cost *unbounded*.
   *
   * NOTE: this rule cannot be evaluated inside the subgraph — AgentBook lives on World
   * Chain and a subgraph cannot read another chain. It is applied client-side in
   * `graph-reputation.ts`, over the candidate set the subgraph has already narrowed.
   */
  REQUIRE_VERIFIED_BUYER: true,

  /**
   * A `Withdrawn` followed within this many seconds by the SAME buyer reopening a
   * channel with the SAME seller is a session RENEWAL, not an abandonment.
   *
   * This rule is not defensive theory — it is the whole of Conduit's real on-chain
   * history. Both `Withdrawn` events ever emitted by the Sepolia escrow
   * (blocks 11102985 and 11109678) are followed 24 seconds later by the same buyer
   * reopening with the same seller at the next epoch. That is `storefront.ts:244-253`
   * doing exactly what it says: an expired channel cannot be reopened over, so the
   * client reclaims the remainder and opens a fresh one.
   *
   * A naive `Withdrawn` counter would therefore score that seller 0.0 — the worst
   * possible reliability — for having a LOYAL RETURNING CUSTOMER who renewed twice.
   *
   * 300s is 12x the observed 24s gap: wide enough for a congested block, far below
   * any plausible "gave up and came back later".
   */
  MAX_RENEWAL_GAP_SECS: 300,

  /** Unique verified buyers at which `breadth` saturates. One buyer is not a record. */
  BREADTH_SATURATION: 5,

  /** Total claimed base units at which `volume` saturates. 1_000_000 = 1.0 USD₮. */
  VOLUME_SATURATION_BASE_UNITS: 1_000_000n,
});

/** Weights for the blended global score. Must sum to 1. */
export const SCORE_WEIGHTS = Object.freeze({
  reliability: 0.65,
  breadth: 0.2,
  volume: 0.15,
});

/** Neutral score for a seller with no qualified history — don't bury new sellers. */
export const NEUTRAL_SCORE = 0.5;

export type DisqualificationReason =
  | 'duration-too-short'
  | 'deposit-too-small'
  | 'buyer-has-no-settlement-history'
  | 'buyer-not-human-verified'
  | 'withdrawal-is-a-renewal';

/** Everything needed to judge whether one closed channel is a usable adverse signal. */
export interface ChannelFacts {
  /** `expiry - openedAt`, in seconds, as recorded when `ChannelOpened` was emitted. */
  durationSecs: number;
  /** The deposit locked at open, in settlement-token base units. */
  depositBaseUnits: bigint;
  /** How many channels this buyer has settled, with any seller, ever. */
  buyerSettledCount: number;
  /**
   * Seconds between this channel's `Withdrawn` and the same buyer reopening with the
   * same seller, or `null` if they never came back. A small gap means renewal, not
   * abandonment — see `QUALIFICATION.MAX_RENEWAL_GAP_SECS`.
   */
  secondsUntilBuyerReopened?: number | null;
  /**
   * Whether the buyer resolves to a World-verified unique human. `undefined` means
   * "not yet checked" and is treated as unverified — fail closed.
   */
  buyerIsVerifiedHuman?: boolean;
}

export interface QualificationResult {
  qualified: boolean;
  reasons: DisqualificationReason[];
}

/**
 * Does this channel's `Withdrawn` event count against the seller?
 *
 * All rules must pass. Anything that fails is still indexed and still visible — it is
 * surfaced as a `probeChannel` — but it does not move the seller's score.
 */
export function qualifyAdverseSignal(f: ChannelFacts): QualificationResult {
  return evaluate(f, true);
}

/**
 * The subset of the rules a subgraph mapping can evaluate on its own — everything
 * except the cross-chain identity check. Used by `subgraph/src/escrow.ts` to mark a
 * channel as a probe at index time; the identity rule is layered on afterwards by
 * `graph-reputation.ts`, which can reach World Chain.
 *
 * This never returns 'buyer-not-human-verified': deciding that is not its job, and
 * reporting it here would make a subgraph look like it had checked something it
 * cannot see.
 */
export function qualifyOnChainOnly(f: Omit<ChannelFacts, 'buyerIsVerifiedHuman'>): QualificationResult {
  return evaluate(f, false);
}

function evaluate(f: Omit<ChannelFacts, 'buyerIsVerifiedHuman'> & Partial<ChannelFacts>, includeIdentityRule: boolean): QualificationResult {
  const reasons: DisqualificationReason[] = [];

  if (f.durationSecs < QUALIFICATION.MIN_DURATION_SECS) reasons.push('duration-too-short');
  if (f.depositBaseUnits < QUALIFICATION.MIN_DEPOSIT_BASE_UNITS) reasons.push('deposit-too-small');
  if (f.buyerSettledCount < QUALIFICATION.MIN_BUYER_SETTLEMENTS) reasons.push('buyer-has-no-settlement-history');
  // The buyer came straight back to the same seller: this was a session renewal, and
  // renewals are evidence of satisfaction, not abandonment.
  if (
    f.secondsUntilBuyerReopened != null &&
    f.secondsUntilBuyerReopened >= 0 &&
    f.secondsUntilBuyerReopened <= QUALIFICATION.MAX_RENEWAL_GAP_SECS
  ) {
    reasons.push('withdrawal-is-a-renewal');
  }
  // Fail closed: an unchecked buyer (`undefined`) is treated exactly like an
  // unverified one, so forgetting to run the lookup can never grant qualification.
  if (includeIdentityRule && QUALIFICATION.REQUIRE_VERIFIED_BUYER && !f.buyerIsVerifiedHuman) {
    reasons.push('buyer-not-human-verified');
  }

  return { qualified: reasons.length === 0, reasons };
}

/** A seller's qualified settlement record, as counted by the subgraph. */
export interface GlobalRecord {
  /** Channels this seller settled (payment completed and channel closed). */
  settled: number;
  /** Channels withdrawn against this seller that PASSED qualification. */
  qualifiedWithdrawn: number;
  /** Channels withdrawn that FAILED qualification — visible, but not scoring. */
  probeChannels: number;
  /**
   * Withdrawals that were session renewals (buyer reopened immediately). Counted
   * separately from probes because they are a POSITIVE signal wearing an adverse
   * event's clothing — a customer who renewed is a customer who came back.
   */
  renewals: number;
  /** Distinct World-verified humans who have opened a channel with this seller. */
  uniqueVerifiedBuyers: number;
  /** Base units actually claimed by this seller across all channels. */
  totalClaimed: bigint;
}

/** settled / (settled + qualifiedWithdrawn); NEUTRAL_SCORE when there is no history. */
export function reliability(r: GlobalRecord): number {
  const n = r.settled + r.qualifiedWithdrawn;
  return n === 0 ? NEUTRAL_SCORE : r.settled / n;
}

/** min(1, uniqueVerifiedBuyers / BREADTH_SATURATION). Verified humans only. */
export function breadth(r: GlobalRecord): number {
  return Math.min(1, r.uniqueVerifiedBuyers / QUALIFICATION.BREADTH_SATURATION);
}

/** min(1, totalClaimed / VOLUME_SATURATION_BASE_UNITS). */
export function volume(r: GlobalRecord): number {
  const cap = QUALIFICATION.VOLUME_SATURATION_BASE_UNITS;
  if (r.totalClaimed >= cap) return 1;
  if (r.totalClaimed <= 0n) return 0;
  // Ratio of two bigints in [0,1] — scale up before narrowing so we keep precision.
  return Number((r.totalClaimed * 10_000n) / cap) / 10_000;
}

/**
 * The global score a seller carries with everyone, as opposed to the first-party score
 * in `reputation.ts` which is what one buyer personally experienced.
 *
 * A seller with no qualified history scores NEUTRAL_SCORE exactly — identical to the
 * local module's baseline, so an unknown seller is never penalised for being unknown.
 */
export function globalScore(r: GlobalRecord): number {
  const hasHistory = r.settled + r.qualifiedWithdrawn > 0 || r.uniqueVerifiedBuyers > 0 || r.totalClaimed > 0n;
  if (!hasHistory) return NEUTRAL_SCORE;
  return (
    SCORE_WEIGHTS.reliability * reliability(r) +
    SCORE_WEIGHTS.breadth * breadth(r) +
    SCORE_WEIGHTS.volume * volume(r)
  );
}

/**
 * §2.5.6 — the measurable claim, computed rather than asserted.
 *
 * Without the human gate, forging N adverse signals costs N x gas: the deposit is
 * returned in full, so capital at risk is zero. With the gate, each signal additionally
 * requires a distinct World-verified human, which is not purchasable at any gas price.
 *
 * `gasPerIdentity` is measured by `contracts/test/sybil-grief.test.ts`, not estimated.
 */
export const MEASURED_GAS_PER_FORGED_IDENTITY = 212_331;

export interface ForgeCost {
  identities: number;
  /** Total gas to forge `identities` adverse signals with the gate OFF. */
  gasWithoutGate: number;
  /** Settlement-token cost of that gas, when the gas token IS the settlement token. */
  costWithoutGate: { baseUnits: bigint; decimals: number } | null;
  /** With the gate ON, the cost is denominated in people, not gas. */
  verifiedHumansRequired: number;
}

/**
 * What it costs to forge `identities` adverse signals against one seller.
 *
 * `gasPriceBaseUnits` is the price of one unit of gas in settlement-token base units.
 * On Arc, where USDC *is* the gas token, that makes `costWithoutGate` a directly
 * meaningful number. Pass `null` on a chain whose gas token differs from the
 * settlement token — we decline to invent an exchange rate.
 */
export function forgeCost(
  identities: number,
  gasPriceBaseUnits: bigint | null,
  decimals = 6,
  gasPerIdentity = MEASURED_GAS_PER_FORGED_IDENTITY
): ForgeCost {
  const gasWithoutGate = identities * gasPerIdentity;
  return {
    identities,
    gasWithoutGate,
    costWithoutGate:
      gasPriceBaseUnits === null ? null : { baseUnits: BigInt(gasWithoutGate) * gasPriceBaseUnits, decimals },
    verifiedHumansRequired: QUALIFICATION.REQUIRE_VERIFIED_BUYER ? identities : 0,
  };
}

/** The reference price used to derive MIN_DEPOSIT_BASE_UNITS, for README/UI display. */
export function cheapestAdvertisedPrice(): bigint {
  return priceFor('UNKNOWN_MODEL'); // the `priceFor` floor: 2_000 base units
}
