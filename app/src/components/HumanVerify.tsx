import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { startHumanRegister, getHumanRegister, cancelHumanRegister, type RegisterStatus } from '../api';
import { short } from '../format';

// ETHOnline 2026 — becoming human-verified, inside the app.
//
// The app could already tell you that you were NOT verified, and then leave you there.
// This closes the loop: the engine drives the AgentKit CLI and returns a verification
// link, so a buyer goes from "not verified" to a wallet registered in AgentBook on World
// Chain without leaving the product or touching a terminal.
//
// The QR is generated here from the verification link. The AgentKit CLI only draws one
// when stdout is a TTY; piped into the engine it emits just the link, so the link is the
// contract and the drawing is ours.
export default function HumanVerify({ address, onClose, onVerified }: {
  address: string;
  onClose: () => void;
  onVerified: () => void;
}) {
  const [st, setSt] = useState<RegisterStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const notified = useRef(false);

  // Render the QR as soon as a verification link arrives. High error correction and a
  // generous quiet zone, because this gets scanned off a screen.
  useEffect(() => {
    if (!st?.url) { setQr(null); return; }
    let live = true;
    void QRCode.toDataURL(st.url, { errorCorrectionLevel: 'H', margin: 2, width: 320 })
      .then((d) => { if (live) setQr(d); })
      .catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [st?.url]);

  // Poll while a registration is in flight. World App round-trips take a while, so this
  // keeps going until the engine reports a terminal phase.
  useEffect(() => {
    if (!st || st.phase === 'idle' || st.phase === 'done' || st.phase === 'error') return;
    const t = setInterval(async () => {
      try { setSt(await getHumanRegister()); } catch { /* keep the last known phase */ }
    }, 1500);
    return () => clearInterval(t);
  }, [st]);

  // Tell the app once, so the header can drop its cached lookup and flip to verified.
  useEffect(() => {
    if (st?.phase === 'done' && !notified.current) { notified.current = true; onVerified(); }
  }, [st, onVerified]);

  const begin = useCallback(async () => {
    setBusy(true);
    try { setSt(await startHumanRegister()); }
    catch (e) { setSt({ phase: 'error', address, url: null, txHash: null, error: e instanceof Error ? e.message : String(e), startedAt: null }); }
    finally { setBusy(false); }
  }, [address]);

  const close = useCallback(async () => {
    // Abandoning mid-flight should not leave a child process waiting on a scan.
    if (st && st.phase !== 'done' && st.phase !== 'idle') { try { await cancelHumanRegister(); } catch { /* ignore */ } }
    onClose();
  }, [st, onClose]);

  const phase = st?.phase ?? 'idle';

  return (
    <div className="hv-backdrop" onClick={close}>
      <div className="hv" onClick={(e) => e.stopPropagation()}>
        <div className="hv-head">
          <h2>Prove you're a human</h2>
          <button className="hv-x" onClick={close} aria-label="Close">×</button>
        </div>

        {phase === 'idle' && (
          <>
            <p className="hv-lead">
              Some sellers only sell GPU time to buyers backed by a <b>verified unique human</b>.
              This registers your wallet in <b>AgentBook</b> on World Chain, so those sellers will
              serve you.
            </p>
            <ul className="hv-facts">
              <li>Your wallet <code>{short(address)}</code> is linked to an <b>anonymous</b> identifier — never your identity.</li>
              <li>One World ID can back many wallets; they all resolve to the same person.</li>
              <li>Gasless. You need World App on your phone.</li>
            </ul>
            <button className="gate-btn primary hv-go" onClick={begin} disabled={busy}>
              {busy ? 'Starting…' : 'Verify with World ID'}
            </button>
          </>
        )}

        {phase === 'starting' && <div className="hv-wait"><i /><i /><i /><span>Creating a verification request…</span></div>}

        {phase === 'awaiting' && (
          <>
            <p className="hv-lead">Scan this with <b>World App</b>.</p>
            {qr
              ? <img className="hv-qr" src={qr} alt="World ID verification QR code" width={320} height={320} />
              : <div className="hv-wait"><i /><i /><i /><span>drawing code…</span></div>}
            {st?.url && (
              <a className="hv-link" href={st.url} target="_blank" rel="noreferrer">
                …or open the link on your phone
              </a>
            )}
            <div className="hv-wait"><i /><i /><i /><span>Waiting for you to confirm in World App…</span></div>
          </>
        )}

        {phase === 'registering' && (
          <>
            <div className="hv-ok">✓ World ID verified</div>
            <div className="hv-wait"><i /><i /><i /><span>Writing your registration to World Chain…</span></div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="hv-ok big">✓ You're verified</div>
            <p className="hv-lead">
              <code>{short(st?.address ?? address)}</code> is now registered in AgentBook. Sellers
              requiring a human will serve you.
            </p>
            {st?.txHash && (
              <a className="hv-link" href={`https://worldscan.org/tx/${st.txHash}`} target="_blank" rel="noreferrer">
                view the registration on World Chain
              </a>
            )}
            <button className="gate-btn primary hv-go" onClick={onClose}>Done</button>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="hv-err">Verification didn't complete</div>
            <p className="hv-lead">{st?.error}</p>
            <button className="gate-btn primary hv-go" onClick={begin} disabled={busy}>Try again</button>
          </>
        )}
      </div>
    </div>
  );
}
