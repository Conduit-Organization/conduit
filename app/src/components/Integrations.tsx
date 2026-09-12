import type { State } from '../api';
import { short } from '../format';

// What the three integrations are doing, live, with links that resolve on public
// explorers. Every value here is real state read from the engine — not a feature list.
//
// The point is that a reader can check each claim without trusting us: the escrow is a
// contract they can open, the reputation is a subgraph they can query, and the human
// gate is a registry entry they can look up.
export default function Integrations({ state }: { state: State | null }) {
  const i = state?.integrations;
  if (!i) return null;

  const dot = (ok: boolean) => <i className={`ig-dot${ok ? ' on' : ''}`} />;

  return (
    <section className="ms-section">
      <div className="ms-label">Live integrations</div>
      <div className="ig-grid">
        {/* ── Arc: where value actually moves ───────────────────────────── */}
        <div className="ig-card">
          <div className="ig-head">
            {dot(!!i.arc.escrow)}
            <b>Arc</b>
            <span className="ig-role">settlement</span>
          </div>
          <p className="ig-what">
            Answers are paid for in <b>{i.arc.symbol}</b> through a payment channel, so a
            session settles once instead of once per answer.
            {i.arc.gasIsSettlementToken && (
              <> Gas is <b>{i.arc.symbol}</b> too — a seller earns and spends one asset.</>
            )}
          </p>
          <dl className="ig-facts">
            <dt>network</dt><dd>{i.arc.network} · chain {i.arc.chainId}</dd>
            <dt>escrow</dt>
            <dd>
              {i.arc.escrowUrl
                ? <a href={i.arc.escrowUrl} target="_blank" rel="noreferrer">{short(i.arc.escrow ?? '')}</a>
                : <span className="ig-off">not deployed</span>}
            </dd>
            <dt>token</dt><dd>{short(i.arc.settlementToken)}</dd>
          </dl>
        </div>

        {/* ── The Graph: the record a buyer reads before choosing ───────── */}
        <div className="ig-card">
          <div className="ig-head">
            {dot(!!i.graph.live)}
            <b>The Graph</b>
            <span className="ig-role">reputation</span>
          </div>
          <p className="ig-what">
            Every seller's settlement history is indexed from the escrow contract, so a
            first-time buyer can see how a seller treated <b>everyone</b> — not just
            themselves.
          </p>
          <dl className="ig-facts">
            <dt>status</dt>
            <dd>
              {i.graph.live
                ? 'synced'
                : i.graph.enabled
                  ? <span className="ig-off">{i.graph.error ? 'error' : 'syncing…'}</span>
                  : <span className="ig-off">disabled</span>}
            </dd>
            <dt>subgraph</dt><dd>{i.graph.network ?? '—'}</dd>
            <dt>counts</dt>
            <dd>{i.graph.countsHumans ? 'unique humans' : 'distinct addresses'}</dd>
          </dl>
        </div>

        {/* ── World: what makes the record worth trusting ───────────────── */}
        <div className="ig-card">
          <div className="ig-head">
            {dot(!!i.world.verified)}
            <b>World</b>
            <span className="ig-role">personhood</span>
          </div>
          <p className="ig-what">
            Sellers can require that a buyer is a <b>verified unique human</b>. That is what
            stops one actor being a thousand customers, and what makes the settlement record
            above expensive to forge.
          </p>
          <dl className="ig-facts">
            <dt>you</dt>
            <dd>
              {i.world.verified
                ? <span className="ig-ok">human-verified</span>
                : i.world.checked
                  ? <span className="ig-off">not registered</span>
                  : 'checking…'}
            </dd>
            <dt>human id</dt>
            <dd>{i.world.humanId ? short(i.world.humanId) : '—'}</dd>
            <dt>registry</dt>
            <dd>
              <a href={i.world.agentBookUrl} target="_blank" rel="noreferrer">
                AgentBook · {i.world.chain}
              </a>
            </dd>
          </dl>
        </div>
      </div>
    </section>
  );
}
