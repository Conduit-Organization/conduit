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

  // ── ETHOnline 2026 ─────────────────────────────────────────────────────────
  /** Escrow payment channels. ON by default — the packaged app has always shipped this way. */
  escrow: boolean;
  /** Subgraph query endpoint for the SELECTED network. null disables global reputation. */
  subgraphUrl: string | null;
  /** Buyer side: attach a World human proof to sessionOpen. Harmless if the seller ignores it. */
  humanProof: boolean;
  /** Seller side: refuse buyers who are not human-backed. Seller policy — OFF by default. */
  requireHuman: boolean;
  /** Optional World Chain RPC for AgentBook lookups. */
  worldChainRpcUrl: string | undefined;
  /** Seller side: refuse a buyer whose qualified abandonment rate exceeds this. */
  maxBuyerAbandonment: number;
}

export function loadConfig(): ConduitConfig {
  const e = loadEnv();

  // Real process env wins over the .env file, because the engine passes settings to the
  // spawned seller child that way. Then .env, then the built-in default — so the app runs
  // correctly with no configuration at all, and a judge can still override any of it.
  const pick = (k: string): string | undefined => process.env[k] ?? e[k];
  const flag = (k: string, dflt: boolean): boolean => {
    const v = pick(k);
    return v === undefined || v === '' ? dflt : v === '1' || v.toLowerCase() === 'true';
  };

  const network = resolveNetwork(pick('CONDUIT_NETWORK') || DEFAULT_NETWORK);
  return {
    mnemonic: e.mnemonic || e.CONDUIT_WALLET_MNEMONIC || '',
    // Explicit env still wins over the profile — no existing configuration changes meaning.
    rpcUrl: e.CONDUIT_RPC_URL || network.rpcUrl,
    usdtAddress: e.CONDUIT_USDT_ADDRESS || network.settlementToken,
    chainId: Number(e.CONDUIT_CHAIN_ID || String(network.chainId)),
    network,

    escrow: flag('CONDUIT_ESCROW', true),
    // Falls back to the selected network's own deployment, so switching network switches
    // the reputation source with it.
    subgraphUrl: pick('CONDUIT_SUBGRAPH_URL') || network.subgraphUrl || null,
    humanProof: flag('CONDUIT_HUMAN_PROOF', true),
    requireHuman: flag('CONDUIT_REQUIRE_HUMAN', false),
    worldChainRpcUrl: pick('CONDUIT_WORLDCHAIN_RPC'),
    maxBuyerAbandonment: Number(pick('CONDUIT_MAX_BUYER_ABANDONMENT') || '0.5'),
  };
}
