import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMsg } from '../types';
import type { AskResult } from '../api';
import { Bolt, Coin, Local } from './icons';

// USD₮ amounts here are micro-payments — fractions of a cent (0.002–0.02). Two decimals would
// round them to "0.00", so show up to 4 decimals and trim trailing zeros (0.002, 0.005, 0.01).
function usdt(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function Stamp({ r }: { r: AskResult }) {
  if (r.source === 'paid') {
    return (
      <motion.span
        className="stamp paid"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 22 }}
      >
        <Coin /> Peer GPU · paid {usdt(r.cost)} USD₮
      </motion.span>
    );
  }
  if (r.source === 'declined') {
    // Every answer is bought from a peer, so a decline means the purchase did NOT happen.
    // Name the actual cause — the seller's refusal reason is how the accountability layers
    // become visible — rather than implying an answer was served anyway.
    const label =
      r.reason === 'no-seller' ? 'No peer online'
      : r.reason === 'budget' ? 'Spend limit reached'
      : r.reason === 'error' ? 'Purchase refused'
      : 'Not answered';
    return (
      <span className="stamp declined" title={r.note ?? undefined}>
        <Local /> {label}
      </span>
    );
  }
  return (
    <motion.span
      className="stamp local"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 22 }}
    >
      <Bolt /> On-device · free
    </motion.span>
  );
}

function Telemetry({ r }: { r: AskResult }) {
  // The confidence figure comes from the on-device router sampling itself. In always-pay
  // mode that router never runs, so consistency is 0 — showing "confidence 0.00" would be
  // reporting a measurement that was never taken. Omit it unless it means something.
  const hasConfidence = r.consistency > 0;
  return (
    <div className="telemetry">
      {hasConfidence && <span>confidence <b>{r.consistency.toFixed(2)}</b></span>}
      {r.source === 'paid' && r.stats.tps ? (
        <span><b>{Math.round(r.stats.tps)}</b> tok/s</span>
      ) : null}
      {r.source === 'paid' && r.stats.ttftMs ? (
        <span>ttft <b>{Math.round(r.stats.ttftMs)}ms</b></span>
      ) : null}
      <span className="ok">0 cloud bytes</span>
    </div>
  );
}


// ETHOnline 2026 — a seller REFUSING a session is a designed outcome, not a failure, so
// it should not render as a crash. Each reason names the layer that refused and what it
// means, because "which check said no" is the whole point of an accountable market.
const REFUSALS: Record<string, { layer: string; what: string }> = {
  'unverified human': {
    layer: 'World',
    what: 'This seller only admits buyers backed by a verified unique human. This wallet is not registered in AgentBook on World Chain.',
  },
  'buyer abandonment history': {
    layer: 'The Graph',
    what: 'This seller read your on-chain settlement record and declined — too many channels opened and abandoned without settling.',
  },
  'no open channel': {
    layer: 'Payment',
    what: 'No funded payment channel with this seller. Being a verified human is not enough on its own — payment and personhood are independent requirements.',
  },
  'deposit below price': {
    layer: 'Payment',
    what: 'Your channel deposit is smaller than this seller\'s price per answer.',
  },
  'channel expired': {
    layer: 'Payment',
    what: 'Your channel with this seller has passed its expiry. Reclaim the remainder and open a new one.',
  },
  'epoch mismatch': {
    layer: 'Payment',
    what: 'The channel was reopened since this session started. Reconnect to pick up the new epoch.',
  },
  'seller does not accept escrow channels': {
    layer: 'Payment',
    what: 'This seller has not enabled payment channels.',
  },
};

function Refusal({ reason }: { reason: string }) {
  // Match the longest known prefix, so 'channel read failed: <rpc detail>' still resolves.
  const key = Object.keys(REFUSALS).find((k) => reason.startsWith(k));
  const info = key ? REFUSALS[key]! : null;
  return (
    <div className="refusal">
      <div className="rf-head">
        <span className="rf-tag">refused</span>
        <code>{reason}</code>
      </div>
      {info && (
        <div className="rf-body">
          <span className="rf-layer">{info.layer}</span>
          {info.what}
        </div>
      )}
    </div>
  );
}

export default function Message({ m }: { m: ChatMsg }) {
  return (
    <motion.div
      className={`msg ${m.role}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="bubble">
        {m.role === 'me' ? (
          m.text
        ) : m.pending ? (
          <div className="thinking">
            <i /><i /><i />
            <span>routing your question…</span>
          </div>
        ) : m.error ? (
          m.error.startsWith('seller rejected: ') ? (
            <Refusal reason={m.error.slice('seller rejected: '.length)} />
          ) : (
            <div className="errline">⚠ {m.error}</div>
          )
        ) : (
          <>
            {m.result && <Stamp r={m.result} />}
            <div className="answer markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
            </div>
            {m.result && <Telemetry r={m.result} />}
          </>
        )}
      </div>
    </motion.div>
  );
}
