// Read-only connectivity + settlement-token check for a configured network.
// Run: npx hardhat run scripts/check-network.ts --network arcTestnet
//
// Needs no key and sends no transaction. Confirms the RPC answers, the chain id matches
// what hardhat.config.ts declares, and the settlement token really is a 6-decimal ERC-20
// at the address we are about to point ConduitEscrow at.
import { ethers, network } from 'hardhat';

const TOKEN: Record<string, string> = {
  sepolia: '0xd077A400968890Eacc75cdc901F0356c943e4fDb',
  arcTestnet: '0x3600000000000000000000000000000000000000',
};

const ERC20 = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
];

async function main() {
  const net = await ethers.provider.getNetwork();
  const block = await ethers.provider.getBlockNumber();
  console.log(`network      : ${network.name}`);
  console.log(`chainId      : ${net.chainId}`);
  console.log(`head block   : ${block}`);

  const configured = (network.config as any).chainId;
  if (configured && Number(configured) !== Number(net.chainId)) {
    throw new Error(`chainId mismatch: config says ${configured}, RPC says ${net.chainId}`);
  }
  console.log(`chainId match: ok`);

  const addr = TOKEN[network.name];
  if (!addr) { console.log('no settlement token configured for this network'); return; }

  const code = await ethers.provider.getCode(addr);
  if (code === '0x') throw new Error(`no contract code at ${addr}`);

  const t: any = new ethers.Contract(addr, ERC20, ethers.provider);
  const [dec, sym, supply] = await Promise.all([t.decimals(), t.symbol(), t.totalSupply()]);
  console.log(`token        : ${addr}`);
  console.log(`  symbol     : ${sym}`);
  console.log(`  decimals   : ${dec}`);
  console.log(`  totalSupply: ${supply}`);
  if (Number(dec) !== 6) throw new Error(`expected 6 decimals, got ${dec} — Conduit prices assume 6`);
  console.log(`\n✓ ${network.name} is reachable and its settlement token is a 6-decimal ERC-20`);
}

main().catch((e) => { console.error('\n✗', e.message ?? e); process.exit(1); });
