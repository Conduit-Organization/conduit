/**
 * Single source of truth for canonical product facts, links, and download URLs.
 * Everything here is verified against the product — do not embellish.
 */

export const REPO = "https://github.com/Conduit-Organization/conduit";
export const RELEASES = `${REPO}/releases`;
export const RUN_FROM_SOURCE = `${REPO}#run-from-source`;

export const VERSION = "v0.1.0";

export const DOWNLOADS = {
  linuxAppImage: `${REPO}/releases/download/v0.1.0/Conduit-0.1.0.AppImage`,
  linuxDeb: `${REPO}/releases/download/v0.1.0/conduit_0.1.0_amd64.deb`,
  winExe: `${REPO}/releases/download/v0.1.0/Conduit-0.1.0-Setup.exe`,
  // macOS .dmg is built but not yet uploaded — flip MAC_AVAILABLE to true once the asset is on the release.
  macDmg: `${REPO}/releases/download/v0.1.0/Conduit-0.1.0-arm64.dmg`,
} as const;

export const MAC_AVAILABLE = false;

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
