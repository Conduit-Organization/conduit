import { useState } from 'react';
import { exportWallet, lockWallet } from '../api';

const FAUCETS = [
  { label: 'Sepolia ETH (gas) — pk910 PoW faucet', url: 'https://sepolia-faucet.pk910.de/' },
  { label: 'Sepolia ETH — Google Cloud faucet', url: 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia' },
  { label: 'Test USD₮ — Pimlico faucet', url: 'https://faucet.pimlico.io/' },
];

export default function WalletMenu({ address, onClose, onLocked }: { address: string; onClose: () => void; onLocked: () => void }) {
  const [tab, setTab] = useState<'fund' | 'export'>('fund');
  const [copied, setCopied] = useState(false);
  const [pw, setPw] = useState('');
  const [phrase, setPhrase] = useState('');
  const [revealErr, setRevealErr] = useState('');
  const [busy, setBusy] = useState(false);

  function copy() {
    void navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1100);
  }
  async function reveal() {
    if (!pw) { setRevealErr('Enter your wallet password.'); return; }
    setRevealErr(''); setBusy(true);
    try { setPhrase(await exportWallet(pw)); setPw(''); }
    catch (e) { setRevealErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function lock() {
    await lockWallet();
    onLocked();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Wallet</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="addr-box">
          <span className="mono">{address}</span>
          <button className="gate-link" onClick={copy}>{copied ? 'copied ✓' : 'copy'}</button>
        </div>

        <div className="tabs">
          <button className={`tab${tab === 'fund' ? ' on' : ''}`} onClick={() => setTab('fund')}>Add funds</button>
          <button className={`tab${tab === 'export' ? ' on' : ''}`} onClick={() => setTab('export')}>Recovery phrase</button>
        </div>

        {tab === 'fund' && (
          <div className="modal-body">
            <p className="gate-sub">This is a <b>testnet</b> wallet. Send test funds to your address above:
              you’ll need a little <b>Sepolia ETH</b> for gas and some <b>test USD₮</b> to pay peers.</p>
            <div className="faucets">
              {FAUCETS.map((f) => (
                <a className="faucet" key={f.url} href={f.url} target="_blank" rel="noreferrer">{f.label} ↗</a>
              ))}
            </div>
          </div>
        )}

        {tab === 'export' && (
          <div className="modal-body">
            {!phrase ? (
              <>
                <p className="gate-sub warn">Your recovery phrase controls your funds. Enter your password, and make sure no one is watching your screen.</p>
                <input className="gate-input" type="password" placeholder="Wallet password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reveal()} autoFocus />
                {revealErr && <div className="gate-err">{revealErr}</div>}
                <button className="gate-btn ghost" onClick={reveal} disabled={busy}>{busy ? 'Verifying…' : 'Reveal recovery phrase'}</button>
              </>
            ) : (
              <>
                <div className="seed-grid">
                  {phrase.split(' ').map((w, i) => (
                    <div className="seed-word" key={i}><span className="n">{i + 1}</span>{w}</div>
                  ))}
                </div>
                <button className="gate-link" onClick={() => navigator.clipboard?.writeText(phrase)}>copy phrase</button>
                <button className="gate-link" onClick={() => setPhrase('')}>hide</button>
              </>
            )}
          </div>
        )}

        <button className="gate-btn lock" onClick={lock}>Lock wallet</button>
      </div>
    </div>
  );
}
