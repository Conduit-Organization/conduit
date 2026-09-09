// Live verification of the settlement-history subgraph — ETHOnline 2026 (new work).
//
// Run: CONDUIT_SUBGRAPH_URL=<studio query url> npm run graph-check
//
// Queries the deployed subgraph and prints the settlement record it derived from real
// on-chain history. No mocks anywhere in the path — if the endpoint is unset or the
// subgraph is still syncing, this says so rather than inventing data.
//
// The important assertion is the renewal one. ConduitEscrow has emitted exactly two
// Withdrawn events on Sepolia, and both are session renewals rather than abandonment:
// the same buyer reopened with the same seller 24 seconds later. A naive counter scores
// that seller 0.0. This checks the mapping actually classified them that way.
import { globalScore, reliability, type GlobalRecord } from '../core/qualification';

const ENDPOINT = process.env.CONDUIT_SUBGRAPH_URL || '';

const QUERY = `{
  _meta { block { number } hasIndexingErrors }
  market(id: "market") {
    totalChannelsOpened totalSettled totalWithdrawn
    totalQualifiedWithdrawn totalProbeChannels totalRenewals
    totalClaimed sellerCount buyerCount
  }
  sellers(first: 25, orderBy: channelsOpened, orderDirection: desc) {
    id channelsOpened channelsSettled qualifiedWithdrawn probeChannels renewals
    withdrawnTotal totalClaimed uniqueBuyers
  }
  buyers(first: 25) { id channelsOpened channelsSettled channelsWithdrawn channelsAbandoned }
  channels(first: 25, orderBy: openedAt, orderDirection: asc) {
    id epoch deposit durationSecs status qualifiedOnChain
    disqualificationReasons secondsUntilBuyerReopened
    buyer { id } seller { id }
  }
}`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ✔ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`); }
}

const short = (a: string) => a.slice(0, 10) + '…';
const usd = (base: string | bigint) => (Number(base) / 1e6).toFixed(6);

async function main(): Promise<void> {
  if (!ENDPOINT) {
    console.error('CONDUIT_SUBGRAPH_URL is not set.\n');
    console.error('  Get it from https://thegraph.com/studio → your subgraph → Query.');
    console.error('  Then: CONDUIT_SUBGRAPH_URL=<url> npm run graph-check');
    process.exit(1);
  }

  console.log('Conduit settlement-history subgraph — live check');
  console.log(`  endpoint: ${ENDPOINT.replace(/\/query\/\d+\//, '/query/<id>/')}\n`);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
  const body: any = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e: any) => e.message).join('; '));
  const d = body.data;

  // ── sync ──
  console.log('Indexing:');
  check('no indexing errors', d._meta.hasIndexingErrors === false);
  console.log(`    synced to block ${d._meta.block.number}`);

  // ── market totals ──
  const m = d.market;
  if (!m) {
    console.log('\n  Market entity not yet created — the subgraph has not reached the first event.');
    console.log('  Wait for the sync to pass block 11014142 and re-run.');
    process.exit(1);
  }
  console.log('\nMarket totals (derived from real on-chain events):');
  console.log(`    channels opened : ${m.totalChannelsOpened}`);
  console.log(`    settled         : ${m.totalSettled}`);
  console.log(`    withdrawn (all) : ${m.totalWithdrawn}`);
  console.log(`      ├─ qualified  : ${m.totalQualifiedWithdrawn}   ← counts against the seller`);
  console.log(`      ├─ probes     : ${m.totalProbeChannels}   ← indexed, visible, not scoring`);
  console.log(`      └─ renewals   : ${m.totalRenewals}   ← the buyer came straight back`);
  console.log(`    total claimed   : ${usd(m.totalClaimed)} USD₮`);
  console.log(`    sellers/buyers  : ${m.sellerCount} / ${m.buyerCount}`);

  check('indexed real settlement history', Number(m.totalChannelsOpened) > 0, `${m.totalChannelsOpened} channels`);
  check('found at least one completed settlement', Number(m.totalSettled) > 0, `${m.totalSettled} settled`);

  // ── the renewal finding ──
  console.log('\nThe renewal finding (why the naive counter is wrong):');
  const renewed = d.channels.filter((c: any) => c.status === 'RENEWED');
  const withdrawn = d.channels.filter((c: any) => c.status === 'WITHDRAWN');
  check(
    'every historical Withdrawn was reclassified as a renewal',
    Number(m.totalWithdrawn) > 0 && renewed.length === Number(m.totalWithdrawn) && withdrawn.length === 0,
    `${renewed.length} renewed, ${withdrawn.length} still counted as abandonment`
  );
  for (const c of renewed) {
    console.log(`    epoch ${c.epoch}  buyer ${short(c.buyer.id)} → seller ${short(c.seller.id)}`);
    console.log(`      reopened after ${c.secondsUntilBuyerReopened}s · reasons: ${c.disqualificationReasons.join(', ')}`);
  }
  check('no qualified adverse signals against any seller', Number(m.totalQualifiedWithdrawn) === 0);

  // ── per-seller scoring ──
  console.log('\nSeller records, scored by the published rules:');
  for (const s of d.sellers) {
    const rec: GlobalRecord = {
      settled: Number(s.channelsSettled),
      qualifiedWithdrawn: Number(s.qualifiedWithdrawn),
      probeChannels: Number(s.probeChannels),
      renewals: Number(s.renewals),
      uniqueVerifiedBuyers: Number(s.uniqueBuyers),
      totalClaimed: BigInt(s.totalClaimed),
    };
    const naive =
      Number(s.channelsSettled) + Number(s.withdrawnTotal) === 0
        ? 0.5
        : Number(s.channelsSettled) / (Number(s.channelsSettled) + Number(s.withdrawnTotal));
    console.log(`\n    ${s.id}`);
    console.log(`      opened ${s.channelsOpened} · settled ${s.channelsSettled} · withdrawn ${s.withdrawnTotal}` +
      ` (qualified ${s.qualifiedWithdrawn}, probes ${s.probeChannels}, renewals ${s.renewals})`);
    console.log(`      earned ${usd(s.totalClaimed)} USD₮ from ${s.uniqueBuyers} buyer(s)`);
    console.log(`      naive reliability : ${(naive * 100).toFixed(1)}%   ← the reading we do NOT ship`);
    console.log(`      hardened          : ${(reliability(rec) * 100).toFixed(1)}%`);
    console.log(`      globalScore       : ${globalScore(rec).toFixed(4)}`);
    if (Number(s.withdrawnTotal) > 0 && naive < reliability(rec)) {
      console.log(`      → the naive counter would have understated this seller by ` +
        `${((reliability(rec) - naive) * 100).toFixed(1)} points`);
    }
  }

  // ── buyer side ──
  console.log('\nBuyer records (the seller reads these before granting):');
  for (const b of d.buyers) {
    const rate = Number(b.channelsOpened) === 0 ? 0 : Number(b.channelsAbandoned) / Number(b.channelsOpened);
    console.log(`    ${short(b.id)}  opened ${b.channelsOpened} · settled ${b.channelsSettled} ·` +
      ` abandoned ${b.channelsAbandoned} → abandonment ${(rate * 100).toFixed(0)}%`);
  }

  check('a first-time buyer can score an unseen seller', d.sellers.length > 0);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('\ngraph-check failed:', e?.message ?? e);
  process.exit(1);
});
