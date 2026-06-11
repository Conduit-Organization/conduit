# Conduit — Product Plan (Demo → Shippable App)

> Goal: turn Conduit from a working **single-machine demo** into a **real product people can install and use** —
> a buyer asks questions and pays a *peer's* GPU per inference in USD₮; a seller shares a GPU and earns —
> all serverless, end-to-end encrypted, with the settled payment as the access handshake.
>
> This document is the master plan. It is intentionally exhaustive. Status markers: ✅ done · ◑ partial · ⬜ not started.

---

## 0. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Money rail** | **Testnet (Sepolia + faucet USD₮)** | Prove the full product + UX with zero real-funds risk. Honest framing: a demonstration of the primitive. Mainnet is parked (M5). |
| **Distribution** | **Electron desktop app** | The engine is heavy **native Node** (QVAC spawns a Bare worker, GPU via Vulkan/Metal, native `rocksdb`/`bare-runtime`/WDK). Electron's main process *is* Node → runs the engine verbatim. Tauri would force a fiddly Node sidecar and its small-binary win evaporates once we must ship Node anyway. Chromium's ~150 MB is noise next to multi-GB models. |
| **Wallet** | **In-app non-custodial WDK wallet** (auto-signs micropayments); top-up from any wallet | Per-inference micropayments make per-payment MetaMask approval unusable. User owns the seed (non-custodial), funds from anywhere, app auto-spends small amounts. |
| **Build style** | Phase by phase; explain → confirm → build | Established working preference. |

---

## 1. The wallet model (important — answers "can users connect their own wallet?")

**Yes — users own their wallet, but via an in-app wallet, not a per-payment MetaMask prompt.**

- **Why not MetaMask/WalletConnect per payment:** Conduit settles **per inference** (~0.01 USD₮ per question). Approving every micropayment in an external wallet is unusable (popup per message) and slow. The buyer's wallet must also auto-sign the **identity-binding handshake** each session. A micropayment product fundamentally needs an **auto-signing local (hot) wallet**.
- **The model:**
  1. On first run the app **creates** a new wallet (BIP-39 seed via WDK) or **imports** an existing seed. The user is shown the seed phrase to back up → **they hold the keys (non-custodial)**.
  2. The seed is stored **encrypted at rest** (Electron `safeStorage`/OS keychain; password-encrypted file in the pre-Electron web phase).
  3. The app **auto-signs** the tiny USD₮ transfers + identity-binding messages — no popup per question.
  4. The user **funds** the wallet by sending testnet USD₮ to their Conduit address — from a faucet or **any wallet they already have** (this is the "connect your wallet" part: fund from wherever).
- **"Connect your wallet" UX (roadmap):** a one-click "top up via WalletConnect" so users can pull testnet USD₮ from an existing wallet without copy-pasting an address. Optional, post-M2.
- **Seller wallet:** the seller machine has its own in-app wallet — its **earnings address**. Payments land there.

---

## 2. Current state (today)

✅ **Engine (Phases 0–4):** identity, payment-gated provider (firewall = grant), WDK USD₮ settlement on Sepolia, confidence router (self-consistency, `reasoning_budget:0`), autonomous buyer agent (free / pay / decline), serverless P2P storefront (`node/sell.ts` ↔ `node/buy.ts` over Hyperswarm topic `conduit:market:v1`: discover → quote+nonce → identity-bound pay → grant → delegate), headline demo + audit log.

◑ **Consumer web app (Phase 5):**
- `src/web/server.ts` — engine API (`/api/state`, `/api/ask`) + serves the React app. **Limitation: the buyer process spawns the seller as a local child** (`startProvider`) — single machine, not a real market.
- `app/` — React + Vite chat + wallet UI ("private instrument panel"; FREE/PAID stamps, spend meter, "0 bytes to cloud" seal).
- Wallet = **shared dev mnemonic in `.env`** (accounts 0 = buyer, 1 = seller). Not multi-user.

**Gap to "people can use it":** (a) one machine, not two-sided; (b) one shared dev key, not per-user wallets; (c) requires Node/terminal, not installable.

---

## 3. Target architecture

