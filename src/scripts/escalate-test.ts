// Empirically find prompts that ESCALATE (pay a peer) vs answer LOCAL, using the exact router config
// the web app uses (k=5, threshold 0.86). Prints each prompt's self-consistency + decision.
// Run: npx tsx src/scripts/escalate-test.ts
import { createRouter } from '../buy/router';

const CANDIDATES: ReadonlyArray<readonly [string, string]> = [
  ['control-math', 'Three workers paint a fence. A takes 6h, B 8h, C 12h alone. They start together; after 2h A leaves, 1h later B leaves. How long total? Show steps.'],
  ['aphorism', 'Write a single original one-line aphorism about time.'],
  ['paperclip', 'Give three unconventional, non-obvious uses for a paperclip.'],
  ['chess', 'What is objectively the best opening move in chess, and exactly why, in two sentences?'],
  ['risks', 'What are the three biggest risks to a peer-to-peer AI compute marketplace? Rank them with a one-line mitigation each.'],
  ['rollups', 'Compare optimistic vs ZK rollups for a micro-payments app, then pick one and justify it.'],
  ['flashfiction', 'Write one sentence of flash fiction about a lighthouse keeper.'],
  ['name', 'Invent a brand name for a serverless peer-to-peer AI marketplace and explain it in one line.'],
];

async function main() {
  const router = await createRouter({ k: 5 }); // matches src/web/server.ts
  const rows: Array<Record<string, unknown>> = [];
  for (const [tag, p] of CANDIDATES) {
    const r = await router.route(p);
    const decision = r.decision === 'escalate' ? `ESCALATE (${r.reason})` : 'local';
    console.log(`\n[${tag}] consistency=${r.consistency.toFixed(3)}  →  ${decision}`);
    console.log(`   sample: ${r.draft.slice(0, 80).replace(/\s+/g, ' ')}…`);
    rows.push({ tag, consistency: Number(r.consistency.toFixed(3)), decision });
  }
  await router.close();
  console.log('\n===== summary (threshold 0.86 → below = ESCALATE) =====');
  console.table(rows);
}

main()
  .then(() => setTimeout(() => process.exit(0), 300))
  .catch((e) => { console.error('ERROR:', e?.message ?? e); process.exit(1); });
