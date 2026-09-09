// Deploy ConduitEscrow to the configured network, pointing at the real settlement token.
//
//   Sepolia: CONDUIT_DEPLOYER_KEY=<key> CONDUIT_USDT_ADDRESS=<token> \
//              npx hardhat run scripts/deploy.ts --network sepolia
//   Arc:     CONDUIT_DEPLOYER_KEY=<key> npx hardhat run scripts/deploy.ts --network arcTestnet
//
// ETHOnline 2026: the deployment record is written per-network
// (contracts/deployed.<network>.json) instead of always overwriting the Sepolia one,
// because the Sepolia settlement history IS our reputation data and must not be lost.
//
// The CONTRACT ITSELF IS UNMODIFIED. Redeploying the identical audited source to a second
// network is a stronger claim than editing it, and it keeps every existing voucher,
// channel and indexed event valid.
import { ethers, network } from 'hardhat';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

// Verified settlement tokens per network. Arc's USDC is native at a fixed address and
// reads decimals() == 6 on-chain, matching the Sepolia test-USD₮ the app already uses.
// See docs/ethonline/VERIFIED-CONSTANTS.md.
const DEFAULT_TOKEN: Record<string, string> = {
  sepolia: '0xd077A400968890Eacc75cdc901F0356c943e4fDb',
  arcTestnet: '0x3600000000000000000000000000000000000000',
};

// Map the hardhat network name to the profile name used by src/core/networks.ts.
const PROFILE_NAME: Record<string, string> = {
  sepolia: 'sepolia',
  arcTestnet: 'arc-testnet',
};

async function main() {
  const token = process.env.CONDUIT_USDT_ADDRESS || DEFAULT_TOKEN[network.name];
  if (!token) throw new Error(`set CONDUIT_USDT_ADDRESS (no default settlement token for network '${network.name}')`);

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('no signer — set CONDUIT_DEPLOYER_KEY to a funded key');
  const bal = await ethers.provider.getBalance(deployer.address);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  // On Arc the gas token IS USDC, so label the balance honestly rather than saying ETH.
  const gasSymbol = network.name === 'arcTestnet' ? 'USDC (gas)' : 'ETH';
  console.log('network :', network.name, `(chainId ${chainId})`);
  console.log('deployer:', deployer.address, `| ${gasSymbol}:`, ethers.formatEther(bal));
  console.log('token   :', token);
  if (bal === 0n) {
    const faucet = network.name === 'arcTestnet' ? 'https://faucet.circle.com' : 'a Sepolia faucet';
    throw new Error(`deployer has no gas balance — fund ${deployer.address} from ${faucet}`);
  }

  const escrow = await (await ethers.getContractFactory('ConduitEscrow')).deploy(token);
  await escrow.waitForDeployment();
  const address = await escrow.getAddress();

  // sanity: the constructor stored the token → contract is live and correctly initialised
  const onchainToken = await escrow.token();
  const matches = onchainToken.toLowerCase() === token.toLowerCase();
  console.log('\n✓ ConduitEscrow deployed →', address);
  console.log('  token() reads back  →', onchainToken, matches ? '(matches ✓)' : '(MISMATCH ✗)');
  if (!matches) throw new Error('deployed token mismatch');

  const profile = PROFILE_NAME[network.name] ?? network.name;
  const out = {
    chainId,
    network: profile,
    escrow: address,
    token,
    deployedBy: deployer.address,
    deployedAt: new Date().toISOString(),
    deployTx: escrow.deploymentTransaction()?.hash ?? null,
  };
  // Per-network file: never clobber another network's record.
  const file = `deployed.${profile}.json`;
  writeFileSync(path.join(__dirname, '..', file), JSON.stringify(out, null, 2) + '\n');
  console.log(`  wrote contracts/${file}`);
  console.log(`\n  next: add "${profile}" to subgraph/networks.json with startBlock from the deploy tx`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
