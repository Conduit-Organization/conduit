// Live ledger + byte counter for the demo: USD₮ balances moving, and the all-important
// cloud_bytes = 0 (no prompt/model bytes ever leave to a cloud AI).
export interface LedgerState {
  buyerStart: bigint;
  sellerStart: bigint;
  buyerNow: bigint;
  sellerNow: bigint;
  cloudBytes: number;
}

export function renderLedger(s: LedgerState, dec = 6): string {
  const f = (b: bigint) => (Number(b) / 10 ** dec).toFixed(dec);
  const sign = (b: bigint) => (b >= 0n ? '+' : '') + f(b);
  return [
    '┌──────────────── CONDUIT LEDGER ────────────────┐',
    `│  buyer  USD₮ : ${f(s.buyerNow).padStart(12)}   (Δ ${sign(s.buyerNow - s.buyerStart)})`,
    `│  seller USD₮ : ${f(s.sellerNow).padStart(12)}   (Δ ${sign(s.sellerNow - s.sellerStart)})`,
    `│  cloud bytes : ${String(s.cloudBytes).padStart(12)}   ← prompt/model bytes to any cloud AI`,
    '└─────────────────────────────────────────────────┘',
  ].join('\n');
}
