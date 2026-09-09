# Conduit settlement-history subgraph

Indexes `ConduitEscrow` so a buyer's client can read a seller's **global** settlement
record before choosing who to buy from. New work for ETHOnline 2026.

Conduit's existing reputation (`src/core/reputation.ts`) is first-party only — it answers
*"how has this seller treated me?"* and returns `0.5` for every seller the buyer has never
met. This answers *"how has this seller treated everyone?"*.

## What it deliberately does not count

A naive `settled / (settled + withdrawn)` tally is wrong twice over:

1. **`Withdrawn` is forgeable for gas.** `open()` bounds only `amount > 0` and
   `duration > 0`, so anyone can open a 1-second channel against any address for one base
   unit and withdraw it in the next block, deposit returned in full. Measured at
   **212,331 gas per forged identity** in `contracts/test/sybil-grief.test.ts`. Five of
   them take an honest seller from 100% to 16.7%.
2. **In Conduit's real history, `Withdrawn` usually means renewal.** Both `Withdrawn`
   events ConduitEscrow has ever emitted on Sepolia are followed **24 seconds later** by
   the same buyer reopening with the same seller — `src/buy/storefront.ts:244-253`
   reclaiming an expired channel. A naive counter scores that seller **0.0** for having a
   loyal repeat customer.

So withdrawals are classified, not counted:

| Bucket | Meaning |
|---|---|
| `qualifiedWithdrawn` | Passed every on-chain rule — a real adverse signal |
| `probeChannels` | Too short, too small, or by a buyer with no settlement history |
| `renewals` | The buyer reopened with the same seller inside the renewal window |
| `withdrawnTotal` | All of them, published so the filtering is auditable |

Nothing is hidden — disqualified withdrawals stay queryable with their
`disqualificationReasons`. Thresholds live in `src/core/qualification.ts` and are
mirrored here in `src/qualification.ts`; `src/core/qualification-mirror.test.ts` fails the
build if the two ever drift.

**The identity rule is not here.** "Is this buyer a World-verified unique human" needs
AgentBook on World Chain, and a subgraph cannot read another chain. That rule is layered
on client-side in `src/core/graph-reputation.ts`, over the candidate set this narrows.
The mapping never claims to have checked it.

## Networks

Both of Conduit's settlement networks are Subgraph Studio networks (verified against The
Graph's canonical networks registry v0.7.119):

| Network | slug | CAIP-2 | Escrow |
|---|---|---|---|
| Ethereum Sepolia | `sepolia` | `eip155:11155111` | `0x741BbE3B2d19E1aE965467280Cc2a442F3632Ee7` @ block `11014017` |
| Arc Testnet | `arc-testnet` | `eip155:5042002` | added to `networks.json` once deployed |

## Build and deploy

```bash
npm install
npm run codegen
npm run build

# Deploy key from https://thegraph.com/studio → your subgraph page
npm run auth -- <DEPLOY_KEY>
npm run deploy:sepolia
```

`npm run codegen` and `npm run build` need no credentials and are the fastest way to check
this compiles.
