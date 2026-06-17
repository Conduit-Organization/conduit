# Remote API Disclosure — Conduit

**AI inference / embeddings / RAG / multimodal / fine-tuning:** 100% via `@qvac/sdk`,
on-device or on a **paid peer** over an end-to-end-encrypted Holepunch link. **No cloud AI.**

**Remote AI calls:** NONE.

**Remote NON-AI services:** a single blockchain **testnet RPC**, used only to submit and
confirm USD₮ settlement transactions (per-inference payments and escrow payment-channel
open / top-up / claim / settle).
- Endpoint: see `CONDUIT_RPC_URL` in `.env` (default: Ethereum Sepolia, chainId 11155111).
- Purpose: settlement only. **No prompt, model, or token data is ever sent to it.**
- All RPC access is confined to the wallet/settlement modules — `src/core/wallet.ts`
  (balances + USD₮ transfers) and `src/core/escrow.ts` (payment channels). No inference
  code path touches the network.

**Prompt bytes sent to any cloud:** 0 (see the `cloud_bytes` field in the JSONL audit log,
e.g. `AUDIT_LOG.sample.jsonl`).

> Testnet only. This is a demonstration of an access-control + settlement primitive, not a
> live money-transmission service.
