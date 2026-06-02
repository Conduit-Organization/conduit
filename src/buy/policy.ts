// Spend policy — hard guardrails so the agent can't overspend, and so a seller's reply can never
// trick it into paying. The router may *recommend* escalation, but ONLY this policy authorizes a
// payment (per-call cap + total budget). Amounts are token base units (USD₮ = 6 decimals).
export class SpendPolicy {
  spent = 0n;
  constructor(
    public readonly maxPerCall: bigint,
    public readonly maxTotal: bigint,
  ) {}

  check(amount: bigint): { ok: boolean; reason?: string } {
    if (amount <= 0n) return { ok: false, reason: 'non-positive amount' };
    if (amount > this.maxPerCall) return { ok: false, reason: 'exceeds per-call cap' };
    if (this.spent + amount > this.maxTotal) return { ok: false, reason: 'total budget exhausted' };
    return { ok: true };
  }

  record(amount: bigint): void {
    this.spent += amount;
  }

  get remaining(): bigint {
    return this.maxTotal - this.spent;
  }
}
