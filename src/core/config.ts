// Loads + validates the settlement config from .env (testnet only).
import { loadEnv } from './env';

export interface ConduitConfig {
  mnemonic: string;
  rpcUrl: string;
  usdtAddress: string;
  chainId: number;
}

export function loadConfig(): ConduitConfig {
  const e = loadEnv();
  const mnemonic = e.mnemonic || e.CONDUIT_WALLET_MNEMONIC || '';
  const rpcUrl = e.CONDUIT_RPC_URL || '';
  const usdtAddress = e.CONDUIT_USDT_ADDRESS || '';
  const chainId = Number(e.CONDUIT_CHAIN_ID || '11155111');
  const missing = Object.entries({ mnemonic, rpcUrl, usdtAddress })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error('missing in .env: ' + missing.join(', '));
  return { mnemonic, rpcUrl, usdtAddress, chainId };
}