```
   BUYER machine (laptop)                         SELLER machine (MacBook / any GPU peer)
 ┌───────────────────────────┐                 ┌───────────────────────────────┐
 │ Electron app              │                 │ Electron app (seller mode)    │
 │  ├─ React UI (chat+wallet)│                 │  ├─ React UI (earnings+status)│
 │  └─ Engine (Node child)   │                 │  └─ Engine (Node child)       │
 │      ├─ in-app wallet (WDK)│                │      ├─ in-app wallet (WDK)    │
 │      ├─ confidence router  │                │      ├─ capability prober      │
 │      └─ storefront BUYER   │◄──Hyperswarm──►│      └─ storefront SELLER      │
 │          discover/quote/   │   E2E Noise    │          advertise/verify/     │
 │          pay/delegate      │                │          gated provider        │
 └───────────────────────────┘                 └───────────────────────────────┘
          │  USD₮ transfer (Sepolia) ─────────────────────►  seller earnings addr
          └─ payment confirmed on-chain  ⇒  seller opens firewall-gated provider ⇒ delegate inference
```

Key property preserved: **no platform/server in the middle**; a **settled payment is the firewall handshake grant**; weights never move; cloud sees nothing (`cloud_bytes=0`).

---

## 3.5 App flow — role toggle + a Binance-P2P-style marketplace
The desktop app models its buyer experience on **Binance P2P**: the buyer browses a marketplace of
sellers (each an "advertiser" with **model · price · speed · reputation · online status**), picks one
(or "Auto"), can **bookmark/favorite** sellers to return to, then transacts.

```
Open app
 └─ Choose role — a TOGGLE, switchable anytime (one app, a person can do both):
     ├─ SELLER → benchmark (capability prober) → pick the model to offer → go online → earn
     │           (status: online, requests served, earnings)
     └─ BUYER  → MARKETPLACE (the buyer's landing screen)
                  ├─ browse sellers: model · price · tps · reputation · online dot
                  ├─ ★ bookmark sellers → a saved list (shows online/offline even when away)
                  ├─ pick a seller  (or "Auto" = cheapest-then-fastest)
                  └─ → CHAT (the ask → free-local / pay-seller → stamped-answer flow)
                          └─ back button returns to the marketplace to switch / bookmark
```

**Notes that keep the model honest:**
- **Choosing a seller ≠ paying.** Easy questions still answer **free, on-device**; the chosen seller is paid **only when a question escalates**. Selection = "who I pay *when* a paid answer is needed."
- **Bookmarks** are stored locally (by seller key), shown with live online/offline status and (later) the seller's **reputation** — the way you'd re-pick a trusted Binance-P2P merchant.
- **One app, role toggle** — sell *and* buy from the same install.

