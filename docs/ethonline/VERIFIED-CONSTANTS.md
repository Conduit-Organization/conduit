# Verified constants — ETHOnline 2026

Every external constant this project depends on, with **how it was verified** and
**when**.

Arc's network parameters and World AgentKit's call surface were treated as unknown until
they were read from a primary source. This file is where they were filled in — from
vendor source, vendor docs, and direct chain reads — so that no chain ID, contract
address, RPC URL or SDK signature in this project rests on assumption.

**Verification date: 2026-09-09.** Re-check before relying on any of it.

Verification levels used below:

| Level | Meaning |
|---|---|
| **CHAIN** | Read directly off the chain with an `eth_call` / `eth_chainId`. Strongest. |
| **SOURCE** | Read from the vendor's published source code or canonical machine-readable registry. |
| **DOCS** | Read from the vendor's live documentation. |

---

## 1. Conduit — Ethereum Sepolia (pre-existing, unchanged)

Source: `contracts/deployed.sepolia.json`, in-repo since June 2026.

| Constant | Value | Level |
|---|---|---|
| chainId | `11155111` | SOURCE |
| ConduitEscrow | `0x741BbE3B2d19E1aE965467280Cc2a442F3632Ee7` | SOURCE |
| Test USD₮ (ERC-20, 6 dec) | `0xd077A400968890Eacc75cdc901F0356c943e4fDb` | SOURCE |
| deployedBy | `0xE74686Fd89ACB480B3903724C367395d86ED4519` | SOURCE |
| default RPC | `https://ethereum-sepolia-rpc.publicnode.com` | SOURCE (`src/core/config.ts`) |

`contracts/contracts/ConduitEscrow.sol` is **not modified** during this event. Its
Sepolia settlement history is the data the new reputation work reads.

### Deployment and real event history — verified 2026-09-09

| Fact | Value | Level |
|---|---|---|
| deploy block | **`11014017`** | **CHAIN** (Blockscout `getcontractcreation`) |
| deployed at | 2026-06-08T07:44:48Z | **CHAIN** |
| creation tx | `0x075960a2bd16991e5d70b273cfdb8e7d52573334e70ef8d8a715c0be621e88b8` | **CHAIN** |
| creator | `0xE74686Fd89ACB480B3903724C367395d86ED4519` — matches `deployedBy` | **CHAIN** |

`11014017` is the subgraph `startBlock`. The deploy date sits inside the original
June–July build window, as expected.

**Complete event history (10 events, 3 sellers):**

| Event | Count |
|---|---|
| `ChannelOpened` | 6 |
| `Withdrawn` | 2 |
| `Settled` | 1 |
| `Claimed` | 1 |

> ⚠️ **Do not derive a `startBlock` by binary-searching `eth_getCode`.** The default
> public Sepolia RPC is not an archive node: it errors on historical state, which a
> naive search reads as "no code" and drives the answer ~640k blocks too high. Use the
> explorer's contract-creation endpoint.

### The finding that reshaped the qualification rules

**Both `Withdrawn` events ConduitEscrow has ever emitted are session renewals, not
abandonment.** Each is followed **24 seconds later** by the *same* buyer reopening with
the *same* seller at the next epoch:

| Withdrawn | Reopened | Gap | Epoch |
|---|---|---|---|
| block `11102985` (2026-06-20T17:40:12Z) | block `11102987` (17:40:36Z) | 24s | 1 → 2 |
| block `11109678` (2026-06-21T16:01:24Z) | block `11109680` (16:01:48Z) | 24s | 2 → 3 |

That is `src/buy/storefront.ts:244-253` behaving exactly as documented — an expired
channel cannot be reopened over, so the client reclaims the remainder and opens a fresh
one. **100% of our real adverse-signal history is a loyal returning customer.**

A naive `settled / (settled + withdrawn)` counter scores seller
`0x315f556c9d9b88892f6ea71efea0aacde4fa5e12` at **0.0** — the worst value the scale can
produce — for the crime of retaining a repeat customer. This is a stronger argument than
the sybil PoC because it is **not hypothetical**: it is already on-chain, it is our own
client's normal behaviour, and a judge can check it on Etherscan in under a minute.

