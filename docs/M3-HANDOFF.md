# Conduit — M3 Handoff (Electron desktop app)

> **Who this is for:** the teammate building M3 on the **MacBook Air (Apple Silicon)**, starting a
> **fresh Claude Code session with zero context**. Open Claude Code in the repo and say:
> *"Read `docs/M3-HANDOFF.md` fully, then let's start M3a."* This document is self-contained.

---

## 0. Rules for this repo — read before anything else

1. **NEVER add an AI co-author to commits.** No `Co-Authored-By: Claude <…>` trailer, ever. This is a hard team rule. Plain commit messages only.
2. **Never commit secrets.** No `.env`, no keystores, no private keys, no recovery phrases. `.gitignore` already excludes them — don't fight it. This handoff intentionally contains no secrets.
3. **Testnet only** (Sepolia). Never mainnet, never real funds.
4. **BUILD, don't test.** Your job on this machine: write the code and keep it **compiling** —
   `npx tsc --noEmit` (repo root) · `cd app && npx tsc --noEmit` · `npm run app:build` must all pass.
   Do **NOT** run the engine, start sellers, download models, or spend testnet funds here.
   **All functional testing happens on the Linux GPU machine** after you push. Push per sub-step (M3a → M3b → M3c), the team tests there and reports back.
5. **Work phase-by-phase, explain-then-build.** Before a big structural change, write the approach down (a few bullets), sanity-check it against this doc, then implement.
6. `docs/PRODUCT-PLAN.md` is the **master plan** — keep milestone statuses updated there as you go.

---

## 1. What Conduit is

**A serverless two-sided P2P inference market where a settled USD₮ payment IS the access handshake.**
A peer with a GPU sells LLM inference over an end-to-end-encrypted Holepunch/Hyperswarm link; a buyer's
agent answers easy questions **free on-device** and pays the seller **per inference in USD₮**
(wallet-to-wallet, Sepolia testnet) only when escalation is worth it. No payment → no Noise handshake →
the model is never reached (`cloud_bytes = 0`). Built on Tether's `@qvac/sdk` (AI) + WDK (wallet).

**Status:** M0–M2 complete and verified end-to-end on real hardware + testnet. M3 (this handoff) makes
it an installable desktop app.

---

## 2. What's already built (all ✅, all committed)

