// Tests for the blended local+global reputation — ETHOnline 2026 (new work).
//
// The subgraph is injected as a fetch stub, so these run offline and deterministically.
// What they protect:
//   - the marketplace behaves EXACTLY as before when the global layer is absent or broken
//   - first-party experience wins once it exists (we blend, we do not replace)
//   - breadth counts unique HUMANS, not unique addresses — the whole point of the gate
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphReputation, type HumanityLookup } from './graph-reputation';
import { createReputation } from './reputation';
import os from 'node:os';
import path from 'node:path';
import type { Reputation, SellerRep } from './reputation';

const SELLER = '0x1111111111111111111111111111111111111111';
const BUYER_A = '0xaaaa000000000000000000000000000000000001';
const BUYER_B = '0xaaaa000000000000000000000000000000000002';
const BUYER_C = '0xaaaa000000000000000000000000000000000003';

/** An in-memory Reputation, so tests never touch ~/.conduit/reputation.json. */
function memoryReputation(): Reputation {
  const data: Record<string, SellerRep> = {};
  const key = (w: string) => w.toLowerCase();
  const entry = (w: string) => (data[key(w)] ??= { served: 0, failed: 0, avgTps: 0, lastSeen: 0 });
  return {
    get: (w) => data[key(w)] ?? null,
    successRate(w) {
      const r = data[key(w)];
      if (!r) return 0.5;
      const n = r.served + r.failed;
      return n === 0 ? 0.5 : r.served / n;
    },
    score(w) {
      const r = data[key(w)];
      if (!r || r.served + r.failed === 0) return 0.5;
      const rate = r.served / (r.served + r.failed);
      return rate * 0.85 + Math.min(1, r.avgTps / 120) * 0.15;
    },
    recordServed(w, tps) {
      const r = entry(w);
      r.served += 1;
      if (tps && tps > 0) r.avgTps = r.avgTps === 0 ? tps : r.avgTps * 0.7 + tps * 0.3;
    },
    recordFailed(w) {
      entry(w).failed += 1;
    },
    snapshot: () => data,
  };
}

interface StubOpts {
  sellers?: any[];
  buyers?: any[];
  fail?: boolean;
  httpStatus?: number;
  graphqlErrors?: string[];
}