Hence `QUALIFICATION.MAX_RENEWAL_GAP_SECS` — a fifth rule the build spec did not
anticipate. See `src/core/qualification.ts`.

---

## 2. Arc testnet (Circle)

Triple-verified: vendor docs, Circle's own published skill, viem's chain definition —
then confirmed against the live chain.

| Constant | Value | Level |
|---|---|---|
| network name | Arc Testnet | DOCS |
| chainId | `5042002` (hex `0x4cef52`) | **CHAIN** — `eth_chainId` → `0x4cef52` |
| RPC | `https://rpc.testnet.arc.network` | **CHAIN** — responded, head block `0x3a5e36c` |
| WebSocket | `wss://rpc.testnet.arc.network` | SOURCE (viem) |
| explorer | `https://testnet.arcscan.app` | SOURCE (viem) |
| faucet | `https://faucet.circle.com` | DOCS |
| gas token | **USDC (native)** — 18 decimals in native view | SOURCE (viem `nativeCurrency`) |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` | **CHAIN** |
| USDC `decimals()` | **`6`** | **CHAIN** — `eth_call 0x313ce567` → `…06` |
| USDC `symbol()` | `"USDC"` | **CHAIN** — `eth_call 0x95d89b41` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | SOURCE (viem) |

**Why this matters for Conduit:** the ERC-20 view of Arc's USDC reports **6 decimals**,
identical to the Sepolia test USD₮ the app already uses. `ConduitEscrow` takes an
`IERC20` and the app's `DEC = 6` assumption holds unchanged. **Arc is a config profile,
not a decimals refactor.**

> ⚠️ The native gas view uses **18** decimals while the ERC-20 view uses **6**. Escrow
> deposits, vouchers, claims and prices all go through the **ERC-20** path, so they are
> 6-decimal throughout. Only gas accounting sees 18.

Sources:
- <https://docs.arc.io/arc/references/contract-addresses>
- <https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md>
- <https://github.com/wevm/viem/blob/main/src/chains/definitions/arcTestnet.ts>

### Arc mainnet — NOT LIVE as of 2026-09-09

| Constant | Value | Level |
|---|---|---|
| chainId | `5042` | SOURCE |
| RPC | `http://rpc.arc.io/` | SOURCE |
| status | **not live** | **CHAIN** — no response to `eth_chainId` on http or https |

Corroborated by two independent vendor sources:

- Circle: *"Arc is currently in testnet. All addresses and configuration apply to
  testnet only."* and *"Mainnet addresses are not yet available."*
- World, in `@worldcoin/agentkit-core`'s own source: *"Arc mainnet (chain id 5042) is
  not live yet. Its public RPC is wired up ahead of launch…"*

**Consequence for the Arc prize.** The prize text requires projects be *"deployed **or
deployment-ready** on Arc mainnet by September 30."* Since Arc mainnet does not yet
exist publicly, **deployment-ready is the only achievable state, and the prize text
explicitly allows it.** Our position is stated honestly in the README rather than
implied.

---

## 3. World — AgentKit / AgentBook

Package **`@worldcoin/agentkit-core`**, version **`0.2.1`**, MIT, published
2026-08-24. Verified against the npm registry and the published source.

Dependencies: `viem ^2.46.2`, `zod ^3.24.2`, `@scure/base ^1.2.6`,
`@noble/curves ^1.9.1`.

### AgentBook deployments

| Chain | Address | Level |
|---|---|---|
| Base (`eip155:8453`) | `0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4` | **CHAIN** — contract code present |
| Base Sepolia | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` | SOURCE |
| **World Chain (`eip155:480`)** | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` | **CHAIN** — contract code present |

Source: `cli/REGISTRATION.md` in `worldcoin/agentkit`, and the hardcoded
`AGENT_BOOK_ADDRESS` in `core/src/agent-book.ts`.

### The primitive we actually use

