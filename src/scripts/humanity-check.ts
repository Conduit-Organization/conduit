// Live verification of the World AgentKit human gate — ETHOnline 2026 (new work).
//
// Run: npm run humanity-check
//
// Hits the REAL AgentBook contract on World Chain. No API key, no sandbox, no local
// mock — the whole point is that the gate is a plain `view` call. Reads only; it never
// sends a transaction and never needs a funded wallet.
//
// It exercises the seller-side ladder end to end with a freshly generated wallet, which
// is by construction NOT registered to a human — so the final AgentBook check must fail
// while every step before it passes. That is the refusal the demo shows on camera.
//
// If CONDUIT_DEMO_BUYER_KEY is set to a wallet that HAS been registered in AgentBook
// (npx @worldcoin/agentkit-cli register <address>), it additionally proves the ACCEPT
// path — the same code, the same ladder, admitting a real human-backed buyer. The two
// halves together are the whole claim: the gate refuses everyone it should, and admits
// exactly one wallet, for a reason that lives on World Chain rather than in our code.
import { Wallet } from 'ethers';
import { createHumanity, resourceUriFor, WORLD_CHAIN_ID } from '../core/humanity';

const AGENT_BOOK_WORLDCHAIN = '0xA23aB2712eA7BBa896930544C7d6636a96b944dA';
const ZERO = '0x0000000000000000000000000000000000000000';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ✔ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function main(): Promise<void> {
  console.log('World AgentKit human gate — live check against World Chain');
  console.log(`  AgentBook : ${AGENT_BOOK_WORLDCHAIN}`);
  console.log(`  chain     : eip155:${WORLD_CHAIN_ID}\n`);

  const humanity = createHumanity({ log: (m) => console.log('   ', m) });

  const buyer = Wallet.createRandom();
  const seller = Wallet.createRandom();
  const otherSeller = Wallet.createRandom();
  const sign = (m: string) => buyer.signMessage(m);

  console.log('AgentBook reads (live):');

  // The verified quirk: AgentBook returns a NON-ZERO id for the zero address, so the
  // module must reject it before ever asking the contract.
  const zeroId = await humanity.humanId(ZERO);
  check('zero address is refused before the lookup', zeroId === null, 'guarded');

  const unregistered = await humanity.humanId(buyer.address);
  check('a fresh wallet is not human-backed', unregistered === null, `${buyer.address.slice(0, 12)}… → null`);

  console.log('\nProof construction and the seller ladder:');

  const proof = await humanity.prove(buyer.address, seller.address, sign, { epoch: '1' });
  check('proof is built and signed', !!proof.signature && proof.signature !== '0x');
  check('proof targets this seller', proof.uri === resourceUriFor(seller.address), proof.uri);
  check('proof is bound to the session epoch', proof.requestId === 'epoch:1');

  // No proof at all → the refusal a funded-but-anonymous buyer gets.
  const none = await humanity.verify(undefined, buyer.address, seller.address);
  check('missing proof is refused', !none.ok, none.reason);

  // A proof minted for a different seller must not open this one.
  // Must be refused for the RIGHT reason — at the seller binding, not incidentally at
  // the AgentBook lookup. AgentKit's own validator only compares the URI host, and every
  // Conduit seller shares a host, so this check has to be ours.
  const wrongSeller = await humanity.verify(proof, buyer.address, otherSeller.address);
  check(
    'proof for another seller is refused, at the seller binding',
    !wrongSeller.ok && wrongSeller.reason === 'human proof was issued for a different seller',
    wrongSeller.reason
  );

  // A valid proof presented by a different wallet must not pass.
  const impostor = Wallet.createRandom();
  const stolen = await humanity.verify(proof, impostor.address, seller.address);
  check('proof presented by another wallet is refused', !stolen.ok, stolen.reason);

  // Tampered signature.
  const tampered = { ...proof, signature: ('0x' + '11'.repeat(65)) as string };
  const badSig = await humanity.verify(tampered, buyer.address, seller.address);
  check('tampered signature is refused', !badSig.ok, badSig.reason);

  // Garbage shape.
  const malformed = await humanity.verify({ not: 'a proof' } as any, buyer.address, seller.address);
  check('malformed proof is refused', !malformed.ok, malformed.reason);

  // The real path: signature and binding are all correct, and it still fails — because
  // the wallet is not registered to a human. THIS is the load-bearing refusal.
  const genuine = await humanity.verify(proof, buyer.address, seller.address);
  check(
    'correctly signed proof from an unregistered wallet is refused',
    !genuine.ok && genuine.reason === 'wallet not registered to a verified human',
    genuine.reason
  );

  // ── the ACCEPT path, when a registered wallet is available ──
  const demoKey = process.env.CONDUIT_DEMO_BUYER_KEY;
  if (demoKey) {
    console.log('\nRegistered buyer (the accept path):');
    const registered = new Wallet(demoKey.startsWith('0x') ? demoKey : `0x${demoKey}`);
    const humanIdOf = await humanity.humanId(registered.address);
    check(
      'registered wallet resolves to a human in AgentBook',
      humanIdOf !== null,
      `${registered.address.slice(0, 12)}… → ${humanIdOf ?? 'null'}`
    );

    if (humanIdOf) {
      const realSeller = Wallet.createRandom();
      const realProof = await humanity.prove(
        registered.address,
        realSeller.address,
        (m) => registered.signMessage(m),
        { epoch: '1' }
      );
      // Order matters. A successful verify CONSUMES the nonce, so the misuse cases are
      // checked first — otherwise they would all refuse at the replay guard and we would
      // not learn whether the rule each one targets actually fires.
      const thief = Wallet.createRandom();
      const stolenNow = await humanity.verify(realProof, thief.address, realSeller.address);
      check(
        'a human-backed proof presented by another wallet is refused',
        !stolenNow.ok && stolenNow.reason === 'proof address does not match buyer wallet',
        stolenNow.reason
      );

      const elsewhere = Wallet.createRandom();
      const wrongTarget = await humanity.verify(realProof, registered.address, elsewhere.address);
      check(
        'a human-backed proof does not open a different seller',
        !wrongTarget.ok && wrongTarget.reason === 'human proof was issued for a different seller',
        wrongTarget.reason
      );

      // Only now the real thing: same ladder, same code, a genuine human-backed buyer.
      const admitted = await humanity.verify(realProof, registered.address, realSeller.address);
      check('the same ladder ADMITS a human-backed buyer', admitted.ok, admitted.reason ?? `humanId ${admitted.humanId}`);

      // And the accepted proof is single-use — the nonce it just consumed is now spent.
      const replay = await humanity.verify(realProof, registered.address, realSeller.address);
      check('an accepted proof cannot be replayed', !replay.ok, replay.reason);
    }
  } else {
    console.log('\n  (set CONDUIT_DEMO_BUYER_KEY to a registered wallet to also prove the accept path)');
  }

  console.log('\nWhat this proves:');
  console.log('  The signature, freshness, seller-binding and replay checks all PASS for');
  console.log('  the genuine proof — it is refused solely at the AgentBook lookup, which is');
  console.log('  a live read of World Chain. Register that wallet with');
  console.log('    npx @worldcoin/agentkit-cli register <address>');
  console.log('  and the same proof is accepted, with no code change.\n');

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('\nhumanity-check failed:', e?.message ?? e);
  process.exit(1);
});
