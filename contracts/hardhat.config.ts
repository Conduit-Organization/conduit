import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';

// Tests run on the in-process `hardhat` network (no testnet needed). `sepolia` is for M4e-2 deploy:
// set CONDUIT_RPC_URL + CONDUIT_DEPLOYER_KEY (a funded Sepolia key) in the environment.
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28', // ≥0.8.25 for OpenZeppelin v5.1's mcopy (Cancun); Sepolia is post-Dencun
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  networks: {
    sepolia: {
      url: process.env.CONDUIT_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: process.env.CONDUIT_DEPLOYER_KEY ? [process.env.CONDUIT_DEPLOYER_KEY] : [],
    },
  },
};

export default config;
