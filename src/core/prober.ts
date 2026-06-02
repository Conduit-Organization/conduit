// Capability Prober — a node benchmarks ITS OWN hardware to decide what it can sell.
//
// Walks a model ladder (small → large): loads each, runs a short completion, records real
// load time + TTFT + tokens/sec + backend (gpu/cpu), then unloads. The largest model that
// loads AND clears a min-tps bar becomes `topSellable`; the smallest that loads is the
// `localDraft` (the buyer-role model). No pricing here — that's `pricing.ts` (Phase 3).
//
// Reusable: Phase 3 calls `probe()` to generate storefront offers; `scripts/bench.ts` is the CLI.

export interface ModelBench {
  id: string;
  loaded: boolean;
  backend?: string;
  ttftMs?: number;
  tps?: number;
  loadMs?: number;
  error?: string;
}

export interface CapabilityProfile {
  ts: string;
  platform: string;
  arch: string;
  backend: string; // 'gpu' | 'cpu' | 'mixed' | 'unknown'
  minSellTps: number;
  models: ModelBench[];
  topSellable: string | null; // largest model id clearing the bar
  localDraft: string | null; // smallest model id that loaded
}

export interface ProbeOptions {
  ladder?: string[]; // model-constant names, ordered small → large
  minSellTps?: number;
  prompt?: string;
  retries?: number; // retries on a download timeout (P2P registry can be flaky)
  log?: (msg: string) => void;
}

export const DEFAULT_LADDER = [
  'QWEN3_600M_INST_Q4',
  'LLAMA_TOOL_CALLING_1B_INST_Q4_K',
  'QWEN3_1_7B_INST_Q4',
  'QWEN3_4B_INST_Q4_K_M',
  // 'QWEN3_8B_INST_Q4_K_M' — opt-in (~5 GB); see scripts/bench.ts BENCH_INCLUDE_8B
];

export async function probe(opts: ProbeOptions = {}): Promise<CapabilityProfile> {
  const log = opts.log ?? (() => {});
  const minSellTps = opts.minSellTps ?? 10;
  const prompt = opts.prompt ?? 'Reply with exactly: ok';
  const ladder = opts.ladder ?? DEFAULT_LADDER;
  const retries = opts.retries ?? 1;

  const sdk: any = await import('@qvac/sdk');
  const results: ModelBench[] = [];

  for (const id of ladder) {
    const modelSrc = sdk[id];
    if (!modelSrc) {
      results.push({ id, loaded: false, error: 'unknown model constant' });
      log(`   ✗ ${id}: unknown constant`);
      continue;
    }
    log(`▶ ${id} …`);
    const tLoad = Date.now();
    try {
      let lastPct = -1;
      const onProgress = (p: any) => {
        const pct = Math.floor((p?.percentage ?? 0) / 20) * 20;
        if (pct !== lastPct) {
          lastPct = pct;
          log(`   download ${pct}%`);
        }
      };
      let modelId: string | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          modelId = await sdk.loadModel({ modelSrc, modelType: 'llm', onProgress });
          break;
        } catch (e: any) {
          const m = String(e?.message ?? e);
          if (attempt >= retries || !/timeout/i.test(m)) throw e;
          log(`   ⟳ retry ${attempt + 1}/${retries} after: ${m.slice(0, 80)}`);
          lastPct = -1;
        }
      }
      const loadMs = Date.now() - tLoad;
      const run = sdk.completion({ modelId, history: [{ role: 'user', content: prompt }], stream: true });
      for await (const ev of run.events) {
        void ev; // drain to force generation
      }
      const final = await run.final.catch(() => null);
      const bench: ModelBench = {
        id,
        loaded: true,
        loadMs,
        backend: final?.stats?.backendDevice,
        ttftMs: final?.stats?.timeToFirstToken,
        tps: final?.stats?.tokensPerSecond,
      };
      results.push(bench);
      log(`   ✓ backend=${bench.backend ?? '?'} ttft=${bench.ttftMs?.toFixed?.(0) ?? '?'}ms tps=${bench.tps?.toFixed?.(1) ?? '?'} (load ${(loadMs / 1000).toFixed(1)}s)`);
      await sdk.unloadModel({ modelId, clearStorage: false });
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 160);
      results.push({ id, loaded: false, error: msg });
      log(`   ✗ ${msg}`);
    }
  }

  // ladder is small → large: last sellable entry is the largest sellable model.
  const sellable = results.filter((r) => r.loaded && (r.tps ?? 0) >= minSellTps);
  const topSellable = sellable.length ? sellable[sellable.length - 1]!.id : null;
  const loadedOk = results.filter((r) => r.loaded);
  const localDraft = loadedOk.length ? loadedOk[0]!.id : null;

  const backends = new Set(loadedOk.map((r) => r.backend).filter(Boolean) as string[]);
  const backend = backends.size === 0 ? 'unknown' : backends.size === 1 ? [...backends][0]! : 'mixed';

  return {
    ts: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    backend,
    minSellTps,
    models: results,
    topSellable,
    localDraft,
  };
}
