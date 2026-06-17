# Conduit — hackathon submission copy

Ready-to-paste text for the submission form. Pick the variant that fits each field's limit.

---

## Vision / Problem

**Full (247 chars):**

> AI inference is gated by accounts, markups, and clouds that read your prompts, while capable GPUs sit idle. Conduit is a serverless P2P market where a USD₮ payment is the only handshake: buyers pay per answer, idle GPUs earn, data stays on-device.

**Lean (185 chars):**

> Using AI means accounts, markups, and clouds that read your prompts — while capable GPUs sit idle. Conduit is a serverless P2P market: pay a tiny USD₮ fee per answer, idle hardware earns.

---

## Description / What it does

**Detailed:**

> **Conduit is a serverless, peer-to-peer marketplace for AI inference.** A single desktop app is both buyer and seller: run an open-weight model on your own GPU and earn, or pay a fraction of a cent in USD₮ to get an answer from a peer who does. The core idea is that a *settled payment* — not an API key — is the access handshake. There's no account, no cloud, and no middleman; your keys and your prompts never leave your device.
>
> **The problem it solves.** Using AI today means going through a gatekeeper: you sign up, get an API key, pay metered and marked-up rates, wait on rate limits, and hand your prompts to someone else's cloud. Meanwhile, millions of capable GPUs sit idle in laptops and workstations with no simple way to earn — because there's no open market, and no open price, for inference. Conduit connects those two sides directly.
>
> **How it works.** Peers discover each other over a distributed hash table (Hyperswarm / Holepunch) with NAT hole-punching, so there is genuinely no server in the middle. An on-device confidence router answers easy prompts for free locally and escalates only the hard ones to a peer. Escalation opens an **escrow payment channel** once, then settles each answer off-chain with signed EIP-712 vouchers — answers come back in about two seconds instead of waiting on a chain confirmation every time. A non-custodial WDK wallet handles USD₮ settlement, and a first-party reputation system ranks sellers by reliability and speed.
>
> **Powered by QVAC.** Every model runs *fully on-device* through the QVAC runtime, using delegated, firewall-gated execution — the seller serves inference to the buyer without ever exposing keys, and no prompt is sent to a cloud. QVAC is what makes private, serverless inference possible: the buyer gets the answer, the seller gets paid, and neither side has to trust a third party with their data.
>
> **Stack & status.** QVAC SDK for on-device inference, WDK for the wallet, Hyperswarm/Holepunch for P2P discovery, a Solidity escrow contract (EIP-712 vouchers) for payments, packaged as a cross-platform Electron desktop app. Conduit is **live on a public testnet** (USD₮ on Sepolia) with a downloadable Linux build and instant escrow channels working end-to-end; macOS and Windows builds and mainnet settlement are next.

**Short (~250 chars):**

> Conduit is a serverless P2P market for AI inference. Pay a fraction of a cent in USD₮ for an answer from a peer, or run a model and earn. Models run on-device via QVAC; peers meet over a DHT; payments settle in ~2s through escrow channels. No cloud, no account.

---

## Reproducibility — hardware + steps (textbox answer)

> The demo uses **two physical machines** on separate networks (a third "freeloader" role is a separate
> process + keypair on the buyer machine, not a third device). Both run the same codebase; buyer/seller
> is a runtime flag.
>
> **Machine 1 — BUYER (router + agent + wallet)**
> - CPU: AMD Ryzen 7 7435HS (8 cores / 16 threads)
> - GPU: NVIDIA GeForce RTX 4050 Laptop — 6 GB VRAM (Vulkan, driver 580.82)
> - RAM: 24 GB DDR5
> - Storage: NVMe SSD (~10 GB free for the model cache)
> - OS: Pop!_OS 24.04 LTS (Linux kernel 6.16)
>
> **Machine 2 — SELLER (GPU provider)**
> - CPU: Apple M5 (Apple Silicon)
> - GPU: Apple integrated GPU (Metal)
> - RAM: 16 GB unified memory
> - Storage: SSD (~10 GB free)
> - OS: macOS 15+
>
> Software: Node.js ≥ 22. Models run fully on-device via @qvac/sdk (audit log records backend=gpu).
> Memory needed: ~0.5 GB for the 0.6B router model, ~3 GB for the Qwen3-4B seller tier.
>
> **Steps**
> 1. `git clone https://github.com/Conduit-Organization/conduit && cd conduit && npm install`
> 2. `cp .env.example .env`, then set: `CONDUIT_WALLET_MNEMONIC=<testnet seed>`,
>    `CONDUIT_RPC_URL=https://rpc.sepolia.org`, `CONDUIT_CHAIN_ID=11155111`,
>    `CONDUIT_USDT_ADDRESS=0xd077A400968890Eacc75cdc901F0356c943e4fDb`, `CONDUIT_ESCROW=1`,
>    `CONDUIT_ESCROW_ADDRESS=0x741BbE3B2d19E1aE965467280Cc2a442F3632Ee7`
> 3. Fund the buyer wallet (account 0): Sepolia ETH for gas + test USD₮.
> 4. `npm run bench` on each machine (benchmarks the GPU, writes bench-profile.json).
> 5. Seller machine: `npm run sell`. Buyer machine: `npm run buy` (or the desktop app / `npm run start`).
> 6. Easy question → answered free on-device; hard question → escrow channel opens, peer is paid,
>    Qwen3-4B answers over E2E in ~2s; a freeloader is refused at the handshake (0 bytes).
> 7. `npm run audit` reproduces the model load/unload + per-inference performance log (AUDIT_LOG.jsonl),
>    no testnet needed.
>
> Expected: 0.6B local ~8–25 ms TTFT, ~180–290 tok/s; Qwen3-4B ~50 ms TTFT, ~60–65 tok/s; on-chain
> settle ~7 s on Sepolia; cloud_bytes = 0 throughout. Single-machine option: run both roles on one box
> (harmless shared `~/.qvac/.worker.lock` warning). Prebuilt installers: GitHub Releases.

---

## Remote APIs (textbox answer)

> AI inference/embeddings: 100% via @qvac/sdk, on-device or on a paid peer over an E2E Holepunch link.
> No cloud AI. Remote AI calls: NONE. The only remote service is a single blockchain testnet RPC
> (Ethereum Sepolia, chainId 11155111), used solely to submit/confirm USD₮ settlement (per-inference
> payments + escrow channel open/top-up/claim/settle). No prompt, model, or token data is ever sent to
> it; RPC access is confined to src/core/wallet.ts and src/core/escrow.ts. Prompt bytes sent to any
> cloud: 0. Full disclosure: REMOTE_APIS.md.

---

## Audit log (textbox answer)

> Yes. Conduit writes a structured JSONL audit log (one event per line) capturing the model lifecycle and
> per-inference performance. `npm run audit` produces a self-contained, testnet-free run; the committed
> AUDIT_LOG.sample.jsonl is one such run. Events: model_load (model, load_ms), inference (prompt,
> prompt_tokens, completion_tokens, total_tokens, ttft_ms, tps, backend, cloud_bytes), model_unload
> (unload_ms). The on-chain settlement + handshake story is in AUDIT_LOG.settlement-sample.jsonl
> (`npm run demo`). Example: model_load QWEN3_4B_INST_Q4_K_M; inference ttft_ms 51.43, tps 63.74,
> prompt_tokens 33, completion_tokens 75, backend "gpu", cloud_bytes 0; model_unload.

---

## Links

- Live: https://www.conduitt.xyz
- Pitch deck: https://www.conduitt.xyz/pitch
- Code: https://github.com/Conduit-Organization/conduit