(Today's M1b is a simplified slice of this: a marketplace *panel* in the rail with pick/Auto/switch. The full landing-screen flow + role toggle + bookmarks land in **M3**; reputation in **M4**.)

---

## 4. Milestones

### M1 — Real two-sided market ✅  *(M1a engine + M1b UI both done)*
**Goal:** the web app's buyer discovers + pays a seller on **another machine**, no local child seller.

**✅ M1a (engine + API) — built & verified** (`src/buy/storefront.ts`, `src/buy/market-agent.ts`, refactored `src/web/server.ts`, hardened `src/node/sell.ts`). Two independent local processes: the web buyer discovered the seller over Hyperswarm (~3s), `/api/sellers` + `/api/select` (by id / "auto" = cheapest-then-fastest) work, and a divergent prompt **escalated → paid 0.01 USD₮ to the remote seller → seller verified on-chain → GRANTED → delegated 4B @ 60 tps → full answer** (buyer 999.66 → 999.65). No local child seller.
**Findings to address:** (1) **routing calibration drift** — with `reasoning_budget:0` the 0.6B is more self-consistent, so it escalates *less* (creative prompts now answer free; only genuinely divergent ones escalate) → re-tune threshold in M4. (2) **persistent-buyer rediscovery lag** — a long-lived buyer is slow to reconnect to a *restarted* seller (Hyperswarm re-announce) → add active re-discovery/health-check in M4. (3) hardened the seller against RPC-timeout crashes (it was dying on one flaky balance read).
**✅ M1b (marketplace UI) — built & verified.** `app/src/components/Marketplace.tsx` + `/api/sellers`/`/api/select` wiring in `App.tsx`/`Rail.tsx`/`api.ts`. The rail's "Peer GPU" card is now a **Marketplace panel**: online count, the active peer, an **Auto** row (cheapest-then-fastest) + a row per seller (model · price · tps · address · online dot); tap to pick/switch (verified — selecting a seller pins it with ✓). Model names prettified (e.g. `QWEN3_4B_INST_Q4_K_M` → "Qwen3 4B").


**Why first:** it's the foundation ("it's actually a market"), and it's independent of the wallet/packaging forks, so we can start now. Reuses the Phase-3 storefront.

**Tasks:**
- [ ] Extract the Phase-3 buyer storefront logic (`src/node/buy.ts`) into a reusable module `src/buy/storefront.ts` that **tracks a live set of sellers** (join topic → discover → keep a registry of offers → per-ask against the *active* seller: quote → nonce → identity-bound sign → pay → await grant → delegate).
- [ ] Refactor `src/web/server.ts`: **remove** `startProvider` local child; run the storefront client; maintain a **marketplace of discovered sellers** (each: pubkey, earnings address, **model** the seller chose, price, latency, online).
- [ ] **Marketplace API/UI:** `/api/sellers` lists discovered sellers; `/api/select {pubkey|"auto"}` sets the **active** seller; buyer can **pick / switch anytime** (pick-and-keep). "Auto" = cheapest-then-fastest. Persist the choice.
- [ ] `/api/ask` escalation uses the **active remote** seller: pay its advertised address (**per-inference** for M1) → seller verifies on-chain + nonce + identity-binding → grants → delegate the **seller's offered model**.
- [ ] Graceful states: **no sellers online** (answer locally only + "no peers" in UI), seller disconnect / reconnect, payment-unconfirmed fallback.
- [ ] Seller side: keep `npm run sell`; the seller's offered **model comes from the capability prober** (`bench-profile.json`); add a minimal seller status line (earnings, requests served, model).
- [ ] UI: a **Marketplace panel** (list of sellers: model · price · speed · online; tap to select) + the rail shows the **active** peer; "searching for peers…" state.

**Files:** `src/web/server.ts` (major), new `src/buy/storefront.ts`, reuse `src/core/protocol.ts` + `pricing.ts` + `src/sell/provider.ts`.

**Acceptance:** buyer web app on machine A; `npm run sell` on machine B. A hard question → A pays B's address on Sepolia → B's GPU answers over E2E → stamp shows B's peer; a freeloader is still refused at the Noise handshake (0 bytes). Dev pre-test: run the seller as a **separate local process** (not a child) to prove discover→pay→grant→delegate before involving the MacBook.

**Risks:** discovery latency / "no seller" UX; single-machine dev test shares `~/.qvac/.worker.lock` (harmless warning); connection lifecycle + reconnection.

**Size:** **L**

---

### M2 — Per-user in-app wallet ✅  *(M2a engine + M2b UI both done)*
**Goal:** replace the shared `.env` mnemonic with a wallet the user creates/imports + secures in-app. (See §1.)

**✅ M2a (engine) — built & verified.** `src/core/keystore.ts` (ethers' audited encrypted-keystore JSON — no custom crypto; mnemonic round-trips, address readable while locked, wrong-pw rejected). `src/core/config.ts` made the mnemonic optional + added Sepolia/USD₮ defaults (boots with no `.env`). `src/web/server.ts` refactored: router warms independently; **buyer + storefront built on unlock**; endpoints `/api/wallet` `/wallet/create` `/import` `/unlock` `/lock` `/export`; `/api/ask` + `/api/state` gated on unlock; **`.env` mnemonic auto-unlocks in dev only**. HTTP-verified: create→lock→unlock cycle, wrong-pw 401, locked `/api/ask` 401, free answer while unlocked. **Decisions locked:** password everywhere (OS-keychain "remember me" optional in Electron); `.env` = dev-only; one wallet per person serves both roles (seller earns into it). Password ≥ 8 chars.
**✅ M2b (wallet screens) — built & verified.** `app/src/components/WalletGate.tsx` (choose → create → 12-word backup / import / unlock, password ≥ 8) + `WalletMenu.tsx` (address + copy, faucet links, **password-gated** recovery-phrase reveal, lock); `App.tsx` gates the chat behind unlock (boot splash → gate → app); `Rail.tsx` "manage" opens the menu. Revealing the seed re-verifies the password by re-decrypting the keystore (`POST /api/wallet/export`). Engine escape hatch `CONDUIT_NO_ENV_WALLET=1` forces the real onboarding even in dev.

**Tasks:**
- [ ] `src/core/keystore.ts` — generate BIP-39 seed (WDK), encrypt at rest (web phase: password → scrypt/PBKDF2 + AES-GCM via a vetted lib; Electron: `safeStorage`/keychain). Never log/commit the seed.
- [ ] Onboarding UI (`app/`): **Create** (show seed → confirm backup) or **Import** (paste seed); **Unlock** (password) on subsequent runs; **Export seed** + **Logout**.
- [ ] Engine: `server.ts` loads the user's wallet from the keystore (not `.env`); `getAccount` uses it; seller likewise has its own earnings wallet.
- [ ] Funding UX: show address + QR, balance auto-refresh, **faucet links** (Pimlico/Candide) + "send testnet USD₮ here" copy; low-balance warning.
- [ ] New endpoints: `/api/wallet/{create,import,unlock,address,export,status}`.

**Acceptance:** a fresh user creates a wallet in-app, funds it from a faucet, asks a question, pays from **their** wallet; seed backup + re-unlock works; `.env` no longer required.

**Risks (highest of the project):** **key security** — use vetted crypto, never roll our own; correct encryption + password UX; safe storage location. This milestone gets extra care + review.

**Size:** **L**

---

### M3 — Electron packaging (one-click, no terminal) ◑  *(M3a + M3b built; M3c code-complete — all build-only, the packaging artifact + Linux GPU run are the coordinated smoke-test)*
**Goal:** a double-click desktop app; no Node/terminal needed.

> **Handoff:** see **`docs/M3-HANDOFF.md`** — M3 is built by the teammate on the MacBook (**build-only**: keep it compiling, push; all functional testing happens on the Linux GPU machine). The handoff doc is self-contained for a fresh Claude Code session.

**◑ M3a (Electron shell) — built (compiles; functional check pending on Linux GPU box).** New top-level `electron/`: `main.ts` (single-instance lock → pick a free port [honors `PORT`, else probes 8788+, falls back to ephemeral] → spawn the engine as a `detached` child in its own process group so the whole tree incl. the Bare worker is killable [gotcha #6] → poll `/api/wallet` until ready → open `BrowserWindow`; graceful shutdown = SIGTERM group → wait → SIGKILL; external links open in the system browser; `app.isPackaged` seam for the packaged spawn), `preload.ts` (`contextIsolation`-safe `window.conduit`), `electron/tsconfig.json` (→ CommonJS in `electron/dist/`). Dev runs the engine from source via `node --import tsx src/web/server.ts`. Root scripts: `electron:build`, `electron:dev`. `npm run web` unchanged.

**◑ M3b (product screens + seller mode) — built (compiles; functional check pending on Linux GPU box).** **Engine:** `src/web/seller.ts` (new) manages the proven `sell.ts` as a child — spawn/kill (detached group → kills the Bare-worker grandchild) + parses stdout for the live offer/`GRANTED` count + reads on-chain earnings delta; `sell.ts` one-line change to take the wallet from `CONDUIT_SELLER_MNEMONIC` (engine injects the unlocked wallet; earns into account #1); new endpoints `/api/seller/{status,start,stop,profile}`; shutdown stops the seller too. **UI:** `TopBar` (Buyer⇄Seller role toggle, persisted) · full-screen `MarketplaceScreen` landing (browse · ★bookmark · Auto · select→chat) · `SellerScreen` (offer → Go online/offline → requests/earnings) · `bookmarks.ts` (**keyed by wallet `address`, not `id`** — gotcha #9) · chat keeps the compact Rail + a back button. `App.tsx` orchestrates role/view + seller-status polling.

**◑ M3c (packaging) — code-complete; the artifact build + smoke-test are the coordinated run.** **Engine bundling:** `scripts/build-engine.mjs` (esbuild → `dist-engine/server.mjs` + `sell.mjs`, deps kept external) so the packaged app needs no `tsx`; `electron/main.ts` packaged branch spawns it with Electron's Node (`ELECTRON_RUN_AS_NODE=1`) and `src/web/seller.ts` spawns the compiled seller via `CONDUIT_SELLER_ENTRY`; the engine finds assets via `CONDUIT_RESOURCES`. **`electron-builder` config** (package.json `build`): mac `dmg` (unsigned, `identity:null`) + Linux `AppImage`/`deb`; `asar:false` (everything on disk so the Node child resolves native modules by walk-up — `asar`+`asarUnpack` is a later size optimization). **First-run model progress:** router emits `onProgress` → engine SSE `/api/model/progress` + `/api/state` snapshot → `ModelBanner` UI. **"Remember on this device":** Electron `safeStorage` (OS keychain) via preload `window.conduit.secret` + `WalletGate` checkbox + once-per-session auto-unlock; degrades to hidden in a plain browser. Scripts: `engine:build`, `dist`, `dist:dir`. **Not yet run here:** `electron-builder` artifact build + the on-hardware smoke-test (per handoff, that step needs a coordinated run; the mac dmg must be built on the Mac, Linux artifacts on Linux).

**✅ Linux verification (review pass on the GPU box):** all typechecks/builds pass. Found + fixed 2 packaging-config blockers — removed an invalid `_comment` key (electron-builder strict-validates and fatally errors on it) and set `directories.app: "."` (the `app/` Vite dir collided with electron-builder's default app-dir → it looked for `resources/app/index.js`); added `author` (required for the `.deb` maintainer field). After the fixes: `electron-builder --dir` assembles with the native `node_modules` (`bare-runtime`, `rocksdb-native`) included; the **packaged engine boots + loads both models + serves the API** under `ELECTRON_RUN_AS_NODE`; **`Conduit-0.0.0.AppImage` (1.6 GB) built**; and **`npm run electron:dev` launches → UI renders → seller goes online → clean user-closed shutdown (both QVAC Bare workers torn down — orphan-prevention confirmed live).** **Remaining:** rebuild the `.deb` (author now set); a **paid-inference E2E through the app** — ideally **Mac-seller ↔ Linux-buyer** to sidestep the one-machine `~/.qvac/.worker.lock`; the **macOS `.dmg` + QVAC-on-Apple-Silicon** (teammate, on the Mac); an app icon (default Electron icon today).

**Tasks:**
- [x] **M3a** `electron/` — `main.ts` spawns the engine as a child, waits for `ready` (polls `/api/wallet`), opens a `BrowserWindow`; `preload.ts`; single-instance lock; graceful engine shutdown (process-group kill fixes the orphaned-seller teardown).
- [x] **M3c** `electron-builder` config → Linux (AppImage/deb) + macOS (dmg); engine bundled via esbuild + spawned with Electron's Node; native modules resolved on disk (`asar:false`). *(Artifact build is the coordinated run.)*
- [x] **M3c** First-run model **download/warm progress** (router `onProgress` → SSE + `/api/state` → `ModelBanner`). Model cache stays in `~/.qvac` (fine for packaged apps).
- [x] **M3c** Wallet store → Electron `safeStorage`/keychain ("remember on this device" + auto-unlock).
- [x] **M3b** **Role toggle:** one app, switchable **Buyer ⇄ Seller** ("Ask & Pay" / "Share your GPU & Earn"). Seller mode = offer (from bench profile) → go online → earnings/status screen.
- [x] **M3b** **Buyer flow (Binance-P2P-style, §3.5):** Marketplace is the buyer's **landing screen** → pick a seller or "Auto" → enter **chat**; a back button returns to the marketplace.
- [x] **M3b** **Bookmarks/favorites:** ★ a seller → saved list persisted locally (**by wallet address**); live online/offline status; one-tap re-select. (Reputation overlay lands in M4.)
- [ ] Tray icon, app lifecycle, auto-update (optional). *(deferred — optional)*
- [x] macOS code-signing/notarization — **deferred** (unsigned dmg + Gatekeeper allow), per locked decision §6.4.

**Acceptance:** install the artifact on a clean machine with **no Node**, run, create wallet, ask, and pay a remote seller. *(Requires the coordinated packaging run + on-hardware test.)*

**Risks:** native-module packaging across OSes; macOS notarization; bundle size; download UX.

**Size:** **XL**

---

### M4 — Escrow payment channels + trust ◑  *(escrow M4e-1/2/3 ✅ done + live-verified · reputation/verifier next)*
**Goal:** instant paid answers via a **trustless** USD₮ payment channel, plus seller reputation + a verifier.

**Decision:** chose **trustless escrow** (a deployed contract) over the simpler trust-based prepaid. The contract only ever pays the seller what the buyer *signed*, and refunds the remainder after a timeout, so a vanished seller can neither cheat nor lock funds — and reputation can then be purely about *service quality*. (Escrow's real value is protecting real money = M5, but we're building it now as the "real payment channel" showcase.)

**✅ M4e-1 (contract + tests) — done, 11 tests green on the local EVM.** New `contracts/` Hardhat workspace. `ConduitEscrow.sol` — unidirectional channels: `open` (lock deposit, set expiry + epoch), `topUp`, `claim` (seller redeems a cumulative EIP-712 voucher; channel stays open), `settle` (final claim + close, refund remainder to buyer), `withdraw` (buyer reclaims remainder after expiry — vanished-seller protection). Security: OZ `SafeERC20` + `ReentrancyGuard` + checks-effects-interactions; vouchers scoped by `epoch` (replay), signer- and seller-bound, capped at the deposit. Tests cover open/claim/settle/withdraw/topUp + over-claim, wrong-signer, wrong-seller, monotonic re-claim, epoch-replay, before-expiry. `MockUSDT.sol` = local test fixture only (Sepolia uses the real test-USD₮). solc 0.8.28 / Cancun.

**Remaining:**
- ✅ **M4e-2 (deploy) — done.** `ConduitEscrow` live on Sepolia at **`0x741BbE3B2d19E1aE965467280Cc2a442F3632Ee7`**, pointing at the real test-USD₮ (`token()` readback = `0xd077…`, verified). Address recorded in `contracts/deployed.sepolia.json` (commit it — it's an address, not a secret). Deployer = dev wallet `0xE746…`. Full on-chain open/claim/withdraw exercises during M4e-3 integration (the contract logic is already proven by the 11 local tests).
- **M4e-3 (integrate) ◑ — client + protocol + on-chain lifecycle proven; agent/seller wiring next.**
  - ✅ `src/core/escrow.ts` — ethers client (open/topUp/claim/settle/withdraw + EIP-712 voucher sign/recover + channel reads). **Voucher digest verified to byte-match the live contract** (off-chain `TypedDataEncoder` == on-chain `voucherDigest` → claims won't revert).
  - ✅ `src/core/protocol.ts` — added session messages: `sessionOpen`/`sessionGrant` (channel-open → grant) + `draw`/`drawAck` (per-inference voucher). Per-inference msgs stay as the fallback.
  - ✅ **Full lifecycle proven on live Sepolia** (`npm run escrow-demo`, `src/scripts/escrow-demo.ts`): open 0.05 deposit → 3 off-chain vouchers (instant) → seller `claim` 0.03 → `settle`+close → buyer −0.03, seller +0.03, channel closed, balances conserve. Real txs. Confirmed ethers acct0/acct1 derivation == WDK addresses; **noted: the seller now needs ETH for gas to `claim` (acct1 has ~0.099 ETH)** — a new requirement vs per-inference (→ gasless is an M5 item).
  - ✅ **Wired into the running engine + verified live over P2P.** `storefront.ts` channel path (open channel once → sign+send a voucher per escalation; per-inference stays the fallback; generic pending-message map; `sessions()` accessor), `sell.ts` (`sessionOpen` → verify channel on-chain → `sessionGrant`; `draw` → verify voucher signer/increasing/≤deposit → `drawAck`+serve; background `claim` at a 0.05 threshold), `server.ts` (gated on `CONDUIT_ESCROW=1`, passes rpcUrl+deployment to the storefront, surfaces `escrow`+`sessions` in `/api/state`), UI session chip ("⚡ channel · X USD₮ left"). **Live E2E (escrow seller ↔ buyer engine on the GPU box):** ask 1 escalated → opened channel (deposit 0.05, buyer 999.61→999.56) → seller "channel verified → GRANTED" + "draw 10000 → served" @ 58 tps; **ask 2 settled OFF-CHAIN in 2s — balance UNCHANGED, voucher cumulative 0.01→0.02** (the instant-payments win). Gated behind `CONDUIT_ESCROW=1` so the proven per-inference path is the default (zero regression).
  - ⬜ Minor follow-ups: claim-on-shutdown/settle (deposit currently frees via `withdraw` after expiry), per-inference requestsServed count in channel mode, top-up/close buttons in the UI.
- **M4b (trust signals):**
  - ✅ **Seller reputation — done.** `src/core/reputation.ts` (first-party served/failed + EWMA tps, keyed by seller **wallet** (stable), persisted to `~/.conduit/reputation.json`, neutral 0.5 for new sellers). Storefront records served-on-success / failed-on-error around each purchase, exposes it on offers, and **"Auto" now ranks by reputation → price → speed**. Surfaced in `/api/sellers` + the marketplace cards (★ % · N served, colour-coded). Typechecks + builds.
  - ◑ **Verifier — built, opt-in, HONESTLY WEAK.** `RouterOptions.verify` (engine flag `CONDUIT_VERIFY=1`, **off by default**): on a confident local pick, runs a self-critique pass (model fact-checks its own draft, reasoning on) → a SHAKY verdict overrides to escalate. **Measured: it did NOT reliably catch the confident-wrong case** — a small model that's confident also self-critiques as SOLID, and the 0.6B's RSA answer is variable run-to-run (sometimes correct). Adds ~+4–6s latency to local answers when on. Kept off by default + documented experimental. **The real fix needs an *independent* verifier (stronger model / external knowledge), not same-model self-critique → deferred.**
  - ✅ **Seller model selection — done.** The prober still decides the **optimal** model (`topSellable`), but the seller screen now shows a **picker of every model their GPU benchmarked as runnable** (each with its tiered price · tps), with the prober's pick **badged "★ recommended" + pre-selected**. The seller can keep it or drop to a smaller/cheaper tier; **price follows the model** (`priceFor`). Flow: `/api/seller/profile` returns `recommended` + the priced runnable list → `SellerScreen` picker → `/api/seller/start {model}` → seller manager injects `CONDUIT_SELLER_MODEL` → `sell.ts` offers it (validated against the runnable set; un-runnable choices safely fall back to the recommended). Picker locks while online. Verified against the real profile (4B recommended; 1.7B/1B selectable at lower price; 8B correctly rejected as not-runnable). Typechecks + builds.
  - ⬜ Resilience (reconnect to restarted sellers, richer error states) — still open.

**Size:** **XL** (the escrow is the hardest single piece in the roadmap).

---

### M5 — Real money (parked) ⬜
Mainnet USD₮ / USD₮0 + **gasless EIP-3009** (so users need no ETH for gas — needs an EIP-3009-supporting token; the Pimlico Sepolia token lacks it) + security review + refunds/disputes + legal/compliance. **Explicitly not now.**

---

## 5. Cross-cutting concerns
- **Security:** wallet keys (M2), the pay-first trust risk (M4), no secrets in logs/commits, dependency hygiene.
- **Onboarding (first-run):** create wallet → fund (faucet) → (seller: benchmark + go online) → ask. Must be self-explanatory.
- **Observability:** keep the JSONL audit log + `cloud_bytes=0` proof; surface peer/latency in UI.
- **Heterogeneous hardware:** seller capability prober already self-sorts the sellable model per machine.
- **Docs/build-in-public:** owner-handled, not a build gate.

## 6. Decisions (resolved)
1. **App role model:** ✅ **One app**, Buyer/Seller toggle ("Ask & Pay" ⇄ "Share my GPU").
2. **Seller selection = a marketplace.** ✅ The buyer sees a live list of sellers (**model · price · speed** · later reputation) and **picks one — or "Auto" — and can switch anytime.** Pick-and-keep, *not* a per-question prompt.
3. **Payments:** ✅ **M1 uses simple per-inference settlement** (proven). Then a **prepaid balance** ("deposit, then pay-as-you-use") makes paid answers **instant** — the deposit *is* the session grant, so questions draw from it with no on-chain wait. **Deposit capped at 1–2 USD₮** for now to bound trust risk; refund the remainder on exit. (Built in M4.)
4. **macOS signing:** ✅ **Deferred.** Unsigned for now (right-click → Open on your own Mac); buy the $99/yr Apple Developer account + notarize only before a public release.
5. **Model tier:** ✅ The **seller chooses** which model(s) to offer (guided by the capability prober — what its hardware can run). **Weights live on the seller; the buyer downloads nothing big** (only the tiny free local model). The chosen model shows in the marketplace list.

## 7. Sequencing & what we are NOT doing
**Order:** M1 → M2 → M3 → M4. M5 parked.
**Not doing now:** mainnet / real funds; custodial wallets; per-payment external-wallet approval; a hosted backend (defeats the serverless thesis); reputation/escrow systems (M4+); mobile.

## 8. Definition of done (product v1)
A non-technical person installs the Conduit app on two machines, creates + funds a testnet wallet on each, flips one to "Share your GPU," and on the other asks questions — easy ones answered free on-device, hard ones paid (~0.01 USD₮) to the *other machine's* GPU over E2E P2P, with a freeloader provably refused and `0 bytes` to any cloud.