```solidity
function lookupHuman(address) view returns (uint256)
```

Selector `0x451a02f4`. Returns `0` when the address is not registered; otherwise an
**anonymous human identifier** derived from World ID. Verified live on World Chain.

```ts
// @worldcoin/agentkit-core — verified signature
export function createAgentBookVerifier(options?: {
  client?: PublicClient
  contractAddress?: `0x${string}`
  rpcUrl?: string
}): { lookupHuman(address: string): Promise<string | null> }
```

> *"Always resolves against the AgentBook deployment on World Chain, regardless of
> which chain the agent's signature was produced on."*

**Two properties that shape our design:**

1. **It is a plain `view` call.** Verification needs no HTTP server, no x402, no API
   key and no sandbox — which is what makes it embeddable in Conduit's Hyperswarm
   `sessionOpen` ladder rather than bolted on as a web login.
2. **It returns a stable *human* id, not a boolean.** N wallets backed by the same
   human collapse to **one** identifier. That lets a seller count unique *humans*
   rather than unique *addresses* — which is exactly the scarcity the hardened
   reputation rules need.

> ⚠️ **`lookupHuman(0x0000…0000)` returns a NON-ZERO value on World Chain**
> (verified 2026-09-09). The zero address must be rejected explicitly before the
> AgentBook lookup, or it would read as human-backed.

### Other verified exports of `@worldcoin/agentkit-core`

```ts
validateAgentkitMessage(message, expectedResourceUri, { maxAge?, checkNonce? })
  → Promise<{ valid: boolean; error?: string }>        // default maxAge 5 min
verifyAgentkitSignature(payload, options?)
  → Promise<{ valid: boolean; address?: string; error?: string }>
formatSIWEMessage(info, address) → string              // viem createSiweMessage
parseAgentkitHeader, buildAgentkitSchema, AgentkitPayloadSchema (zod)
```

`AgentkitPayload` is a **SIWE-shaped signed message**: `domain, address, statement?,
uri, version, chainId (CAIP-2), type ('eip191'|'eip1271'|'ed25519'), nonce, issuedAt,
expirationTime?, notBefore?, requestId?, resources?, signature`.

`validateAgentkitMessage` enforces `payload.domain === new URL(expectedResourceUri).hostname`
and a matching URI host — so the seller must present a stable resource URI.

### Registration (buyer side) — requires World App

`npx @worldcoin/agentkit-cli register <address>` → nonce lookup → World App QR
verification → on-chain `register(address agent, uint256 root, uint256 nonce,
uint256 nullifierHash, uint256[8] proof)`. Gasless via a hosted relay on Base by
default. Networks supported by the CLI: `base`, `base-sepolia`.

### World ID Sandbox App — gated, request required

