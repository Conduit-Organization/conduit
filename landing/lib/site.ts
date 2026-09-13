/**
 * Single source of truth for canonical product facts, links, and download URLs.
 * Everything here is verified against the product — do not embellish.
 */

export const REPO = "https://github.com/Conduit-Organization/conduit";
export const RELEASES = `${REPO}/releases`;
export const RUN_FROM_SOURCE = `${REPO}#run-from-source`;

export const VERSION = "v0.2.0";

/**
 * Release assets. The tag and the file names are derived from one constant so they cannot
 * drift apart — the previous version of this file linked to an AppImage that had never been
 * uploaded, which read as a working download and was a 404.
 */
const TAG = "v0.2.0";
const V = TAG.slice(1);

export const DOWNLOADS = {
  linuxAppImage: `${REPO}/releases/download/${TAG}/Conduit-${V}.AppImage`,
  linuxDeb: `${REPO}/releases/download/${TAG}/conduit_${V}_amd64.deb`,
  winExe: `${REPO}/releases/download/${TAG}/Conduit-${V}-Setup.exe`,
  macDmg: `${REPO}/releases/download/${TAG}/Conduit-${V}-arm64.dmg`,
} as const;

/** Flip to false for a platform whose asset is not on the release yet. */
export const AVAILABLE = { linux: true, mac: true, win: true } as const;

/** @deprecated kept so nothing still importing it breaks; read AVAILABLE.mac instead. */
export const MAC_AVAILABLE = AVAILABLE.mac;

/**
 * The settlement network. Conduit moved from Sepolia to Arc: USDC is both the gas token and
 * the token answers are priced in, so a seller earns and spends one asset.
 */
export const NETWORK = {
  label: "Arc Testnet",
  chainId: 5042002,
  symbol: "USDC",
  explorer: "https://testnet.arcscan.app",
  faucet: "https://faucet.circle.com",
  escrow: "0xdC48E5e5c3Cf91b6db9ec0f329a14188174632C2",
  token: "0x3600000000000000000000000000000000000000",
  gasIsSettlementToken: true,
} as const;

/** What each integration does, in the product's own terms. Every address here is deployed. */
export const INTEGRATIONS = [
  {
    name: "Arc",
    role: "settlement",
    what:
      "Answers are paid for in USDC through a payment channel: one deposit on-chain, then every " +
      "answer is an off-chain signed voucher, redeemed together. Gas is USDC too, so a seller " +
      "earns and spends one asset.",
    facts: [
      ["network", "Arc Testnet · chain 5042002"],
      ["escrow", "0xdC48E5e5…632C2"],
      ["token", "USDC · 0x3600…0000"],
    ],
    href: `https://testnet.arcscan.app/address/0xdC48E5e5c3Cf91b6db9ec0f329a14188174632C2`,
  },
  {
    name: "The Graph",
    role: "reputation",
    what:
      "Every channel the escrow has ever opened is indexed from on-chain events, so a first-time " +
      "buyer can see how a seller treated everyone — not just themselves. Forged signals are " +
      "classified and excluded from scoring rather than hidden.",
    facts: [
      ["subgraph", "conduit-arc"],
      ["indexed", "channels, settlements, withdrawals"],
      ["counts", "unique humans, not addresses"],
    ],
    href: "https://thegraph.com/studio/",
  },
  {
    name: "World",
    role: "personhood",
    what:
      "A seller can require that a buyer is a verified unique human. The wallet resolves to an " +
      "anonymous human id — never an identity — so one actor cannot be a thousand customers, and " +
      "a funded channel alone is not enough to be served.",
    facts: [
      ["registry", "AgentBook · World Chain"],
      ["address", "0xA23aB271…944dA"],
      ["proof", "anonymous human id"],
    ],
    href: "https://worldscan.org/address/0xA23aB2712eA7BBa896930544C7d6636a96b944dA",
  },
] as const;

export type ModelInfo = {
  family: string;
  size: string;
  note?: string;
};

export const MODELS: ModelInfo[] = [
  { family: "Qwen3", size: "0.6B" },
  { family: "Llama 3.2", size: "1B", note: "tool-calling" },
  { family: "Qwen3", size: "1.7B" },
  { family: "Qwen3", size: "4B" },
];

/** Honest architecture primitives — used for the trust marquee (no fake logos). */
export const PRIMITIVES = [
  "Serverless",
  "DHT — Hyperswarm / Holepunch",
  "NAT hole-punching",
  "On-device QVAC runtime",
  "Non-custodial WDK wallet",
  "EIP-712 vouchers",
  "Escrow payment channels",
  "Open source",
] as const;
