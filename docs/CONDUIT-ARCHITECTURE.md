# CONDUIT — Architecture Diagrams (Mermaid)

> Companion to `CONDUIT-PLAN.md`. Every element is grounded in the verified v0.11.x QVAC + WDK docs. Markers: **[DOC]** = confirmed in docs · **[SPIKE]** = to be validated in Phase 0. Render in GitHub, VS Code (Mermaid extension), Obsidian, or https://mermaid.live.

**Legend — the three channels (this is the whole trick):**
- **Storefront channel** (our own `hyperswarm` topic) — discovery, quote, payment receipt, provider-pubkey handoff. Small JSON, *no prompt data*. (Built by us; not a QVAC primitive — delegation has no topic/discovery [DOC].)
- **Delegated-inference channel** (QVAC over Hyperswarm/Noise) — `prompt in / tokens out` only, E2E encrypted, runs on the seller's GPU [DOC].
- **Testnet RPC** (disclosed non-AI remote) — settlement tx only; *never* sees a prompt/model byte.

---

## 1. System architecture (component view)

```mermaid
flowchart LR
  subgraph BUYER["CONDUIT NODE — role BUY (any machine; demo M5 16GB)"]
    direction TB
    BA["Buyer Agent — tool loop<br/>completion(tools, captureThinking)"]
    CR["Confidence Router<br/>self-assess + self-consistency via embed()"]
    BLM["Local LLM Qwen3-0.6B / Llama-3.2-1B<br/>qvac completion()"]
    BDC["Delegated client<br/>loadModel(delegate) + completion(stream)"]
    BW["WDK Wallet EVM/ERC-4337<br/>sign / signTypedData / transfer"]
    BP["Capability Prober (conduit bench)"]
    BAUD["Audit Logger JSONL + Ledger TUI"]
    BA --> CR --> BLM
    BA --> BDC
    BA --> BW
    BDC -.-> BAUD
  end

  subgraph SELLER["CONDUIT NODE — role SELL (benched OK; demo RTX 4050)"]
    direction TB
    SP["Capability Prober (conduit bench)<br/>→ capability profile + pricing"]
    SS["Storefront — hyperswarm topic conduit:market:v1<br/>announce / quote / verify payment"]
    SPG["Provider-gate — lifecycle Mechanism A or A-prime"]
    SQP["Payment-gated QVAC Provider<br/>startQVACProvider(firewall allow [buyerKey])<br/>runs Qwen3-4B on GPU"]
    SSW["Settlement worker WDK<br/>verify + submit EIP-3009 + confirm"]
    SW["WDK Wallet EVM — receives USD₮"]
    SAUD["Audit Logger JSONL — loggingStream()"]
    SP --> SS --> SPG --> SQP
    SS --> SSW --> SW
    SQP -.-> SAUD
  end

  subgraph FREE["FREELOADER — separate keypair, never paid"]
    FL["loadModel(delegate providerPublicKey)"]
  end

  subgraph EXT["DISCLOSED NON-AI REMOTE"]
    RPC["EVM testnet RPC — Sepolia 11155111<br/>+ Pimlico/Candide USD₮ faucet"]
  end

  BA -.->|"Storefront: discover / quote / pay"| SS
  BDC ==>|"E2E delegated inference Noise/DHT — prompt in / tokens out"| SQP
  BW -->|"EIP-3009 transfer"| RPC
  SSW -->|"submit + confirm tx"| RPC
  FL -->|"dht.connect — no payment"| SQP
  SQP -.->|"HANDSHAKE REJECTED — 0 bytes served"| FL
```

*Both nodes are the **same `conduit` binary** with different role flags; the Capability Prober lets each machine decide what it can sell. The freeloader is a separate keypair/process, not a third machine.*

---

## 2. End-to-end happy path (the payment-is-the-grant flow)

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant BA as Buyer Agent
  participant LLM as Local LLM QVAC
  participant W as Buyer Wallet WDK
  participant SS as Seller Storefront
  participant PG as Provider-gate
  participant QP as QVAC Provider Seller GPU
  participant SW as Settlement WDK
  participant RPC as Testnet RPC
  participant AUD as Audit Log

  User->>BA: prompt
  BA->>LLM: completion(history, captureThinking)
  LLM-->>BA: draft + thinking
  BA->>LLM: re-sample k=3 + embed() consistency
  Note over BA: confidence LOW → escalate
  BA->>SS: discover_provider + get_quote
  SS-->>BA: quote {price, wallet, nonce, chainId, token}
  BA->>W: signTypedData EIP-3009 transferWithAuthorization
  W-->>BA: signed authorization (no tokens moved yet)
  BA->>SS: payment receipt = signed auth + identity-binding sig
  SS->>RPC: read-only verify payer has funds
  RPC-->>SS: funds OK
  SS->>PG: payment verified → open the door for buyerKey
  PG->>QP: startQVACProvider(firewall allow [buyerKey])
  QP-->>PG: provider publicKey
  PG-->>SS: provider publicKey
  SS-->>BA: provider publicKey
  BA->>QP: loadModel(delegate) → dht.connect Noise handshake
  Note over BA,QP: buyer pubkey in allow-list → GRANTED
  BA->>QP: completion(history, stream)
  QP-->>BA: token stream — E2E, runs on seller GPU
  Note over BA: read stats.timeToFirstToken / tokensPerSecond
  QP->>SW: inference complete → settle
  SW->>RPC: submit EIP-3009 authorization on-chain
  RPC-->>SW: tx confirmed (hash)
  BA-->>AUD: log inference + TTFT/TPS + cloud_bytes 0
  SW-->>AUD: log settlement tx
  BA-->>User: SoTA answer
