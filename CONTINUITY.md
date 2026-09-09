# Continuity Disclosure — ETHOnline 2026

> **Read this first if you are judging this project.** It tells you exactly which
> lines of this repository are hackathon work and which are not, and it gives you a
> one-line command to see the boundary for yourself.

Conduit is entered in ETHOnline 2026 under the **Continuity Track**. Continuity
judging assesses **only work done during the event**. Everything that existed before
the event is disclosed below and is **not** submitted as hackathon work.

---

## The boundary, in one command

```bash
git diff pre-ethonline..HEAD --stat
```

That diff — and nothing outside it — is the ETHOnline 2026 submission.

| | |
|---|---|
| Pre-existing state, tagged | `pre-ethonline` → commit `d4b7740` |
| Boundary commit timestamp | 2026-07-23T12:34:05+05:30 |
| First hackathon commit | 2026-09-09T12:55:36+05:30 |
| Hackathon branch | `ethonline-2026` |

---

## Pre-existing work — NOT submitted

Conduit was built between **2026-06-01** and **2026-07-23** for **QVAC Hackathon I**
("Unleash Edge AI", DoraHacks, June 1–21 2026). **31 commits**, Apache-2.0, tag
`v0.1.0`. First commit `b88fac1`, 2026-06-01T22:40:09+05:30.

Everything at the `pre-ethonline` tag is **pre-existing** and scores zero here:

| Area | Files |
|---|---|
| P2P transport (Hyperswarm / HyperDHT) | `src/buy/storefront.ts`, `src/node/sell.ts` |
| On-device inference (`@qvac/sdk`) | `src/sell/provider.ts`, `src/buy/router.ts` |
| Confidence router (k-sample self-consistency) | `src/buy/router.ts` |
| Payment channels + Sepolia deployment | `contracts/contracts/ConduitEscrow.sol`, `src/core/escrow.ts` |
| EIP-712 voucher rail | `src/core/escrow.ts` |
| Wire protocol | `src/core/protocol.ts` |
| Local first-party reputation | `src/core/reputation.ts` |
| Wallet + encrypted keystore | `src/core/wallet.ts`, `src/core/keystore.ts` |
| React web app + engine API (:8788) | `app/src/**`, `src/web/server.ts` |
| Electron desktop packaging | `electron/` |
| Audit log | `src/core/audit.ts` |
| Architecture diagrams + docs | `docs/`, `README.md` |

`contracts/contracts/ConduitEscrow.sol` is **deliberately unmodified** during this
event. Its Sepolia settlement history is the data the new work reads.

---

## Work done during ETHOnline 2026

*(This section is filled in as the work lands. It is kept current, not written
retroactively.)*

**Thesis of the new work:**

> On-chain settlement history is only a trustworthy reputation signal if the
> identities producing it are scarce. **World** makes identities scarce. **The Graph**
> makes the history readable. **Arc** makes producing it cheap enough to be worth
> doing.

| Sponsor | New work | Status |
|---|---|---|
| The Graph | `subgraph/` — indexes `ConduitEscrow` settlement history | ⬜ not started |
| The Graph | `src/core/graph-reputation.ts` — global seller reputation | ⬜ not started |
| The Graph | Blended local+global scoring in seller selection | ⬜ not started |
| World | `src/core/humanity.ts` — AgentKit verification + AgentBook | ⬜ not started |
| World | Human-proof gate in the `sessionOpen` reject ladder | ⬜ not started |
| World | `FEEDBACK.md` | ⬜ not started |
| Arc | `src/core/networks.ts` — network profiles | ⬜ not started |
| Arc | `ConduitEscrow` deployed to Arc testnet | ⬜ not started |
| All | Sybil-griefing PoC + hardened qualification rules | ⬜ not started |

---

## Prior recognition

Conduit was **submitted** to QVAC Hackathon I (June 2026).

---

*Maintained continuously during the event. If this file and `git log` disagree,
`git log` is correct — tell us and we will fix this file.*
