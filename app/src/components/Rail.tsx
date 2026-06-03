import { useState } from 'react';
import type { State } from '../api';
import { Mark, Lock } from './icons';

function fmt(n: string | number, dp = 2): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(dp) : '—';
}
function short(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
}

export default function Rail({ state, flash }: { state: State | null; flash: boolean }) {
  const [copied, setCopied] = useState(false);

  const spent = state ? Number(state.spent) : 0;
  const budget = state ? Number(state.budget) : 1;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

  const ready = !!state?.ready;
  const err = state?.setupErr;
  const dotClass = err ? 'err' : ready ? 'on' : 'warm';
  const peerStatus = err ? 'peer error' : ready ? 'peer online' : 'warming up…';

  function copy() {
    if (!state) return;
    void navigator.clipboard?.writeText(state.buyer.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1100);
  }

  return (
    <aside className="rail">
      <div className="rail-inner">
      <div className="brand rise" style={{ animationDelay: '40ms' }}>
        <Mark size={30} />
        <div>
          <div className="wordmark">Conduit</div>
          <div className="tag">P2P inference · USD₮</div>
        </div>
      </div>

      <section className="card rise" style={{ animationDelay: '110ms' }}>
        <div className="card-label">
          <span>Your wallet</span>
          <span>Sepolia</span>
        </div>
        <div className="balance">
          <span className={`num${flash ? ' flash' : ''}`}>{fmt(state?.buyer.usdt ?? '—')}</span>
          <span className="unit">USD₮</span>
        </div>
        <div className="addr" onClick={copy} title="Copy address">
          {short(state?.buyer.address ?? '')}
          <span className={copied ? 'copied' : ''}>{copied ? 'copied' : '⧉'}</span>
        </div>
        <div className="gas">
          <span>gas</span>
          <b>{fmt(state?.buyer.eth ?? '—', 4)} ETH</b>
        </div>
      </section>

      <section className="card rise" style={{ animationDelay: '180ms' }}>
        <div className="card-label">
          <span>Session spend</span>
          <span>{Math.round(pct)}%</span>
        </div>
        <div className="spend-row">
          <span className="big">{fmt(spent)} USD₮</span>
          <span className="of">of {fmt(budget)} budget</span>
        </div>
        <div className="meter">
          <span style={{ width: `${pct}%` }} />
        </div>
      </section>

      <section className="card rise" style={{ animationDelay: '250ms' }}>
        <div className="card-label">
          <span>Peer GPU</span>
        </div>
        <div className="peer-row">
          <i className={`dot ${dotClass}`} />
          <span className="peer-status">{peerStatus}</span>
        </div>
        <div className="peer-meta">
          <div className="kv">
            <span>model</span>
            <span className="model">{state?.sellerModel ?? '—'}</span>
          </div>
          <div className="kv">
            <span>price</span>
            <span>{state ? `${fmt(state.price)} USD₮ / escalation` : '—'}</span>
          </div>
        </div>
      </section>

      <div className="spacer" />

      <section className="seal rise" style={{ animationDelay: '320ms' }}>
        <div className="ring">
          <Lock />
        </div>
        <div>
          <div className="t1">0 BYTES TO CLOUD</div>
          <div className="t2">End-to-end encrypted, peer to peer</div>
        </div>
      </section>
      </div>
    </aside>
  );
}
