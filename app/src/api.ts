// Typed client for the Conduit engine API (src/web/server.ts).
export type Source = 'local' | 'paid' | 'declined';

export interface Peer {
  id: string;
  address: string;
  model: string;
  price: string;
  tps: number;
  online: boolean;
}

export interface State {
  buyer: { address: string; usdt: string; eth: string };
  cloudBytes: number;
  spent: string;
  budget: string;
  sellerModel: string | null;
  price: string | null;
  peer: Peer | null; // the active seller (resolved from selection / Auto)
  sellersOnline: number;
  selected: string; // 'auto' or a seller id
  ready: boolean;
  setupErr: string | null;
}

export interface SellersResp {
  sellers: Peer[];
  selected: string;
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

export async function getSellers(): Promise<SellersResp> {
  const r = await fetch('/api/sellers');
  if (!r.ok) throw new Error(`sellers ${r.status}`);
  return r.json();
}

export async function selectSeller(id: string): Promise<void> {
  await fetch('/api/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

export async function ask(prompt: string): Promise<AskResult> {
  const r = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  return r.json();
}
