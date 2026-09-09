// Qualification thresholds — AssemblyScript mirror of src/core/qualification.ts.
//
// ⚠️ THESE NUMBERS MUST MATCH `src/core/qualification.ts` EXACTLY.
//
// They cannot be imported: subgraph mappings compile to WASM via AssemblyScript, which
// is a different language target from the engine's TypeScript. So they are duplicated
// here, and `src/core/qualification-mirror.test.ts` parses THIS FILE and fails the test
// suite if the two ever drift apart.
//
// Why these values: see the doc comments in src/core/qualification.ts. In short — the
// griefing PoC (contracts/test/sybil-grief.test.ts) opens 1-second channels for 1 base
// unit, and Conduit's real Sepolia history shows every `Withdrawn` is a 24-second
// session renewal by a returning customer. Both populations sit orders of magnitude
// away from these thresholds.
import { BigInt } from '@graphprotocol/graph-ts';

/** A channel shorter than this cannot evidence a failure to deliver. */
export const MIN_DURATION_SECS = BigInt.fromI32(600);

/** 10x the cheapest advertised tier (2_000 base units) = 0.02 USD₮. */
export const MIN_DEPOSIT_BASE_UNITS = BigInt.fromI32(20000);

/** A wallet that has never paid for anything is not a wronged customer. */
export const MIN_BUYER_SETTLEMENTS = BigInt.fromI32(1);

/** A reopen within this window is a renewal, not an abandonment. Observed gap: 24s. */
export const MAX_RENEWAL_GAP_SECS = BigInt.fromI32(300);

// Enum values, matching `DisqualificationReason` in schema.graphql.
export const REASON_DURATION_TOO_SHORT = 'DURATION_TOO_SHORT';
export const REASON_DEPOSIT_TOO_SMALL = 'DEPOSIT_TOO_SMALL';
export const REASON_BUYER_NO_HISTORY = 'BUYER_HAS_NO_SETTLEMENT_HISTORY';
export const REASON_IS_RENEWAL = 'WITHDRAWAL_IS_A_RENEWAL';

/**
 * The rules a subgraph can evaluate by itself, at the moment a channel is withdrawn.
 *
 * Deliberately EXCLUDES the World-verified-buyer rule: AgentBook lives on World Chain
 * and a subgraph cannot read another chain. That rule is layered on client-side, over
 * the candidate set this has already narrowed. Reporting it here would make the
 * subgraph look like it had checked something it cannot see.
 */
export function disqualificationReasons(
  durationSecs: BigInt,
  depositBaseUnits: BigInt,
  buyerSettledCount: BigInt
): string[] {
  const reasons: string[] = [];
  if (durationSecs.lt(MIN_DURATION_SECS)) reasons.push(REASON_DURATION_TOO_SHORT);
  if (depositBaseUnits.lt(MIN_DEPOSIT_BASE_UNITS)) reasons.push(REASON_DEPOSIT_TOO_SMALL);
  if (buyerSettledCount.lt(MIN_BUYER_SETTLEMENTS)) reasons.push(REASON_BUYER_NO_HISTORY);
  return reasons;
}

/** Whether a gap between withdraw and reopen counts as a session renewal. */
export function isRenewalGap(gapSecs: BigInt): boolean {
  return gapSecs.ge(BigInt.zero()) && gapSecs.le(MAX_RENEWAL_GAP_SECS);
}
