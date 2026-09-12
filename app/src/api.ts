// Typed client for the Conduit engine API (src/web/server.ts).
export type Source = 'local' | 'paid' | 'declined';

export interface Peer {
  id: string;
  address: string;
  model: string;
  price: string;
  tps: number;
  online: boolean;
  served: number; // paid answers this seller has delivered to you
  failed: number; // failed attempts
  successRate: number; // [0,1], neutral 0.5 until there's history
  // ETHOnline 2026 — the blended score "Auto" actually sorts on, and the seller's
  // global settlement record from The Graph. `global` is null when the subgraph is
  // not configured or the seller has no on-chain history.
  score?: number;
  global?: GlobalRecord | null;
  /** This seller only admits World-verified humans. Shown on the card. */
  requireHuman?: boolean;
  /** Which chain this seller settles on — offers have always carried it on the wire. */
  chainId?: number;
  network?: string;
  /** False when this seller settles on a different network than you; you cannot pay them. */
  sameNetwork?: boolean;
}

/** A seller's settlement record across ALL buyers, indexed from ConduitEscrow. */
export interface GlobalRecord {
  settled: number;
  /** The only figure that scores against a seller — passed every qualification rule. */
  qualifiedWithdrawn: number;
  /** Withdrawals excluded as probes: too short, too small, or by a buyer with no history. */
  probeChannels: number;
  /** Withdrawals that were session renewals — the buyer immediately came back. */
  renewals: number;
  uniqueVerifiedBuyers: number;
  totalClaimed: string;
  reliability: number;
  globalScore: number;
  /** What a naive settled/(settled+withdrawn) tally would have read. */
  naiveReliability: number;
}

/** What each integration is doing right now, with verifiable links. */
export interface Integrations {
  arc: {
    network: string;
    chainId: number;
    settlementToken: string;
    symbol: string;
    /** On Arc the gas token IS the settlement token. */
    gasIsSettlementToken: boolean;
    escrow: string | null;
    explorer: string;
    escrowUrl: string | null;
  };
  graph: GraphStatus & { endpoint: string | null; network: string | null };
  world: HumanStatus & {
    agentBook: string;
    chain: string;
    agentBookUrl: string;
    walletUrl: string | null;
  };
}

/** Whether this buyer wallet resolves to a unique human in AgentBook on World Chain. */
export interface HumanStatus {
  /** This engine attaches a proof at all (buyer-side switch). */
  enabled: boolean;
  verified: boolean;
  /** Anonymous, stable across every wallet the same person backs. Not an identity. */
  humanId: string | null;
  /** False until the first lookup completes — "unknown", not "not human". */
  checked: boolean;
}

/** Whether the global-reputation layer is actually live, so the UI never implies it is. */
export interface GraphStatus {
  enabled: boolean;
  live: boolean;
  /** True when breadth counts verified humans rather than distinct addresses. */
  countsHumans: boolean;
  error: string | null;
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
  escrow?: boolean; // escrow (payment-channel) mode is enabled on this engine
  sessions?: EscrowSession[]; // open payment channels (instant paid answers)
  graph?: GraphStatus; // ETHOnline 2026 — global reputation layer status
  /** Every answer is bought from a peer; there is no free local tier. */
  alwaysPay?: boolean;
  /** Live status of the three integrations, with links a judge can verify. */
  integrations?: Integrations;
  human?: HumanStatus; // is THIS buyer wallet backed by a verified unique human
  humanProof?: boolean; // this engine attaches a World human proof to sessions
  network?: { name: string; label: string; explorer: string; symbol: string };
  ready: boolean;
  setupErr: string | null;
  modelProgress?: ModelProgress;
}

export interface EscrowSession {
  seller: string; // seller wallet address
  deposit: string; // USD₮ locked
  spent: string; // USD₮ drawn so far
  remaining: string; // USD₮ left in the channel
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
  graph?: GraphStatus;
}

export type DeclineReason = 'no-seller' | 'budget' | 'error';

export interface AskResult {
  source: Source;
  reason: DeclineReason | null; // why it fell back to local, when source === 'declined'
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
  /** ETHOnline 2026 — this seller only admits World-verified humans. Seller policy. */
  requireHuman?: boolean;
}

export interface SellerOfferProfile {
  model: string;
  price: string; // human USD₮
  priceBaseUnits: string;
  tps: number;
}

export interface SellableModel {
  id: string;
  loaded: boolean;
  tps: number | null;
  backend: string | null;
  price: string; // human USD₮ for this model tier
}

export interface SellerProfile {
  backend: string | null;
  platform: string | null;
  topSellable: string | null;
  recommended: string | null; // the prober's optimal pick — highlight + pre-select this
  localDraft: string | null;
  ts: string | null;
  offer: SellerOfferProfile | null;
  models: SellableModel[]; // runnable models this machine benchmarked (each with its tiered price)
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
export async function startSeller(model?: string, requireHuman?: boolean): Promise<SellerStatus> {
  return postJson('/api/seller/start', { ...(model ? { model } : {}), requireHuman: !!requireHuman });
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

// ── ETHOnline 2026: in-app World ID registration ─────────────────────────────
export type RegisterPhase = 'idle' | 'starting' | 'awaiting' | 'registering' | 'done' | 'error';

export interface RegisterStatus {
  phase: RegisterPhase;
  address: string | null;
  /** Deep link to open in World App. The client renders the QR from this. */
  url: string | null;
  txHash: string | null;
  error: string | null;
  startedAt: number | null;
}

export async function startHumanRegister(): Promise<RegisterStatus> {
  return postJson('/api/human/register', {});
}

export async function getHumanRegister(): Promise<RegisterStatus> {
  const r = await fetch('/api/human/register');
  if (!r.ok) throw new Error(`human register ${r.status}`);
  return r.json();
}

export async function cancelHumanRegister(): Promise<void> {
  await postJson('/api/human/register/cancel', {});
}
