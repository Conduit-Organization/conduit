import { useEffect, useState } from 'react';
import { useSymbol } from '../symbol';
import type { State, Peer, GlobalRecord } from '../api';
import { Star } from './icons';
import { fmt, short, modelName } from '../format';
import * as bm from '../bookmarks';
import Integrations from './Integrations';

// The buyer's landing screen (Binance-P2P style): browse sellers, ★ bookmark, pick one — or Auto —
// then enter chat. Choosing a seller ≠ paying: easy questions still answer free on-device; the chosen
// seller is paid only when a question escalates.
//
// ETHOnline 2026: each card now also shows the seller's GLOBAL settlement record, indexed
// from ConduitEscrow by The Graph — how they have treated everyone, not just you. Where a
// naive settled-vs-withdrawn tally would disagree with the hardened reading, both numbers
// are shown, because the difference is the whole point.
export default function MarketplaceScreen({
  state,
  sellers,
  onPick,
}: {
  state: State | null;
  sellers: Peer[];
  onPick: (id: string) => void; // select the seller (or 'auto') AND enter chat
}) {
  const sym = useSymbol();
  const [marks, setMarks] = useState<bm.Bookmark[]>([]);
  useEffect(() => { setMarks(bm.load()); }, []);

  const graph = state?.graph;
  const online = sellers.filter((s) => s.online);
  const byAddr = new Map(sellers.map((s) => [s.address.toLowerCase(), s]));

  // Reputation label from this buyer's own history with the seller.
  function rep(s: Peer): { label: string; cls: string } {
    const n = s.served + s.failed;
    if (n === 0) return { label: 'new peer', cls: 'new' };
    const pct = Math.round(s.successRate * 100);
    return { label: `★ ${pct}% · ${s.served} served`, cls: pct >= 90 ? 'good' : pct >= 60 ? 'ok' : 'bad' };
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // Withdrawals the qualification rules excluded: still indexed, still queryable, but
  // not counted against the seller. Surfaced so the filtering is visible, not implicit.
  const excludedCount = (g: GlobalRecord) => g.probeChannels + g.renewals;

  function chainClass(g: GlobalRecord): string {
    if (g.settled + g.qualifiedWithdrawn === 0) return 'new';
    if (g.reliability >= 0.9) return 'good';
    return g.reliability >= 0.6 ? 'ok' : 'bad';
  }

  function toggleMark(s: Peer | bm.Bookmark, e: React.MouseEvent) {
    e.stopPropagation();
    setMarks(bm.toggle({ address: s.address, model: s.model, price: s.price, savedAt: Date.now() }));
  }

  return (
    <div className="screen market-screen">
      <div className="screen-head">
        <h1>Marketplace</h1>
        <p>
          Pick a GPU peer — or <b>Auto</b>, which ranks on on-chain settlement history — then ask.
          Every answer is <span className="pay">bought from that peer and settled in USDC</span>.
          <span className="count"> · {online.length} online</span>
        </p>
      </div>

      {marks.length > 0 && (
        <section className="ms-section">
          <div className="ms-label">★ Bookmarked</div>
          <div className="ms-grid">
            {marks.map((b) => {
              const live = byAddr.get(b.address.toLowerCase());
              const isOnline = !!live?.online;
              return (
                <button
                  key={b.address}
                  className={`ms-card${isOnline ? '' : ' off'}`}
                  onClick={() => isOnline && live && onPick(live.id)}
                  disabled={!isOnline}
                >
                  <div className="ms-card-top">
                    <span className="ms-model">
                      <i className={`mdot${isOnline ? ' on' : ''}`} />
                      {modelName(b.model)}
                    </span>
                    <span className="ms-star on" onClick={(e) => toggleMark(b, e)} title="Remove bookmark">
                      <Star filled />
                    </span>
                  </div>
                  <div className="ms-sub">
                    {fmt(live?.price ?? b.price)} {sym}{live ? ` · ${Math.round(live.tps)} tps` : ''}
                  </div>
                  <div className="ms-addr">{short(b.address)}</div>
                  <div className={`ms-state${isOnline ? ' on' : ''}`}>{isOnline ? 'online — tap to use' : 'offline'}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="ms-section">
        <div className="ms-label">Sellers</div>

        {graph?.enabled && (
          <div className={`ms-graph${graph.live ? ' live' : ''}`}>
            <i className="mdot on" />
            {graph.live ? (
              <span>
                <b>On-chain reputation live.</b> Every seller below carries a settlement record
                indexed from <code>ConduitEscrow</code> — how they have treated{' '}
                <b>everyone</b>, not just you.
                {graph.countsHumans
                  ? ' Reach counts verified humans, not addresses.'
                  : ' Reach counts distinct addresses — enable the human gate to count people.'}
              </span>
            ) : (
              <span>
                Global reputation configured but not yet synced
                {graph.error ? ` — ${graph.error}` : '…'}. Showing your own history only.
              </span>
            )}
          </div>
        )}
        <div className="ms-grid">
          <button className="ms-card auto" onClick={() => onPick('auto')}>
            <div className="ms-card-top">
              <span className="ms-model"><b>Auto</b></span>
              {state?.selected === 'auto' && <span className="ms-check">✓ active</span>}
            </div>
            <div className="ms-sub">best record, then cheapest</div>
            <div className="ms-addr">ranks on settlement history, then price and speed</div>
            <div className="ms-state on">tap to use</div>
          </button>

          {sellers.map((s) => {
            const marked = marks.some((m) => m.address.toLowerCase() === s.address.toLowerCase());
            return (
              <button
                key={s.id}
                className={`ms-card${s.online && s.sameNetwork !== false ? '' : ' off'}`}
                onClick={() => s.online && s.sameNetwork !== false && onPick(s.id)}
                disabled={!s.online || s.sameNetwork === false}
              >
                <div className="ms-card-top">
                  <span className="ms-model">
                    <i className={`mdot${s.online ? ' on' : ''}`} />
                    {modelName(s.model)}
                  </span>
                  <span
                    className={`ms-star${marked ? ' on' : ''}`}
                    onClick={(e) => toggleMark(s, e)}
                    title={marked ? 'Remove bookmark' : 'Bookmark this seller'}
                  >
                    <Star filled={marked} />
                  </span>
                </div>
                <div className="ms-sub">{fmt(s.price)} {sym} · {Math.round(s.tps)} tps</div>
                <div className="ms-addr">{short(s.address)}</div>
                {s.requireHuman && (
                  // Advertised by the seller, so a buyer sees the policy BEFORE opening a
                  // channel rather than paying first and being refused at sessionOpen.
                  <div
                    className={`ms-human${state?.human?.verified ? ' ok' : ''}`}
                    title={
                      state?.human?.verified
                        ? 'This seller requires a verified human — your wallet qualifies'
                        : 'This seller only serves verified humans. Verify from the header to buy here.'
                    }
                  >
                    {state?.human?.verified ? '✓ verified humans only' : '⚠ verified humans only'}
                  </div>
                )}
                {s.network && (
                  <div className={`ms-net${s.sameNetwork === false ? ' other' : ''}`}>
                    {s.sameNetwork === false
                      ? `settles on ${s.network} — you are on a different network`
                      : `settles on ${s.network}`}
                  </div>
                )}
                <div className={`ms-rep ${rep(s).cls}`}>{rep(s).label}</div>

                {s.global ? (
                  <>
                    <div className={`ms-chain ${chainClass(s.global)}`}>
                      ⛓ {s.global.settled} settled
                      {s.global.qualifiedWithdrawn > 0 && ` · ${s.global.qualifiedWithdrawn} abandoned`}
                      {s.global.settled + s.global.qualifiedWithdrawn > 0 && ` · ${pct(s.global.reliability)}`}
                      {s.global.settled + s.global.qualifiedWithdrawn === 0 && ' · no record yet'}
                    </div>
                    {excludedCount(s.global) > 0 && (
                      <div className="ms-excluded" title="Indexed and queryable — excluded from scoring by the published rules">
                        {excludedCount(s.global)} signal{excludedCount(s.global) === 1 ? '' : 's'} excluded
                        {s.global.probeChannels > 0 && ` · ${s.global.probeChannels} probe`}
                        {s.global.renewals > 0 && ` · ${s.global.renewals} renewal`}
                        <br />
                        <span className="naive">a naive count would read {pct(s.global.naiveReliability)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  graph?.enabled && graph.live && (
                    <div className="ms-chain new">⛓ no on-chain history</div>
                  )
                )}

                <div className={`ms-state${s.online && s.sameNetwork !== false ? ' on' : ''}`}>
                  {!s.online
                    ? 'offline'
                    : s.sameNetwork === false
                      ? 'unreachable from your network'
                      : state?.selected === s.id
                        ? '✓ active — tap to use'
                        : 'online — tap to use'}
                </div>
              </button>
            );
          })}
        </div>

        {!sellers.length && (
          <div className="ms-empty">
            <div className="ms-empty-dot" />
            Searching for peers… run <code>npm run sell</code> on a GPU machine, or flip to{' '}
            <b>Share GPU &amp; Earn</b> on another device.
          </div>
        )}
      </section>

      <Integrations state={state} />
    </div>
  );
}
