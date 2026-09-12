import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The logic sell.ts applies to ~/.qvac/.worker.lock, exercised against a temp file.
// Kept in step with clearStaleWorkerLock() there; the rules are what matter:
//   a lock naming a DEAD pid is garbage        → remove it
//   a lock naming a LIVE pid belongs to someone → leave it alone
function clearStaleWorkerLock(lockPath: string): 'removed' | 'kept' | 'absent' {
  let raw: string;
  try { raw = readFileSync(lockPath, 'utf8'); } catch { return 'absent'; }

  let pid: number | undefined;
  try { pid = JSON.parse(raw)?.pid; } catch { /* unparseable → stale */ }

  if (typeof pid === 'number') {
    try { process.kill(pid, 0); return 'kept'; } catch { /* gone → stale */ }
  }
  try { unlinkSync(lockPath); return 'removed'; } catch { return 'kept'; }
}

const dir = mkdtempSync(path.join(tmpdir(), 'conduit-lock-'));
const lock = (name: string) => path.join(dir, name);

test('a lock left by a dead process is removed', () => {
  // The condition found on the machine where a buyer paid and got nothing: a lock naming
  // a pid from a run that had long since exited.
  const p = lock('dead.lock');
  let deadPid = 999_999;
  while (true) { try { process.kill(deadPid, 0); deadPid--; } catch { break; } }
  writeFileSync(p, JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }));

  assert.equal(clearStaleWorkerLock(p), 'removed');
  assert.equal(existsSync(p), false, 'a stale lock must not survive');
});

test("a lock held by a live process is left alone", () => {
  // Another Conduit really is running here. Deleting its lock would have two processes
  // fighting over one worker, which is worse than waiting.
  const p = lock('live.lock');
  writeFileSync(p, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  assert.equal(clearStaleWorkerLock(p), 'kept');
  assert.equal(existsSync(p), true, "another process's lock must not be deleted");
});

test('an unparseable lock is treated as garbage', () => {
  const p = lock('junk.lock');
  writeFileSync(p, 'not json at all');
  assert.equal(clearStaleWorkerLock(p), 'removed');
  assert.equal(existsSync(p), false);
});

test('no lock at all is not an error', () => {
  assert.equal(clearStaleWorkerLock(lock('nope.lock')), 'absent');
});
