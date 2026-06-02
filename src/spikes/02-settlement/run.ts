// Spike #1.5 — prove USD₮ settles wallet-to-wallet on a testnet, via WDK.
//
// Uses one dev mnemonic: account 0 = "buyer" (funded), account 1 = "seller" (recipient we also
// control, so test funds aren't burned). Buyer transfers a small USD₮ amount to the seller and we
// confirm the seller's balance increased. Run: npm run spike:settle
import { formatUnits, formatEther } from 'ethers';
import { loadEnv } from '../../core/env';
import { getAccount } from '../../core/wallet';

const env = loadEnv();
const mnemonic = env.mnemonic || env.CONDUIT_WALLET_MNEMONIC || '';
const rpc = env.CONDUIT_RPC_URL || '';
const token = env.CONDUIT_USDT_ADDRESS || '';
const DEC = 6;
const AMOUNT = 250_000n; // 0.25 USD₮ (6 decimals)

if (!mnemonic || !rpc || !token) {
  console.error('Missing one of: mnemonic / CONDUIT_RPC_URL / CONDUIT_USDT_ADDRESS in .env');
  process.exit(1);
}
const fmt = (b: bigint) => formatUnits(b, DEC);

async function main() {
  console.log('=== Spike #1.5 — WDK USD₮ settlement (Sepolia testnet) ===\n');
  const buyer = await getAccount(mnemonic, rpc, 0);
  const seller = await getAccount(mnemonic, rpc, 1);
  console.log('buyer  (acct 0):', buyer.address);
  console.log('seller (acct 1):', seller.address, '\n');

  const [eth, bU0, sU0] = await Promise.all([buyer.ethBalance(), buyer.tokenBalance(token), seller.tokenBalance(token)]);
  console.log(`before:  buyer ${fmt(bU0)} USD₮ / ${formatEther(eth)} ETH   |   seller ${fmt(sU0)} USD₮\n`);

  console.log(`transferring ${fmt(AMOUNT)} USD₮  buyer → seller  via WDK account.transfer …`);
  const t0 = Date.now();
  const res = await buyer.transferToken(token, seller.address, AMOUNT);
  const hash = res?.hash ?? String(res);
  console.log('  tx submitted:', hash);

  let sU1 = sU0;
  for (let i = 0; i < 45 && sU1 <= sU0; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    sU1 = await seller.tokenBalance(token);
  }
  const bU1 = await buyer.tokenBalance(token);
  console.log(`  confirmed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  console.log(`after :  buyer ${fmt(bU1)} USD₮ (Δ ${fmt(bU1 - bU0)})   |   seller ${fmt(sU1)} USD₮ (Δ +${fmt(sU1 - sU0)})`);
  const ok = sU1 - sU0 === AMOUNT;
  console.log('\nSPIKE #1.5:', ok ? 'PASS ✅  USD₮ settled wallet-to-wallet via WDK' : 'CHECK — unexpected balance delta');
  console.log('tx      :', hash);
  console.log('explorer: https://sepolia.etherscan.io/tx/' + hash);
}

main()
  .then(() => setTimeout(() => process.exit(0), 200))
  .catch((e) => {
    console.error('SPIKE #1.5 ERROR:', e?.message ?? e);
    process.exit(1);
  });
