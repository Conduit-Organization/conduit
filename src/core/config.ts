// Loads the settlement config (testnet only). The mnemonic is OPTIONAL — the real wallet now comes
// from the encrypted keystore (src/core/keystore.ts); a `.env` mnemonic is only a dev/demo fallback.
// Network params default to Sepolia + the Pimlico test-USD₮ so the app boots with no .env at all.
import { loadEnv } from './env';

export interface ConduitConfig {
  mnemonic: string; // optional dev fallback ('' if unset); real wallet = keystore
  rpcUrl: string;
  usdtAddress: string;
  chainId: number;
}

const DEFAULT_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const DEFAULT_USDT = '0xd077A400968890Eacc75cdc901F0356c943e4fDb'; // Pimlico test-USD₮ on Sepolia (6 dec)
const DEFAULT_CHAIN = 11155111; // Sepolia

export function loadConfig(): ConduitConfig {
  const e = loadEnv();
  return {
    mnemonic: e.mnemonic || e.CONDUIT_WALLET_MNEMONIC || '',
    rpcUrl: e.CONDUIT_RPC_URL || DEFAULT_RPC,
    usdtAddress: e.CONDUIT_USDT_ADDRESS || DEFAULT_USDT,
    chainId: Number(e.CONDUIT_CHAIN_ID || String(DEFAULT_CHAIN)),
  };
}
