// Spike #1 — CONSUMER (used for both the allow-listed "buyer" and the "freeloader").
// Attempts delegated inference against the provider and classifies the outcome:
//   GRANTED_SERVED  — handshake passed AND inference streamed back
//   REJECTED        — refused at the handshake (no tokens) — expected for the freeloader
//   ERROR           — something else (e.g. inference failed after a successful handshake)
//
// Env in: CONSUMER_SEED (hex), PROVIDER_PUBKEY (hex), LABEL, MODEL (constant name)
// Stdout: a single `RESULT ...` line.
import { randomSeedHex } from '../../core/identity';

const seedHex = process.env.CONSUMER_SEED || randomSeedHex();
const providerPub = (process.env.PROVIDER_PUBKEY || '').trim();
const label = process.env.LABEL || 'consumer';
const modelName = process.env.MODEL || 'QWEN3_600M_INST_Q4';

if (!providerPub) {
  console.log(`RESULT label=${label} outcome=ERROR error="missing PROVIDER_PUBKEY"`);
  process.exit(1);
}

process.env.QVAC_HYPERSWARM_SEED = seedHex;

const sdk: any = await import('@qvac/sdk');
const { loadModel, completion, close } = sdk;
const modelSrc = sdk[modelName];

const t0 = Date.now();
try {
  const modelId = await loadModel({
    modelSrc,
    modelType: 'llm',
    delegate: { providerPublicKey: providerPub, timeout: 30000, fallbackToLocal: false },
  });
  const run = completion({
    modelId,
    history: [{ role: 'user', content: 'Reply with exactly: hi' }],
    stream: true,
  });
  let text = '';
  for await (const ev of run.events) {
    if (ev.type === 'contentDelta') text += ev.text;
  }
  const final = await run.final.catch(() => null);
  const ttft = final?.stats?.timeToFirstToken ?? '?';
  const tps = final?.stats?.tokensPerSecond ?? '?';
  const out = (text || final?.contentText || '').slice(0, 40);
  console.log(`RESULT label=${label} outcome=GRANTED_SERVED ms=${Date.now() - t0} ttft=${ttft} tps=${tps} text=${JSON.stringify(out)}`);
} catch (e: any) {
  const msg = String(e?.message ?? e);
  const looksRejected = /timeout|connect|firewall|handshake|unreachable|denied|ECONN|not.*allow|peer/i.test(msg);
  console.log(`RESULT label=${label} outcome=${looksRejected ? 'REJECTED' : 'ERROR'} ms=${Date.now() - t0} error=${JSON.stringify(msg.slice(0, 160))}`);
} finally {
  try { await close(); } catch {}
  setTimeout(() => process.exit(0), 500);
}
