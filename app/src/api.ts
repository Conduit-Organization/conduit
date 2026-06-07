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
  modelProgress?: ModelProgress;
}

export interface ModelProgress {
  phase: 'warming' | 'downloading' | 'ready' | 'error';
  model?: string;
  percentage?: number;
  message?: string;
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

export interface SellerStatus {
  running: boolean;
  online: boolean;
  model: string | null;
  price: string | null; // base-units
  tps: number | null;
  address: string | null;
  requestsServed: number;
  earned: string | null; // base-units, on-chain delta since going online
  startedAt: number | null;
  error: string | null;
}

export interface SellerOfferProfile {
  model: string;
  price: string; // human USD₮
  priceBaseUnits: string;
  tps: number;
}

export interface SellerProfile {
  backend: string | null;
  platform: string | null;
  topSellable: string | null;
  localDraft: string | null;
  ts: string | null;
  offer: SellerOfferProfile | null;
  models: { id: string; loaded: boolean; tps: number | null; backend: string | null }[];
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

// ---- seller mode ----
export async function getSellerStatus(): Promise<SellerStatus> {
  const r = await fetch('/api/seller/status');
  if (!r.ok) throw new Error(`seller status ${r.status}`);
  return r.json();
}
export async function getSellerProfile(): Promise<SellerProfile> {
  const r = await fetch('/api/seller/profile');
  if (!r.ok) throw new Error(`seller profile ${r.status}`);
  return r.json();
}
export async function startSeller(): Promise<SellerStatus> {
  return postJson('/api/seller/start', {});
}
export async function stopSeller(): Promise<void> {
  await postJson('/api/seller/stop', {});
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
export async function exportWallet(password: string): Promise<string> {
  const d = await postJson('/api/wallet/export', { password });
  return d.mnemonic as string;
}
