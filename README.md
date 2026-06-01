# Conduit

**A serverless P2P inference market where a settled USD₮ payment is the access handshake.**

A peer with a GPU sells LLM inference over an end-to-end-encrypted Holepunch link; a buyer's
agent pays per inference in USD₮, wallet-to-wallet, with no platform in the middle. No payment →
no handshake → the model is never reached. Weights never move; only prompt-bytes-in /
token-bytes-out cross the wire; the cloud sees nothing.

- **License:** Apache-2.0
- **AI:** 100% via `@qvac/sdk` (on-device or on a paid peer). No cloud AI. See [`REMOTE_APIS.md`](./REMOTE_APIS.md).
- **Settlement:** USD₮ on an EVM **testnet** via WDK (the only remote service; non-AI).
- **Docs:** [`docs/`](./docs/) — start with the build runbook [`docs/BUILD-PHASES.md`](./docs/BUILD-PHASES.md); also [`docs/CONDUIT-PLAN.md`](./docs/CONDUIT-PLAN.md), [`docs/CONDUIT-ARCHITECTURE.md`](./docs/CONDUIT-ARCHITECTURE.md), [`docs/spikes-FINDINGS.md`](./docs/spikes-FINDINGS.md)

> ⚠️ Status: **Phase 0 (foundation + de-risking spikes).** Not yet a runnable end-to-end demo.

## Requirements
- Node.js ≥ 22
- A GPU for the seller role: NVIDIA + Vulkan (Linux/Windows) or Apple Silicon + Metal (macOS)
- A funded **testnet** wallet for settlement spikes

## Layout
```
src/
  core/      identity · config · audit · protocol (shared, role-agnostic)
  sell/      storefront · provider-gate · settlement        (Phase 1+)
  buy/       agent · router · tools · delegate              (Phase 1+)
  spikes/    01-firewall · 02-settlement · 03-prober-delegate (Phase 0)
  scripts/   bench · fund_testnet · prewarm_dht             (Phase 0+)
```

## Phase 0 — de-risking spikes
```bash
npm install
npm run spike:firewall    # #1  payment-gated firewall: granted vs. refused-at-handshake
npm run spike:settle      # #1.5 WDK testnet USD₮ settlement + chain selection
npm run spike:delegate    # #2  capability prober + delegated inference (+ fallbackToLocal)
```

Each spike has a written hypothesis + kill-criterion in [`docs/CONDUIT-PLAN.md`](./docs/CONDUIT-PLAN.md) §7; the full build runbook is [`docs/BUILD-PHASES.md`](./docs/BUILD-PHASES.md).