```

*Settlement is **per completed inference** [locked]. The signed EIP-3009 authorization is a "signed intent, not a transfer" [DOC] — the seller only redeems it on-chain after serving.*

---

## 3. The freeloader rejection (the security beat)

```mermaid
sequenceDiagram
  autonumber
  participant FL as Freeloader
  participant QP as QVAC Provider
  participant LOG as loggingStream
  FL->>QP: dht.connect(providerPublicKey) — no payment
  Note over QP: firewall mode allow, publicKeys = [buyerKey]<br/>freeloader pubkey NOT in list
  QP--xFL: Noise handshake REJECTED — socket destroyed, no RPC mounted
  QP->>LOG: handshake_rejected, reason not_allow_listed, bytes_served 0
  Note over FL,QP: 0 prompt bytes parsed, 0 tokens served
```

*Refusal happens at the **transport/Noise layer** before any RPC is mounted [DOC]. [SPIKE #3] confirms we can observe the rejection cleanly via `loggingStream`.*

---

## 4. Confidence router decision (replaces the unavailable logprob signal)

```mermaid
flowchart TD
  A["User prompt"] --> B["Local draft — completion(captureThinking)"]
  B --> C["Compute signals"]
  C --> C1["self_confidence — structured output / Zod"]
  C --> C2["self-consistency k=3 via embed() cosine"]
  C --> C3["heuristics — hedging in thinking, output length"]
  C1 --> D{"confident? conf ≥ τ AND consistency ≥ c AND no flag"}
  C2 --> D
  C3 --> D
  D -->|"yes"| E["Return LOCAL answer<br/>cost 0 USD₮, 0 cloud bytes"]
  D -->|"no"| F["ESCALATE → discover → quote → pay → delegate"]
```

*`completion` does **not** expose logprobs [DOC], so we measure **answer stability** instead. [SPIKE #4] validates separation on ~20 prompts.*

---

## 5. Capability Prober (`conduit bench`) — how a node learns what it can sell

```mermaid
flowchart TD
  S["conduit bench start"] --> DET["Detect backend + memory<br/>stats.backendDevice, RAM/VRAM"]
  DET --> M1["loadModel Qwen3-1.7B → short completion"]
  M1 --> Q1{"loads AND tps ≥ bar?"}
  Q1 -->|"no"| FAIL["cannot sell — buyer-only node"]
  Q1 -->|"yes"| M2["loadModel Qwen3-4B → short completion"]
  M2 --> Q2{"loads AND tps ≥ bar?"}
  Q2 -->|"no"| O17["offer tier = 1.7B"]
  Q2 -->|"yes"| M3["loadModel 7B GGUF → short completion"]
  M3 --> Q3{"loads AND tps ≥ bar?"}
  Q3 -->|"no"| O4["offer tier = 4B — RTX 4050 / M5 16GB"]
  Q3 -->|"yes"| O7["offer tier = 7B — 24GB+ box"]
  O17 --> PROF["capability profile + pricing policy"]
  O4 --> PROF
  O7 --> PROF
  PROF --> ADV["advertise offer on storefront"]
```

*Real TTFT/TPS measured here and at serve-time land in the **same JSONL** → one-run artifact consistency.*

---

## 6. Payment → grant: the provider-lifecycle mechanism ([SPIKE #1] picks the branch)

```mermaid
flowchart TD
  PV["Payment verified for buyerKey"] --> SPIKE{"Spike #1 result"}
  SPIKE -->|"fresh-process firewall works — PREFERRED"| MA["Mechanism A<br/>spawn child process<br/>startQVACProvider(firewall [buyerKey])<br/>return pubkey; teardown after session"]
  SPIKE -->|"only static-at-boot reliable"| MAP["Mechanism A-prime<br/>long-lived provider firewall [buyerKey]<br/>reveal secret provider pubkey on payment"]
  SPIKE -->|"firewall cannot gate at all — unexpected"| FB["Fallback — app-layer gate<br/>provider open at transport<br/>refuses completion without verified receipt"]
  MA --> GRANT["Buyer dht.connect → GRANTED, freeloader refused at Noise"]
  MAP --> GRANT
  FB --> GRANT2["Buyer served only after receipt check<br/>beat reframed: 0 tokens (not 0 bytes)"]
