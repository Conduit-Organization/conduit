// Typed client for the Conduit engine API (src/web/server.ts).
export type Source = 'local' | 'paid' | 'declined';

export interface State {
  buyer: { address: string; usdt: string; eth: string };
  cloudBytes: number;
  spent: string;
  budget: string;
  sellerModel: string;
  price: string;
  ready: boolean;
  setupErr: string | null;
}

export interface AskResult {
  source: Source;
  answer: string;
  note: string | null;
  consistency: number;
  cost: string;
  stats: { ttftMs: number | null; tps: number | null };
  error?: string;
}

export async function getState(): Promise<State> {
  const r = await fetch('/api/state');
  if (!r.ok) throw new Error(`state ${r.status}`);
  return r.json();
}

export async function ask(prompt: string): Promise<AskResult> {
  const r = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  return r.json();
}
