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

## Spike #1.5 — WDK testnet settlement ⏳ pending (needs a funded testnet wallet)
## Spike #2 — capability prober + delegated inference ◑ delegated half already proven by Spike #1; prober TODO
