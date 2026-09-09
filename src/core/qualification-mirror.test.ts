// Drift guard: the subgraph's AssemblyScript thresholds must equal the engine's.
//
// Subgraph mappings compile to WASM via AssemblyScript, a different language target from
// the engine's TypeScript, so `subgraph/src/qualification.ts` cannot import
// `src/core/qualification.ts`. The numbers are therefore duplicated — and duplicated
// constants drift silently.
//
// This test parses the AssemblyScript source as text and fails if the two ever diverge.
// It is deliberately dumb: no imports from the subgraph package, no build step, no
// AssemblyScript toolchain. It just reads the file.
//
// If this fails, the two copies of the rule disagree — which means the subgraph is
// scoring sellers by different rules than the client, and the README's published
// thresholds are wrong for at least one of them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUALIFICATION } from './qualification';

const here = path.dirname(fileURLToPath(import.meta.url));
const AS_SOURCE = path.join(here, '../../subgraph/src/qualification.ts');

function readAsSource(): string {
  return readFileSync(AS_SOURCE, 'utf8');
}

/** Pull `export const NAME = BigInt.fromI32(<n>);` out of the AssemblyScript source. */
function asBigIntConst(src: string, name: string): number {
  const m = new RegExp(`export const ${name} = BigInt\\.fromI32\\((\\d+)\\)`).exec(src);
  assert.ok(m, `could not find ${name} in ${AS_SOURCE}`);
  return Number(m![1]);
}

describe('subgraph/src/qualification.ts mirrors src/core/qualification.ts', () => {
  test('MIN_DURATION_SECS matches', () => {
    assert.equal(asBigIntConst(readAsSource(), 'MIN_DURATION_SECS'), QUALIFICATION.MIN_DURATION_SECS);
  });

  test('MIN_DEPOSIT_BASE_UNITS matches', () => {
    assert.equal(
      BigInt(asBigIntConst(readAsSource(), 'MIN_DEPOSIT_BASE_UNITS')),
      QUALIFICATION.MIN_DEPOSIT_BASE_UNITS
    );
  });

  test('MIN_BUYER_SETTLEMENTS matches', () => {
    assert.equal(asBigIntConst(readAsSource(), 'MIN_BUYER_SETTLEMENTS'), QUALIFICATION.MIN_BUYER_SETTLEMENTS);
  });

  test('MAX_RENEWAL_GAP_SECS matches', () => {
    assert.equal(asBigIntConst(readAsSource(), 'MAX_RENEWAL_GAP_SECS'), QUALIFICATION.MAX_RENEWAL_GAP_SECS);
  });

  test('every threshold the engine defines is mirrored, so a new rule cannot be forgotten', () => {
    // If someone adds a threshold to the engine that the mapping must also enforce,
    // this test tells them. Scoring-only constants are exempt: they are applied
    // client-side, never in the mapping.
    const CLIENT_SIDE_ONLY = new Set([
      'REQUIRE_VERIFIED_BUYER', // cross-chain — a subgraph cannot read World Chain
      'BREADTH_SATURATION',
      'VOLUME_SATURATION_BASE_UNITS',
    ]);
    const src = readAsSource();
    const missing = Object.keys(QUALIFICATION).filter((k) => !CLIENT_SIDE_ONLY.has(k) && !src.includes(k));
    assert.deepEqual(missing, [], `not mirrored in the subgraph mapping: ${missing.join(', ')}`);
  });

  test('the AssemblyScript enum values match the GraphQL schema', () => {
    const src = readAsSource();
    const schema = readFileSync(path.join(here, '../../subgraph/schema.graphql'), 'utf8');
    for (const value of [
      'DURATION_TOO_SHORT',
      'DEPOSIT_TOO_SMALL',
      'BUYER_HAS_NO_SETTLEMENT_HISTORY',
      'WITHDRAWAL_IS_A_RENEWAL',
    ]) {
      assert.ok(src.includes(`'${value}'`), `${value} missing from the mapping constants`);
      assert.ok(schema.includes(value), `${value} missing from schema.graphql`);
    }
  });

  test('the mapping does not claim to check the cross-chain identity rule', () => {
    // A subgraph cannot read AgentBook on World Chain. If the mapping ever starts
    // emitting a "not human verified" reason, it is lying about what it verified.
    const src = readAsSource();
    assert.ok(!/BUYER_NOT_HUMAN_VERIFIED/.test(src));
    assert.ok(!/lookupHuman/.test(src));
  });
});
