import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';

// Tests run on the in-process `hardhat` network (no testnet needed). `sepolia` is for M4e-2 deploy:
// set CONDUIT_RPC_URL + CONDUIT_DEPLOYER_KEY (a funded Sepolia key) in the environment.
//
// ETHOnline 2026: `arcTestnet` deploys the SAME, UNMODIFIED ConduitEscrow to Circle's Arc
// testnet. Params verified 2026-09-09 against docs.arc.io, circlefin/skills and viem, then
// confirmed by direct chain reads (eth_chainId -> 0x4cef52). On Arc, USDC is the gas token,
// so the deployer needs testnet USDC from https://faucet.circle.com and nothing else.
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28', // ≥0.8.25 for OpenZeppelin v5.1's mcopy (Cancun); Sepolia is post-Dencun
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  networks: {
    sepolia: {
      url: process.env.CONDUIT_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      chainId: 11155111,
      accounts: process.env.CONDUIT_DEPLOYER_KEY ? [process.env.CONDUIT_DEPLOYER_KEY] : [],
    },
    arcTestnet: {
      url: process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network',
      chainId: 5042002,
      accounts: process.env.CONDUIT_DEPLOYER_KEY ? [process.env.CONDUIT_DEPLOYER_KEY] : [],
    },
  },
};

export default config;
