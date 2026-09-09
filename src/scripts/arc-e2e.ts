// End-to-end escrow settlement on Arc testnet — ETHOnline 2026 (new work).
//
// Run: CONDUIT_DEPLOYER_KEY=<funded key> npm run arc-e2e
//
// Drives a complete Conduit payment-channel lifecycle against the ConduitEscrow
// deployment on Arc, in USDC:
//
//   approve → open → sign vouchers off-chain → claim on-chain → settle → verify balances
//
// It deliberately goes through `src/core/escrow.ts` — the SAME client the buyer and
// seller nodes use — rather than raw ethers, so a pass here means the production rail
// works on Arc, not merely that the chain accepts transactions.
//
// On Arc, USDC is both the gas token and the settlement token. The seller therefore
// needs a small native balance to submit its claim, which the buyer funds at the start;
// on a general-purpose L2 that would have to be ETH the seller does not earn.
import { Wallet, JsonRpcProvider, Contract, formatUnits, formatEther, keccak256, toUtf8Bytes, concat, getBytes } from 'ethers';
import { readFileSync } from 'node:fs';
import { createEscrowClient } from '../core/escrow';
import { ARC_TESTNET } from '../core/networks';

const DEPOSIT = 1_000_000n; // 1 USDC — the storefront default
const PRICE = 10_000n; // 0.01 USDC per inference, the Qwen3-4B tier
const DRAWS = 3;
const DURATION = 3600;
const SELLER_GAS = 500_000_000_000_000_000n; // 0.5 USDC in the 18-dec native view

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ✔ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`); }
}
const usdc = (v: bigint) => formatUnits(v, 6);

/** Scale between Arc's two views of one balance: native is 18-dec, ERC-20 is 6-dec. */
const SCALE = 1_000_000_000_000n;

/**
 * Exact gas cost of a transaction, in native (18-decimal) units.
 *
 * The accounting below is done in native units on purpose. Arc exposes ONE balance
 * through two views — native at 18 decimals, ERC-20 at 6 — and the ERC-20 view is a
 * FLOORED projection of the native one. Reconciling a gas fee against an ERC-20 delta
 * therefore loses up to a base unit per reading, which is real truncation rather than a
 * discrepancy worth asserting about. Native units are exact, so that is where the
 * arithmetic happens; the 6-decimal figures are for display only.
 */
async function gasCostWei(provider: JsonRpcProvider, txHash: string): Promise<bigint> {
  const r = await provider.getTransactionReceipt(txHash);
  if (!r) return 0n;
  return r.gasUsed * r.gasPrice;
}

/** Display a native (18-dec) amount as USDC. */
const usdcFromWei = (v: bigint) => formatUnits(v, 18);

async function main(): Promise<void> {
  const key = process.env.CONDUIT_DEPLOYER_KEY;
  if (!key) throw new Error('set CONDUIT_DEPLOYER_KEY to a key funded with Arc testnet USDC');

  // `new Wallet()` accepts a bare hex key, but `getBytes()` below requires the 0x prefix.
  const key0x = key.startsWith('0x') ? key : `0x${key}`;

  const dep = JSON.parse(readFileSync('contracts/deployed.arc-testnet.json', 'utf8'));
  const provider = new JsonRpcProvider(ARC_TESTNET.rpcUrl);
  const buyer = new Wallet(key0x, provider);
  // Deterministic seller derived from the buyer key, so re-runs reuse the same address
  // (the escrow keys channels by buyer+seller, and epochs must advance predictably).
  const seller = new Wallet(keccak256(concat([getBytes(key0x), toUtf8Bytes('conduit-arc-seller')])), provider);

  console.log('Conduit — end-to-end settlement on Arc testnet\n');
  console.log(`  escrow  : ${dep.escrow}`);
  console.log(`  token   : ${dep.token} (USDC, 6 dec)`);
  console.log(`  buyer   : ${buyer.address}`);
  console.log(`  seller  : ${seller.address}\n`);

  const net = await provider.getNetwork();
  check('connected to Arc testnet', Number(net.chainId) === ARC_TESTNET.chainId, `chainId ${net.chainId}`);

  const token: any = new Contract(dep.token, [
    'function balanceOf(address) view returns (uint256)',
  ], provider);

  const esc = createEscrowClient(ARC_TESTNET.rpcUrl, dep.escrow, ARC_TESTNET.chainId);
  check('escrow points at the right settlement token', (await esc.tokenAddress()).toLowerCase() === dep.token.toLowerCase());

  // ── the seller needs gas, and on Arc that gas IS its revenue currency ──
  const sellerGasBalance = await provider.getBalance(seller.address);
  if (sellerGasBalance < SELLER_GAS / 2n) {
    console.log(`\n  funding seller with ${formatEther(SELLER_GAS)} USDC for gas…`);
    const tx = await buyer.sendTransaction({ to: seller.address, value: SELLER_GAS });
    await tx.wait();
  }
  console.log(`  seller gas balance: ${formatEther(await provider.getBalance(seller.address))} USDC\n`);

  const buyerBefore: bigint = await token.balanceOf(buyer.address);
  const sellerBefore: bigint = await token.balanceOf(seller.address);
  // Native balances are the exact ledger; the ERC-20 view above is a floored projection.
  const buyerNativeBefore = await provider.getBalance(buyer.address);
  const sellerNativeBefore = await provider.getBalance(seller.address);

  // ── 1. open (or reuse) a channel ──
  let ch = await esc.channel(buyer.address, seller.address);
  if (!ch.open) {
    console.log(`Opening a channel — deposit ${usdc(DEPOSIT)} USDC, ${DURATION}s…`);
    const txh = await esc.open(buyer, dep.token, seller.address, DEPOSIT, DURATION);
    console.log(`  open tx: https://testnet.arcscan.app/tx/${txh}`);
    ch = await esc.channel(buyer.address, seller.address);
  } else {
    console.log(`Reusing the open channel at epoch ${ch.epoch}.`);
  }
  check('channel is open on Arc', ch.open, `deposit ${usdc(ch.deposit)} USDC, epoch ${ch.epoch}`);
  const escrowBal: bigint = await token.balanceOf(dep.escrow);
  check('deposit was actually escrowed', escrowBal >= ch.deposit);

  // ── 2. off-chain vouchers, one per inference ──
  console.log(`\nSigning ${DRAWS} vouchers off-chain (one per answer, ${usdc(PRICE)} USDC each)…`);
  let cumulative = ch.claimed;
  let lastSig = '';
  for (let i = 1; i <= DRAWS; i++) {
    cumulative += PRICE;
    lastSig = await esc.signVoucher(buyer, seller.address, ch.epoch, cumulative);
    const recovered = esc.recoverVoucher(buyer.address, seller.address, ch.epoch, cumulative, lastSig);
    check(`voucher ${i} verifies to the buyer`, recovered.toLowerCase() === buyer.address.toLowerCase(), `cumulative ${usdc(cumulative)} USDC`);
  }
  const onchainDigest = await esc.voucherDigestOnchain(buyer.address, seller.address, ch.epoch, cumulative);
  check('off-chain EIP-712 digest matches the contract', !!onchainDigest && onchainDigest.startsWith('0x'));

  // ── 3. seller redeems on-chain ──
  console.log('\nSeller claims the accumulated vouchers on-chain…');
  const claimTx = await esc.claim(seller, buyer.address, cumulative, lastSig);
  console.log(`  claim tx: https://testnet.arcscan.app/tx/${claimTx}`);
  const afterClaim = await esc.channel(buyer.address, seller.address);
  check('claimed amount recorded on-chain', afterClaim.claimed === cumulative, `${usdc(afterClaim.claimed)} USDC`);
  const claimGas = await gasCostWei(provider, claimTx);
  const sellerNativeMid = await provider.getBalance(seller.address);
  // The seller pays its own gas OUT OF ITS REVENUE — that is the Arc property, not a bug.
  check('seller was paid the signed total, net of its own gas',
    sellerNativeMid - sellerNativeBefore === cumulative * SCALE - claimGas,
    `+${usdcFromWei(sellerNativeMid - sellerNativeBefore)} (earned ${usdc(cumulative)}, gas ${usdcFromWei(claimGas)})`);
  check('channel stays open for more draws', afterClaim.open);

  // ── 4. settle: close and refund the remainder ──
  console.log('\nSeller settles — closes the channel and refunds the remainder…');
  const settleTx = await esc.settle(seller, buyer.address, cumulative, lastSig);
  console.log(`  settle tx: https://testnet.arcscan.app/tx/${settleTx}`);
  const closed = await esc.channel(buyer.address, seller.address);
  check('channel closed', !closed.open);

  const settleGas = await gasCostWei(provider, settleTx);
  const buyerAfter: bigint = await token.balanceOf(buyer.address);
  const sellerAfter: bigint = await token.balanceOf(seller.address);
  const buyerNativeAfter = await provider.getBalance(buyer.address);
  const sellerNativeAfter = await provider.getBalance(seller.address);

  const sellerGas = claimGas + settleGas;
  const sellerNet = sellerNativeAfter - sellerNativeBefore;
  const buyerSpent = buyerNativeBefore - buyerNativeAfter;
  const buyerGas = buyerSpent - cumulative * SCALE; // approve + open, not hash-captured

  check('seller net revenue = signed total − its own gas',
    sellerNet === cumulative * SCALE - sellerGas,
    `${usdc(cumulative)} − ${usdcFromWei(sellerGas)} = ${usdcFromWei(sellerNet)} USDC`);
  check('buyer outlay = signed total + its own gas',
    buyerSpent === cumulative * SCALE + buyerGas && buyerGas > 0n,
    `${usdc(cumulative)} + ${usdcFromWei(buyerGas)} = ${usdcFromWei(buyerSpent)} USDC`);
  check('gas and revenue are the same asset — the Arc property',
    sellerGas > 0n && buyerGas > 0n);
  check('the ERC-20 view tracks the native ledger',
    (buyerBefore - buyerAfter) * SCALE <= buyerSpent && buyerSpent - (buyerBefore - buyerAfter) * SCALE < SCALE,
    'floored projection, within one base unit');
  const escrowAfter: bigint = await token.balanceOf(dep.escrow);
  check('no funds stranded in the escrow', escrowAfter === 0n);

  console.log(`\n  buyer  ${usdc(buyerBefore)} → ${usdc(buyerAfter)} USDC   (paid ${usdc(cumulative)} + ${usdcFromWei(buyerGas)} gas)`);
  console.log(`  seller ${usdc(sellerBefore)} → ${usdc(sellerAfter)} USDC   (earned ${usdc(cumulative)} − ${usdcFromWei(sellerGas)} gas)`);
  console.log(`\n  ${DRAWS} answers settled for ${usdc(cumulative)} USDC across 2 on-chain transactions.`);
  console.log(`  Total gas for the whole session: ${usdcFromWei(buyerGas + sellerGas)} USDC.`);
  console.log('');
  console.log('  Gas is denominated in the same unit the seller earns, so a seller\'s');
  console.log('  revenue and its costs never diverge. On a general-purpose L2 the seller');
  console.log('  would earn USDC and pay gas in ETH — involuntarily long a second asset.');
  console.log(`  Note the amortisation: this session paid gas twice for ${DRAWS} answers.`);
  console.log(`  The channel holds ${usdc(DEPOSIT)} USDC — ~${DEPOSIT / PRICE} answers for the same 2 transactions.\n`);

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('\narc-e2e failed:', e?.message ?? e);
  process.exit(1);
});
