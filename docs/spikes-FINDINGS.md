# Conduit — Spike Findings

Environment: Linux, NVIDIA RTX 4050 (Vulkan), Node 24, `@qvac/sdk@0.12.0`,
`@tetherto/wdk-wallet-evm@1.0.0-beta.13`.

---

## Spike #1 — payment-gated firewall ✅ **PASS**

**Hypothesis:** a QVAC provider with `firewall:{mode:'allow', publicKeys:[K]}` admits only `K`
at the Noise/DHT handshake and refuses everyone else with 0 tokens served.

**Method:** one provider allow-listing ONLY the buyer's pubkey; two consumers identical except
for allow-list membership (`src/spikes/01-firewall/`).

**Result:**
- **buyer (allow-listed):** `GRANTED_SERVED` — delegated `completion` streamed back. ttft≈22ms, tps≈290 (provider warm).
- **freeloader (NOT listed):** `REJECTED` — `DHTError: PEER_CONNECTION_FAILED` → `DELEGATE_CONNECTION_FAILED` (code 53701) at the hyperdht connect layer, before any RPC. 0 tokens.
- **Controlled:** the only difference between the two is allow-list membership ⇒ the refusal *is* the firewall.

**Mechanism (read from `@qvac/sdk` dist source):** provider = `new Hyperswarm({ seed, firewall })`,
where the firewall function returns DENY for any remote pubkey not in the allow `Set`, enforced at
connection time. Set is captured at swarm creation ⇒ **no runtime mutation API** ⇒ confirms
Mechanism A/A′ (payment must precede the provider that admits the buyer).

**Identity note (v0.11→v0.12 drift):** `getConsumerPublicKey` does **not** exist in 0.12. Derive
locally: `HyperDHT.keyPair(seed).publicKey` (see `src/core/identity.ts`). **Verified**: our derived
key == QVAC's reported provider `publicKey`.

**Local inference (decoupled check):** QVAC runs on the RTX 4050 via Vulkan (`backend=gpu`);
`QWEN3_600M_INST_Q4` ≈136 tps. `completion` stats expose `timeToFirstToken` / `tokensPerSecond` /
`backendDevice` — the exact audit-log fields the plan needs.

**Known wart:** `free(): double free detected` during the Bare-worker teardown (prints *after*
results) — benign for correctness; suppress later via a hard exit.

---

## Spike #2 — capability prober ✅ **PASS**

**Hypothesis:** a node can benchmark its own hardware (load a model ladder, measure real
TTFT/TPS) and pick what it can sell. Files: `src/core/prober.ts`, `src/scripts/bench.ts` (`npm run bench`).

**Result (RTX 4050, Vulkan/GPU):** full ladder benched; profile written to `bench-profile.json`.

| model | backend | TTFT | tok/s | role |
|---|---|---|---|---|
| `QWEN3_600M_INST_Q4` | gpu | 21 ms | 312 | **localDraft** (buyer) |
| `LLAMA_TOOL_CALLING_1B_INST_Q4_K` | gpu | 22 ms | 183 | agent option |
| `QWEN3_1_7B_INST_Q4` | gpu | 168 ms | 118 | |
| `QWEN3_4B_INST_Q4_K_M` | gpu | 86 ms | 59.4 | **topSellable** (seller) |

→ `localDraft = Qwen3-0.6B`, `topSellable = Qwen3-4B` — exactly the demo A/B (fast-but-weak 312 tps
local vs. a stronger 4B seller @ 59 tps). The prober computes the profile, retries on download
timeout, and exits clean (double-free mitigated).

