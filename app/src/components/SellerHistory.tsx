import { useEffect } from 'react';
import type { Peer, GraphStatus } from '../api';
import { useSymbol, useExplorer } from '../symbol';
import { modelName } from '../format';

// The full settlement record behind a seller's card.
//
// The card has room for one line, so it shows the conclusion: how many settled, and the
// hardened reliability. The reasoning is the interesting part — which signals were counted,
// which were set aside, and what the number would have been if nothing were set aside. That
// is the whole argument for indexing this on The Graph rather than trusting a self-reported
// score, and it deserves more than a tooltip.
//
// Everything here is derived from events ConduitEscrow emitted on-chain. Nothing is
// self-reported by the seller, and the address links to the explorer so a reader can check
// the underlying history rather than take this panel's word for it.

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function SellerHistory({
  seller,
  graph,
  onClose,
}: {
  seller: Peer;
  graph?: GraphStatus | null;
  onClose: () => void;
}) {
  const sym = useSymbol();
  const explorer = useExplorer();
  const g = seller.global ?? null;

  // Esc closes. A panel that can only be dismissed by hitting a small × is a panel people
  // feel trapped in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const excluded = g ? g.probeChannels + g.renewals : 0;
  const scoring = g ? g.settled + g.qualifiedWithdrawn : 0;

  return (
    <div className="sh-backdrop" onClick={onClose}>
      <div className="sh" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Seller settlement history">
        <div className="sh-head">
          <div>
            <div className="sh-eyebrow">Settlement history · indexed by The Graph</div>
            <h2>{modelName(seller.model)}</h2>
            <div className="sh-addr">
              {explorer
                ? <a href={`${explorer}/address/${seller.address}`} target="_blank" rel="noreferrer">{seller.address} ↗</a>
                : seller.address}
            </div>
          </div>
          <button className="sh-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!g ? (
          <p className="sh-empty">
            {graph?.enabled === false
              ? 'The global reputation layer is switched off on this engine, so no history is being read.'
              : graph?.live
                ? 'This seller has never opened a payment channel on this network. A first-time seller is not penalised for that — they are simply unproven.'
                : 'The subgraph has not finished syncing, so no history is available yet.'}
          </p>
        ) : (
          <>
            <div className="sh-headline">
              <div className="sh-big">
                <b>{scoring === 0 ? '—' : pct(g.reliability)}</b>
                <span>reliability</span>
              </div>
              <div className="sh-big">
                <b>{pct(g.globalScore)}</b>
                <span>overall score</span>
              </div>
              <div className="sh-big">
                <b>{g.totalClaimed} <i>{sym}</i></b>
                <span>earned on-chain</span>
              </div>
              <div className="sh-big">
                <b>{g.uniqueVerifiedBuyers}</b>
                <span>verified humans served</span>
              </div>
            </div>

            <div className="sh-sec">
              <div className="sh-label">What counts</div>
              <ul className="sh-rows">
                <li><span className="k">Sessions settled</span><span className="v ok">{g.settled}</span></li>
                <li>
                  <span className="k">
                    Channels abandoned
                    <em>funded, left unsettled — the only figure that counts against a seller</em>
                  </span>
                  <span className={`v${g.qualifiedWithdrawn > 0 ? ' bad' : ''}`}>{g.qualifiedWithdrawn}</span>
                </li>
              </ul>
            </div>

            {excluded > 0 && (
              <div className="sh-sec">
                <div className="sh-label">What was set aside</div>
                <ul className="sh-rows">
                  {g.probeChannels > 0 && (
                    <li>
                      <span className="k">
                        Probe channels
                        <em>too short, too small, or opened by a buyer with no settlement history</em>
                      </span>
                      <span className="v muted">{g.probeChannels}</span>
                    </li>
                  )}
                  {g.renewals > 0 && (
                    <li>
                      <span className="k">
                        Session renewals
                        <em>the buyer withdrew and immediately reopened — loyalty, not abandonment</em>
                      </span>
                      <span className="v muted">{g.renewals}</span>
                    </li>
                  )}
                </ul>
                <p className="sh-note">
                  These are indexed and queryable — they are not hidden. They are excluded from
                  scoring by published rules. Counting them the naive way would read this
                  seller as <b>{pct(g.naiveReliability)}</b> instead of <b>{pct(g.reliability)}</b>.
                </p>
              </div>
            )}

            <p className="sh-foot">
              Derived from events <code>ConduitEscrow</code> emitted on-chain, indexed by The Graph.
              Nothing here is self-reported.
              {graph?.countsHumans && ' Reach is counted in verified humans, not addresses.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