function stubFetch(o: StubOpts = {}) {
  let calls = 0;
  const fn = (async () => {
    calls++;
    if (o.fail) throw new Error('network down');
    if (o.httpStatus && o.httpStatus !== 200) {
      return { ok: false, status: o.httpStatus, json: async () => ({}) } as any;
    }
    if (o.graphqlErrors) {
      return { ok: true, status: 200, json: async () => ({ errors: o.graphqlErrors!.map((m) => ({ message: m })) }) } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { sellers: o.sellers ?? [], buyers: o.buyers ?? [] } }),
    } as any;
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

function seller(over: Partial<any> = {}) {
  return {
    id: SELLER,
    channelsOpened: '10',
    channelsSettled: '9',
    qualifiedWithdrawn: '1',
    probeChannels: '0',
    renewals: '0',
    withdrawnTotal: '1',
    totalClaimed: '1000000',
    uniqueBuyers: '3',
    channels: [
      { status: 'SETTLED', buyer: { id: BUYER_A } },
      { status: 'SETTLED', buyer: { id: BUYER_B } },
      { status: 'WITHDRAWN', buyer: { id: BUYER_C } },
    ],
    ...over,
  };
}

describe('degradation — the marketplace must not depend on the subgraph', () => {
  test('with no endpoint, every method delegates to the local implementation', async () => {
    const local = memoryReputation();
    local.recordServed(SELLER, 100);
    const g = createGraphReputation({ endpoint: null, local });

    assert.equal(g.isLive(), false);
    assert.equal(g.globalRecord(SELLER), null);
    assert.equal(g.score(SELLER), local.score(SELLER));
    assert.equal(g.successRate(SELLER), local.successRate(SELLER));
    assert.deepEqual(g.get(SELLER), local.get(SELLER));
  });

  test('an unknown seller still scores the 0.5 baseline "Auto" relies on', () => {
    const g = createGraphReputation({ endpoint: null, local: memoryReputation() });
    // storefront.ts:126-128 compares scores and falls through to price-then-speed when
    // they are within 0.02. Every seller at 0.5 is what makes that fall-through happen.
    assert.equal(g.score(SELLER), 0.5);
  });

  test('a network failure never throws and leaves scoring on the local path', async () => {
    const local = memoryReputation();
    const stub = stubFetch({ fail: true });
    const g = createGraphReputation({ endpoint: 'https://example.invalid/subgraph', local, fetchImpl: stub.fn });

    await g.refresh(); // must not reject
    assert.equal(g.isLive(), false);
    assert.match(g.lastError() ?? '', /network down/);
    assert.equal(g.score(SELLER), 0.5);
  });

  test('an HTTP error and a GraphQL error are both survived', async () => {
    const local = memoryReputation();
    for (const opts of [{ httpStatus: 503 }, { graphqlErrors: ['bad query'] }]) {
      const g = createGraphReputation({
        endpoint: 'https://example.invalid/subgraph',
        local,
        fetchImpl: stubFetch(opts).fn,
      });
      await g.refresh();
      assert.equal(g.isLive(), false);
      assert.ok(g.lastError());
    }
  });

  test('stale data is kept when a later refresh fails', async () => {
    const local = memoryReputation();
    let mode: StubOpts = { sellers: [seller()] };
    const fetchImpl = (async (...a: any[]) => stubFetch(mode).fn(...(a as [any]))) as unknown as typeof fetch;
    const g = createGraphReputation({ endpoint: 'https://x/sg', local, fetchImpl });

    await g.refresh();
    assert.equal(g.isLive(), true);
    const before = g.globalRecord(SELLER);

    mode = { fail: true };
    await g.refresh();
    assert.deepEqual(g.globalRecord(SELLER), before, 'stale global data beats none');
  });
});

describe('blending — local experience wins once it exists', () => {
  async function live(localRep: Reputation, sellers = [seller()]) {
    const g = createGraphReputation({
      endpoint: 'https://x/sg',
      local: localRep,
      fetchImpl: stubFetch({ sellers }).fn,
    });
    await g.refresh();
    return g;
  }

  test('with no local history the score is purely global', async () => {
    const local = memoryReputation();
    const g = await live(local);
    const rec = g.globalRecord(SELLER)!;
    assert.ok(rec);
    // n = 0 → w_local = 0/(0+5) = 0 → entirely the global score.
    assert.notEqual(g.score(SELLER), 0.5, 'a seller with real history must not score the unknown baseline');
    assert.ok(g.score(SELLER) > 0.5, '9 settled vs 1 withdrawn is a good record');
  });

  test('local history pulls the score toward first-party experience', async () => {
    const local = memoryReputation();
    const g = await live(local);
    const globalOnly = g.score(SELLER);

    // This buyer has personally had a terrible time with an otherwise well-regarded seller.
    for (let i = 0; i < 20; i++) local.recordFailed(SELLER);
    const blended = g.score(SELLER);

    assert.ok(blended < globalOnly, 'my own bad experience must outweigh strangers');
    // w_local = 20/25 = 0.8, so the blend must land nearer my own score than the
    // strangers' — that is the whole claim, and it is what to assert, rather than an
    // arbitrary epsilon.
    const distToLocal = Math.abs(blended - local.score(SELLER));
    const distToGlobal = Math.abs(blended - globalOnly);
    assert.ok(distToLocal < distToGlobal, `blended ${blended} should sit nearer local ${local.score(SELLER)} than global ${globalOnly}`);
    // And the exact arithmetic: 0.8 * local + 0.2 * global.
    assert.ok(Math.abs(blended - (0.8 * local.score(SELLER) + 0.2 * globalOnly)) < 1e-9);
  });

  test('the blend weight is monotonic in the amount of local evidence', async () => {
    const local = memoryReputation();
    const g = await live(local);
    let prev = g.score(SELLER);
    const seen: number[] = [prev];
    for (let i = 0; i < 10; i++) {
      local.recordFailed(SELLER);
      const s = g.score(SELLER);
      assert.ok(s <= prev + 1e-9, 'each bad first-party outcome may only lower the score');
      prev = s;
      seen.push(s);
    }
    assert.ok(seen[seen.length - 1]! < seen[0]!);
  });

  test('successRate answers globally only when there is no local history', async () => {
    const local = memoryReputation();
    const g = await live(local);
    // 9 settled / (9 settled + 1 qualified withdrawn) = 0.9
    assert.ok(Math.abs(g.successRate(SELLER) - 0.9) < 1e-9);

    local.recordServed(SELLER, 50);
    assert.equal(g.successRate(SELLER), local.successRate(SELLER), 'local wins once it exists');
  });

  test('recording outcomes still writes through to the local store', async () => {
    const local = memoryReputation();
    const g = await live(local);
    g.recordServed(SELLER, 42);
    assert.equal(local.get(SELLER)!.served, 1);
    g.recordFailed(SELLER);
    assert.equal(local.get(SELLER)!.failed, 1);
  });
});

describe('breadth counts humans, not addresses', () => {
  const oneHuman: HumanityLookup = { humanId: async () => '0xdeadbeef' };
  const perWallet: HumanityLookup = { humanId: async (w) => 'human-' + w.toLowerCase() };

  test('without a humanity lookup it falls back to distinct addresses, and says so', async () => {
    const g = createGraphReputation({ endpoint: 'https://x/sg', local: memoryReputation(), fetchImpl: stubFetch({ sellers: [seller()] }).fn });
    await g.refresh();
    assert.equal(g.breadthCountsHumans(), false);
    assert.equal(g.globalRecord(SELLER)!.uniqueVerifiedBuyers, 3, '3 distinct wallets');
  });

  test('three wallets backed by ONE human collapse to one', async () => {
    const g = createGraphReputation({
      endpoint: 'https://x/sg',
      local: memoryReputation(),
      humanity: oneHuman,
      fetchImpl: stubFetch({ sellers: [seller()] }).fn,
    });
    await g.refresh();
    assert.equal(g.breadthCountsHumans(), true);
    assert.equal(g.globalRecord(SELLER)!.uniqueVerifiedBuyers, 1, 'sybil breadth collapses');
  });

  test('three wallets backed by three humans stay three', async () => {
    const g = createGraphReputation({
      endpoint: 'https://x/sg',
      local: memoryReputation(),
      humanity: perWallet,
      fetchImpl: stubFetch({ sellers: [seller()] }).fn,
    });
    await g.refresh();
    assert.equal(g.globalRecord(SELLER)!.uniqueVerifiedBuyers, 3);
  });

  test('unregistered wallets do not count toward breadth', async () => {
    const none: HumanityLookup = { humanId: async () => null };
    const g = createGraphReputation({
      endpoint: 'https://x/sg',
      local: memoryReputation(),
      humanity: none,
      fetchImpl: stubFetch({ sellers: [seller()] }).fn,
    });
    await g.refresh();
    assert.equal(g.globalRecord(SELLER)!.uniqueVerifiedBuyers, 0);
  });
});

describe('buyer-side accountability (the seller reads the buyer too)', () => {
  const buyers = [
    { id: BUYER_A, channelsOpened: '10', channelsSettled: '9', channelsWithdrawn: '1', channelsAbandoned: '0' },
    { id: BUYER_C, channelsOpened: '4', channelsSettled: '0', channelsWithdrawn: '4', channelsAbandoned: '3' },
  ];

  async function live() {
    const g = createGraphReputation({
      endpoint: 'https://x/sg',
      local: memoryReputation(),
      fetchImpl: stubFetch({ sellers: [seller()], buyers }).fn,
    });
    await g.refresh();
    return g;
  }

  test('a good buyer has a zero abandonment rate', async () => {
    assert.equal((await live()).buyerAbandonmentRate(BUYER_A), 0);
  });

  test('a serial abandoner is measurable', async () => {
    assert.ok(Math.abs((await live()).buyerAbandonmentRate(BUYER_C) - 0.75) < 1e-9);
  });

  test('an unknown buyer is accused of nothing', async () => {
    // A brand-new buyer must not be refused for having no record.
    assert.equal((await live()).buyerAbandonmentRate('0xffff000000000000000000000000000000000009'), 0);
  });

  test('is case-insensitive about addresses', async () => {
    assert.equal((await live()).buyerAbandonmentRate(BUYER_C.toUpperCase()), (await live()).buyerAbandonmentRate(BUYER_C));
  });
});

describe('the real reputation.ts satisfies the interface we wrap', () => {
  test('createReputation is a drop-in for the local dependency', () => {
    // Guards against reputation.ts changing shape underneath us. Point it at a temp path
    // so the suite never reads or writes the developer's real ~/.conduit/reputation.json.
    process.env.CONDUIT_REPUTATION = path.join(os.tmpdir(), `conduit-rep-test-${process.pid}.json`);
    const real = createReputation();
    const g = createGraphReputation({ endpoint: null, local: real });
    assert.equal(typeof g.score(SELLER), 'number');
    assert.equal(typeof g.successRate(SELLER), 'number');
    assert.equal(g.score(SELLER), real.score(SELLER));
  });
});
