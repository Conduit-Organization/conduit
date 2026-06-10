import { useEffect, useState } from 'react';
import type { State, Peer } from '../api';
import { Star } from './icons';
import { fmt, short, modelName } from '../format';
import * as bm from '../bookmarks';

// The buyer's landing screen (Binance-P2P style): browse sellers, ★ bookmark, pick one — or Auto —
// then enter chat. Choosing a seller ≠ paying: easy questions still answer free on-device; the chosen
// seller is paid only when a question escalates.
export default function MarketplaceScreen({
  state,
  sellers,
  onPick,
}: {
  state: State | null;
  sellers: Peer[];
  onPick: (id: string) => void; // select the seller (or 'auto') AND enter chat
}) {
  const [marks, setMarks] = useState<bm.Bookmark[]>([]);
  useEffect(() => { setMarks(bm.load()); }, []);

  const online = sellers.filter((s) => s.online);
  const byAddr = new Map(sellers.map((s) => [s.address.toLowerCase(), s]));

  // Reputation label from this buyer's own history with the seller.
  function rep(s: Peer): { label: string; cls: string } {
    const n = s.served + s.failed;
    if (n === 0) return { label: 'new peer', cls: 'new' };
    const pct = Math.round(s.successRate * 100);
    return { label: `★ ${pct}% · ${s.served} served`, cls: pct >= 90 ? 'good' : pct >= 60 ? 'ok' : 'bad' };
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
          Pick a GPU peer — or <b>Auto</b> — then ask. Easy questions answer{' '}
          <b>free, on-device</b>; your chosen peer is paid <span className="pay">only when it's worth escalating</span>.
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
                    {fmt(live?.price ?? b.price)} USD₮{live ? ` · ${Math.round(live.tps)} tps` : ''}
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
        <div className="ms-grid">
          <button className="ms-card auto" onClick={() => onPick('auto')}>
            <div className="ms-card-top">
              <span className="ms-model"><b>Auto</b></span>
              {state?.selected === 'auto' && <span className="ms-check">✓ active</span>}
            </div>
            <div className="ms-sub">cheapest, then fastest</div>
            <div className="ms-addr">picks the best peer for each paid answer</div>
            <div className="ms-state on">tap to use</div>
          </button>

          {sellers.map((s) => {
            const marked = marks.some((m) => m.address.toLowerCase() === s.address.toLowerCase());
            return (
              <button
                key={s.id}
                className={`ms-card${s.online ? '' : ' off'}`}
                onClick={() => s.online && onPick(s.id)}
                disabled={!s.online}
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
                <div className="ms-sub">{fmt(s.price)} USD₮ · {Math.round(s.tps)} tps</div>
                <div className="ms-addr">{short(s.address)}</div>
                <div className={`ms-rep ${rep(s).cls}`}>{rep(s).label}</div>
                <div className={`ms-state${s.online ? ' on' : ''}`}>
                  {s.online ? (state?.selected === s.id ? '✓ active — tap to use' : 'online — tap to use') : 'offline'}
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
    </div>
  );
}
