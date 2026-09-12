<p align="center">
  <img src="./docs/assets/conduit-banner.svg" alt="Conduit — serverless P2P inference market" width="560">
</p>

<p align="center">
  <b>A serverless, peer-to-peer marketplace for AI inference — where a settled USD₮ payment is the access handshake.</b>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-2be3a8"></a>
  <img alt="Network" src="https://img.shields.io/badge/network-Sepolia%20testnet-ffc44d">
  <img alt="AI" src="https://img.shields.io/badge/AI-100%25%20on--device%20via%20QVAC-2be3a8">
  <img alt="Cloud bytes" src="https://img.shields.io/badge/prompt%20bytes%20to%20cloud-0-2be3a8">
  <a href="https://www.conduitt.xyz"><img alt="Site" src="https://img.shields.io/badge/site-conduitt.xyz-8a9aa6"></a>
</p>

---

A peer with a GPU sells LLM inference over an end-to-end-encrypted Holepunch link; a buyer's agent pays
per inference in USD₮, wallet-to-wallet, with **no platform in the middle**. No payment → no handshake →
the model is never reached. Model weights never move; only prompt-bytes-in / token-bytes-out cross the
wire; **the cloud sees nothing**. Every model runs fully on-device through the **QVAC runtime**.

> **Testnet only.** Payments use test USD₮ on Ethereum Sepolia — no real money moves. This is a
> demonstration of the access-control + settlement primitive, not a live financial service.

