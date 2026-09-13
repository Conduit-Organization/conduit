import test from 'node:test';
import assert from 'node:assert/strict';

// A buyer verified with World ID mid-session and the seller kept refusing them as an
// "unverified human" — restarting both apps was the only cure. The lookup cached its answer
// for ten minutes whether or not it found anything, so the one result that CAN change was
// the one being held.
//
// Registration is one-way: a wallet goes unregistered -> registered and never back. These
// tests pin that asymmetry. They model the cache rule rather than calling World Chain, so
// they stay offline and deterministic; the rule is the thing that was wrong.

function makeCache(positiveTtl: number, negativeTtl: number, now: () => number) {
  const cache = new Map<string, { id: string | null; at: number }>();
  let lookups = 0;
  return {
    get lookups() { return lookups; },
    forget(w: string) { cache.delete(w.toLowerCase()); },
    read(w: string, chain: () => string | null): string | null {
      const key = w.toLowerCase();
      const hit = cache.get(key);
      if (hit) {
        const ttl = hit.id ? positiveTtl : negativeTtl;
        if (now() - hit.at < ttl) return hit.id;
      }
      lookups++;
      const id = chain();
      cache.set(key, { id, at: now() });
      return id;
    },
  };
}

const W = '0xAbC0000000000000000000000000000000000001';
const ID = '0x810b30b971757bbb';

test('a "not registered" answer does not survive the user verifying', () => {
  let t = 0;
  const c = makeCache(600_000, 5_000, () => t);
  let registered = false;

  assert.equal(c.read(W, () => (registered ? ID : null)), null, 'starts unregistered');
  registered = true;                      // the scan in World App succeeds

  t += 6_000;                             // a few seconds pass
  assert.equal(c.read(W, () => (registered ? ID : null)), ID,
    'the seller must see the registration without being restarted');
});

test('a found registration is held, and costs no further lookups', () => {
  let t = 0;
  const c = makeCache(600_000, 5_000, () => t);
  assert.equal(c.read(W, () => ID), ID);
  const after = c.lookups;
  t += 60_000;
  assert.equal(c.read(W, () => ID), ID);
  assert.equal(c.lookups, after, 'a wallet that resolves to a human keeps resolving to one');
});

test('the short negative window still spares the second lookup in one purchase', () => {
  // A purchase looks the buyer up twice — once on the probe, once on the grant.
  let t = 0;
  const c = makeCache(600_000, 5_000, () => t);
  c.read(W, () => null);
  const after = c.lookups;
  t += 800;
  c.read(W, () => null);
  assert.equal(c.lookups, after, 'two reads moments apart should be one round trip');
});

test('forget() drops the answer immediately, without waiting out any window', () => {
  let t = 0;
  const c = makeCache(600_000, 5_000, () => t);
  let registered = false;
  assert.equal(c.read(W, () => (registered ? ID : null)), null);

  registered = true;
  c.forget(W);                            // we drove the registration; we know it changed
  assert.equal(c.read(W, () => (registered ? ID : null)), ID,
    'an invalidation we triggered ourselves must take effect at once');
});
