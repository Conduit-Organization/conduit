// Seller-mode manager — the engine runs the BUYER in-process; the SELLER is the proven CLI
// (src/node/sell.ts) run as a managed CHILD. This module spawns/kills that child, parses its
// stdout for live status (offered model/price/tps, earnings address, requests served), and reads
// the on-chain USD₮ earnings delta. We reuse sell.ts verbatim — only its wallet source is injected.
//
// Lifecycle: the child is spawned `detached` in its own process group so a stop tears down its
// QVAC Bare-worker grandchild too (handoff gotcha #6 — orphaned workers hold GPU memory).
import { spawn, type ChildProcess } from 'node:child_process';
import type { ConduitAccount } from '../core/wallet';

export interface SellerStatus {
  running: boolean; // child process alive
  online: boolean; // child joined the swarm + advertised its offer
  model: string | null;
  price: string | null; // base-units (string to stay bigint-safe over JSON)
  tps: number | null;
  address: string | null; // earnings address (seller account index 1)
  requestsServed: number;
  earned: string | null; // on-chain USD₮ delta since going online (base-units), best-effort
  startedAt: number | null;
  error: string | null;
}

export interface SellerManagerDeps {
  repoRoot: string; // cwd for the dev (tsx) spawn
  rpcUrl: string;
  usdtAddress: string;
  // Build a ConduitAccount for the earnings address (account index 1). Injected to avoid an
  // import cycle and to reuse the engine's wallet wiring.
  makeEarningsAccount: (mnemonic: string) => Promise<ConduitAccount>;
  log?: (m: string) => void;
}

export interface SellerManager {
  start(mnemonic: string, model?: string): Promise<SellerStatus>;
  stop(): Promise<void>;
  status(): SellerStatus;
}

// `[seller] online. offer: QWEN3_4B_INST_Q4_K_M @ 10000 base-units, ~59 tps. wallet 0x…`
const OFFER_RE = /offer:\s*(\S+)\s*@\s*(\d+)\s*base-units,\s*~?([\d.]+)\s*tps\.\s*wallet\s*(0x[0-9a-fA-F]+)/;

function sellerSpawnSpec(repoRoot: string): { command: string; args: string[]; cwd: string } {
  // M3c packaged path: a compiled seller entry run with Electron's bundled Node.
  const compiled = process.env.CONDUIT_SELLER_ENTRY;
  if (compiled) {
    return { command: process.execPath, args: [compiled], cwd: repoRoot };
  }
  // Dev path: run the seller from source via tsx.
  return {
    command: process.platform === 'win32' ? 'node.exe' : 'node',
    args: ['--import', 'tsx', 'src/node/sell.ts'],
    cwd: repoRoot,
  };
}