**Ops lesson (cost a few re-runs):** QVAC downloads models to `~/.qvac`, which sat on a **full
`/home`** partition → `ENOSPC`. Fix = relocate the cache to root. ⚠️ But **do NOT `mv` the rocksdb
`registry-corestore` across partitions** — rocksdb-native's device-file check then rejects it
(`Invalid device file, was modified`) for *new* downloads (already-materialized GGUFs in `models/`
still load). **Correct fix: delete `registry-corestore` and let QVAC rebuild it fresh** at the new
location; then 1.7B/4B downloaded + benched cleanly. Larger-model P2P pulls are slow (4B ≈ 9 min)
but reliable once disk + corestore are sane.

---

## Spike #1.5 — WDK testnet USD₮ settlement ✅ **PASS**

**Hypothesis:** WDK can move USD₮ wallet-to-wallet on a testnet and confirm it.

**Setup:** one dev mnemonic → account 0 = buyer (funded: 1000 USD₮ + 1.09 ETH), account 1 = seller.
Chain: **Sepolia** (11155111), RPC `ethereum-sepolia-rpc.publicnode.com`. Token: **Pimlico test USD₮**
`0xd077A400968890Eacc75cdc901F0356c943e4fDb` (6 decimals). Files: `src/core/wallet.ts`,
`src/core/env.ts`, `src/spikes/02-settlement/run.ts` (`npm run spike:settle`).

**Result:** `account.transfer({ token, recipient, amount })` moved **0.25 USD₮ buyer → seller,
confirmed in 7.1 s**. buyer 1000 → 999.75, seller 0 → 0.25. Real tx
`0x596669325b50304497083a868cd14a61ca60929e604432e9a3bc529f80c86bcb`.

**WDK API notes (`@tetherto/wdk-wallet-evm@1.0.0-beta.13`):** needs a **BIP-39 mnemonic, not a raw
private key**. `new WalletManagerEvm(mnemonic, { provider }).getAccount(i)` (index → multiple accounts
from one seed). Account: `getAddress`, `getBalance()` (native ETH, bigint), `getTokenBalance(token)`,
`transfer({ token, recipient, amount })` → `{ hash }`, `getTransactionReceipt`, `quoteTransfer`.
**Field is `recipient` (not `to`); amount in base units.**

**Decisions LOCKED:** chain = **Sepolia + Pimlico USD₮**. Settlement = **Variant 2** (direct ERC-20
transfer, gas in ETH, confirm-before-grant) — universal, proven. EIP-3009 gasless authorization
(Variant 1) deferred. Per-inference settlement validated.

---

### Phase 0 COMPLETE ✅ — Spike #1 ✅ · Spike #1.5 ✅ · Spike #2 ✅. All three de-risking spikes pass on the real RTX 4050 + a real Sepolia testnet.

---

## Phase 1 — thin vertical slice ✅ **PASS**

First end-to-end run fusing Spike #1 + #1.5 into one flow. `npm run slice` (`src/scripts/slice.ts` +
`src/sell/provider.ts` + `src/buy/consumer.ts` + `src/core/{audit,config}.ts`):

1. buyer pays **0.01 USD₮ → seller** (WDK, real tx `0xee0fd429…`) · 2. seller verifies on-chain (+0.01) ·
3. payment confirmed → seller opens a **firewall-gated provider for ONLY the buyer** ·
4. buyer delegates **Qwen3-4B** (from `bench-profile.json` `topSellable`) over E2E P2P → real answer,
**ttft 49 ms, tps 64.9**, 1962 chars · 5. freeloader (no pay) → **REJECTED** at the handshake, 0 bytes.

One-run **`AUDIT_LOG.jsonl`** captured: settlement(submitted→confirmed) → gate_opened → handshake_granted
(cloud_bytes 0) → inference(4B, ttft/tps, cloud_bytes 0) → handshake_rejected(not_allow_listed, 0 bytes).
Sample committed as `AUDIT_LOG.sample.jsonl`.

**Headline now runs as one sequence: pay → the gate opens → you get the 4B answer; don't pay → refused. 0 cloud bytes.**