Confirmed a real, approval-gated resource — and a **stated qualification bullet** of
the AgentKit Continuity prize (*"Uses the World ID Sandbox App to test the project
remotely"*).

- Request at <https://developer.world.org> → **World ID Sandbox** in the sidebar.
  Enrollment is tied to a **team**, so open the panel from inside a team.
- **iOS:** TestFlight, *"gated behind an enrollment request… Wait for approval."*
- **Android:** private Google Play testing track — request tester access with the
  exact Google account used by both the browser and the Play Store.
- Integration side: update IDKit, set `environment: sandbox`, verify proofs against
  `https://developer.world.org/api/v4/verify/${rp_id}`.
- Rejected or revoked? <mailto:sandbox.access@toolsforhumanity.org>

**No published SLA.** This is the one genuinely externally-paced dependency in the
project. Request both platforms in parallel.

Source: <https://docs.world.org/world-id/sandbox/sandbox-access>

---

## 4. The Graph

From The Graph's canonical machine-readable networks registry (`v0.7.119`),
`graphprotocol/networks-registry` → `public/TheGraphNetworksRegistry.json`.

| Network slug | Full name | CAIP-2 | Subgraphs endpoint | Level |
|---|---|---|---|---|
| `sepolia` | Ethereum Sepolia Testnet | `eip155:11155111` | `https://api.studio.thegraph.com/deploy` | SOURCE |
| `arc-testnet` | Arc Testnet | `eip155:5042002` | `https://api.studio.thegraph.com/deploy` | SOURCE |
| `arc` | Arc Mainnet | `eip155:5042` | `https://api.studio.thegraph.com/deploy` | SOURCE |

**Both of Conduit's settlement networks are Subgraph Studio networks.** The spec's
risk R2 (*"The Graph may not support Arc"*) does not apply — Arc Testnet is a
first-class supported network, so the same subgraph can be deployed against both
deployments and the cross-leg claim is literal rather than aspirational.

Note `sepolia` has **no** Substreams/SPS provider listed, and `arc-testnet` has only
the subgraphs service — so the plan correctly skips the Substreams challenge.

Toolchain: `npm install -g @graphprotocol/graph-cli@latest`, then
`graph init` → `graph codegen && graph build` → `graph auth <DEPLOY_KEY>` →
`graph deploy <SUBGRAPH_SLUG>`. Deploy key comes from the Studio subgraph page.

---

## 5. ETHGlobal event facts

| Fact | Value | Level |
|---|---|---|
| Submission deadline | **Sunday 2026-09-13, 12:00 PM EDT** | DOCS |
| Demo video | **2–4 minutes.** *"Videos under 2 minutes or over 4 minutes will be automatically rejected during upload."* | DOCS |
| Continuity disclosure | *"Continuity submissions must clearly document pre-existing work and include new features or functionality developed during the hackathon."* | DOCS |
| Arc mainnet bullet | *"Projects must be deployed or deployment-ready on Arc mainnet by September 30."* | DOCS |
| World bullet | *"Uses the World ID Sandbox App to test the project remotely."* | DOCS |

> ⚠️ The **2-minute minimum** on the demo video is a hard automatic rejection and was
> not in the build spec. Budget for 2:00–4:00, not "under 4:00".

Sources: <https://ethglobal.com/events/ethonline2026/info/details>,
<https://ethglobal.com/events/ethonline2026/prizes>

---

## 6. Corrections to the build spec

Recorded because the spec asked to be told when reality disagreed with it.

| # | Spec said | Reality | Impact |
|---|---|---|---|
| 1 | Arc params unknown, "do not guess a chain ID" | chainId `5042002`, USDC `0x3600…0000` at **6 decimals** | Fits Conduit's existing 6-dec assumption exactly |
| 2 | Risk R2: The Graph may not support Arc | **`arc-testnet` is a supported Subgraph Studio network** | R2 retired; both networks indexable |
| 3 | Arc row 2 commits us to mainnet by Sept 30 | **Arc mainnet is not live**; prize text allows *"deployment-ready"* | Lower risk than assessed; must be stated honestly |
| 4 | AgentKit surface unknown; `HumanProof` shape TBD | `agentkit-core` is x402-oriented, **but `lookupHuman` is a plain `view` call** | Verification needs no sandbox/API key — fits the P2P ladder natively |
| 5 | AgentBook: Base `0xE1D1…61a4`, "Base Sepolia / World Chain" `0xA23a…44dA` | **Both confirmed.** Same address on Base Sepolia and World Chain; lookups always resolve on World Chain | Spec was right |
| 6 | Video is a hard 4:00 cap | Also a hard **2:00 minimum** | New constraint |
| 7 | Calendar labels Day 0 as "Wednesday Sep 10" | **Sep 9 is the Wednesday**; Sep 13 is the Sunday | Day 0 is 2026-09-09; one more day than the labels imply |
| 8 | World gate = "is this a verified human" (boolean) | `lookupHuman` returns a **stable anonymous human id** | Enables counting unique *humans*, not just verified wallets — strictly stronger |
| 9 | §2.5.5 lists four qualification rules | A **fifth is required**: both real `Withdrawn` events on Sepolia are 24-second session renewals by a returning customer, not abandonment | Without it the naive counter scores a seller 0.0 for customer loyalty — a real, already-on-chain failure, not a hypothetical attack |