export function createSellerManager(deps: SellerManagerDeps): SellerManager {
  const log = deps.log ?? (() => {});
  let child: ChildProcess | null = null;
  let earnings: ConduitAccount | null = null;
  let earnedAtStart: bigint | null = null;
  let earnedNow: bigint | null = null;
  let pendingBaseUnits = 0n; // unclaimed channel vouchers (earned but not yet redeemed on-chain)

  const st: SellerStatus = {
    running: false, online: false, model: null, price: null, tps: null,
    address: null, requestsServed: 0, earned: null, startedAt: null, error: null,
  };

  function reset() {
    st.running = false; st.online = false; st.model = null; st.price = null; st.tps = null;
    st.address = null; st.requestsServed = 0; st.earned = null; st.startedAt = null;
    earnings = null; earnedAtStart = null; earnedNow = null; pendingBaseUnits = 0n;
  }

  // Live earned = on-chain settled delta (per-inference pays + redeemed channel claims) + unclaimed
  // channel vouchers. The two stay continuous: when a batch claim settles, pending drops exactly as
  // the on-chain balance rises, so the total never double-counts or jumps.
  function recomputeEarned() {
    const onChainDelta = earnedAtStart !== null ? (earnedNow ?? earnedAtStart) - earnedAtStart : 0n;
    st.earned = (onChainDelta + pendingBaseUnits).toString();
  }

  function ingest(line: string) {
    const m = OFFER_RE.exec(line);
    if (m) {
      st.online = true;
      st.model = m[1] ?? null;
      st.price = m[2] ?? null;
      st.tps = m[3] ? Number(m[3]) : null;
      st.address = m[4] ?? null;
      log(`[seller-mgr] online: ${st.model} @ ${st.price} (~${st.tps} tps) → ${st.address}`);
    }
    // Unclaimed-earnings beacon from the seller child (base units) — surfaces money owed before claim.
    const pe = /earned-pending\s+(\d+)/.exec(line);
    if (pe) {
      pendingBaseUnits = BigInt(pe[1]!);
      recomputeEarned();
    }
    // Count only ACTUAL served inferences: a channel draw ("(served)") or a per-inference payment
    // grant — NOT the one-time channel session-open, which also logs GRANTED but serves nothing yet.
    if (/GRANTED \(served\)/.test(line) || /payment verified.*GRANTED/.test(line)) {
      st.requestsServed += 1;
      void refreshEarnings(); // refresh the on-chain delta too (per-inference pays land in the wallet)
    }
  }

  async function refreshEarnings() {
    if (!earnings) return;
    try {
      const bal = await earnings.tokenBalance(deps.usdtAddress);
      earnedNow = bal;
      if (earnedAtStart === null) earnedAtStart = bal;
      recomputeEarned();
    } catch (e: any) {
      log(`[seller-mgr] earnings read failed (keeping last): ${e?.message ?? e}`);
    }
  }

  async function start(mnemonic: string, model?: string): Promise<SellerStatus> {
    if (child) return st; // already running
    reset();
    st.error = null;
    const spec = sellerSpawnSpec(deps.repoRoot);
    log(`[seller-mgr] starting: ${spec.command} ${spec.args.join(' ')}${model ? ` (model ${model})` : ''}`);

    // Build the earnings account (index 1) and snapshot the starting balance for the delta.
    try {
      earnings = await deps.makeEarningsAccount(mnemonic);
      earnedAtStart = await earnings.tokenBalance(deps.usdtAddress);
      earnedNow = earnedAtStart;
      st.earned = '0';
    } catch (e: any) {
      earnedAtStart = null; // earnings reporting degrades gracefully if the RPC is flaky
      log(`[seller-mgr] could not snapshot starting balance: ${e?.message ?? e}`);
    }

    const proc = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        CONDUIT_SELLER_MNEMONIC: mnemonic,
        ...(model ? { CONDUIT_SELLER_MODEL: model } : {}), // seller's chosen model (else sell.ts uses topSellable)
        ...(process.env.CONDUIT_SELLER_ENTRY ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        QVAC_HYPERSWARM_SEED: '', // let sell.ts pick its own provider identity (don't inherit the buyer's)
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    child = proc;
    st.running = true;
    st.startedAt = Date.now();

    const onLine = (buf: Buffer, isErr: boolean) => {
      const text = buf.toString();
      (isErr ? process.stderr : process.stdout).write(`[seller] ${text}`);
      for (const line of text.split('\n')) if (line.trim()) ingest(line);
    };
    proc.stdout?.on('data', (b) => onLine(b, false));
    proc.stderr?.on('data', (b) => onLine(b, true));
    proc.on('exit', (code, signal) => {
      log(`[seller-mgr] seller exited (code=${code} signal=${signal})`);
      if (code && code !== 0 && !signal) st.error = `seller exited with code ${code}`;
      child = null;
      st.running = false;
      st.online = false;
    });
    proc.on('error', (e) => { st.error = String(e?.message ?? e); });
    return st;
  }

  async function stop(): Promise<void> {
    const proc = child;
    if (!proc || proc.pid == null) { reset(); return; }
    const pid = proc.pid;
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    try {
      if (process.platform !== 'win32') process.kill(-pid, 'SIGTERM');
      else proc.kill('SIGTERM');
    } catch { try { proc.kill('SIGTERM'); } catch { /* gone */ } }

    const timeout = new Promise<'t'>((r) => setTimeout(() => r('t'), 8_000));
    if ((await Promise.race([exited.then(() => 'e' as const), timeout])) === 't') {
      log('[seller-mgr] seller did not exit in time — SIGKILL');
      try {
        if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
        else proc.kill('SIGKILL');
      } catch { /* gone */ }
    }
    child = null;
    reset();
  }

  function status(): SellerStatus {
    return { ...st };
  }

  return { start, stop, status };
}
