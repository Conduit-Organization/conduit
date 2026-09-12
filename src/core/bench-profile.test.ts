import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { profileForThisMachine } from './bench-profile';

// bench-profile.json is committed AND shipped inside the package, so every install starts
// out holding the numbers of the machine that generated it. A Mac was advertising an
// x64 Linux box's 4B throughput — and could not serve the model it was selling.

const mine = { platform: os.platform(), arch: os.arch() };

test("this machine's own profile is accepted", () => {
  const { profile, reason } = profileForThisMachine({
    ...mine, ts: '2026-06-02T09:21:27.352Z', backend: 'gpu', minSellTps: 10,
    topSellable: 'QWEN3_4B_INST_Q4_K_M', localDraft: 'QWEN3_600M_INST_Q4',
    models: [{ id: 'QWEN3_4B_INST_Q4_K_M', loaded: true, tps: 59.42 }],
  });
  assert.ok(profile, reason);
  assert.equal(profile!.topSellable, 'QWEN3_4B_INST_Q4_K_M');
});

test("another machine's profile is refused, and says which", () => {
  // The exact shape of the shipped file, read on a machine that is not the one it describes.
  const foreign = { platform: 'linux', arch: 'x64', ts: '2026-06-02T09:21:27.352Z', backend: 'gpu',
    minSellTps: 10, topSellable: 'QWEN3_4B_INST_Q4_K_M', localDraft: null,
    models: [{ id: 'QWEN3_4B_INST_Q4_K_M', loaded: true, tps: 59.42335575574624 }] };

  const onDarwinArm = { ...foreign };
  const { profile, reason } = profileForThisMachine(
    mine.platform === 'linux' && mine.arch === 'x64' ? { ...onDarwinArm, platform: 'darwin', arch: 'arm64' } : onDarwinArm,
  );
  assert.equal(profile, null, 'a foreign benchmark must not be advertised');
  assert.match(reason!, /measured on/);
  assert.match(reason!, new RegExp(`${mine.platform}\\/${mine.arch}`), 'the reason must name this machine');
});

test('an unlabelled profile is refused rather than assumed local', () => {
  // Predates the platform/arch bookkeeping. It may well be ours, but it cannot be SHOWN
  // to be, and the cost of guessing wrong is a buyer paying for a model that never loads.
  const { profile, reason } = profileForThisMachine({
    ts: '2026-01-01T00:00:00.000Z', backend: 'gpu', minSellTps: 10,
    topSellable: 'QWEN3_4B_INST_Q4_K_M', localDraft: null, models: [],
  });
  assert.equal(profile, null);
  assert.match(reason!, /does not record which machine/);
});

test('garbage input is refused without throwing', () => {
  for (const bad of [null, undefined, 'a string', 42]) {
    const { profile, reason } = profileForThisMachine(bad);
    assert.equal(profile, null);
    assert.ok(reason && reason.length > 0, 'a refusal must always carry a reason');
  }
});
