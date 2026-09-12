// Can this machine actually serve? — run before going online, and by the seller at startup.
//
// A seller that cannot load its model is indistinguishable from a healthy one in the
// marketplace: it announces, it quotes, it passes every economic check. A buyer finds out
// only after committing an on-chain deposit, and then waits out a timeout because the
// failure happens deep inside the grant. This asks the question up front.
//
// The provider is started with a firewall that admits NOBODY. Starting it is what loads
// the model, so this answers "can this machine serve?" without authorizing anyone — the
// grant that payment buys is not handed out by a health check.
export {}; // this file is a module (top-level await)

const sdk: any = await import('@qvac/sdk');

const started = Date.now();
let code = 0;

console.log('Conduit seller check — can this machine serve?\n');

try {
  console.log('  starting the QVAC provider (firewall: allow nobody)…');
  const res = await sdk.startQVACProvider({ firewall: { mode: 'allow', publicKeys: [] } });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  ✔ provider started in ${secs}s — pubkey ${String(res.publicKey).slice(0, 16)}…`);

  await sdk.stopQVACProvider();
  console.log('  ✔ provider stopped cleanly\n');
  console.log('This machine can sell. `npm run sell` (or "Share GPU & Earn") will come online.');
} catch (e: any) {
  code = 1;
  const msg = e?.message ?? String(e);
  console.error(`  ✘ the provider did not start: ${msg}\n`);
  console.error('This machine cannot serve, so the seller will refuse to advertise.');
  console.error('A seller in the marketplace that cannot serve takes buyers\' deposits and');
  console.error('returns nothing, which is why being absent is the better failure.\n');

  if (/timed out|timeout/i.test(msg)) {
    console.error('  A timeout here usually means the worker process never started:');
    console.error('    • a stale ~/.qvac/.worker.lock from a killed run — check the pid inside,');
    console.error('      and delete the file if that process is gone');
    console.error('    • another Conduit instance already holding the worker on this machine');
    console.error('    • on a packaged app: the bundled runtime missing its executable bit');
  }
}

try { await sdk.close?.(); } catch { /* already closed */ }
process.exit(code);
