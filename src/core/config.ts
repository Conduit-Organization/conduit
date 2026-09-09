// Loads the settlement config (testnet only). The mnemonic is OPTIONAL — the real wallet now comes
// from the encrypted keystore (src/core/keystore.ts); a `.env` mnemonic is only a dev/demo fallback.
// Network params default to Sepolia + the Pimlico test-USD₮ so the app boots with no .env at all.
//
// ETHOnline 2026: `CONDUIT_NETWORK` selects a named profile from src/core/networks.ts
// (`sepolia` | `arc-testnet`). Individual env vars still override whatever the profile
// says, so every existing .env keeps working exactly as before — the profile only
// supplies the defaults that used to be hardcoded here.
import { loadEnv } from './env';
import { resolveNetwork, DEFAULT_NETWORK, type NetworkProfile } from './networks';

export interface ConduitConfig {
  mnemonic: string; // optional dev fallback ('' if unset); real wallet = keystore
  rpcUrl: string;
  usdtAddress: string;
  chainId: number;
  /** The resolved network profile — label, explorer, faucet, gas-token semantics. */
  network: NetworkProfile;
}

export function loadConfig(): ConduitConfig {
  const e = loadEnv();
  const network = resolveNetwork(e.CONDUIT_NETWORK || process.env.CONDUIT_NETWORK || DEFAULT_NETWORK);
  return {
    mnemonic: e.mnemonic || e.CONDUIT_WALLET_MNEMONIC || '',
    // Explicit env still wins over the profile — no existing configuration changes meaning.
    rpcUrl: e.CONDUIT_RPC_URL || network.rpcUrl,
    usdtAddress: e.CONDUIT_USDT_ADDRESS || network.settlementToken,
    chainId: Number(e.CONDUIT_CHAIN_ID || String(network.chainId)),
    network,
  };
}