| Milestone | What it means |
|---|---|
| **M0–M4 (engine phases)** | Identity, payment-gated QVAC provider (firewall = the grant), WDK USD₮ settlement, confidence router (self-consistency), autonomous agent (free / pay / decline), P2P storefront protocol, headline demo + audit log. |
| **M1 — real two-sided market** | The web app's buyer discovers **separate seller processes** over Hyperswarm, negotiates (quote → nonce → identity-bound pay → grant), and delegates inference. Marketplace UI: browse sellers, pick one or "Auto" (cheapest-then-fastest), switch anytime. |
| **M2 — per-user wallet** | Encrypted keystore (ethers' audited keystore JSON; password ≥ 8). Create / import / unlock / lock / password-gated seed reveal. The chat is gated behind unlock. `.env` mnemonic = dev-only auto-unlock fallback. |

### File map

```
app/                         React UI (Vite + TS + framer-motion + react-markdown) — talks ONLY to /api/*
  src/App.tsx                orchestrator: boot splash → WalletGate → app; polls /api/state + /api/sellers
  src/api.ts                 typed client for every engine endpoint
  src/components/
    WalletGate.tsx           create (12-word backup) / import / unlock screens
    WalletMenu.tsx           address · faucet links · password-gated seed reveal · lock
    Rail.tsx                 left "instrument panel": wallet, spend meter, Marketplace, privacy seal
    Marketplace.tsx          seller list (model · price · tps · online), Auto row, tap-to-select
    Thread.tsx / Message.tsx / Composer.tsx   chat (FREE/PAID stamps, markdown answers)
  src/styles.css             the entire design system (ink #0E1217 + mint #2BE3A8; Instrument Serif / JetBrains Mono / Hanken Grotesk)

src/
  web/server.ts              THE ENGINE (this process = buyer). Serves app/dist + the whole /api:
                             /api/state /api/sellers /api/select /api/ask
                             /api/wallet (+ /create /import /unlock /lock /export)
                             Wallet unlock builds buyer-account + storefront; local router warms independently.
  buy/storefront.ts          marketplace client: discovers sellers, registry, select/auto, purchase()
                             (quote → sign bind → pay USD₮ → await grant → delegate inference)
  buy/market-agent.ts        router recommends → SpendPolicy authorises → storefront.purchase
  buy/router.ts              confidence router: sample 0.6B k×, embed, mean cosine; <0.86 → escalate
  buy/policy.ts              spend policy (per-call cap 0.1, session budget 1 USD₮)
  buy/agent.ts               OLD single-machine agent — used by demo scripts only; do not delete
  core/keystore.ts           encrypted wallet keystore (create/import/unlock/readAddress; ~/.conduit/keystore.json, override CONDUIT_KEYSTORE)
  core/wallet.ts             WDK accounts: getAccount(mnemonic, rpcUrl, index) → balances + transferToken
  core/{config,env}.ts       config — mnemonic OPTIONAL; Sepolia RPC + USD₮ defaults baked in (boots with no .env)
  core/{protocol,pricing,prober,identity,audit,ledger}.ts   storefront wire protocol, offer pricing, GPU benchmark, pubkey derivation, JSONL audit
  node/sell.ts               THE SELLER (CLI today): advertises offer from bench-profile.json, verifies payment on-chain, opens firewall-gated provider, grants. Hardened vs RPC timeouts.
  node/buy.ts                Phase-3 CLI buyer (reference implementation of the negotiation)
  scripts/                   demos: demo.ts (headline), market-demo, agent-demo, bench, slice
  sell/provider.ts           payment-gated QVAC provider child (used by the demo scripts)
docs/PRODUCT-PLAN.md         MASTER PLAN — read §3.5 (app flow) before M3b
```

---

## 3. How it runs (context only — the team runs this on the Linux GPU box, not you)

| command | what |
|---|---|
| `npm install` + `npm run app:install` | engine + UI deps |
| `npm run app:build` | build the React UI → `app/dist` (the engine serves it) |
| `npm run web` | start the engine/buyer → http://localhost:8788 |
| `npm run sell` | start a seller (separate process / machine) |
| `npm run demo` | single-machine headline demo (local-free → pay → freeloader-refused) |

Env knobs: `PORT` (default 8788) · `CONDUIT_KEYSTORE=<path>` (keystore location) ·
`CONDUIT_NO_ENV_WALLET=1` (force real onboarding even when `.env` has a dev mnemonic).
`.env` (never committed) can hold: `mnemonic`, `CONDUIT_RPC_URL`, `CONDUIT_USDT_ADDRESS`, `CONDUIT_CHAIN_ID` —
all optional now; network values default to Sepolia + the Pimlico test-USD₮ (`0xd077A400968890Eacc75cdc901F0356c943e4fDb`, 6 decimals).

---

## 4. Hard-won facts — do NOT re-learn these the painful way

1. **QVAC runs a native Bare worker.** `@qvac/sdk` in Node spawns `node_modules/bare-runtime-<platform>/bin/bare` running `@qvac/sdk/dist/server/worker.js`. This is **the packaging crux of M3c**: native binaries (`bare-runtime-*`, `rocksdb` prebuilds) cannot live inside an asar archive.
2. **`process.env.QVAC_HYPERSWARM_SEED` must be set BEFORE the SDK is imported** — it fixes the buyer's P2P identity (the key the seller firewall-allows). `server.ts` does this at the very top; preserve that ordering in anything you restructure.
3. **Qwen3 models are thinking models.** Without `generationParams: { reasoning_budget: 0, predict: N }`, they can burn the whole token budget inside `<think>` and return an **empty answer**. Every `completion()` call in the codebase sets these — keep it that way.
4. **`kvCache: false` on completions** — otherwise the per-model KV cache accumulates across calls and throws `ContextOverflowError`.
5. **One machine, two QVAC processes** (buyer engine + seller) → a harmless shared `~/.qvac/.worker.lock` warning. Expected.
6. **Hard-killing the engine leaks children.** `kill -9` skips cleanup handlers, orphaning seller/worker processes that **hold GPU memory**. The Electron shell's lifecycle management (M3a) must terminate the engine child gracefully (SIGTERM) and ensure grand-children die too.
7. **Public RPC blips.** Sepolia RPC calls can time out; `sell.ts` is hardened (balanceOrNull + process-level guards). Keep any new chain-touching code equally defensive.
8. **Hyperswarm rediscovery lag**: a long-running buyer is slow to re-find a **restarted** seller (DHT re-announce). Known issue, parked for M4 — don't burn time on it.
9. **Seller storefront identity is NOT stable across restarts** (its swarm keypair is random each start). The marketplace `id` therefore changes when a seller restarts. **For M3b bookmarks, key on the seller's wallet address (`address` field) — that IS stable** — not on `id`.
10. **The dev wallet fallback**: no keystore + `.env` mnemonic ⇒ auto-unlock (so demos skip onboarding). `CONDUIT_NO_ENV_WALLET=1` disables it. Real users always see the gate.

---

## 5. M3 — your mission: the installable desktop app

**Goal:** a double-click app — no terminal, no Node install. One app, **Buyer ⇄ Seller toggle**.

### Locked decisions (do not relitigate; flag if something proves impossible)
- **Electron, not Tauri.** The engine is native Node (Bare worker, GPU, rocksdb, WDK). Electron's main process IS Node → the engine runs verbatim as a child. Tauri would force a fiddly Node sidecar; its small-binary advantage dies the moment we must ship Node anyway. Chromium's ~150 MB is noise next to multi-GB models.
- **Engine stays a child process.** Electron main = lifecycle manager (spawn engine → wait ready → open window → kill cleanly on quit). Don't try to run the engine in-process (top-level await ESM + Bare spawn = pain).
- **Buyer flow is Binance-P2P style** — read `docs/PRODUCT-PLAN.md §3.5`. Buyer lands on the **Marketplace** (full screen), picks a seller or Auto, can **bookmark** sellers, then enters chat; back button returns to the marketplace. **Choosing a seller ≠ paying** — easy questions stay free/on-device; the chosen seller is paid only on escalation.
- **Wallet:** password everywhere (already built). Electron adds optional **"remember on this device"** via `safeStorage` (OS keychain). The password remains the primary lock.
- **macOS signing/notarization: DEFERRED** — unsigned dmg, right-click → Open. Don't buy certificates.
- **The seller chooses its model** (capability prober → `bench-profile.json`); weights live on the seller; buyers download nothing big.

### M3a — the Electron shell  *(prove the desktop window works)*
- New top-level `electron/` directory: `main.ts` (spawn engine child → poll `http://localhost:<port>/api/wallet` until it responds → `BrowserWindow` loading that URL), `preload.ts` (minimal), single-instance lock, graceful shutdown (SIGTERM the engine, wait, ensure children are gone — see gotcha #6).
- **Dev mode:** spawn the engine via the repo (`node --import tsx src/web/server.ts`) with `cwd` = repo root; window loads `http://localhost:8788`. (Packaged mode switches to a compiled engine — that's M3c, don't solve it yet.)
- Pick the port at spawn (env `PORT`), pass it through; handle "port in use".
- Scripts in root `package.json`: `electron:dev` (build app → spawn electron). Keep `npm run web` working unchanged.
- **Done when:** everything typechecks + `app` builds + `electron/` compiles. (Functional check happens on the Linux box.)

### M3b — the product screens  *(role toggle · marketplace landing · bookmarks · seller mode)*
- **Role toggle:** a top-level switch (Buyer "Ask & Pay" ⇄ Seller "Share your GPU & Earn"), switchable anytime, persisted locally.
- **Buyer:** after wallet unlock, land on a **full-screen Marketplace** (evolve `Marketplace.tsx` from a rail panel into the landing screen: model · price · tps · online · ★bookmark · select) → selecting (or Auto) enters the existing chat; back returns. Keep the rail's compact panel in chat view.
- **Bookmarks:** ★ on a seller → persisted list (**key by seller wallet `address`, NOT `id`** — gotcha #9); show bookmarked sellers with live online/offline status; one-tap select. `localStorage` is fine for now.
- **Seller mode (new engine work):** the engine today is buyer-only; the seller is the separate CLI `src/node/sell.ts`. Recommended approach: keep the seller as a **child process the engine manages** — add endpoints `/api/seller/start`, `/api/seller/stop`, `/api/seller/status` (online?, model, price, requests served, earnings = wallet balance delta) that spawn/kill/inspect a `sell.ts` child. Reuse, don't rewrite, `sell.ts`. UI: bench result → model to offer → Go online → status + earnings.
- **Done when:** typecheck + `app:build` pass; endpoints + screens exist; PRODUCT-PLAN M3 checkboxes updated.

### M3c — packaging  *(installers; the genuinely hard part)*
- Compile the engine to plain JS (esbuild → e.g. `dist-engine/server.mjs`) so the packaged app doesn't need `tsx`; Electron main spawns it with the bundled Node (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`).
- `electron-builder`: Linux AppImage + deb; macOS dmg (**build the dmg ON this Mac** — native modules don't cross-compile). `asarUnpack` everything native: `bare-runtime-*`, `rocksdb`/prebuilds, `@qvac/sdk/dist/server/**`. Expect iteration here — this is where the time goes.
- First-run **model download progress**: QVAC's `loadModel` emits progress (`ModelProgressUpdate`); surface it via an engine endpoint/SSE → a progress UI instead of a silent multi-GB wait.
- `safeStorage` "remember on this device" for the wallet password (optional checkbox on unlock).
- Model cache stays in the user's home (`~/.qvac`) — fine for packaged apps.
- **Done when:** builds produce artifacts on this Mac; the team smoke-tests the Linux artifact on the GPU box and the mac dmg on this machine **together with you** (coordinate — this step inherently needs a run).

### Honest risks
Native packaging (M3c) is the riskiest part — budget iteration. The seller-mode engine endpoints (M3b) are the largest *new code* surface. Everything else is assembly of proven parts.

---

## 6. Workflow with the team

1. Build a sub-step (M3a → M3b → M3c). Keep `npx tsc --noEmit` (root **and** `app/`) + `npm run app:build` green.
2. Commit (plain message, **no AI co-author**), push.
3. The team pulls on the **Linux GPU machine**, runs it for real (models, payments, two-sided market), and reports back. You iterate.
4. Don't run models / engines / payments on this Mac unless explicitly coordinated (M3c smoke test will be).

## 7. Read these first (in order)
1. This file. 2. `docs/PRODUCT-PLAN.md` (esp. §1 wallet model, §3.5 app flow, M3 section). 3. `src/web/server.ts`. 4. `src/buy/storefront.ts`. 5. `app/src/App.tsx`. 6. `src/node/sell.ts`.

Repo: `github.com/Conduit-Organization/conduit` · License Apache-2.0 · Everything testnet.
