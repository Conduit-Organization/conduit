# Conduit — Architecture Diagrams

Each diagram is stored as **three separate files**:
- `NN-name.mmd` — canonical Mermaid source (edit this, then re-render)
- `NN-name.svg` — **vector render: zoom-proof, no blur at any zoom level** ← use these for slides/docs
- `NN-name.png` — high-resolution raster (3× device scale), for tools that only accept images

> SVG is the format that never blurs when you zoom (it's math, not pixels). Open an `.svg` in any browser, VS Code, Figma, or drop it into a slide and scale it to wall-size — still crisp.

| # | File (base name) | What it shows | Plan § |
|---|---|---|---|
| 01 | `01-system-architecture` | Component view: symmetric Buyer/Seller nodes, the 3 channels (storefront / E2E delegation / testnet RPC), freeloader | §3.1 |
| 02 | `02-happy-path-sequence` | Full flow: ask → local draft → confidence → quote → EIP-3009 pay → verify → gated provider → delegated inference → settle | §2.1–2.2, §3.3 |
| 03 | `03-freeloader-rejection` | The security beat: unpaid peer refused at the Noise handshake, 0 bytes, logged via `loggingStream` | §2.3, §5 |
| 04 | `04-confidence-router` | Escalation decision (self-assessment + self-consistency, since logprobs aren't exposed) | §3.2 |
| 05 | `05-capability-prober` | `conduit bench`: how a node self-benchmarks a model ladder and decides what it can sell | §3.0 |
| 06 | `06-payment-grant-mechanism` | Payment→grant lifecycle: Mechanism A vs A′ vs app-layer fallback, chosen by Spike #1 | §4.1 |
| 07 | `07-session-lifecycle` | State machine: Advertising → QuoteIssued → PaymentVerified → ProviderLive → Serving → Settled (+ Rejected) | §2, §4.4 |

## View
Open any `.svg` in a browser or VS Code (no extension needed for SVG). For the `.mmd` source with live preview, use the VS Code "Mermaid" extension, Obsidian, or https://mermaid.live.

## Re-render (after editing a `.mmd`)
```bash
bash render.sh          # re-renders every .mmd → .svg + .png
```
Requires Node.js. Uses `@mermaid-js/mermaid-cli` via `npx` (downloads a headless browser on first run). Config: `puppeteer.json` (sandbox flags) + `mermaid-config.json` (theme).
