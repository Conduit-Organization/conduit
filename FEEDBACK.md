# World AgentKit — Integration Feedback (ETHOnline 2026)

Written during the integration, not afterwards, so the friction is recorded while it is
still fresh. Where something went badly it says so, with file and line references, because
a glowing writeup is not useful to the team that has to fix things.

**What we built with it:** a human-proof gate inside a peer-to-peer session grant.
Conduit is a serverless marketplace for AI inference — a buyer's agent pays a seller's
GPU over an end-to-end-encrypted Hyperswarm link. The seller's admission ladder
(`src/node/sell.ts`) had six checks, all economic, and none of them asked who the buyer
was. AgentKit is now the seventh. Our integration is `src/core/humanity.ts`, exercised
live by `npm run humanity-check`.

**Versions:** `@worldcoin/agentkit-core@0.2.1`, `@worldcoin/agentkit-cli`, docs as of
2026-09-09.

---

## 1. AgentKit docs and integration flow

**The single most valuable thing, and it is undersold.** Nearly all the documentation
frames AgentKit as an x402 extension: `createAgentkitClient`, `agentkit.fetch()`,
resource servers, facilitators, 402 responses. We are not an HTTP service. We are two
peers on a DHT with no server anywhere, and on a first read of
`docs.world.org/agents/agent-kit/integrate` we concluded AgentKit simply did not fit our
architecture.

It fits perfectly. `AgentBook.lookupHuman(address) → uint256` is a plain `view` call, and
`@worldcoin/agentkit-core` exposes it standalone via `createAgentBookVerifier()`. No HTTP
server, no facilitator, no API key, no sandbox needed to *verify*. That is what let us put
the check inside a P2P session grant as a genuine peer of the economic checks instead of
bolting a login onto a UI.

We only found this by reading `core/src/agent-book.ts` in the GitHub repo. **Please lead
with the primitive and present x402 as the most common consumer of it, rather than the
other way round.** A short "AgentKit without HTTP" page would have saved us most of a day,
and we suspect non-web integrators are being lost at exactly this point.

**`lookupHuman` returning an identifier rather than a boolean is excellent** and also
under-explained. Because N wallets backed by the same human collapse to one id, a relying
party can count unique *humans* instead of unique *addresses*. That distinction is the
entire reason our reputation system works — a sybil attacker with 5 wallets shows up as 1
human. The docs describe it as "an anonymous human identifier"; they never point out that
it is *stable across an operator's wallets* and therefore usable as a sybil-resistance
primitive. It deserves its own section.

**Error messages in `verifyAgentkitSignature` are outstandingly good.** On a mismatch it
returns the full SIWE message the server reconstructed, so you can diff it against what
you signed. More SDKs should do this.

---

## 2. Developer Portal — navigation, search, product discovery, debugging guidance

**Product discovery is the weak point.** "AgentKit", "World ID", "Mini Apps", "Sandbox",
"Human-in-the-Loop" and "Selfie Check" are presented as siblings, and it is genuinely hard
to work out which combination applies to a given integration. Specifically:

- **AgentKit and the World ID Sandbox appear to be different worlds.** AgentBook
  registration goes through the **production** World App via
  `npx @worldcoin/agentkit-cli register`. The Sandbox is documented entirely in the World
  ID/IDKit section (`environment: sandbox`). Nothing we found states whether a Sandbox
  identity can register in AgentBook, or whether an AgentKit integration can be tested
  end-to-end without a production World ID. **We would have been unblocked hours earlier by
  one sentence answering that.** It also matters commercially: the ETHOnline AgentKit track
  requires using the Sandbox App, and it is not obvious that the two are compatible.
- The registration relay (`https://x402-worldchain.vercel.app`) is documented in
  `cli/REGISTRATION.md` in the GitHub repo but is hard to find from the docs site.
