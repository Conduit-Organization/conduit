// Settlement network profiles — ETHOnline 2026 (new work).
//
// Conduit's config was already env-driven (rpcUrl / usdtAddress / chainId), with Sepolia
// as a DEFAULT rather than an assumption. So supporting a second settlement network is a
// named profile plus a deploy, not a refactor. This file is that registry.
//
// WHY ARC IS NOT JUST "A CHEAPER CHAIN"
//
// The narrow argument — gas is cheaper — is answerable with "so use any L2". The real one
// is denominational: on Arc, USDC IS the gas token. A Conduit seller earns USDC and pays
// its costs in USDC, so revenue and costs are in the same unit. On a general-purpose L2 a
// seller earns USDC and pays gas in ETH, which makes every seller involuntarily long ETH
// on top of running a GPU. That is a product problem, not a marketing line.
//
// And it is what makes the reputation ledger writable at all: the settlement record the
// subgraph indexes only exists because someone paid gas to emit it. On a chain where
// opening a channel costs more than the inference it funds, sellers stop opening channels
// and the ledger stops being written.
//
// ⚠️ EVERY CONSTANT HERE IS VERIFIED AGAINST A PRIMARY SOURCE, NOT RECALLED.
// See docs/ethonline/VERIFIED-CONSTANTS.md for how each was checked and when.

export interface NetworkProfile {
  /** Stable key used by CONDUIT_NETWORK and by the subgraph's network slug. */
  name: string;
  label: string;
  chainId: number;
  rpcUrl: string;
  /** ERC-20 settlement token. Conduit prices, vouchers and deposits are all in this. */
  settlementToken: string;
  settlementSymbol: string;
  /** Decimals of the ERC-20 view of the settlement token. */
  decimals: number;
  explorer: string;
  /** Deployed ConduitEscrow, or null until it is deployed on this network. */
  escrow: string | null;
  faucet?: string;
  /** True when the gas token and the settlement token are the same asset. */
  gasIsSettlementToken: boolean;
  testnet: boolean;
  /** The Graph network slug, when the network is supported by Subgraph Studio. */
  graphNetwork?: string;
  /**
   * Deployed subgraph query endpoint for THIS network's escrow. Each network has its own
   * settlement history, so switching networks must switch the reputation source too —
   * scoring an Arc seller against Sepolia's ledger would be quietly wrong.
   */
  subgraphUrl?: string;
}

/**
 * Ethereum Sepolia — the original deployment, and the canonical reputation source.
 * Its settlement history is what `subgraph/` indexes, and it predates this event.
 */
export const SEPOLIA: NetworkProfile = {
  name: 'sepolia',
  label: 'Ethereum Sepolia',
  chainId: 11155111,
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  settlementToken: '0xd077A400968890Eacc75cdc901F0356c943e4fDb', // test USD₮, 6 dec
  settlementSymbol: 'USD₮',
  decimals: 6,
  explorer: 'https://sepolia.etherscan.io',
  escrow: '0x741BbE3B2d19E1aE965467280Cc2a442F3632Ee7',
  gasIsSettlementToken: false, // seller earns USD₮, pays gas in ETH
  testnet: true,
  graphNetwork: 'sepolia',
  subgraphUrl: 'https://api.studio.thegraph.com/query/1759016/conduit/v0.0.1',
};

/**
 * Arc Testnet (Circle). Verified 2026-09-09 against docs.arc.io, circlefin/skills,
 * viem's chain definition, AND direct chain reads:
 *   eth_chainId              → 0x4cef52 (5042002)
 *   USDC.decimals()          → 6
 *   USDC.symbol()            → "USDC"
 *
 * The ERC-20 view of Arc's USDC is 6 decimals — identical to the Sepolia test USD₮ this
 * app already uses — so ConduitEscrow, the voucher rail and the UI's `DEC = 6` all carry
 * over unchanged. (The NATIVE gas view is 18 decimals; escrow deposits, vouchers, claims
 * and prices all go through the ERC-20 path, so they are 6-decimal throughout.)
 */
export const ARC_TESTNET: NetworkProfile = {
  name: 'arc-testnet',
  label: 'Arc Testnet',
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.network',
  settlementToken: '0x3600000000000000000000000000000000000000', // native USDC, 6 dec ERC-20 view
  settlementSymbol: 'USDC',
  decimals: 6,
  explorer: 'https://testnet.arcscan.app',
  escrow: '0xdC48E5e5c3Cf91b6db9ec0f329a14188174632C2', // deployed 2026-09-09, block 61217992
  faucet: 'https://faucet.circle.com',
  gasIsSettlementToken: true, // USDC is the gas token — revenue and costs in one unit
  testnet: true,
  graphNetwork: 'arc-testnet',
  subgraphUrl: 'https://api.studio.thegraph.com/query/1759016/conduit-arc/v0.0.1',
};

export const NETWORKS: Record<string, NetworkProfile> = {
  [SEPOLIA.name]: SEPOLIA,
  [ARC_TESTNET.name]: ARC_TESTNET,
};

/**
 * Arc is the default settlement network.
 *
 * USDC is both the gas token and the settlement token there, so a seller's revenue and
 * its costs are denominated in the same unit and a buyer needs exactly one asset to
 * participate. Sepolia remains fully supported (CONDUIT_NETWORK=sepolia) and still holds
 * the project's original settlement history.
 */
export const DEFAULT_NETWORK = ARC_TESTNET.name;

/**
 * Resolve a profile by name. Unknown names fall back to the default rather than throwing:
 * a typo in an env var must not stop the app booting into a working local router.
 */
export function resolveNetwork(name?: string | null): NetworkProfile {
  if (!name) return NETWORKS[DEFAULT_NETWORK]!;
  return NETWORKS[name.toLowerCase()] ?? NETWORKS[DEFAULT_NETWORK]!;
}

export function networkByChainId(chainId: number): NetworkProfile | null {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId) ?? null;
}

/** A seller's offer already carries `chainId` and `token`, so cross-network offers are
 *  distinguishable on the wire with no protocol change. This is how the UI labels them. */
export function labelForChainId(chainId: number): string {
  return networkByChainId(chainId)?.label ?? `chain ${chainId}`;
}

export function listNetworks(): NetworkProfile[] {
  return Object.values(NETWORKS);
}

/**
 * Can a buyer on `buyerChain` actually transact with a seller on `sellerChain`?
 *
 * Each network has its own ConduitEscrow deployment, so a channel opened on one chain is
 * invisible on the other: the seller would read an empty channel and refuse. That has to
 * be decided in ONE place, because two consumers ask the question — the marketplace card
 * (which greys the seller out) and the "Auto" router (which must never pick them). When
 * those two disagreed, a card looked clickable and every purchase through it failed with
 * an opaque decode error.
 *
 * A seller that announces no chain is treated as ours: every build sends `chainId` in its
 * offer, so this only covers a peer too old to say, and matching the card's tolerance
 * keeps the two answers identical.
 */
export function sameSettlementNetwork(sellerChain: number | undefined, buyerChain: number | undefined): boolean {
  if (buyerChain == null) return true; // we have no escrow of our own — nothing to mismatch
  return (sellerChain ?? buyerChain) === buyerChain;
}
