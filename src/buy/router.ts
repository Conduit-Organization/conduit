// Confidence router — decides whether the buyer answers LOCALLY or ESCALATES (pays a peer).
//
// QVAC exposes no logprobs, so we measure ANSWER STABILITY instead: sample the local model k
// times (default sampling is non-greedy, ~temp 0.8, so samples vary), embed each answer, and take
// the mean pairwise cosine similarity. Stable (high) = the model is sure → answer locally for free.
// Unstable (low) = the model disagrees with itself → escalate to a paid peer. Honest + model-agnostic.
type SDK = any;

export interface RouteResult {
  decision: 'local' | 'escalate';
  consistency: number; // mean pairwise cosine of the k samples (0..1)
  samples: string[];
  draft: string; // the local answer we'd return if not escalating
  thinking?: string;
}

export interface ModelLoadProgress {
  model: string; // model constant being fetched
  percentage: number; // 0..100
}

export interface RouterOptions {
  localModel?: string; // model-constant name
  embedModel?: string;
  k?: number; // samples per prompt
  threshold?: number; // escalate if consistency < threshold
  maxOutputChars?: number; // cap text before embedding
  log?: (m: string) => void;
  onProgress?: (p: ModelLoadProgress) => void; // first-run model download progress (for the UI)
}

export interface Router {
  route(prompt: string): Promise<RouteResult>;
  close(): Promise<void>;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!, y = b[i]!;
    dot += x * y; na += x * x; nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

function meanPairwiseCosine(vecs: number[][]): number {
  if (vecs.length < 2) return 1;
  let sum = 0, count = 0;
  for (let i = 0; i < vecs.length; i++)
    for (let j = i + 1; j < vecs.length; j++) { sum += cosine(vecs[i]!, vecs[j]!); count++; }
  return count ? sum / count : 1;
}

export async function createRouter(opts: RouterOptions = {}): Promise<Router> {
  const sdk: SDK = await import('@qvac/sdk');
  const localModel = opts.localModel ?? 'QWEN3_600M_INST_Q4';
  const embedModel = opts.embedModel ?? 'EMBEDDINGGEMMA_300M_Q4_0';
  const k = opts.k ?? 3;
  const threshold = opts.threshold ?? 0.86;
  const cap = opts.maxOutputChars ?? 1500;
  const log = opts.log ?? (() => {});

  const onProg = (model: string) => (p: any) => opts.onProgress?.({ model, percentage: Number(p?.percentage ?? 0) });
  const llmId = await sdk.loadModel({ modelSrc: sdk[localModel], modelType: 'llm', modelConfig: { ctx_size: 8192 }, onProgress: onProg(localModel) });
  const embId = await sdk.loadModel({ modelSrc: sdk[embedModel], onProgress: onProg(embedModel) });

  async function sampleOnce(prompt: string): Promise<{ content: string; thinking: string }> {
    const run = sdk.completion({
      modelId: llmId,
      history: [{ role: 'user', content: prompt }],
      stream: true,
      captureThinking: true, // separate Qwen3 <think> from the actual answer
      kvCache: false, // each self-consistency sample is an INDEPENDENT attempt — no shared/growing KV cache
      // reasoning_budget:0 disables Qwen3 <think> so the whole budget goes to the ANSWER — without it a
      // small thinking model can burn every token reasoning and emit nothing. predict caps the answer
      // length; short answers stop at EOS well before it, so easy questions stay fast.
      generationParams: { predict: 512, reasoning_budget: 0 },
    });
    let content = '', thinking = '';
    for await (const ev of run.events) {
      if (ev.type === 'contentDelta') content += ev.text;
      else if (ev.type === 'thinkingDelta') thinking += ev.text;
    }
    const final = await run.final.catch(() => null);
    return { content: (content || final?.contentText || '').trim(), thinking };
  }

  return {
    async route(prompt: string): Promise<RouteResult> {
      const samples: string[] = [];
      let firstThinking = '';
      for (let i = 0; i < k; i++) {
        const { content, thinking } = await sampleOnce(prompt);
        if (i === 0) firstThinking = thinking;
        samples.push(content);
        log(`    sample ${i + 1}: ${content.slice(0, 70).replace(/\s+/g, ' ')}…`);
      }
      // A small thinking model can spend its whole token budget reasoning and emit no answer.
      // Empty/degenerate output is NOT confidence — if too few samples produced real content,
      // escalate to a capable peer rather than return a blank reply. The draft is always the
      // first NON-empty sample so we never surface "" as the local answer.
      const nonEmpty = samples.filter((s) => s.trim().length > 0);
      const draft = nonEmpty[0] ?? '';
      if (nonEmpty.length < Math.max(2, Math.ceil(k / 2))) {
        return { decision: 'escalate', consistency: 0, samples, draft, thinking: firstThinking || undefined };
      }

      const vecs: number[][] = [];
      for (const s of nonEmpty) {
        const r = await sdk.embed({ modelId: embId, text: s.slice(0, cap) });
        vecs.push(r.embedding as number[]);
      }
      const consistency = meanPairwiseCosine(vecs);
      return {
        decision: consistency < threshold ? 'escalate' : 'local',
        consistency,
        samples,
        draft,
        thinking: firstThinking || undefined,
      };
    },
    async close() {
      try { await sdk.unloadModel({ modelId: llmId }); } catch {}
      try { await sdk.unloadModel({ modelId: embId }); } catch {}
      try { await sdk.close(); } catch {}
    },
  };
}
