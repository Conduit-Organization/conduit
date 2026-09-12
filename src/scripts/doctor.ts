export {}; // module (top-level await)

// `npm run doctor` — is this machine able to take part at all?
//
// Three questions, in the order they bite. Each is cheap, and each has been the real cause
// of a purchase failing somewhere in this project:
//
//   1. Is a stale worker lock blocking the inference runtime?
//   2. Can the runtime actually start?
//   3. Does this machine's benchmark belong to this machine?
//
// None of them involves a peer, a wallet, or a single unit of currency.
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { clearStaleWorkerLock, workerLockPath } from '../core/worker-lock';
import { checkLocalRuntime } from '../core/runtime-check';
import { profileForThisMachine } from '../core/bench-profile';

const sdk: any = await import('@qvac/sdk');

let bad = 0;
const ok = (m: string) => console.log(`  ✔ ${m}`);
const no = (m: string) => { bad++; console.log(`  ✘ ${m}`); };

console.log(`Conduit doctor — ${os.platform()}/${os.arch()}\n`);

// ── 1. worker lock ────────────────────────────────────────────────────────────
console.log('QVAC worker lock:');
const lock = clearStaleWorkerLock();
if (lock.outcome === 'absent') ok('no lock present');
else if (lock.outcome === 'removed') ok(`cleared a stale lock (pid ${lock.pid ?? 'unknown'} is gone)`);
else console.log(`  • held by a live process (pid ${lock.pid}) — another Conduit is running here`);
console.log(`    ${workerLockPath()}`);

// ── 2. the runtime itself ─────────────────────────────────────────────────────
console.log('\nLocal inference runtime:');
const started = Date.now();
const rt = await checkLocalRuntime(sdk);
if (rt.ok) ok(`responded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
else {
  no(rt.reason ?? 'did not respond');
  console.log('\n    Without this, nothing can be bought OR sold on this machine: a buyer');
  console.log('    delegates inference to a peer, but the delegated call still runs through');
  console.log('    this runtime. Common causes:');
  console.log('      • a stale lock (cleared above — try again)');
  console.log('      • macOS: the prebuilt addon links Homebrew OpenSSL by absolute path;');
  console.log('        `brew install openssl@3`, or build the app so it vendors the dylibs');
  console.log('      • a packaged app whose bundled runtime lost its executable bit');
}

// ── 3. whose benchmark is this? ───────────────────────────────────────────────
console.log('\nCapability profile (only needed to SELL):');
try {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const raw = JSON.parse(readFileSync(path.join(here, '../../bench-profile.json'), 'utf8'));
  const { profile, reason } = profileForThisMachine(raw);
  if (!profile) no(`${reason} — run \`npm run bench\` here before selling`);
  else {
    const runnable = (profile.models ?? []).filter((m) => m.loaded);
    if (runnable.length === 0) {
      // Owning the profile is not the same as having something to sell. A benchmark taken
      // while the runtime was broken records every model as unloadable, and reporting that
      // as a pass would call a machine ready to sell when it has nothing to offer.
      no(`measured on this machine (${profile.platform}/${profile.arch}) but NO model loaded`);
      console.log('      the benchmark was taken while the runtime could not start;');
      console.log('      re-run `npm run bench` now that it can. Buying is unaffected.');
    } else {
      ok(`measured on this machine (${profile.platform}/${profile.arch}), ${runnable.length} model(s) runnable`);
      for (const m of runnable) console.log(`      ${m.id} · ~${Math.round(m.tps ?? 0)} tps`);
    }
  }
} catch {
  no('no bench-profile.json — run `npm run bench` before selling');
}

if (bad === 0) console.log('\nThis machine is ready.\n');
else if (rt.ok) console.log(`\n${bad} problem(s) above — this machine can BUY, but not sell.\n`);
else console.log(`\n${bad} problem(s) above — this machine can neither buy nor sell yet.\n`);
process.exit(bad === 0 ? 0 : 1);
