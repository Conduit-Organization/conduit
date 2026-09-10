// Manufacture a QUALIFIED buyer abandonment on Arc — ETHOnline 2026 (new work).
//
// Run: CONDUIT_DEPLOYER_KEY=<funded key> npm run make-abandonment
//
// The seller's admission ladder refuses a buyer whose abandonment rate is too high
// (`buyer abandonment history`), which is the bilateral half of the accountability
// story — the buyer reads the seller's record, and the seller reads the buyer's.
//
// Demonstrating that refusal needs a buyer who has genuinely abandoned channels, and
// every buyer in both subgraphs currently sits at 0. This creates one, honestly: real
// channels, real deposits, a real expiry, real withdrawals.
//
// To COUNT as an abandonment a withdrawal must pass the on-chain qualification rules —
// long enough, funded enough, by a buyer who has actually settled something before, and
// not immediately followed by a reopen. So the script:
//
//   1. settles one genuine channel   → gives the buyer a settlement history
//   2. opens two funded channels     → deposits above the threshold, duration above it
//   3. waits for them to expire      → a real 600s wait, not a shortcut
//   4. withdraws both, and stops     → no reopen, so neither is a renewal
//
// Result: opened 3, settled 1, abandoned 2 → a 66.7% abandonment rate, over the 50%
// default the seller refuses at.
import { Wallet, JsonRpcProvider, formatUnits, keccak256, toUtf8Bytes, concat, getBytes } from 'ethers';
import { readFileSync } from 'node:fs';
import { createEscrowClient } from '../core/escrow';
import { ARC_TESTNET } from '../core/networks';
import { QUALIFICATION } from '../core/qualification';

// Comfortably over MIN_DEPOSIT_BASE_UNITS so the deposit rule passes unambiguously.
const DEPOSIT = 25_000n; // 0.025 USDC
const DRAW = 10_000n; // 0.01 USDC — one inference
const DURATION = QUALIFICATION.MIN_DURATION_SECS; // exactly the threshold: 600s
const FUND_BUYER = 200_000_000_000_000_000n; // 0.2 USDC for gas + deposits
const FUND_SELLER = 30_000_000_000_000_000n; // 0.03 USDC, enough to settle once

const usdc = (v: bigint) => formatUnits(v, 6);
const derive = (key: string, label: string) =>
  new Wallet(keccak256(concat([getBytes(key), toUtf8Bytes(label)])));

async function main(): Promise<void> {
  const key = process.env.CONDUIT_DEPLOYER_KEY;
  if (!key) throw new Error('set CONDUIT_DEPLOYER_KEY to a key funded with Arc testnet USDC');
  const key0x = key.startsWith('0x') ? key : `0x${key}`;

  const dep = JSON.parse(readFileSync('contracts/deployed.arc-testnet.json', 'utf8'));
  const provider = new JsonRpcProvider(ARC_TESTNET.rpcUrl);
  const funder = new Wallet(key0x, provider);
  const esc = createEscrowClient(ARC_TESTNET.rpcUrl, dep.escrow, ARC_TESTNET.chainId);

  // Deterministic, so re-runs address the same parties instead of littering the chain.
  const badBuyer = derive(key0x, 'conduit-bad-buyer').connect(provider);
  const settleSeller = derive(key0x, 'conduit-settle-seller').connect(provider);
  const abandonA = derive(key0x, 'conduit-abandon-a');
  const abandonB = derive(key0x, 'conduit-abandon-b');

  console.log('Manufacturing a qualified buyer abandonment on Arc testnet\n');
  console.log(`  bad buyer      : ${badBuyer.address}`);
  console.log(`  settle seller  : ${settleSeller.address}`);
  console.log(`  abandoned #1   : ${abandonA.address}`);
  console.log(`  abandoned #2   : ${abandonB.address}\n`);

  // ── fund ──
  for (const [w, amount, label] of [
    [badBuyer.address, FUND_BUYER, 'bad buyer'],
    [settleSeller.address, FUND_SELLER, 'settle seller'],
  ] as const) {
    const bal = await provider.getBalance(w);
    if (bal < amount / 2n) {
      console.log(`  funding ${label}…`);
      await (await funder.sendTransaction({ to: w, value: amount })).wait();
    }
  }

  // ── 1. one genuine settlement, so the buyer has a participation history ──
  let ch = await esc.channel(badBuyer.address, settleSeller.address);
  if (!ch.open && ch.epoch === 0n) {
    console.log('\n1. Settling one genuine channel (gives the buyer a history)…');
    await esc.open(badBuyer, dep.token, settleSeller.address, DEPOSIT, 3600);
    ch = await esc.channel(badBuyer.address, settleSeller.address);
    const sig = await esc.signVoucher(badBuyer, settleSeller.address, ch.epoch, DRAW);
    await esc.settle(settleSeller, badBuyer.address, DRAW, sig);
    console.log(`   settled ${usdc(DRAW)} USDC — the buyer is now a real participant`);
  } else {
    console.log('\n1. Buyer already has a settlement history — skipping.');
  }

  // ── 2. two funded channels, above every on-chain threshold ──
  console.log(`\n2. Opening two channels to abandon (deposit ${usdc(DEPOSIT)} USDC, duration ${DURATION}s)…`);
  const targets = [abandonA.address, abandonB.address];
  let expiry = 0n;
  for (const t of targets) {
    const c = await esc.channel(badBuyer.address, t);
    if (c.open) {
      console.log(`   ${t.slice(0, 12)}… already open (epoch ${c.epoch}, expiry ${c.expiry})`);
      expiry = c.expiry > expiry ? c.expiry : expiry;
      continue;
    }
    await esc.open(badBuyer, dep.token, t, DEPOSIT, DURATION);
    const opened = await esc.channel(badBuyer.address, t);
    expiry = opened.expiry > expiry ? opened.expiry : expiry;
    console.log(`   opened → ${t.slice(0, 12)}…  expires at ${opened.expiry}`);
  }

  // ── 3. wait for a real expiry ──
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  let remaining = expiry - now();
  console.log(`\n3. Waiting ${remaining > 0n ? remaining : 0n}s for the channels to expire.`);
  console.log('   This wait is the point — a channel that has not expired cannot be');
  console.log('   withdrawn, and a short one would not qualify as evidence anyway.');
  while (now() < expiry + 5n) {
    remaining = expiry + 5n - now();
    process.stdout.write(`\r   ${remaining}s remaining…    `);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('\r   expired.                    ');

  // ── 4. withdraw both, and do NOT reopen ──
  console.log('\n4. Withdrawing both — and deliberately not reopening, so neither');
  console.log('   counts as a session renewal…');
  for (const t of targets) {
    const c = await esc.channel(badBuyer.address, t);
    if (!c.open) { console.log(`   ${t.slice(0, 12)}… already closed`); continue; }
    const h = await esc.withdraw(badBuyer, t);
    console.log(`   withdrew ${t.slice(0, 12)}…  https://testnet.arcscan.app/tx/${h}`);
  }

  console.log(`
Done. Expected once the subgraph re-indexes:

    buyer ${badBuyer.address}
      channelsOpened     3
      channelsSettled    1
      channelsAbandoned  2
      abandonment rate   66.7%   (threshold ${QUALIFICATION.REQUIRE_VERIFIED_BUYER ? '' : ''}50%)

That buyer will now be refused at sessionOpen with 'buyer abandonment history',
which is the seller side of the same ledger the buyer reads about the seller.

  npm run graph-check      # confirm the record
`);
}

main().catch((e) => {
  console.error('\nmake-abandonment failed:', e?.message ?? e);
  process.exit(1);
});
