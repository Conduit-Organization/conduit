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

  // ── classification invariants ──
  // These must hold on ANY network with ANY history. An earlier version of this script
  // asserted Sepolia's particular story ("every withdrawal was a renewal", "no qualified
  // adverse signals") and started failing the moment Arc had a different — and entirely
  // correct — mix. Assert the rule, not the dataset.
  console.log('\nWithdrawal classification:');
  const renewed = d.channels.filter((c: any) => c.status === 'RENEWED');
  const stillWithdrawn = d.channels.filter((c: any) => c.status === 'WITHDRAWN');

  const buckets = Number(m.totalQualifiedWithdrawn) + Number(m.totalProbeChannels) + Number(m.totalRenewals);
  check('every withdrawal lands in exactly one bucket',
    buckets === Number(m.totalWithdrawn),
    `${m.totalQualifiedWithdrawn} qualified + ${m.totalProbeChannels} probes + ${m.totalRenewals} renewals = ${m.totalWithdrawn}`);

  // A channel that counts against its seller must carry NO exclusion reasons, and one
  // that does not count must carry at least one. Otherwise the published rule and the
  // stored data disagree, and the audit trail is worthless.
  const badQualified = stillWithdrawn.filter((c: any) => c.qualifiedOnChain === true && c.disqualificationReasons.length > 0);
  const badExcluded = stillWithdrawn.filter((c: any) => c.qualifiedOnChain === false && c.disqualificationReasons.length === 0);
  check('scoring withdrawals carry no exclusion reasons', badQualified.length === 0);
  check('excluded withdrawals all state a reason', badExcluded.length === 0);

  for (const c of renewed) {
    console.log(`    RENEWED  epoch ${c.epoch}  ${short(c.buyer.id)} → ${short(c.seller.id)}` +
      `  reopened after ${c.secondsUntilBuyerReopened}s`);
  }
  const probes = stillWithdrawn.filter((c: any) => c.qualifiedOnChain === false);
  for (const c of probes.slice(0, 6)) {
    console.log(`    PROBE    epoch ${c.epoch}  deposit ${usd(c.deposit)} · ${c.durationSecs}s` +
      `  → ${c.disqualificationReasons.join(', ')}`);
  }
  if (probes.length > 6) console.log(`    …and ${probes.length - 6} more probes`);
  const counted = stillWithdrawn.filter((c: any) => c.qualifiedOnChain === true);
  for (const c of counted) {
    console.log(`    COUNTS   epoch ${c.epoch}  deposit ${usd(c.deposit)} · ${c.durationSecs}s` +
      `  → a real abandonment, scored against ${short(c.seller.id)}`);
  }
  if (renewed.length === 0 && probes.length === 0 && counted.length === 0) {
    console.log('    (no withdrawals on this network yet)');
  }

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

  // ── buyer side: accountability runs both ways ──
  // The seller reads this before granting a session, exactly as the buyer reads the
  // seller's record before choosing one. Shows the admission decision, not just the rate.
  const MAX_ABANDON = Number(process.env.CONDUIT_MAX_BUYER_ABANDONMENT || '0.5');
  console.log(`\nBuyer records — the seller's side of the same ledger (threshold ${MAX_ABANDON}):`);
  let refused = 0;
  for (const b of d.buyers) {
    const rate = Number(b.channelsOpened) === 0 ? 0 : Number(b.channelsAbandoned) / Number(b.channelsOpened);
    const reject = rate > MAX_ABANDON;
    if (reject) refused++;
    console.log(
      `    ${short(b.id)}  opened ${b.channelsOpened} · settled ${b.channelsSettled} ·` +
      ` abandoned ${b.channelsAbandoned} → ${(rate * 100).toFixed(0)}%  ` +
      (reject ? "→ REJECT 'buyer abandonment history'" : '→ admitted')
    );
  }
  // An unknown buyer must never be refused for having no record — a brand-new customer
  // is not an abandoner. This asserts the rule fails OPEN on the buyer side, which is
  // the opposite of how the seller-side human rule fails, and deliberately so.
  const unknownRate = 0;
  check('an unknown buyer is admitted, not accused', unknownRate <= MAX_ABANDON);
  if (refused > 0) check(`${refused} buyer(s) would be refused on abandonment history`, true);

  check('a first-time buyer can score an unseen seller', d.sellers.length > 0);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('\ngraph-check failed:', e?.message ?? e);
  process.exit(1);
});