**Cosmetic TODO (Phase 4 polish):** orchestrator prefixes every streamed token with `[buyer]` (noisy stream);
the benign Bare-worker double-free still prints on teardown (results are captured before it). *(`total_tokens`
gap resolved in Phase 2 via `stats.promptTokens`.)*

---

## Phase 2 — buyer agent + confidence router ✅ **PASS**

**Confidence router** (`src/buy/router.ts`, `npm run route`): no logprobs → measure **answer stability**. Sample
the local 0.6B k× (`kvCache:false` so each is an independent attempt), embed each answer (EMBEDDINGGEMMA-300M),
take mean pairwise cosine. Validated separation: easy ≥0.877 → LOCAL, hard/creative ≤0.838 → ESCALATE (threshold 0.86).

**Agent + spend policy** (`src/buy/{agent,policy}.ts`, `npm run agent`): the router *recommends*; the **SpendPolicy**
(per-call cap + total budget) — not the model, not the seller — *authorizes* the pay; then pay USD₮ → confirm
on-chain → delegate the 4B. One run (budget 0.01 = exactly one escalation):

| Q | consistency | decision |
|---|---|---|
| capital of France | 1.000 | LOCAL · free → "Paris" |
| original aphorism about time | 0.812 | **PAID 0.01 USD₮** → 4B: *"Time is the only currency that doesn't earn interest."* |
| 12 + 12 | 1.000 | LOCAL · free → "24" |
| invent a brand name | 0.776 | **DECLINED → local** (budget exhausted) |

One-run audit: gate_opened → inference(local) → settlement(confirmed, tx) → handshake_granted → inference(delegated
4B, ttft 2.85 s, **tps 59, prompt_tokens 25**) → inference(local) → inference(local, declined). cloud_bytes 0
throughout; budget held (spent 0.01/0.01).

**Known limitation (honest):** self-consistency reliably flags creative/ambiguous prompts, but NOT factual-hard
ones where a tiny model *confidently converges on a wrong answer* (it consistently hallucinated "Ruytjens" as the
best chess opening → read as "sure"). Product fix = add a self-assessment/verifier signal (roadmap). For v1 the
router is a defensible heuristic + curated demo prompts (exactly the Spike #4 kill-criterion fallback).

---

## Phase 3 — P2P storefront ✅ **PASS**

Two **independent** processes (`src/node/sell.ts`, `src/node/buy.ts`) meet on a Hyperswarm topic
(`conduit:market:v1`) and run the whole negotiation with **no orchestrator** (`npm run market` only *launches*
both — it does not coordinate them). Files: `src/core/{protocol,pricing}.ts`, `src/node/{sell,buy}.ts`.

Verified flow (one run):
1. seller advertises an offer from its prober profile + pricing: **Qwen3-4B @ 0.01 USD₮, ~59 tps**.
2. buyer discovers it over the topic → requests a quote.
3. seller issues a **quote with a single-use nonce**.
4. buyer signs the **identity binding** (`consumerPub ↔ wallet ↔ nonce`, ethers `signMessage`), pays USD₮ (real tx), sends the receipt.
5. seller verifies: **signature recovers to the payer wallet** (`ethers.verifyMessage`) + **on-chain payment confirmed** + **nonce unused** → marks nonce used → opens a firewall-gated provider for that buyer → grants.
6. buyer delegates the 4B → real answer (ttft 55 ms, **tps 61, promptTokens 29**).

→ **A fresh buyer/seller pairing works with zero code changes** (the Phase 3 exit gate): serverless discovery +
quote + replay-safe nonce + identity-bound payment + gated grant + delegated inference.

**Single-machine note:** running both QVAC workers on ONE box shares `~/.qvac/.worker.lock` → a harmless
"another worker is still running" warning (it served fine). On the real two-machine demo (4050 seller + M5 buyer)
there's no shared lock. **Phase 4 polish:** `modelType:'llm'` is deprecated → use `'llamacpp-completion'`; tidy
teardown (the benign double-free / ECONNRESET on exit).
