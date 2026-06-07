// Bundle the engine + seller TypeScript into plain ESM JS so the PACKAGED app needs no `tsx`.
//
// Strategy: bundle our own src/ into one .mjs per entry, but keep every node_modules package
// EXTERNAL (`packages: 'external'`). Native deps (bare-runtime-*, rocksdb, @qvac/sdk, WDK,
// hyperswarm…) must be loaded from a real on-disk node_modules at runtime — they can't be inlined
// or live inside an asar. Electron's main spawns these bundles with its bundled Node
// (ELECTRON_RUN_AS_NODE=1); the engine finds app/dist + bench-profile.json via CONDUIT_RESOURCES.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

const outdir = 'dist-engine';
rmSync(outdir, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external', // keep all node_modules external (resolved on disk at runtime)
  sourcemap: true,
  outExtension: { '.js': '.mjs' }, // explicit ESM extension (what electron/main + seller.ts spawn)
  logLevel: 'info',
  // top-level await + import.meta.url are used by the engine; both are valid in ESM output.
};

await build({ ...common, entryPoints: { server: 'src/web/server.ts' }, outdir });
await build({ ...common, entryPoints: { sell: 'src/node/sell.ts' }, outdir });

console.log(`\n✓ engine bundled → ${outdir}/server.mjs + ${outdir}/sell.mjs`);
