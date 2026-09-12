// Whose benchmark is this? — guarding the one claim a seller makes about its own hardware.
//
// `bench-profile.json` records what a machine measured: which models loaded, and how fast.
// It is committed to the repo and shipped inside the packaged app, so a fresh install has
// something to read — but that also means every install starts out holding the numbers of
// the machine that generated it.
//
// A seller that trusts a foreign profile advertises capability it has never demonstrated.
// The failure is invisible until someone pays: the offer looks normal, the economic checks
// pass, and then the model will not load, because it was a different GPU on a different OS
// that proved it could. Meanwhile the marketplace's "fastest seller" ordering is comparing
// numbers that all came from the same box.
//
// So the profile is only believed when it describes the machine reading it.
import os from 'node:os';
import type { CapabilityProfile } from './prober';

export interface ProfileVerdict {
  /** The profile, or null when it describes some other machine. */
  profile: CapabilityProfile | null;
  /** Present when the profile was rejected — a sentence naming what mismatched. */
  reason?: string;
}

/**
 * Accept a profile only if it was measured on this platform and architecture.
 *
 * Those two are what decide whether a model can run at all: a Metal build and a Vulkan
 * build load different binaries, and an arm64 machine cannot use an x64 measurement. A
 * profile with neither field recorded predates that bookkeeping and is treated as foreign,
 * because an unlabelled measurement cannot be shown to be ours.
 */
export function profileForThisMachine(raw: unknown): ProfileVerdict {
  const p = raw as Partial<CapabilityProfile> | null;
  if (!p || typeof p !== 'object') return { profile: null, reason: 'no benchmark on this machine yet' };

  const here = { platform: os.platform(), arch: os.arch() };
  if (!p.platform || !p.arch) {
    return { profile: null, reason: 'the benchmark does not record which machine produced it' };
  }
  if (p.platform !== here.platform || p.arch !== here.arch) {
    return {
      profile: null,
      reason: `the benchmark was measured on ${p.platform}/${p.arch}, but this machine is ${here.platform}/${here.arch}`,
    };
  }
  return { profile: p as CapabilityProfile };
}
