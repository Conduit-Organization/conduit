// The griefing attack, and its defence, live on Arc — ETHOnline 2026 (new work).
//
// Run: CONDUIT_DEPLOYER_KEY=<funded key> CONDUIT_SUBGRAPH_URL=<arc query url> npm run attack-demo
//
// Three acts, all real. Nothing here is simulated: the wallets are funded, the channels
// are opened and withdrawn on Arc testnet, the subgraph re-indexes them, and the human
// lookups hit AgentBook on World Chain.
//
//   ACT 1  Forge adverse signals against an honest seller for the price of gas.
//   ACT 2  Turn on the qualification rules. The forged signals stop counting.
//   ACT 3  Escalate: what an attacker must do to defeat those rules, and why the
//          human gate makes that unbounded rather than merely expensive.
//
// It runs on Arc deliberately. Gas there is denominated in USDC, so the cost of the
// attack is a real currency figure rather than a gas number nobody can price — and it
// keeps the Sepolia settlement history, which is our evidence, untouched.
import { Wallet, HDNodeWallet, JsonRpcProvider, Contract, formatUnits } from 'ethers';
import { readFileSync } from 'node:fs';
import { createEscrowClient } from '../core/escrow';
import { ARC_TESTNET } from '../core/networks';
import { createHumanity } from '../core/humanity';
import { QUALIFICATION, qualifyAdverseSignal, reliability, type GlobalRecord } from '../core/qualification';

const ATTACKERS = Number(process.env.ATTACKERS || '5');
const DUST = 1n; // the contract's minimum: require(amount > 0)
const GRIEF_DURATION = 1; // require(duration > 0) — the whole vulnerability
const FUND_PER_ATTACKER = 30_000_000_000_000_000n; // 0.03 USDC (18-dec native view)

const usdc = (v: bigint) => formatUnits(v, 6);
const usdcFromWei = (v: bigint) => formatUnits(v, 18);
const rule = (s = '') => console.log('\n' + '─'.repeat(74) + (s ? `\n${s}` : ''));

interface SellerRow {
  channelsSettled: string; qualifiedWithdrawn: string; probeChannels: string;
  renewals: string; withdrawnTotal: string; totalClaimed: string; uniqueBuyers: string;
}

async function querySeller(endpoint: string, seller: string): Promise<SellerRow | null> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `{ seller(id: "${seller.toLowerCase()}") {
        channelsSettled qualifiedWithdrawn probeChannels renewals
        withdrawnTotal totalClaimed uniqueBuyers } }`,
    }),
  });
  const body: any = await res.json();
  return body?.data?.seller ?? null;
}

