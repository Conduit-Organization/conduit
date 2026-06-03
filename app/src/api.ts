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

export interface WalletStatus {
  exists: boolean;
  unlocked: boolean;
  address: string | null;
}

export interface State {
  wallet: WalletStatus;
  // the fields below are present only once the wallet is unlocked:
  buyer?: { address: string; usdt: string; eth: string };
  cloudBytes?: number;
  spent?: string;
  budget?: string;
  sellerModel?: string | null;
  price?: string | null;
  peer?: Peer | null;
  sellersOnline?: number;
  selected?: string;
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

async function postJson(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `request failed (${r.status})`);
  return data;
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
  await postJson('/api/select', { id });
}

export async function ask(prompt: string): Promise<AskResult> {
  const r = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  return r.json();
}

// ---- wallet ----
export async function createWallet(password: string): Promise<{ address: string; mnemonic: string }> {
  return postJson('/api/wallet/create', { password });
}
export async function importWallet(mnemonic: string, password: string): Promise<{ address: string }> {
  return postJson('/api/wallet/import', { mnemonic, password });
}
export async function unlockWallet(password: string): Promise<{ address: string }> {
  return postJson('/api/wallet/unlock', { password });
}
export async function lockWallet(): Promise<void> {
  await fetch('/api/wallet/lock', { method: 'POST' });
}
export async function exportWallet(): Promise<string> {
  const r = await fetch('/api/wallet/export');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'locked');
  return d.mnemonic as string;
}
