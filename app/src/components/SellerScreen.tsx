import { useEffect, useState } from 'react';
import { getSellerProfile, type SellerStatus, type SellerProfile } from '../api';
import { Gpu } from './icons';
import { short, modelName } from '../format';

function usdtFromBaseUnits(v: string | null): string {
  if (v == null) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? (n / 1e6).toFixed(2) : '—';
}

// Seller mode: the prober (bench-profile.json) decides the OPTIMAL model for this machine; we
// highlight it as "Recommended" and pre-select it, but let the seller pick any model their GPU can
// actually run (price follows the model). Going online spawns the proven sell.ts child via the engine.
export default function SellerScreen({
  status,
  busy,
  onStart,
  onStop,
}: {
  status: SellerStatus | null;
  busy: boolean;
  onStart: (model?: string) => void;
  onStop: () => void;
}) {
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getSellerProfile().then((p) => {
      if (!live) return;
      setProfile(p);
      setChosen((c) => c ?? p.recommended ?? p.topSellable ?? p.models[0]?.id ?? null); // default to the prober's pick
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const running = !!status?.running;
  const online = !!status?.online;

  // When running, reflect the live offer; otherwise reflect the seller's current selection.
  const sel = profile?.models.find((m) => m.id === chosen) ?? null;
  const model = online ? status?.model ?? null : chosen;
  const price = online ? usdtFromBaseUnits(status?.price ?? null) : sel?.price ?? profile?.offer?.price ?? '—';
  const tps = online ? status?.tps ?? null : sel?.tps ?? profile?.offer?.tps ?? null;

  const dotClass = status?.error ? 'err' : online ? 'on' : running ? 'warm' : '';
  const stateText = status?.error
    ? `error: ${status.error}`
    : online
      ? 'Online — serving the marketplace'
      : running
        ? 'Starting up — joining the swarm…'
        : 'Offline';

  return (
    <div className="screen seller-screen">
      <div className="screen-head">
        <h1>Share your GPU &amp; Earn</h1>
        <p>
          Sell inference to peers over an <b>end-to-end encrypted</b> link. A buyer pays you in{' '}
          <span className="pay">USD₮ per answer</span> — the settled payment is the access handshake. Weights
          never leave this machine.
        </p>
      </div>

      <section className="card seller-offer">
        <div className="card-label">
          <span>Your offer</span>
          <span>{profile?.backend ? `${profile.backend} · ${profile.platform ?? ''}`.trim() : ''}</span>
        </div>

        {model ? (
          <div className="so-grid">
            <div className="so-cell">
              <div className="so-k">Model</div>
              <div className="so-v"><Gpu /> {modelName(model)}</div>
            </div>
            <div className="so-cell">
              <div className="so-k">Price / answer</div>
              <div className="so-v mint">{price} USD₮</div>
            </div>
            <div className="so-cell">
              <div className="so-k">Speed</div>
              <div className="so-v">{tps != null ? `${Math.round(tps)} tps` : '—'}</div>
            </div>
          </div>
        ) : (
          <p className="gate-sub" style={{ textAlign: 'left', margin: '12px 0 4px' }}>
            No capability profile yet. Run <code>npm run bench</code> on this machine to measure what it can
            sell (writes <code>bench-profile.json</code>), then come back.
          </p>
        )}

        {/* Model picker — runnable models for this GPU; the prober's pick is badged + pre-selected.
            Locked while online (change requires going offline first). */}
        {profile && profile.models.length > 0 && (
          <div className="model-picker">
            <div className="mp-label">Choose what to sell {online && <span className="mp-locked">· locked while online</span>}</div>
            {profile.models.map((m) => {
              const isRec = m.id === profile.recommended;
              const isSel = online ? m.id === status?.model : m.id === chosen;
              return (
                <button
                  key={m.id}
                  className={`mp-row${isSel ? ' sel' : ''}`}
                  onClick={() => !online && !running && setChosen(m.id)}
                  disabled={online || running}
                >
                  <span className="mp-top">
                    <span className="mp-name"><Gpu /> {modelName(m.id)}{isRec && <span className="mp-rec">★ recommended</span>}</span>
                    <span className="mp-check">{isSel ? '✓' : ''}</span>
                  </span>
                  <span className="mp-sub">{m.price} USD₮ / answer · {m.tps != null ? `~${Math.round(m.tps)} tps` : '—'}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="seller-go">
          <div className="sg-state">
            <i className={`dot ${dotClass}`} />
            <span className="peer-status">{stateText}</span>
          </div>
          {running ? (
            <button className="gate-btn lock" onClick={onStop} disabled={busy}>
              {busy ? 'Stopping…' : 'Go offline'}
            </button>
          ) : (
            <button className="gate-btn primary" onClick={() => onStart(chosen ?? undefined)} disabled={busy || !chosen}>
              {busy ? 'Starting…' : `Go online${sel ? ` with ${modelName(sel.id)}` : ''}`}
            </button>
          )}
        </div>
      </section>

      <section className="card seller-stats">
        <div className="card-label"><span>This session</span></div>
        <div className="ss-grid">
          <div className="ss-cell">
            <div className="ss-num">{status?.requestsServed ?? 0}</div>
            <div className="ss-k">requests served</div>
          </div>
          <div className="ss-cell">
            <div className="ss-num mint">{usdtFromBaseUnits(status?.earned ?? null)}</div>
            <div className="ss-k">USD₮ earned</div>
          </div>
          <div className="ss-cell">
            <div className="ss-num small">{short(status?.address ?? null)}</div>
            <div className="ss-k">earnings address</div>
          </div>
        </div>
        <div className="ss-note">
          Earnings land in account #1 of your wallet ({short(status?.address ?? null)}). Buyers pay this
          address directly on Sepolia.
        </div>
      </section>
    </div>
  );
}
