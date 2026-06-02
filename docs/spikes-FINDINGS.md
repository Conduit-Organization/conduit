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

### Phase 0 COMPLETE ✅ — Spike #1 ✅ · Spike #1.5 ✅ · Spike #2 ✅. All three de-risking spikes pass on the real RTX 4050 + a real Sepolia testnet. Ready for **Phase 1** (thin vertical slice: wire payment → firewall-gated provider → delegated inference, end to end).