- `cli/REGISTRATION.md` lists AgentBook on `base`, `base-sepolia` and `worldchain`, while
  `core/src/agent-book.ts` hardcodes the World Chain address and always resolves there. Both
  are correct, but reconciling them took a careful read. **A single canonical deployments
  table in the docs would fix this.**

**Debugging guidance is essentially absent** for the case where `lookupHuman` returns 0.
That is the interesting failure — is the wallet unregistered, is it registered on a
different network, or did the RPC fail? All three look identical from the outside. Our
integration has to fail closed on RPC errors specifically because the SDK returns `null`
for both "not registered" and "lookup threw" (`agent-book.ts` swallows the error in a
`catch` and returns `null`). **Distinguishing "not found" from "could not check" would be a
real improvement** — as it stands, a relying party that treats `null` as "not human" will
silently deny service during an RPC outage.

---

## 3. Sandbox App — states, proof flows, test users, errors, edge cases

**Honest limitation: at the time of writing we are still waiting on Sandbox access**, so
this section covers the access flow rather than in-app behaviour, and we will extend it
once we are in.

**Blocking bug we hit: the iOS enrollment form cannot be submitted.** On the
**Install World ID Sandbox → iOS** panel, entering an Apple Account email and pressing
**Submit email** does nothing — the button is inert, with no error, no toast and no
validation message.

The cause appears to be the sentence rendered directly above the field:

> *"An email-based portal account is required to request iOS enrollment."*

Our Developer Portal account was not created with an email credential, so there is
nothing for the form to attach the request to. But the page still renders an enabled-
looking button and an editable field, and gives no feedback when the requirement is not
met. From the developer's side this is indistinguishable from a broken page — we spent
time checking browsers and ad-blockers before suspecting the account type.

**The deeper problem is that the panel conflates two different accounts.** The sentence
about the **portal** account is rendered immediately above a field whose placeholder is
`apple-account@example.com`. Those are different accounts with different purposes, and
nothing on the page distinguishes them. Our first assumption — and we suspect most
developers' — was that the requirement referred to the Apple Account being email-based,
which it already was. The real blocker was the portal sign-in method (World ID / wallet),
which is never mentioned. Labelling the field "Apple Account email" and the requirement
"your World Developer Portal account must have an email credential" would remove the
ambiguity outright.

Three small fixes would remove this entirely:

1. **Disable the button visibly** when the portal account has no email, instead of
   letting it look actionable.
2. **Say what to do next.** "Your portal account has no email credential — add one in
   account settings to request iOS enrollment" is one sentence and completely unblocks
   the developer.
3. **Link the remedy** directly from that message. There is currently no documented page
   explaining portal account types, or how to add an email to an account created via
   World ID / wallet sign-in — we could not find one anywhere in the docs.

Worth noting the asymmetry: **the Android tab has no equivalent requirement.** It accepts
any Google account email. So the same developer is blocked on one platform and not the
other, for a reason that is never stated as a platform difference. If the email-based
account requirement is iOS-only because of how TestFlight enrollment works, saying so
would make it obvious rather than mysterious.

The access flow itself has further friction worth reporting:

- **Access is gated with no published SLA**, which is hard to plan a four-day hackathon
  around when a prize track requires using it. Even a rough expected turnaround on the
  request page would help enormously.
- **The enrollment path is easy to miss.** `docs.world.org/world-id/sandbox/sandbox-access`
  says to pick **World ID Sandbox** from the Developer Portal sidebar, but enrollment is
  *team-scoped* — you must open the panel from inside a team. A developer who has not
  created a team will not find the option and will not be told why.
- **iOS and Android differ substantially** (TestFlight with manual approval vs. a private
  Google Play track) and the docs do not say which is typically faster. For anyone
  time-boxed, that is the most useful sentence you could add.
- The Android instructions correctly warn that the browser and Play Store must use the same
  account — this is good, specific, hard-won documentation and more sections should read
  like it.
