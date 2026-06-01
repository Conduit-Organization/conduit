# Conduit — Build Playbook (phase by phase, in detail)

This is the **execution runbook**: every phase broken into concrete tasks, the exact files to
create, the commands to run, the order/dependencies, and the acceptance ("done") criteria.
It is more granular than [`CONDUIT-PLAN.md`](./CONDUIT-PLAN.md) (which is the architecture/why);
this doc is the *how* and the *checklist*.

**Status legend:** ✅ done · 🔨 in progress · ◑ partially done · ⬜ not started

**Current overall status:** Phase 0 — `0.1 ✅`, `0.2 ✅`, `0.3 ✅ (Spike #1 PASS)`, `0.4 ⬜`, `0.5 ⬜`.

---

## 0. Ground rules & conventions (read once)

- **Runtime:** Node ≥ 22, TypeScript run directly with **`tsx`** (no build step in dev). ESM (`"type":"module"`). Strict TS.
- **One binary, role-agnostic:** the same code runs as buyer or seller; role is a runtime flag/env. (Spikes are standalone scripts under `src/spikes/`.)
- **SDK reality:** `@qvac/sdk@0.12.0` (newer than the cached v0.11 docs — always verify against the installed types, not the docs). Key drift already handled: `getConsumerPublicKey` does **not** exist → derive pubkeys via `hyperdht` in `src/core/identity.ts`.
- **Identity:** a node's P2P identity = `HyperDHT.keyPair(seed).publicKey`; set `QVAC_HYPERSWARM_SEED` (hex) **before** the SDK touches the swarm. Helper: `useQvacSeed(seedHex)`.
- **Secrets:** testnet only. Everything sensitive lives in `.env` (git-ignored). Never commit a key.
- **The one remote:** a testnet RPC for settlement only, isolated in `src/core/settlement.ts`, disclosed in `REMOTE_APIS.md`. No prompt/model bytes ever leave to it.
- **Definition of Done (per task):** code written + runs + a one-line proof captured (log/printout) + (where relevant) a note in [`spikes-FINDINGS.md`](./spikes-FINDINGS.md).
- **Known wart:** the QVAC Bare worker prints `free(): double free detected` on teardown (after results). Benign. Mitigation pattern: capture results, then `process.exit(0)` before deep native teardown so exit codes stay clean.

### Repo layout (target)
```
conduit/
  package.json  tsconfig.json  .gitignore  .env.example  qvac.config.js
  README.md  LICENSE  REMOTE_APIS.md  AUDIT_LOG.sample.jsonl
  docs/            ← this folder (plan, architecture, diagrams, findings, this playbook)
  src/
    core/          identity ✅ · config · audit · protocol · prober · pricing · wallet · settlement
    sell/          storefront · provider-gate · seller
    buy/           agent · router · tools · delegate · buyer
    spikes/        01-firewall ✅ · 02-settlement · 03-prober-delegate
    scripts/       bench · fund_testnet · prewarm_dht · run_demo
    types/         shims.d.ts ✅
```

---

## PHASE 0 — Foundation + de-risking spikes

**Goal:** retire the three biggest risks before building product code: (1) can a payment gate the
firewall? (2) can WDK settle USD₮ on testnet? (3) does delegated inference + self-benchmark work on
our hardware? **Exit gate:** pay→grant→answer and no-pay→reject proven; chain + settlement variant chosen.

