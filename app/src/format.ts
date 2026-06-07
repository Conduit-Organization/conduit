// Small display helpers shared across screens (kept identical to the originals in Rail/Marketplace).

export function fmt(n: string | number | undefined, dp = 2): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(dp) : '—';
}

export function short(a: string | null | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
}

// QWEN3_4B_INST_Q4_K_M → "Qwen3 4B" (size tokens like 4B/1.7B stay uppercase)
export function modelName(m: string | null | undefined): string {
  if (!m) return '—';
  const base = m.replace(/_INST.*$/i, '').replace(/_Q\d.*$/i, '').replace(/_/g, ' ').trim();
  if (!base) return m;
  return base
    .toLowerCase()
    .split(' ')
    .map((w) => (/^[\d.]+[a-z]+$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