- **The docs and the portal UI disagree about what is required.**
  `docs.world.org/world-id/sandbox/sandbox-access` describes the iOS path as "install
  TestFlight, submit your Apple Account email, wait for approval" and never mentions the
  email-based portal account prerequisite that the portal itself enforces. A developer
  following the documentation cannot complete the documented flow.

**A genuine gap:** because verification is a `view` call, our *seller* side needs no
Sandbox at all — we tested the entire refusal ladder against live World Chain with
throwaway wallets, and it works (`npm run humanity-check`, 11/11). What we cannot test
without Sandbox access is the *buyer* side: obtaining a real registration. So the gate is
provably correct at refusing, and unverifiable at accepting, until access arrives.
**A "test registration" facility — even a rate-limited faucet that registers an address to
a throwaway human id on a testnet AgentBook — would completely unblock relying parties.**
That is the single highest-value thing you could ship for integrators.

---

## 4. What was confusing, missing, broken, or hard to test

Concrete, in descending order of how much time each cost us.

1. **`validateAgentkitMessage` validates the URI's host but not its path.** This is the
   one we would most like changed. Reading
   `core/src/validate.ts`, it compares `message.domain` to
   `new URL(expectedResourceUri).hostname` and `messageUrl.host` to `expectedUrl.host` —
   the path is never checked, though the function's parameter is named
   `expectedResourceUri` and reads as though the whole resource is validated.

   In our system every seller lives at `https://conduitt.xyz/seller/<address>`, so **a
   proof minted for one seller passed validation for a different seller.** We caught it
   only because our test asserted the refusal *reason* rather than just that a refusal
   happened; with a registered wallet it would have been a real authorization bug. See
   `src/core/humanity.ts` step 2, where we now compare the full URI ourselves.

   Either compare the full URI, or rename the parameter to `expectedOrigin` and document
   loudly that path-scoping is the caller's job. As written it invites exactly this
   mistake.

2. **`AgentBook.lookupHuman(0x0000…0000)` returns a NON-ZERO human id on World Chain**
   (verified 2026-09-09). Any relying party that forwards an unvalidated address will treat
   the zero address as human-backed. We guard it explicitly. This looks like it deserves a
   `require(agent != address(0))` in the contract, or at minimum a warning in the docs.

3. **No test vectors.** There is no published (payload, signature, expected result) fixture,
   so there is no way to unit-test a verifier without either a live RPC or hand-rolled
   mocks. A handful of static vectors — one valid, one expired, one wrong-signer, one
   wrong-chain — would let integrators test in CI. This is cheap for you and valuable for
   everyone.

4. **`@worldcoin/agentkit-core` pulls in `viem`**, which is a real cost for a codebase
   standardised on `ethers` — we now ship both. The AgentBook read is a single `view` call
   against a one-function ABI; a transport-agnostic path (accept an EIP-1193 provider, or
   expose the address plus ABI as constants) would let integrators use whatever client they
   already have.

5. **`getPublicClient` falls back to a shared Alchemy free-tier key** hardcoded in
   `core/src/viem-client.ts`. The comment is admirably candid that this is not a secret and
   is rate-limited, but it is a surprising default for a security check: a relying party
   that never sets `rpcUrl` has its human-verification gate depending on a shared,
   rate-limited endpoint. Worth a louder warning, or a startup log line.

6. **Minor, and appreciated:** the same file already carries an entry for Arc mainnet
   (`chain id 5042`) with the note that it is not live yet. That saved us a separate
   investigation and is a good example of the docs-in-source being ahead of the docs site.

---

## Summary

The primitive is excellent and the decision to expose a stable anonymous human id rather
than a boolean is the thing that made our whole design work. The main cost to us was
**discovery** — a genuinely general-purpose identity primitive is presented almost
exclusively through one transport (x402/HTTP), and the highest-leverage documentation
change would be to lead with the primitive itself.

The one thing we would call a defect rather than a papercut is the host-only URI check in
`validateAgentkitMessage` (§4.1), because it fails silently, in the safe-looking direction,
in a function whose name implies stronger guarantees.
