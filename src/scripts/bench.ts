// `npm run bench` — run the capability prober on this machine and write a profile.
//
//   MIN_SELL_TPS=15 npm run bench         # raise the sellable-speed bar
//   BENCH_INCLUDE_8B=1 npm run bench       # also try Qwen3-8B (~5 GB download)
import { writeFile } from 'node:fs/promises';
import { probe, type CapabilityProfile } from '../core/prober';

const includeBig = process.env.BENCH_INCLUDE_8B === '1';
const ladder = process.env.BENCH_LADDER
  ? process.env.BENCH_LADDER.split(',').map((s) => s.trim()).filter(Boolean)
  : [
      'QWEN3_600M_INST_Q4',
      'LLAMA_TOOL_CALLING_1B_INST_Q4_K',
      'QWEN3_1_7B_INST_Q4',
      'QWEN3_4B_INST_Q4_K_M',
      ...(includeBig ? ['QWEN3_8B_INST_Q4_K_M'] : []),
    ];
const minSellTps = Number(process.env.MIN_SELL_TPS ?? 10);

console.log('=== conduit bench — capability prober ===');
console.log('ladder:          ' + ladder.join(' → '));
console.log('min sellable tps: ' + minSellTps + (includeBig ? '  (incl. 8B)' : '  (4B max; set BENCH_INCLUDE_8B=1 for 8B ~5GB)'));
console.log('');

const profile: CapabilityProfile = await probe({ ladder, minSellTps, log: (m) => console.log(m) });

console.log('\n=== CAPABILITY PROFILE ===');
console.table(
  profile.models.map((m) => ({
    model: m.id,
    loaded: m.loaded,
    backend: m.backend ?? '-',
    ttft_ms: m.ttftMs != null ? Math.round(m.ttftMs) : '-',
    tps: m.tps != null ? Number(m.tps.toFixed(1)) : '-',
    load_s: m.loadMs != null ? Number((m.loadMs / 1000).toFixed(1)) : '-',
    note: m.error ?? '',
  })),
);
console.log('backend:             ' + profile.backend);
console.log('→ local draft model: ' + (profile.localDraft ?? '(none)'));
console.log('→ top sellable model:' + (profile.topSellable ? ' ' + profile.topSellable : ' (none cleared the bar)'));

const outPath = new URL('../../bench-profile.json', import.meta.url).pathname;
await writeFile(outPath, JSON.stringify(profile, null, 2));
console.log('\nwrote ' + outPath);

// Force a clean exit (dodge the QVAC Bare-worker teardown double-free polluting the exit code).
try {
  const sdk: any = await import('@qvac/sdk');
  await sdk.close();
} catch {
  /* ignore */
}
setTimeout(() => process.exit(0), 200);
