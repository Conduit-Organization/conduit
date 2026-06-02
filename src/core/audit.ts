// JSONL audit logger — one event object per line, generated live from the same run as the demo.
// Events: settlement | p2p (sub: gate_opened|handshake_granted|handshake_rejected) | inference | model_load | bench.
import { appendFileSync, writeFileSync } from 'node:fs';

export interface Audit {
  path: string;
  log(event: string, payload?: Record<string, unknown>): void;
}

export function makeAudit(path = 'AUDIT_LOG.jsonl', fresh = true): Audit {
  if (fresh) writeFileSync(path, '');
  return {
    path,
    log(event: string, payload: Record<string, unknown> = {}) {
      appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), event, ...payload }) + '\n');
    },
  };
}