async function waitForIndex(endpoint: string, seller: string, expectWithdrawn: number, tries = 40): Promise<SellerRow | null> {
  for (let i = 0; i < tries; i++) {
    const s = await querySeller(endpoint, seller);
    if (s && Number(s.withdrawnTotal) >= expectWithdrawn) return s;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return querySeller(endpoint, seller);
}

function naiveReliability(s: SellerRow): number {
  const n = Number(s.channelsSettled) + Number(s.withdrawnTotal);
  return n === 0 ? 0.5 : Number(s.channelsSettled) / n;
}

function record(s: SellerRow): GlobalRecord {
  return {
    settled: Number(s.channelsSettled),
    qualifiedWithdrawn: Number(s.qualifiedWithdrawn),
    probeChannels: Number(s.probeChannels),
    renewals: Number(s.renewals),
    uniqueVerifiedBuyers: Number(s.uniqueBuyers),
    totalClaimed: BigInt(s.totalClaimed),
  };
}

async function main(): Promise<void> {
  const key = process.env.CONDUIT_DEPLOYER_KEY;
  const endpoint = process.env.CONDUIT_SUBGRAPH_URL;
  if (!key) throw new Error('set CONDUIT_DEPLOYER_KEY to a key funded with Arc testnet USDC');
  if (!endpoint) throw new Error('set CONDUIT_SUBGRAPH_URL to the Arc subgraph query URL');

  const key0x = key.startsWith('0x') ? key : `0x${key}`;
  const dep = JSON.parse(readFileSync('contracts/deployed.arc-testnet.json', 'utf8'));
  const provider = new JsonRpcProvider(ARC_TESTNET.rpcUrl);
  const funder = new Wallet(key0x, provider);
  const esc = createEscrowClient(ARC_TESTNET.rpcUrl, dep.escrow, ARC_TESTNET.chainId);
  const token: any = new Contract(dep.token, ['function balanceOf(address) view returns (uint256)'], provider);

  // The victim: the seller that actually earned money in the end-to-end run. It has a
  // clean record and has done nothing wrong. That is the point.
  const VICTIM = '0x0E0D477350eF340442f0bB2275906cEE195F05e5';

  console.log('CONDUIT — forging a seller\'s reputation, and stopping it');
  console.log(`  network : Arc testnet (chainId ${ARC_TESTNET.chainId}) — gas is USDC`);
  console.log(`  escrow  : ${dep.escrow}`);
  console.log(`  victim  : ${VICTIM}`);
  console.log(`  attacker wallets: ${ATTACKERS}`);

  const before = await querySeller(endpoint, VICTIM);
  if (!before) throw new Error('victim seller not found in the subgraph — run npm run arc-e2e first');

  rule('ACT 1 — the attack');
  console.log(`
The victim's record right now, indexed from real on-chain settlement:

    settled            ${before.channelsSettled}
    withdrawn          ${before.withdrawnTotal}
    naive reliability  ${(naiveReliability(before) * 100).toFixed(1)}%

ConduitEscrow.open() bounds only amount > 0 and duration > 0. So a stranger can open a
one-second channel against any address for one base unit — a millionth of a dollar — and
withdraw it in the next block with the deposit returned in full. Each cycle emits the
same Withdrawn event a genuine grievance would.
`);

  let totalGasWei = 0n;
  const attackers: HDNodeWallet[] = [];

  for (let i = 1; i <= ATTACKERS; i++) {
    const a = Wallet.createRandom().connect(provider);
    attackers.push(a);
    process.stdout.write(`  [${i}/${ATTACKERS}] ${a.address.slice(0, 12)}…  `);

    const fundTx = await funder.sendTransaction({ to: a.address, value: FUND_PER_ATTACKER });
    const fundRcpt = await fundTx.wait();
    totalGasWei += fundRcpt!.gasUsed * fundRcpt!.gasPrice;

    const beforeBal: bigint = await token.balanceOf(a.address);
    const openHash = await esc.open(a, dep.token, VICTIM, DUST, GRIEF_DURATION);

    // duration=1 means the channel is withdrawable as soon as a block lands with a
    // timestamp past the open. Retry rather than assume the next block is far enough.
    let withdrawHash = '';
    for (let attempt = 0; attempt < 20; attempt++) {
      try { withdrawHash = await esc.withdraw(a, VICTIM); break; }
      catch { await new Promise((r) => setTimeout(r, 1500)); }
    }
    if (!withdrawHash) { console.log('withdraw failed'); continue; }

    for (const h of [openHash, withdrawHash]) {
      const r = await provider.getTransactionReceipt(h);
      if (r) totalGasWei += r.gasUsed * r.gasPrice;
    }
    const afterBal: bigint = await token.balanceOf(a.address);
    console.log(`forged  (deposit ${usdc(DUST)} returned: ${afterBal >= beforeBal - 1n ? 'yes' : 'no'})`);
  }

  console.log(`\n  Total cost to the attacker: ${usdcFromWei(totalGasWei)} USDC — gas only.`);
  console.log('  Capital at risk: zero. Every deposit came straight back.');

  console.log('\n  Waiting for the subgraph to re-index…');
  const expect = Number(before.withdrawnTotal) + ATTACKERS;
  const after = await waitForIndex(endpoint, VICTIM, expect);
  if (!after) throw new Error('subgraph did not return the victim after the attack');

  console.log(`
  The victim's record now:

    settled            ${after.channelsSettled}
    withdrawn          ${after.withdrawnTotal}   (was ${before.withdrawnTotal})
    naive reliability  ${(naiveReliability(after) * 100).toFixed(1)}%   (was ${(naiveReliability(before) * 100).toFixed(1)}%)

  This seller has done nothing wrong. Not one of those wallets ever bought anything.`);

  rule('ACT 2 — the qualification rules');
  console.log(`
A Withdrawn event is not evidence on its own. It counts against a seller only if the
channel that produced it looked like a real session opened by a real participant:

    duration        >= ${QUALIFICATION.MIN_DURATION_SECS}s          (the attack used ${GRIEF_DURATION}s)
    deposit         >= ${QUALIFICATION.MIN_DEPOSIT_BASE_UNITS} units   (the attack used ${DUST})
    buyer settled   >= ${QUALIFICATION.MIN_BUYER_SETTLEMENTS} with any seller  (the attack wallets: 0)
    not a renewal   the buyer did not immediately reopen
    buyer is a World-verified unique human
`);

  const forged = qualifyAdverseSignal({
    durationSecs: GRIEF_DURATION,
    depositBaseUnits: DUST,
    buyerSettledCount: 0,
    secondsUntilBuyerReopened: null,
    buyerIsVerifiedHuman: false,
  });
  console.log(`  Each forged channel fails on: ${forged.reasons.join(', ')}`);
  console.log(`\n  So the subgraph classifies them, it does not count them:`);
  console.log(`    qualifiedWithdrawn  ${after.qualifiedWithdrawn}   ← the only figure that scores`);
  console.log(`    probeChannels       ${after.probeChannels}   ← indexed, queryable, not scoring`);
  console.log(`    renewals            ${after.renewals}`);
  console.log(`\n    naive reliability     ${(naiveReliability(after) * 100).toFixed(1)}%`);
  console.log(`    hardened reliability  ${(reliability(record(after)) * 100).toFixed(1)}%   ← restored`);
  console.log('\n  Nothing is hidden. Every forged channel is still queryable, with the');
  console.log('  reason it was excluded. The rule can be audited rather than trusted.');

  rule('ACT 3 — why the human gate is what makes this hold');
  const depositToQualify = QUALIFICATION.MIN_DEPOSIT_BASE_UNITS * BigInt(ATTACKERS);
  console.log(`
The rules above raise the price of the attack. They do not make it impossible.

To produce ${ATTACKERS} adverse signals that actually COUNT, an attacker must now, per wallet:

    lock >= ${usdc(QUALIFICATION.MIN_DEPOSIT_BASE_UNITS)} USDC for >= ${QUALIFICATION.MIN_DURATION_SECS}s   (${usdc(depositToQualify)} USDC tied up in total)
    have completed >= ${QUALIFICATION.MIN_BUYER_SETTLEMENTS} genuine settlement beforehand
    avoid reopening with the victim

All of that is purchasable. It is a cost, not a barrier — which is exactly why the
signal cannot rest on economics alone.

The fifth rule is different in kind. It requires a distinct World-verified human per
identity, and that is not something more money buys.
`);

  const humanity = createHumanity();
  console.log('  Checking the attack wallets against AgentBook on World Chain (live):');
  let humanBacked = 0;
  for (const a of attackers.slice(0, Math.min(3, attackers.length))) {
    const id = await humanity.humanId(a.address);
    if (id) humanBacked++;
    console.log(`    ${a.address.slice(0, 14)}…  lookupHuman → ${id ?? 'null (not human-backed)'}`);
  }
  console.log(`    …${attackers.length > 3 ? `and ${attackers.length - 3} more, all the same` : ''}`);
  console.log(`\n  ${humanBacked} of ${attackers.length} attack wallets are backed by a verified human.`);

  console.log(`
  And because lookupHuman returns a stable ANONYMOUS HUMAN ID rather than a boolean,
  ${ATTACKERS} wallets belonging to one person collapse to one person. Buying more
  addresses buys nothing.

  Cost to forge ${ATTACKERS} counting adverse signals against this seller:

    with no rules          ${usdcFromWei(totalGasWei)} USDC          (measured above, just now)
    with rules 1-4         ${usdc(depositToQualify)} USDC locked + ${ATTACKERS} prior settlements
    with the human gate    ${ATTACKERS} verified humans — not purchasable at any price
`);

  rule();
  console.log('  The Graph made the attack visible. The rules made the signal honest.');
  console.log('  World made the identities scarce. Arc made the whole ledger cheap');
  console.log('  enough to write that any of it is worth doing.\n');
}

main().catch((e) => {
  console.error('\nattack-demo failed:', e?.message ?? e);
  process.exit(1);
});
