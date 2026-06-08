// Deploy ConduitEscrow to the configured network, pointing at the real settlement token.
// Run: CONDUIT_DEPLOYER_KEY=<funded key> CONDUIT_USDT_ADDRESS=<token> npx hardhat run scripts/deploy.ts --network sepolia
import { ethers, network } from 'hardhat';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const token = process.env.CONDUIT_USDT_ADDRESS;
  if (!token) throw new Error('set CONDUIT_USDT_ADDRESS (the test-USD₮ contract address)');

  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log('network :', network.name);
  console.log('deployer:', deployer.address, '| ETH:', ethers.formatEther(bal));
  console.log('token   :', token);

  const escrow = await (await ethers.getContractFactory('ConduitEscrow')).deploy(token);
  await escrow.waitForDeployment();
  const address = await escrow.getAddress();

  // sanity: the constructor stored the token → contract is live and correctly initialised
  const onchainToken = await escrow.token();
  const matches = onchainToken.toLowerCase() === token.toLowerCase();
  console.log('\n✓ ConduitEscrow deployed →', address);
  console.log('  token() reads back  →', onchainToken, matches ? '(matches ✓)' : '(MISMATCH ✗)');
  if (!matches) throw new Error('deployed token mismatch');

  const out = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    network: network.name,
    escrow: address,
    token,
    deployedBy: deployer.address,
  };
  writeFileSync(path.join(__dirname, '..', 'deployed.sepolia.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('  wrote contracts/deployed.sepolia.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
