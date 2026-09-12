// In-app World ID registration — ETHOnline 2026 (new work).
//
// The engine can already READ whether a wallet is human-backed, and ATTACH a proof when
// buying. What it could not do was let you BECOME verified: that needed the AgentKit CLI
// run by hand, which is fine for us and a dead end for anyone who downloads the app.
//
// This drives `@worldcoin/agentkit-cli register <address>` as a managed child, the same
// pattern src/web/seller.ts uses for the seller node, and surfaces the verification link
// so the whole flow happens inside the product:
//
//   not verified → [Verify I'm human] → QR → scan in World App → ✓ human-verified
//
// The CLI is a real dependency rather than an `npx` call on purpose: a packaged AppImage
// has no npx, and shelling out to the network mid-demo is a failure waiting to happen.
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

export type RegisterPhase =
  | 'idle'
  /** Child spawned, waiting for it to produce a verification request. */
  | 'starting'
  /** QR + URL are ready; the user must scan with World App. */
  | 'awaiting'
  /** World ID verified; the relay is writing the registration on-chain. */
  | 'registering'
  | 'done'
  | 'error';

export interface RegisterStatus {
  phase: RegisterPhase;
  /** The address being registered. */
  address: string | null;
  /**
   * Deep link to open in World App. The client renders the QR from this.
   *
   * The CLI draws an ASCII QR only when stdout is a TTY; piped, as it is here, it emits
   * a single line carrying just the link. So the link is the contract, not the drawing.
   */
  url: string | null;
  /** On-chain registration transaction, once the relay has submitted it. */
  txHash: string | null;
  error: string | null;
  startedAt: number | null;
}

export interface HumanityRegistrar {
  start(address: string): RegisterStatus;
  cancel(): void;
  status(): RegisterStatus;
}

// The CLI prints ANSI colour; strip it before matching or the patterns miss.
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;
const URL_RE = /https:\/\/world\.org\/verify\?\S+/;
const TX_RE = /(0x[0-9a-fA-F]{64})/;

/** How much child output to retain for diagnosis when a registration fails. */
const OUTPUT_TAIL = 40;

export function createHumanityRegistrar(deps: { log?: (m: string) => void } = {}): HumanityRegistrar {
  const log = deps.log ?? (() => {});
  let child: ChildProcess | null = null;
  // Ring buffer of everything the child said. Without this a failure surfaces only as
  // "exit 1" and the real cause — a missing module, a network error — is lost, which is
  // exactly how a pruned dependency went unnoticed until someone installed a build.
  let recent: string[] = [];
  let st: RegisterStatus = {
    phase: 'idle', address: null, url: null, txHash: null, error: null, startedAt: null,
  };

  function reset(address: string) {
    st = { phase: 'starting', address, url: null, txHash: null, error: null, startedAt: Date.now() };
    recent = [];
  }

  /** The most useful-looking lines from the child, for an error message. */
  function tail(): string {
    const lines = recent.filter((l) => l.trim().length > 0);
    const notable = lines.filter((l) => /error|cannot find|not found|failed|refused|ENOENT|MODULE/i.test(l));
    return (notable.length ? notable : lines).slice(-3).join(' · ').slice(0, 300);
  }

  function handleLine(raw: string) {
    const line = raw.replace(ANSI, '');
    const trimmed = line.trim();
    if (trimmed) {
      recent.push(trimmed);
      if (recent.length > OUTPUT_TAIL) recent.shift();
    }

    const url = URL_RE.exec(trimmed);
    if (url) {
      st.url = url[0];
      st.phase = 'awaiting';
      log('[humanity] verification request ready — waiting for World App');
      return;
    }

    if (/World ID verified/i.test(trimmed)) {
      st.phase = 'registering';
      log('[humanity] World ID verified — submitting registration');
      return;
    }

    if (/registered on World Chain/i.test(trimmed)) {
      st.phase = 'done';
      log('[humanity] agent registered on World Chain');
      return;
    }

    // The tx line arrives just after the success banner.
    if (st.phase === 'done' && !st.txHash) {
      const tx = TX_RE.exec(trimmed)?.[1];
      // Don't mistake the address being registered for the transaction hash.
      if (tx && tx.toLowerCase() !== st.address?.toLowerCase()) st.txHash = tx;
    }
  }

  return {
    start(address: string): RegisterStatus {
      if (child) return st; // one at a time
      reset(address);

      let entry: string;
      try {
        entry = require_.resolve('@worldcoin/agentkit-cli/dist/index.js');
      } catch (e: any) {
        st.phase = 'error';
        st.error = 'AgentKit CLI not found in this install';
        return st;
      }

      // Under Electron, process.execPath IS the Electron binary; ELECTRON_RUN_AS_NODE
      // makes it behave as plain node so the CLI runs unmodified.
      const isElectron = !!(process as any).versions?.electron;
      const proc = spawn(process.execPath, [entry, 'register', address], {
        env: { ...process.env, ...(isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = proc;
      log(`[humanity] registering ${address}…`);

      const onChunk = (b: Buffer) => {
        for (const line of b.toString().split('\n')) handleLine(line);
      };
      proc.stdout?.on('data', onChunk);
      proc.stderr?.on('data', onChunk);

      proc.on('error', (e) => {
        st.phase = 'error';
        st.error = String(e?.message ?? e);
        child = null;
      });
      proc.on('exit', (code) => {
        child = null;
        if (st.phase !== 'done' && st.phase !== 'error') {
          st.phase = 'error';
          const why = tail();
          // Say WHAT went wrong, not just that something did. A clean exit that never
          // reached 'done' usually means the verification window expired unscanned.
          st.error = code === 0
            ? 'verification did not complete' + (why ? ` — ${why}` : '')
            : `registration failed (exit ${code})` + (why ? ` — ${why}` : '');
        }
        if (st.phase === 'error') {
          // Always put the full tail in the engine log, however the UI renders it.
          log(`[humanity] registration failed:\n    ${recent.slice(-OUTPUT_TAIL).join('\n    ')}`);
        }
      });
      return st;
    },

    cancel() {
      if (child) { try { child.kill('SIGTERM'); } catch { /* already gone */ } child = null; }
      st = { phase: 'idle', address: null, url: null, txHash: null, error: null, startedAt: null };
    },

    status: () => st,
  };
}