**Live:** [conduitt.xyz](https://www.conduitt.xyz) · **Pitch:** [conduitt.xyz/pitch](https://www.conduitt.xyz/pitch)

## Contents

- [ETHOnline 2026 — what is new](#ethonline-2026--what-is-new)
- [How it works](#how-it-works)
- [Demo hardware](#demo-hardware)
- [Prerequisites](#prerequisites)
- [Setup (clean checkout)](#setup-clean-checkout)
- [Environment variables](#environment-variables)
- [Contract addresses (Sepolia)](#contract-addresses-sepolia)
- [Getting testnet funds](#getting-testnet-funds)
- [Running it](#running-it)
- [All commands](#all-commands)
- [Models](#models)
- [Audit log](#audit-log)
- [Remote APIs — the no-cloud guarantee](#remote-apis--the-no-cloud-guarantee)
- [Reproducing the demo](#reproducing-the-demo)
- [Repository layout](#repository-layout)
- [License](#license)

---

## ETHOnline 2026 — what is new

> **Judging this project?** Everything below the next heading predates this event and is
> **not** submitted as hackathon work. The boundary is one command:
>
> ```bash
> git diff pre-ethonline..HEAD --stat
> ```
>
> Full disclosure in [`CONTINUITY.md`](./CONTINUITY.md).

Conduit already sold GPU inference between peers with no server in the middle. What it
could not do was tell you **who was on the other end** — of either side.

**A seller's admission test was six checks, and all six were about money.** Is there a
channel, is the deposit big enough, has it expired, does the epoch match
(`src/node/sell.ts:146-159`). Nothing asked who the buyer was. A buyer is an address, and
addresses are free — so one actor can be a thousand customers, and a seller cannot
rate-limit, price-discriminate or ban anyone, because the banned party returns as a fresh
address in one line of code.

**And a buyer could not see a seller at all.** Reputation was first-party only — a JSON
file on one laptop — so every seller you had not personally met scored a flat `0.5`
(`src/core/reputation.ts:6,54,60`, a TODO we wrote ourselves in June).

The new work closes both, in one mechanism:

> **A human-backed agent buys GPU capacity from another agent, and personhood is what
> makes the settlement record worth reading.**
>
> **World** makes identities scarce · **The Graph** makes the history readable ·
> **Arc** makes producing that history cheap enough to be worth doing.

### The vulnerability we found in our own design

The obvious way to score a seller is `settled / (settled + withdrawn)` — a buyer who had
to claw their deposit back is a seller who vanished. **That reading is wrong twice over,
and we can prove both.**

**1. `Withdrawn` is forgeable for gas.** `ConduitEscrow.open()` bounds only `amount > 0`
and `duration > 0`, so anyone can open a 1-second channel against **any address** for one
base unit and withdraw it in the next block, deposit returned in full. Measured at
**212,331 gas per forged identity, zero capital at risk**. Five throwaway wallets take an
honest seller from 100% to 16.7%. The victim never transacts and need not even be a
seller. Proof: [`contracts/test/sybil-grief.test.ts`](./contracts/test/sybil-grief.test.ts).

**2. Every real `Withdrawn` in our history is a renewal, not an abandonment.** Both events
`ConduitEscrow` has ever emitted on Sepolia are followed **24 seconds later** by the same
buyer reopening with the same seller at the next epoch — `src/buy/storefront.ts:244-253`
reclaiming an expired channel. A naive counter scores that seller **0.0**, the worst value
on the scale, for retaining a loyal customer. Check it yourself:
[block 11102985](https://sepolia.etherscan.io/block/11102985) → [11102987](https://sepolia.etherscan.io/block/11102987).

`ConduitEscrow` is **not** at fault — funds are never at risk, and `withdraw()` does
exactly what its docstring promises. The defect is in *deriving reputation from the
event*, which is the new work. So the naive counter is never shipped, not even briefly.

### The qualification rules — published so you can audit them

A `Withdrawn` counts against a seller only if **all five** hold
([`src/core/qualification.ts`](./src/core/qualification.ts)):

| Rule | Threshold | Why |
|---|---|---|
| Channel duration | ≥ **600s** | A 1-second channel cannot evidence a failure to deliver |
| Deposit | ≥ **20,000** base units (0.02 USD₮) | 10× the cheapest advertised tier — a session, not a probe |
| Buyer settlements | ≥ **1** with any seller | A wallet that never paid for anything is not a wronged customer |
| Not a renewal | reopen gap > **300s** | The buyer came straight back — that is satisfaction, not a complaint |
| Buyer is World-verified | AgentBook `lookupHuman ≠ 0` | The identity has to have cost something |

Failing any of these does **not** hide the event — it is still indexed and queryable as
`probeChannels` or `renewals`, with its `disqualificationReasons`. The filtering is
auditable, not implicit.

```
reliability = settled / (settled + qualifiedWithdrawn)       // 0.5 when n = 0
breadth     = min(1, uniqueVerifiedHumans / 5)               // humans, not addresses
volume      = min(1, totalClaimed / 1_000_000)               // 1.0 USD₮ (6 dec)
globalScore = 0.65*reliability + 0.20*breadth + 0.15*volume
```

Global history is **blended with**, never substituted for, your own experience:
`w_local = n / (n + 5)`. First-party evidence is strictly better when you have it; the
global signal only fills the cold-start hole.

### Why the human gate is load-bearing, not a login

`AgentBook.lookupHuman(address)` returns a **stable anonymous human identifier**, not a
boolean. So N wallets backed by the same person collapse to **one** — which is precisely
what makes `breadth` uncheatable and the sybil attack above unaffordable. It is a plain
`view` call, so the check sits *inside* the P2P session grant as a peer of the economic
checks rather than wrapping them.

Payment and personhood stay **independent**: a verified human with no funded channel is
still refused `no open channel`; a funded channel with no proof is refused
`unverified human`. And `requireHuman` is **seller policy** — some sellers sell to any
funded keypair, some only to humans. That is a market, not a rule.

### Cost to forge a seller's reputation

|  | Cost |
|---|---|
| Without the human gate | N × gas — **cents**, deposit refunded in full |
| With the human gate | N × World-verified humans — **not purchasable at any gas price** |

The first number is measured from real transactions we ran, not estimated. The second is a
property of World ID, not a claim of ours.

### New in this event

| Area | Files |
|---|---|
| Subgraph over `ConduitEscrow` | [`subgraph/`](./subgraph/) |
| Global seller reputation | `src/core/graph-reputation.ts` |
| Human gate + AgentBook | `src/core/humanity.ts`, `src/node/sell.ts`, `src/core/protocol.ts` |
| Qualification rules + sybil PoC | `src/core/qualification.ts`, `contracts/test/sybil-grief.test.ts` |
| Arc network profile | `src/core/networks.ts`, `contracts/hardhat.config.ts` |
| Boundary + feedback + verified constants | [`CONTINUITY.md`](./CONTINUITY.md), [`FEEDBACK.md`](./FEEDBACK.md), [`docs/ethonline/VERIFIED-CONSTANTS.md`](./docs/ethonline/VERIFIED-CONSTANTS.md) |

`contracts/contracts/ConduitEscrow.sol` is **deliberately unmodified**. Redeploying the
identical source to a second network is a stronger claim than editing it, and it keeps
every existing voucher, channel and indexed event valid.

```bash
npm test              # 52 engine tests
npm run test:contracts # 16 contract tests, incl. the sybil PoC
npm run humanity-check # live AgentBook reads on World Chain — no key needed
npm run check:arc      # live Arc testnet connectivity + settlement token
```

---

## How it works

One app is both **buyer** and **seller** — the role is a runtime choice, not a separate product. A node
learns what it can sell by benchmarking its own hardware (the **capability prober**, `npm run bench`).

The buyer→answer path has four hops:

1. **Discover** — peers meet on a Hyperswarm/Holepunch DHT (topic `conduit:market:v1`) with NAT
   hole-punching. There is no server in the middle. The seller advertises an offer (model + price + tps).
2. **Route** — an on-device **confidence router** samples a small local model *k* times and measures
   self-consistency (QVAC exposes no logprobs, so we use answer stability). Easy/consistent prompts are
   answered **free, locally**; only hard/ambiguous ones **escalate** to a paid peer.
3. **Pay** — escalation opens an **escrow payment channel** (one on-chain deposit), then settles each
   answer **off-chain** with a signed **EIP-712 voucher** — answers come back in ~2s with no on-chain
   wait. (A simpler per-inference on-chain payment path also exists.) A **SpendPolicy** (per-call cap +
   session budget) authorizes the spend; if it declines, the buyer keeps the free local draft.
4. **Run** — the payment releases the seller's **firewall-gated QVAC provider** pubkey; the buyer
   delegates inference to it over the E2E link. The model executes **on the seller's device** — the
   buyer never sees the weights, the seller never sees the buyer's keys, and no prompt touches a cloud.

A **freeloader** (no payment) is refused at the Noise handshake having transferred **0 bytes**. First-party
**reputation** (served/failed + EWMA tok/s) ranks sellers in the marketplace.

For deeper architecture notes see [`docs/CONDUIT-ARCHITECTURE.md`](./docs/CONDUIT-ARCHITECTURE.md) and the
diagrams in [`docs/diagrams/`](./docs/diagrams/).

---

## Demo hardware

The demo runs across **two physical machines** on independent networks (a third "freeloader" role is a
separate process + keypair on the buyer machine, not a third device). Both machines run the same `conduit`
codebase; buyer/seller is a runtime flag.

| Role | Machine | CPU | GPU | RAM | Storage | OS |
|------|---------|-----|-----|-----|---------|-----|
| **Buyer** (router + agent + wallet) | Linux laptop | AMD Ryzen 7 7435HS — 8 cores / 16 threads | NVIDIA GeForce RTX 4050 Laptop — 6 GB VRAM, Vulkan, driver 580.82 | 24 GB DDR5 | NVMe SSD (~10 GB free for the model cache) | Pop!_OS 24.04 LTS, kernel 6.16 |
| **Seller** (GPU provider) | MacBook Air (M5) | Apple M5 — Apple Silicon | Apple integrated GPU (Metal) | 16 GB unified memory | SSD (~10 GB free) | macOS 15+ |

> Either machine can fill either role; this table reflects the recorded demo. Models execute on the GPU
> (the audit log records `"backend":"gpu"`). VRAM/unified-memory needed: ~0.5 GB for the 0.6B router model,
> ~3 GB for the Qwen3-4B seller tier.

---

## Prerequisites

- **Node.js ≥ 22**
- A **GPU**: NVIDIA + Vulkan (Linux/Windows) or Apple Silicon + Metal (macOS) for the seller role
- **~10 GB free disk** for the on-device model cache (`~/.qvac`)
- A funded **testnet** wallet: a little **Sepolia ETH** (gas) + **test USD₮** (see [faucets](#getting-testnet-funds))
- `git`

---

## Setup (clean checkout)

```bash
# 1. Clone + install engine dependencies
git clone https://github.com/Conduit-Organization/conduit.git
cd conduit
npm install                     # also compiles native modules for your platform

# 2. Configure the environment
cp .env.example .env            # then edit .env — see the table below

# 3. Fund the wallet (account 0 = buyer): Sepolia ETH for gas + test USD₮ (faucets below)

# 4. Benchmark this machine → bench-profile.json (picks the best sellable model)
npm run bench

# 5. Run something — e.g. the headline demo, or the desktop app
npm run demo
```

The desktop app can also be **downloaded prebuilt** (no toolchain needed) from
[GitHub Releases](https://github.com/Conduit-Organization/conduit/releases) — see [Running it](#running-it).

---

## Environment variables

Copy `.env.example` → `.env` and fill in. Both roles read this file. **Testnet keys only — never commit a secret.**

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CONDUIT_WALLET_MNEMONIC` | ✅ | — | BIP-39 seed phrase (testnet). Account 0 = buyer, account 1 = seller earnings. |
| `CONDUIT_RPC_URL` | ✅ | `https://rpc.sepolia.org` | EVM **testnet RPC** — the only remote service, non-AI, settlement only. |
| `CONDUIT_CHAIN_ID` | ✅ | `11155111` | Sepolia chain id. |
| `CONDUIT_USDT_ADDRESS` | ✅ | — | Test USD₮ token contract (see below). |
| `CONDUIT_ESCROW` | — | `0` | `1` enables the instant escrow payment-channel path (recommended). |
| `CONDUIT_ESCROW_ADDRESS` | when escrow on | — | Deployed `ConduitEscrow` contract (see below). |
| `CONDUIT_SEED` | — | random | 64-hex seed for a deterministic Hyperswarm identity. |
| `CONDUIT_SELLER_MNEMONIC` | — | — | Run the seller from a different wallet than the buyer. |
| `CONDUIT_SELLER_MODEL` | — | prober's pick | Force the seller to serve a specific model. |
| `CONDUIT_VERIFY` | — | `0` | `1` adds a self-critique pass on confident local answers. |
| `PORT` | — | `8788` | Web/engine API port. |

> The packaged desktop app ships with escrow **on by default** and the contract address baked in — no
> `.env` needed for paid answers there.

---

## Contract addresses (Sepolia)

Network: **Ethereum Sepolia** · chain id **`11155111`**.

| Contract | Address | Explorer |
|----------|---------|----------|
| **ConduitEscrow** (payment channels) | `0x741BbE3B2d19E1aE965467280Cc2a442F3632Ee7` | [etherscan](https://sepolia.etherscan.io/address/0x741BbE3B2d19E1aE965467280Cc2a442F3632Ee7) |
| **Test USD₮** (ERC-20, 6 decimals) | `0xd077A400968890Eacc75cdc901F0356c943e4fDb` | [etherscan](https://sepolia.etherscan.io/address/0xd077A400968890Eacc75cdc901F0356c943e4fDb) |

The escrow contract source is in [`contracts/contracts/ConduitEscrow.sol`](./contracts/contracts/ConduitEscrow.sol)
(open / topUp / claim / settle / withdraw, EIP-712 vouchers, OpenZeppelin `SafeERC20` + `ReentrancyGuard` +
`EIP712` + `ECDSA`). Deployment record: [`contracts/deployed.sepolia.json`](./contracts/deployed.sepolia.json).

---

## Getting testnet funds

The buyer wallet needs **both**:

1. **Sepolia ETH** (gas to open/settle the channel) — e.g. [sepoliafaucet.com](https://sepoliafaucet.com),
   the [Alchemy](https://www.alchemy.com/faucets/ethereum-sepolia) or [Infura](https://www.infura.io/faucet/sepolia)
   faucets.
2. **Test USD₮** (the token above) — from the Pimlico / Candide faucet for the configured token.

> A fresh wallet with USD₮ but **no Sepolia ETH** cannot open a channel — escalation will fall back to a
> free local answer. Fund gas first.

---

## Running it

### Desktop app (easiest)
Download the installer for your OS from [Releases](https://github.com/Conduit-Organization/conduit/releases).
It bundles the engine, wallet, and UI; escrow is on by default. Or build from source:

```bash
npm run dist        # builds the Electron app → release/
```

The build is large (~1.6 GB) because the on-device AI runtime and its model backends are
bundled. On first launch the app downloads its models into `~/.qvac` (~3 GB).

macOS and Windows builds must be produced **on** those platforms — a DMG needs macOS's
`hdiutil`, so it cannot be cross-built from Linux.

#### Platform notes

**Install before running (macOS).** Drag `Conduit.app` to `/Applications` first. Launching
it directly from the mounted DMG fails:

```
Error: EROFS: read-only file system, chmod '.../bare-runtime-darwin-arm64/bin/bare'
```

The engine makes its runtime binary executable at startup, which a read-only DMG volume
cannot allow.

**macOS also needs OpenSSL 3.** The vendor's `darwin-arm64` prebuilds for the inference
engine (`@qvac/llm-llamacpp`, `@qvac/embed-llamacpp`) link against absolute Homebrew
paths:

```
/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib
/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib
```

Without them `dlopen` fails, the model worker never starts, and the UI shows a worker
timeout. Install them with:

```bash
brew install openssl@3
```

This is an upstream packaging issue in the prebuilt binary, not in Conduit — only 2 of
the 12 QVAC prebuilds are affected, and the `linux-x64` prebuilds link by normal soname,
which is why Linux is unaffected. Settlement, reputation and the World gate all work
regardless; it is local *inference* that needs the libraries.

**Unsigned builds.** Releases are not code-signed. macOS Gatekeeper reports "damaged and
can't be opened" — right-click the app and choose **Open** once. Windows SmartScreen
shows a similar warning.

### Headline demo (single machine)
```bash
npm run demo
```
One run: ① a cheap local 0.6B answers an easy prompt **free**; ② the agent detects low confidence,
**pays 0.01 USD₮**, and gets a SoTA answer from Qwen3-4B over E2E P2P; ③ a **freeloader is refused at
the handshake (0 bytes)** — with a live USD₮ ledger, a `cloud_bytes=0` counter, and a JSONL audit.

### Two machines (the real P2P demo)
```bash
# Machine A (seller):
npm run sell        # benchmarks, advertises an offer on the DHT, waits for paying buyers

# Machine B (buyer):
npm run buy         # discovers the seller, routes, pays, delegates
```
Both join the Hyperswarm topic `conduit:market:v1`; discovery and NAT hole-punching are automatic.

### Chat + wallet web app
```bash
npm run app:install         # web-app deps (once)
npm run start               # app:build + serve → http://localhost:8788
# dev with hot-reload UI:   npm run app:dev   (Vite :5173, proxies /api → :8788)
```

### Audit run (model lifecycle + inference performance)
```bash
npm run audit               # loads models, runs inference, unloads — writes AUDIT_LOG.jsonl
```

---

## All commands

| command | what it does |
|---|---|
| **`npm run start`** | build + serve the chat + wallet web app → http://localhost:8788 |
| `npm run web` | serve the app + engine API (after `app:build`) |
| `npm run app:dev` | UI with hot-reload (Vite :5173 → engine :8788) |
| `npm run dist` | build the Electron desktop app → `release/` |
| `npm run demo` | headline: local-free → pay-to-escalate (4B) → freeloader-refused, with ledger + audit |
| `npm run audit` | model load/unload + inference performance → `AUDIT_LOG.jsonl` (no testnet needed) |
| `npm run market` | serverless storefront — independent seller + buyer meet over Hyperswarm and negotiate |
| `npm run sell` / `npm run buy` | run a seller / buyer node on its own (two machines / two terminals) |
| `npm run agent` | autonomous buyer: confidence router + spend policy (free / pay / budget-decline) |
| `npm run route` | confidence router on easy vs. hard prompts (self-consistency, no logprobs) |
| `npm run bench` | capability prober — benchmarks the local GPU, writes `bench-profile.json` |
| `npm run escrow-demo` | open a channel, draw vouchers, settle — end to end on Sepolia |
| `npm run slice` | Phase-1 thin vertical slice (hand-scripted pay→gate→delegate→reject) |
| `npm run spike:firewall` / `spike:settle` / `spike:delegate` | the de-risking spikes |
| `npm run typecheck` | TypeScript check (engine) |

---

## Models

Open-weight models run fully on-device via QVAC; they download on demand into `~/.qvac` and are picked
per machine by the prober. Recorded tiers:

| Model | Role | Throughput (RTX 4050) |
|-------|------|-----------------------|
| Qwen3 **0.6B** (Q4) | local router / draft | ~180–290 tok/s |
| Llama 3.2 **1B** (tool-calling, Q4) | small seller tier | ~183 tok/s |
| Qwen3 **1.7B** (Q4) | seller tier | ~118 tok/s |
| Qwen3 **4B** (Q4_K_M) | **recommended seller tier** | ~60–65 tok/s |
| EmbeddingGemma **300M** (Q4) | router self-consistency embedding | — |

(Throughput from `npm run bench` / `npm run audit` on the demo hardware above.)

---

## Audit log

Every demo run can emit a structured JSONL audit log — one event object per line. `npm run audit`
produces a self-contained, **testnet-free** run capturing the full model lifecycle and per-inference
performance; the committed [`AUDIT_LOG.sample.jsonl`](./AUDIT_LOG.sample.jsonl) is one such run.

**Event types**

| event | fields |
|-------|--------|
| `model_load` | `model`, `model_type`, `role`, `load_ms` |
| `inference` | `model`, `role`, `prompt`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `ttft_ms`, `tps`, `backend`, `cloud_bytes` |
| `model_unload` | `model`, `unload_ms` |
| `p2p` | `sub` (`gate_opened` / `handshake_granted` / `handshake_rejected`), peer keys, `bytes_served` |
| `settlement` | `network`, `amount_usdt`, `to`, `tx`, `status` |

Example inference line (real, from `npm run audit`):

```json
{"event":"inference","model":"QWEN3_4B_INST_Q4_K_M","role":"seller-tier","prompt":"In two sentences, explain why a stablecoin can lose its 1:1 peg to the dollar.","prompt_tokens":33,"completion_tokens":75,"total_tokens":108,"ttft_ms":51.43,"tps":63.74,"backend":"gpu","cloud_bytes":0}
```

`"backend":"gpu"` proves on-device execution; `"cloud_bytes":0` proves nothing went to a cloud. The
on-chain settlement + handshake story (per-inference payment, freeloader rejection) is in
[`AUDIT_LOG.settlement-sample.jsonl`](./AUDIT_LOG.settlement-sample.jsonl), produced by `npm run demo`.

---

## Remote APIs — the no-cloud guarantee

- **AI inference / embeddings:** 100% via `@qvac/sdk`, on-device or on a paid peer over E2E Holepunch. **No cloud AI.**
- **Remote AI calls:** NONE.
- **Remote non-AI services:** a single blockchain **testnet RPC**, used only to submit/confirm USD₮
  settlement (per-inference payments + escrow channel open/top-up/claim/settle). No prompt, model, or
  token data is ever sent to it. RPC access is confined to `src/core/wallet.ts` and `src/core/escrow.ts`.
- **Prompt bytes sent to any cloud:** 0.

Full disclosure: [`REMOTE_APIS.md`](./REMOTE_APIS.md).

---

## Reproducing the demo

1. Provision two machines per [Demo hardware](#demo-hardware) (or run both roles on one box — note the
   shared `~/.qvac/.worker.lock` warning; harmless).
2. On each: `git clone` → `npm install` → `cp .env.example .env` and set `CONDUIT_RPC_URL`,
   `CONDUIT_CHAIN_ID=11155111`, `CONDUIT_USDT_ADDRESS=0xd077A400968890Eacc75cdc901F0356c943e4fDb`,
   `CONDUIT_WALLET_MNEMONIC=<testnet seed>`, and (for instant channels) `CONDUIT_ESCROW=1` +
   `CONDUIT_ESCROW_ADDRESS=0x741BbE3B2d19E1aE965467280Cc2a442F3632Ee7`.
3. Fund the buyer wallet: Sepolia ETH (gas) + test USD₮.
4. `npm run bench` on both → each writes its `bench-profile.json` (the Mac picks Qwen3-4B as its tier).
5. Seller machine: `npm run sell`. Buyer machine: `npm run buy` (or the desktop app / `npm run start`).
6. Ask an easy question → answered free on-device. Ask a hard one → channel opens, peer is paid, the
   4B answers over E2E in ~2s. A freeloader process is refused at the handshake.
7. Inspect `AUDIT_LOG.jsonl` for model loads/unloads + per-inference `ttft_ms` / `tps` / tokens, and
   `cloud_bytes:0` throughout. `npm run audit` reproduces the model-lifecycle log with no testnet.

**Expected numbers** (demo hardware): 0.6B local ~8–25 ms TTFT, ~180–290 tok/s · Qwen3-4B ~50 ms TTFT,
~60–65 tok/s · on-chain settle ~7 s on Sepolia · `cloud_bytes = 0` throughout.

---

## Repository layout

```
app/         React chat + wallet UI (Vite)
contracts/   Hardhat workspace — ConduitEscrow.sol, MockUSDT, tests, deploy script
electron/    desktop shell (spawns the engine as a child process)
landing/     marketing site + /pitch deck (Next.js) — conduitt.xyz
src/
  core/      identity · env · config · wallet · escrow · audit · ledger · prober · pricing · protocol · reputation · keystore
  sell/      provider              (payment-gated QVAC provider)
  buy/       router · agent · market-agent · policy · storefront · consumer
  node/      sell · buy            (independent storefront nodes)
  web/       server · seller       (engine API: /api/state + /api/ask — and serves the built app)
  scripts/   demo · audit-demo · market-demo · agent-demo · route-test · bench · slice · escrow-demo
  spikes/    01-firewall · 02-settlement · 03-prober-delegate
docs/        architecture, build phases, diagrams, submission copy
```

---

## License

[Apache-2.0](./LICENSE). Testnet demonstration only — not a live money-transmission service.
