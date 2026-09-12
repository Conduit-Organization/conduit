// The QVAC worker lock, and recovering from one its owner never released.
//
// QVAC serialises access to its inference worker with ~/.qvac/.worker.lock, which records
// the owning pid. A process killed hard — or an Electron shell torn down, or a crashed
// run — leaves the file behind, and the next attempt to start the worker waits on a
// process that will never appear. It surfaces much later, and says nothing useful:
//
//     RPC initialization timed out after 30000ms — the worker process may have failed to start
//
// This was first fixed for the seller, because that is where it was found. It applies just
// as much to the buyer: a buyer delegates inference to a peer, but the delegated call still
// runs through this machine's worker. Both roles clear it, from here.
import { readFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type LockOutcome = 'removed' | 'kept' | 'absent';

export function workerLockPath(): string {
  return path.join(os.homedir(), '.qvac', '.worker.lock');
}

/**
 * Remove a worker lock whose owner is gone; never touch one whose owner is alive.
 *
 * A lock naming a dead pid is garbage. A lock naming a LIVE process is not ours to take:
 * another Conduit is running on this machine, and reporting that is more useful than
 * silently fighting it for the worker. An unparseable file is treated as garbage — it
 * cannot be shown to belong to anyone.
 */
export function clearStaleWorkerLock(lockPath = workerLockPath()): { outcome: LockOutcome; pid?: number } {
  let raw: string;
  try { raw = readFileSync(lockPath, 'utf8'); }
  catch { return { outcome: 'absent' }; }

  let pid: number | undefined;
  try { pid = JSON.parse(raw)?.pid; } catch { /* unparseable → stale */ }

  if (typeof pid === 'number') {
    try { process.kill(pid, 0); return { outcome: 'kept', pid }; } // throws iff gone
    catch { /* not running → stale */ }
  }
  try { unlinkSync(lockPath); return { outcome: 'removed', pid }; }
  catch { return { outcome: 'kept', pid }; } // raced with someone else clearing it
}

/** Clear it and say what happened, in whichever role's voice is calling. */
export function recoverWorkerLock(tag: string, log = console.log): void {
  const { outcome, pid } = clearStaleWorkerLock();
  if (outcome === 'removed') log(`${tag} cleared a stale QVAC worker lock (pid ${pid ?? 'unknown'} is gone)`);
  else if (outcome === 'kept') log(`${tag} note: the QVAC worker lock is held by a live process (pid ${pid}) — sharing the worker`);
}