```

*Why this exists: the QVAC firewall is **static at `startQVACProvider`** and the call is **idempotent** — there is **no runtime allow-list mutation** [DOC]. So we make payment *precede* the provider that admits the buyer, instead of hot-editing a running allow-list.*

---

## 7. Session lifecycle (state machine)

```mermaid
stateDiagram-v2
  [*] --> Advertising
  Advertising --> QuoteIssued: buyer get_quote (nonce reserved)
  QuoteIssued --> PaymentVerified: signed EIP-3009 verified (sig + funds)
  QuoteIssued --> Advertising: quote expires (nonce released)
  PaymentVerified --> ProviderLive: provider started, firewall=[buyerKey]
  ProviderLive --> Serving: dht.connect GRANTED + completion(stream)
  Serving --> Settled: inference complete → EIP-3009 submitted → tx confirmed
  Serving --> ProviderLive: mid-stream drop → buyer re-issues (no auto-reconnect)
  Settled --> [*]
  QuoteIssued --> Rejected: freeloader / no payment / bad signature
  Rejected --> [*]
```

*`ProviderLive → Serving` is where the handshake is granted; `Rejected` is the freeloader path. "No auto-reconnect" and "provider restart breaks open connections" are documented v1 limitations [DOC].*

---

## 8. The Continuity layer (ETHOnline 2026)

The market above works, and settles, and refuses freeloaders. What it could not do was
help a buyer who had never met a seller before — a stranger scored a flat 0.5, so "Auto"
quietly degraded into price-then-speed. The obvious fix, counting settlements per address,
is worthless on its own: addresses are free, so a seller can be its own thousand happy
customers.

Three integrations close three different halves of that problem, and none of them is
sufficient alone.

```mermaid
flowchart TB
  subgraph GAP["THE GAP IN THE ORIGINAL MARKET"]
    direction LR
    G1["A buyer meeting a seller for the first time<br/>has no evidence about them — every<br/>stranger scores a flat 0.5"]
    G2["Reputation built from addresses is free<br/>to forge — one actor can be a thousand<br/>satisfied customers"]
    G3["A seller earns one asset and pays gas<br/>in another, so revenue does not cover costs"]
  end

  subgraph ARC["ARC — settlement"]
    direction TB
    A1["ConduitEscrow payment channel<br/>0xdC48E5e5…632C2 · chain 5042002"]
    A2["open → EIP-712 vouchers off-chain → settle<br/>one on-chain write per session, not per answer"]
    A3["USDC is BOTH the gas token and the<br/>settlement token — one balance, one asset"]
    A1 --> A2 --> A3
  end

  subgraph GRAPH["THE GRAPH — reputation"]
    direction TB
    R1["Subgraph indexes every channel the<br/>escrow has ever opened, settled or withdrawn"]
    R2["Settled / Withdrawn / Renewal / Probe<br/>classified, not merely counted"]
    R3["A first-time buyer reads how a seller<br/>treated EVERYONE, before paying anything"]
    R1 --> R2 --> R3
  end

  subgraph WORLD["WORLD — personhood"]
    direction TB
    W1["AgentBook on World Chain<br/>0xA23aB271…944dA"]
    W2["wallet → anonymous humanId<br/>many wallets, one person"]
    W3["Sellers may require a verified human;<br/>breadth counts PEOPLE, not keypairs"]
    W1 --> W2 --> W3
  end

  G3 ==>|"closed by"| ARC
  G1 ==>|"closed by"| GRAPH
  G2 ==>|"closed by"| WORLD

  ARC -->|"emits the events"| GRAPH
  WORLD -->|"makes the record<br/>expensive to forge"| GRAPH
  GRAPH ==>|"score a seller a buyer has never met"| PICK["Auto picks a seller<br/>reputation → price → speed"]
  PICK ==> PAY["Answer bought, channel drawn,<br/>receipt shown in USDC"]
  ARC ==> PAY
```

*Arc is where value actually moves, and its one-asset model (USDC is both gas and
settlement) is what lets a seller's revenue cover a seller's costs. The Graph turns the
escrow's event log into a record a stranger can read before paying. World is what makes
that record expensive to forge — without it, the reputation layer would be a
sybil amplifier rather than a defence.*

---

### Diagram → plan-section map
| Diagram | Plan section |
|---|---|
| 1 System architecture | §3.1 |
| 2 Happy path | §2.1 + §2.2 + §3.3 |
| 3 Freeloader rejection | §2.3 + §5 |
| 4 Confidence router | §3.2 |
| 5 Capability Prober | §3.0 |
| 6 Payment→grant mechanism | §4.1 |
| 7 Session lifecycle | §2 + §4.4 |
| 8 Continuity layer (Arc / Graph / World) | ETHOnline 2026 |
