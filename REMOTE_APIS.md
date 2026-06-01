# Remote API Disclosure — Conduit

**AI inference / embeddings / RAG / multimodal / fine-tuning:** 100% via `@qvac/sdk`,
on-device or on a **paid peer** over an end-to-end-encrypted Holepunch link. **No cloud AI.**

**Remote AI calls:** NONE.

**Remote NON-AI services:** a single blockchain **testnet RPC**, used only to submit and
confirm USD₮ settlement transactions.
- Endpoint: see `CONDUIT_RPC_URL` in `.env` (default: Ethereum Sepolia, chainId 11155111).
- Purpose: settlement only. **No prompt, model, or token data is ever sent to it.**
- All RPC access is isolated in one module (`src/core/settlement.ts`) and asserted by tests.

**Prompt bytes sent to any cloud:** 0 (see the `cloud_bytes` field in the JSONL audit log).

> Testnet only. This is a demonstration of an access-control + settlement primitive, not a
> live money-transmission service.
