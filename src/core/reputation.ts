// Seller reputation — a small persistent record of how each seller has performed for THIS buyer.
//
// Keyed by seller WALLET address (stable across restarts; the marketplace `id` is not — see the M3
// handoff gotcha). Tracks served/failed counts + a rolling tps average, persisted to disk so trust
// survives restarts. Surfaced in the marketplace and used to rank the "Auto" pick. This is a local,
// first-party signal (what I myself experienced) — not a global score; a gossiped/global reputation
// network is future work.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SellerRep {
  served: number; // successful paid answers
  failed: number; // failed attempts (timeout / disconnect / reject / bad delivery)
  avgTps: number; // rolling average tokens/sec over served answers
  lastSeen: number; // ms epoch of the last recorded outcome
}

export interface Reputation {
  get(wallet: string): SellerRep | null;
  /** successRate in [0,1]; neutral 0.5 when there's no history yet (don't bury new sellers). */
  successRate(wallet: string): number;
  /** sortable score for "Auto": success rate, lightly boosted by speed. Higher = better. */
  score(wallet: string): number;
  recordServed(wallet: string, tps?: number | null): void;
  recordFailed(wallet: string): void;
  snapshot(): Record<string, SellerRep>;
}

function repPath(): string {
  return process.env.CONDUIT_REPUTATION || path.join(os.homedir(), '.conduit', 'reputation.json');
}

export function createReputation(): Reputation {
  let data: Record<string, SellerRep> = {};
  try { data = JSON.parse(readFileSync(repPath(), 'utf8')); } catch { /* fresh */ }

  const key = (w: string) => w.toLowerCase();
  function save() {
    try {
      const p = repPath();
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(data, null, 2));
    } catch { /* best-effort; reputation is a convenience signal, not critical state */ }
  }
  const entry = (w: string): SellerRep => (data[key(w)] ??= { served: 0, failed: 0, avgTps: 0, lastSeen: 0 });

  return {
    get(wallet) {
      return data[key(wallet)] ?? null;
    },
    successRate(wallet) {
      const r = data[key(wallet)];
      if (!r) return 0.5; // unknown → neutral
      const n = r.served + r.failed;
      return n === 0 ? 0.5 : r.served / n;
    },
    score(wallet) {
      const r = data[key(wallet)];
      if (!r || r.served + r.failed === 0) return 0.5; // neutral baseline for new sellers
      const rate = r.served / (r.served + r.failed);
      const speed = Math.min(1, r.avgTps / 120); // normalise tps (~120 = great) into a small bonus
      return rate * 0.85 + speed * 0.15;
    },
    recordServed(wallet, tps) {
      const r = entry(wallet);
      r.served += 1;
      if (tps && tps > 0) r.avgTps = r.avgTps === 0 ? tps : r.avgTps * 0.7 + tps * 0.3; // EWMA
      r.lastSeen = Date.now();
      save();
    },
    recordFailed(wallet) {
      const r = entry(wallet);
      r.failed += 1;
      r.lastSeen = Date.now();
      save();
    },
    snapshot() {
      return data;
    },
  };
}
