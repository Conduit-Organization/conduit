# Conduit

**A serverless P2P inference market where a settled USD₮ payment is the access handshake.**

A peer with a GPU sells LLM inference over an end-to-end-encrypted Holepunch link; a buyer's agent
pays per inference in USD₮, wallet-to-wallet, with **no platform in the middle**. No payment → no
handshake → the model is never reached. Weights never move; only prompt-bytes-in / token-bytes-out
cross the wire; the cloud sees nothing.

- **License:** Apache-2.0 · **AI:** 100% via `@qvac/sdk` (on-device or on a paid peer), no cloud AI — see [`REMOTE_APIS.md`](./REMOTE_APIS.md)
- **Settlement:** USD₮ on an EVM **testnet** (Sepolia) via WDK — the only remote service, and it's non-AI
- **Docs:** [`docs/`](./docs/) — build runbook [`docs/BUILD-PHASES.md`](./docs/BUILD-PHASES.md), plan [`docs/CONDUIT-PLAN.md`](./docs/CONDUIT-PLAN.md), diagrams [`docs/CONDUIT-ARCHITECTURE.md`](./docs/CONDUIT-ARCHITECTURE.md), what-we-proved [`docs/spikes-FINDINGS.md`](./docs/spikes-FINDINGS.md)

> Status: **runs end-to-end** (Phases 0–3) with a **chat + wallet web app** on top. Pay→gate→delegated
> inference, an autonomous answer-free-or-pay agent, and a serverless P2P storefront all work on a real
> GPU + a real testnet. Testnet only — a demonstration of the access-control/settlement primitive, not a
> live financial service.

## The headline demo
```bash
npm run demo
```
One run shows the whole story: ① a cheap local 0.6B answers an easy prompt **free**; ② the agent detects
low confidence, **pays 0.01 USD₮**, and gets a SoTA answer from the seller's Qwen3-4B over E2E P2P;
③ a **freeloader is refused at the Noise handshake (0 bytes)** — with a live USD₮ ledger, a `cloud_bytes=0`
counter, and a one-run JSONL audit ([`AUDIT_LOG.sample.jsonl`](./AUDIT_LOG.sample.jsonl)).

## Quickstart (clean checkout)
```bash
npm install

cp .env.example .env          # then edit .env:
#   mnemonic="<your TESTNET BIP-39 seed phrase>"   (account 0 = buyer, account 1 = seller)
#   CONDUIT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
#   CONDUIT_USDT_ADDRESS=<test-USD₮ contract on Sepolia>     (e.g. the Pimlico faucet token)
# Fund account 0 with a little Sepolia ETH (gas) + test USD₮ (Pimlico/Candide faucet).

npm run bench                 # optional: benchmark this machine → bench-profile.json (picks the sellable model)
npm run demo                  # the headline demo (above)
```

## The app — chat + wallet (for anyone)
Don't want a terminal? A local web app puts the whole engine behind a simple **chat + wallet** UI. Easy
questions are answered **free on-device**; hard ones quietly **pay a peer's GPU** a fraction of a cent in
USD₮ — each answer stamped *on-device / free* or *peer / paid*, with a live wallet, a session-spend meter,
and a persistent **0 bytes to cloud** seal.

```bash
npm install            # engine deps        (once)
npm run app:install    # web-app deps       (once)
npm run app:build      # build the React UI → app/dist
npm run web            # serve the app + engine API → http://localhost:8788
# or, in one step:
npm run start          # app:build + web
```
Hot-reload UI development: `npm run app:dev` (Vite on :5173, proxies `/api` → the engine on :8788).

> Needs `.env` configured + a funded testnet wallet (same as the Quickstart above). The app is a thin
> shell over the proven engine — it only calls `/api/state` and `/api/ask`. First launch warms the
> on-device model (~1 min) before it reports ready.

## All commands
| command | what it does |
|---|---|
| **`npm run start`** | build + serve the **chat + wallet web app** → http://localhost:8788 |
| `npm run web` | serve the app + engine API (after `app:build`); `app:dev` runs the UI with hot-reload |
| `npm run demo` | headline: local-free → pay-to-escalate (4B) → freeloader-refused, with ledger + audit |
| `npm run market` | **serverless storefront** — independent seller + buyer find each other over Hyperswarm and negotiate (discover → quote+nonce → identity-bound pay → grant → delegate) |
| `npm run agent` | autonomous buyer: confidence router + spend policy (answer-free / pay / budget-decline) |
| `npm run route` | confidence router on easy vs. hard prompts (self-consistency, no logprobs) |
| `npm run bench` | capability prober — benchmarks the local GPU, writes `bench-profile.json` |
| `npm run slice` | Phase-1 thin vertical slice (hand-scripted pay→gate→delegate→reject) |
| `npm run spike:firewall` / `spike:settle` | the de-risking spikes (firewall-as-gate; WDK USD₮ settlement) |
| `npm run sell` / `npm run buy` | run a seller / buyer node on their own (two machines / two terminals) |

## Requirements
- Node.js ≥ 22
- A GPU for the seller role: **NVIDIA + Vulkan** (Linux/Windows) or Apple Silicon + Metal (macOS)
- A funded **testnet** wallet (account 0): a little Sepolia ETH for gas + test USD₮

> Single-machine note: running a seller and a buyer on **one** box makes both QVAC workers share
> `~/.qvac/.worker.lock` (a harmless warning; it serves fine). The real demo is two machines.

## Layout
```
app/       React chat + wallet UI (Vite) — static files that talk to the engine over /api
src/
  core/    identity · env · config · wallet · audit · ledger · prober · pricing · protocol
  sell/    provider            (payment-gated QVAC provider, Mechanism A)
  buy/     router · agent · policy · consumer
  node/    sell · buy          (independent storefront nodes)
  web/     server              (engine API: /api/state + /api/ask — and serves the built app)
  scripts/ demo · market-demo · agent-demo · route-test · bench · slice
  spikes/  01-firewall · 02-settlement
```
