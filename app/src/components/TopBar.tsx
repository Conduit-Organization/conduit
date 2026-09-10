import type { State } from '../api';
import { Mark, Bolt, Gpu } from './icons';
import { fmt, short } from '../format';

export type Role = 'buyer' | 'seller';

// The persistent app header: brand · Buyer⇄Seller role toggle · status chips · wallet pill.
// One install does both roles; the toggle is switchable anytime and persisted by App.
//
// ETHOnline 2026: two chips make the new guarantees visible rather than implicit — which
// settlement network is live, and whether this wallet is backed by a verified unique
// human. Both state what is actually true, including when the answer is "not verified".
export default function TopBar({
  role,
  onRole,
  state,
  flash,
  onManage,
}: {
  role: Role;
  onRole: (r: Role) => void;
  state: State | null;
  flash: boolean;
  onManage: () => void;
}) {
  const addr = state?.buyer?.address ?? state?.wallet.address ?? '';
  const net = state?.network;
  const human = state?.human;
  const humanTitle = !human?.enabled
    ? 'Human proofs are turned off on this engine'
    : !human.checked
      ? 'Checking AgentBook on World Chain…'
      : human.verified
        ? `Backed by a verified unique human — AgentBook id ${human.humanId?.slice(0, 14)}…`
        : 'This wallet is not registered in AgentBook. Sellers requiring a human will refuse it.';

  return (
    <header className="topbar">
      <div className="tb-brand">
        <Mark size={26} />
        <div>
          <div className="wordmark">Conduit</div>
          <div className="tag">P2P inference · USD₮</div>
        </div>
      </div>

      <div className="role-toggle" role="tablist" aria-label="Role">
        <button
          className={`role-opt${role === 'buyer' ? ' on' : ''}`}
          onClick={() => onRole('buyer')}
          role="tab"
          aria-selected={role === 'buyer'}
        >
          <Bolt />
          <span className="ro-t">Ask &amp; Pay</span>
        </button>
        <button
          className={`role-opt${role === 'seller' ? ' on' : ''}`}
          onClick={() => onRole('seller')}
          role="tab"
          aria-selected={role === 'seller'}
        >
          <Gpu />
          <span className="ro-t">Share GPU &amp; Earn</span>
        </button>
      </div>

      <div className="tb-status">
        {net && (
          <span className="tb-chip net" title={`Settling on ${net.label} · ${net.explorer}`}>
            <i className="mdot on" />
            {net.label}
          </span>
        )}
        {human?.enabled && (
          <span
            className={`tb-chip human${human.verified ? ' ok' : human.checked ? ' no' : ''}`}
            title={humanTitle}
          >
            {human.verified ? '✓ human-verified' : human.checked ? 'not verified' : 'checking…'}
          </span>
        )}
      </div>

      <button className="wallet-pill" onClick={onManage} title="Manage wallet">
        <span className={`wp-bal${flash ? ' flash' : ''}`}>{fmt(state?.buyer?.usdt)}</span>
        <span className="wp-unit">USD₮</span>
        <span className="wp-addr">{short(addr)}</span>
      </button>
    </header>
  );
}
