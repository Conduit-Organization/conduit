// Validate the confidence router: does self-consistency separate "easy" (model is sure → LOCAL)
// from "hard"/ambiguous (model disagrees with itself → ESCALATE)? Run: npm run route
import { createRouter } from '../buy/router';

const prompts: ReadonlyArray<readonly [string, string]> = [
  ['easy', 'What is the capital of France? Answer in one word.'],
  ['easy', 'What is 17 + 25? Reply with just the number.'],
  ['easy', 'Name the largest planet in the Solar System. One word.'],
  ['hard', 'Will Lagos get rain exactly 14 days from today? Answer yes or no, with a reason.'],
  ['hard', 'Write a single original one-line aphorism about time.'],
  ['hard', 'What is objectively the best opening move in chess and exactly why, in two sentences?'],
];

async function main() {
  const router = await createRouter({ k: 3, log: (m) => console.log(m) });
  console.log('=== confidence router — self-consistency (easy vs hard) ===');
  const rows: Array<Record<string, unknown>> = [];
  for (const [tag, p] of prompts) {
    console.log(`\n[${tag}] ${p}`);
    const r = await router.route(p);
    console.log(`  → consistency=${r.consistency.toFixed(3)}  decision=${r.decision.toUpperCase()}`);
    rows.push({ tag, consistency: Number(r.consistency.toFixed(3)), decision: r.decision });
  }
  await router.close();
  console.log('\n=== summary ===');
  console.table(rows);
}

main()
  .then(() => setTimeout(() => process.exit(0), 300))
  .catch((e) => { console.error('ROUTE TEST ERROR:', e?.message ?? e); process.exit(1); });