### 0.1 Scaffold ✅ DONE
- **Files:** `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `qvac.config.js`, `README.md`, `LICENSE` (Apache-2.0), `REMOTE_APIS.md`.
- **Deps:** `@qvac/sdk`, `@tetherto/wdk-wallet-evm`, `zod`, `hyperdht`, `b4a`; dev `tsx`, `typescript`, `@types/node`.
- **Done:** `npm install` resolves; `git init` done.

### 0.2 Core identity ✅ DONE
- **File:** `src/core/identity.ts` + `src/types/shims.d.ts`.
- **API:** `randomSeedHex()`, `seedBuf(hex)`, `publicKeyHexFromSeed(hex)`, `useQvacSeed(hex)`.
- **Proof captured:** provider's QVAC-reported `publicKey` === our `publicKeyHexFromSeed(seed)` → IDENTITY MATCH ✅.

### 0.3 Spike #1 — firewall as payment gate ✅ DONE — **PASS**
- **Files:** `src/spikes/01-firewall/{provider,consumer,run}.ts`.
- **Run:** `npm run spike:firewall`.
- **Result:** allow-listed buyer `GRANTED_SERVED` (delegated completion, tps≈290); non-listed freeloader `REJECTED` (`PEER_CONNECTION_FAILED`, 0 tokens). Controlled (only var = allow-list). See [`spikes-FINDINGS.md`](./spikes-FINDINGS.md).
- **Follow-ups (small, do during Phase 1 hardening):**
  - [ ] add `process.exit(0)` after capturing results to suppress the teardown double-free.
  - [ ] tighten the freeloader connect timeout (it currently retries ~11s) so rejection reads instantly.
  - [ ] capture the provider-side rejection via `loggingStream()` (Spike #3 idea) for the audit log.

### 0.4 Spike #2 — capability prober + delegated inference ⬜ TODO
> Delegated-inference half is already proven by Spike #1. This task is the **prober**.
- **Files to create:**
  - `src/core/prober.ts` — exports `probe(opts?) : Promise<CapabilityProfile>`.
  - `src/scripts/bench.ts` — CLI wrapper: `npm run bench` → prints + writes a profile JSON.
- **Model ladder (verified 0.12 constants):** `QWEN3_1_7B_INST_Q4` → `QWEN3_4B_INST_Q4_K_M` → `QWEN3_8B_INST_Q4_K_M`. Buyer-local tier: `QWEN3_600M_INST_Q4` / `LLAMA_3_2_1B_INST_Q4_0` / `LLAMA_TOOL_CALLING_1B_INST_Q4_K`.
- **Algorithm:**
  1. For each model in the ladder: `loadModel({modelSrc, modelType:'llm', onProgress})`, then a short `completion` (e.g. "Reply with: ok"), read `final.stats.{timeToFirstToken, tokensPerSecond, backendDevice}`, then `unloadModel`.
  2. Stop at the largest model that loads AND clears a min-tps bar (config: `MIN_SELL_TPS`, default e.g. 15).
  3. Emit `CapabilityProfile = { backend, ram?, models: [{ id, fits:boolean, ttftMs, tps }], topSellable: modelId | null }`.
- **Acceptance:** on the RTX 4050, prints a profile where 1.7B and 4B load with real tps; `topSellable` chosen; profile written to `bench-profile.json`. (4B is a ~2.5 GB one-time download.)
- **Note:** keep pricing OUT of the prober; pricing policy is `src/core/pricing.ts` (Phase 3). Prober only measures capability.

### 0.5 Spike #1.5 — WDK testnet settlement + chain choice ⬜ TODO  *(needs a funded testnet wallet)*
- **Files to create:**
  - `src/core/wallet.ts` — thin wrapper around `@tetherto/wdk-wallet-evm`: `makeWallet(mnemonic, rpcUrl)`, `getAddress()`, `getBalance()`, `getTokenBalance(token)`, `transferUsdt({to, amount})`, `sign(msg)`/`verify`, `signTypedData`/`verifyTypedData`.
  - `src/spikes/02-settlement/run.ts` — the spike.
  - `src/scripts/fund_testnet.ts` — prints the wallet address + faucet instructions.
- **Prereq (human):** a funded Sepolia testnet wallet — fund with test-USD₮ via Pimlico/Candide faucet and a little test-ETH for gas (or rely on the ERC-4337 paymaster path). Put the mnemonic in `.env` as `CONDUIT_WALLET_MNEMONIC`.
- **Two settlement variants to test (pick the default that works):**
  - **Variant 1 (preferred): EIP-3009 signed authorization.** Buyer `signTypedData` a `transferWithAuthorization` (gasless intent), seller verifies + settles on-chain. Requires the token to implement EIP-3009.
  - **Variant 2 (fallback): direct ERC-20 transfer.** Buyer `transferUsdt({to, amount})`; seller confirms via read-only balance / receipt before granting. Universal.
- **Algorithm:** create two wallets (buyer/seller); print addresses; (human funds buyer); buyer→seller transfer of a tiny USD₮ amount; seller confirms receipt; log tx hash. Then attempt Variant 1 (`signTypedData` EIP-3009) and report whether the test token supports it.
- **Acceptance:** a real testnet tx hash logged; chain + variant chosen and written to `spikes-FINDINGS.md` and `.env` (`CONDUIT_USDT_ADDRESS`, `CONDUIT_RPC_URL`, `CONDUIT_CHAIN_ID`).
- **Kill-criterion:** if neither variant settles on any supported testnet → escalate; worst case sign-only receipt with deferred settlement (documented).

### 0.6 Co-process smoke (optional) ⬜
- One Node process boots QVAC (Bare worker) + a `hyperswarm` channel + a WDK wallet without conflict. If they clash → split the wallet/storefront into a sidecar process (clean seam already planned).

**PHASE 0 EXIT GATE:** ✅ Spike #1 · ⬜ Spike #2 · ⬜ Spike #1.5. When all three pass → Phase 1.

---

## PHASE 1 — Thin vertical slice + Capability Prober

**Goal:** one scripted, end-to-end paid inference between a seller and a buyer (no agent yet), using
the real firewall gate, real delegated completion, the chosen settlement variant, and a freeloader
rejection — with the seller model chosen by the prober (not hardcoded).

### 1.1 Core completion (shared modules)
- `src/core/config.ts` — load + validate env (zod): seed, mnemonic, rpc, chainId, token, role, ports/limits.
- `src/core/audit.ts` — JSONL audit logger. **Schema** (one object per line):
  ```
  { ts, event, role, ...payload }
  events: model_load | inference | settlement | p2p(sub:handshake_granted|handshake_rejected) | bench
  inference payload: { model, prompt_tokens, completion_tokens, ttft_ms, tps, cloud_bytes:0 }
  settlement payload: { network, amount_usdt, to, tx, status }
  ```
  Write a committed example as `AUDIT_LOG.sample.jsonl`.
- `src/core/protocol.ts` — zod message types for the storefront wire (used fully in Phase 3, stubbed here): `OfferAnnounce`, `QuoteRequest`, `Quote`, `PaymentReceipt`, `ProviderGrant`.

### 1.2 Sell side
- `src/sell/provider-gate.ts` — lifecycle manager implementing **Mechanism A / A′** (Spike #1 decides which is robust):
  - `openGate(buyerPubkey) : Promise<{ providerPublicKey }>` — start a QVAC provider whose firewall = `[buyerPubkey]` (A: fresh process per session; A′: long-lived, reveal pubkey on payment).
  - `closeGate()`.
- `src/sell/seller.ts` — scripted seller: load prober profile → pick `topSellable` → wait for a (hardcoded, for now) buyer pubkey + payment proof → `openGate` → serve. Logs via audit.

### 1.3 Buy side
- `src/buy/delegate.ts` — `delegatedCompletion({ providerPublicKey, model, history }) : AsyncIterable<token> + stats` over `loadModel({delegate})` + `completion`.
- `src/buy/buyer.ts` — scripted buyer: pay (chosen variant) → receive provider pubkey → delegate → print answer + stats.

### 1.4 Wire payment→grant (scripted, no agent)
- Hardcode seller↔buyer identities + a fixed price. Flow: buyer pays → seller verifies (wallet) → `openGate(buyerPub)` → buyer delegates → tokens stream. Log every step.

### 1.5 Freeloader
- `src/spikes/.../freeloader` already exists; promote a `src/buy/buyer.ts --freeloader` mode (different seed, no payment) → expect rejection.

**PHASE 1 EXIT GATE:** end-to-end **paid inference + freeloader rejection, by hand**, seller model chosen by the prober. Audit log shows model_load, inference (with ttft/tps), settlement (tx), handshake_granted, handshake_rejected, cloud_bytes:0.

---

## PHASE 2 — Buyer agent + confidence router

**Goal:** the buyer becomes an autonomous tool-calling agent that answers locally when confident and
pays to escalate when not — under a hard spend policy.

### 2.1 Confidence router  `src/buy/router.ts`
- Signal (logprobs unavailable): **self-consistency** — run the local draft `k=3×` at temp>0, embed each with `embed()`, compare cosine; low agreement = low confidence. Plus optional structured self-assessment (`response_format`/zod) and hedging heuristics on `thinkingText`.
- `route(prompt) : { decision:'local'|'escalate', confidence, draft }`. One threshold is enough for v1.

### 2.2 Tool-calling agent  `src/buy/agent.ts` + `src/buy/tools.ts`
- Hand-written loop over `completion({ tools:[zod], stream:true })`. Tools: `discover_provider`, `get_quote`, `pay`, `delegate`, `answer_locally`. Consume `run.events` (`toolCall`), invoke handler, feed result back, finalize on `run.final`.
- **Spend policy (sandbox):** max price/call + max budget; `pay` clamps to policy; a seller's reply can NEVER trigger `pay`; untrusted text is data, not a command.

### 2.3 Resilience
- `fallbackToLocal:true` on delegated calls; on provider drop, re-issue (consumers don't auto-reconnect).

**PHASE 2 EXIT GATE:** the agent decides to escalate and pays autonomously, within policy; local path stays free; demo prompt set shows a clean local-vs-escalate split.

---

## PHASE 3 — Storefront + multi-message protocol

**Goal:** real discovery/quoting/settlement so a second buyer/seller pairing works with no code changes,
and offers come from the prober + pricing policy.

### 3.1 Storefront  `src/sell/storefront.ts` + buyer discovery in `src/buy/tools.ts`
- A `hyperswarm` topic (e.g. `conduit:market:v1`). Seller announces `OfferAnnounce { sellerPub, wallet, model, priceUsdtPerInference, maxTokens, tps }`. Buyer joins, collects offers, picks best.

### 3.2 Quote + identity binding + replay protection
- `QuoteRequest` → `Quote { price, wallet, nonce, chainId, token }` (single-use nonce). Buyer signs a message binding **consumerPubkey ↔ wallet ↔ nonce** (`wallet.sign`) so payer = peer and a payment can't be replayed.

### 3.3 Pricing + settlement worker
- `src/core/pricing.ts` — turn the prober profile into offer prices (fixed per tier or ∝ size; **no auction in v1**).
- `src/sell/settlement.ts` (or extend `core/wallet.ts`) — verify the signed payment, settle (chosen variant), confirm tx, then `openGate`.

**PHASE 3 EXIT GATE:** a fresh buyer/seller pairing works without edits; a node that benchmarks higher auto-advertises a bigger model.

---

## PHASE 4 — Artifacts, demo, reproducibility

**Goal:** the demo + the verification artifacts, all from one run.

### 4.1 One-run audit log
- Ensure the demo run emits a single JSONL whose numbers match the on-screen ledger and the video. No second source of truth.

### 4.2 Ledger TUI + byte counter  `src/scripts/run_demo.ts` (+ `src/demo/ledger-tui/`)
- TUI (e.g. `ink`): live buyer/seller USD₮ balances + a **cloud-bytes = 0** counter + GRANTED/REJECTED events. (Web overlay = post-v1 polish.)

### 4.3 Reproducibility + disclosure
- `src/scripts/fund_testnet.ts`, `prewarm_dht.ts`. Test `test/remote-isolation.test.ts` asserts the only egress is the disclosed RPC. Finalize `REMOTE_APIS.md`, README (clean-checkout steps), Apache-2.0, research/education + testnet disclaimer.

### 4.4 Demo choreography + video
- Storyboard in `docs/` / `src/demo/`: (A) weak local → (B) low confidence → discover → pay → SoTA answer over E2E → (C) freeloader refused. ≤5 min. Capture hardware profiler screenshots.

**PHASE 4 EXIT GATE:** clean-checkout reproduction + recorded demo + matching artifacts.

---

## Production roadmap (post-v1, not gating)
Cross-internet via `swarmRelays` · multi-buyer concurrency (provider pool / runtime-firewall feature request to QVAC) · reputation/discovery · mainnet USD₮0 (Plasma/Stable) · escrow + disputes + refunds · per-token streaming settlement · price discovery/auction.

---

## Appendix A — command cheat-sheet
```bash
npm install                 # deps
npm run spike:firewall      # Spike #1  (DONE — PASS)
npm run bench               # Spike #2  capability prober            (to add)
npm run spike:settle        # Spike #1.5 WDK testnet settlement      (to add)
npm run typecheck           # tsc --noEmit
# run a single TS file:  node --import tsx <path>
```

## Appendix B — env vars (`.env`, testnet only)
`CONDUIT_SEED` (hex P2P identity) · `CONDUIT_WALLET_MNEMONIC` (testnet) · `CONDUIT_RPC_URL` (default Sepolia) · `CONDUIT_CHAIN_ID` (11155111) · `CONDUIT_USDT_ADDRESS` (set after 0.5) · `CONDUIT_ROLE` (buy|sell|bench) · `QVAC_HYPERSWARM_SEED` (set by code from `CONDUIT_SEED`).

## Appendix C — verified 0.12 model constants
Seller: `QWEN3_4B_INST_Q4_K_M`, `QWEN3_8B_INST_Q4_K_M`, `QWEN3_1_7B_INST_Q4`. Buyer-local: `QWEN3_600M_INST_Q4`, `LLAMA_3_2_1B_INST_Q4_0`, `LLAMA_TOOL_CALLING_1B_INST_Q4_K`. Embeddings (router): `EMBEDDINGGEMMA_300M_Q4_0`. Multimodal/Med available too (roadmap).

## Appendix D — troubleshooting
- **`free(): double free` on exit** — benign SDK teardown bug; `process.exit(0)` after capturing results.
- **Cold DHT first connect 15–45s** — pre-warm with `prewarm_dht.ts`; subsequent connects sub-second.
- **Freeloader takes ~11s to reject** — hole-punch retries; tighten the delegate `timeout`.
- **Model download** — first load of a constant fetches the GGUF (e.g. 600M ≈ 382 MB, 4B ≈ 2.5 GB), then cached.
- **GPU** — `stats.backendDevice` should read `gpu` (Vulkan on the 4050 / Metal on the M5); `cpu` = no Vulkan ICD, still works but slow.
