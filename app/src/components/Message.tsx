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
    // The router WANTED a remote peer, but we fell back to the local draft. Tell the user the real
    // reason instead of always blaming the budget.
    const label =
      r.reason === 'no-seller' ? 'No peer online · on-device'
      : r.reason === 'error' ? 'Peer unreachable · on-device'
      : r.reason === 'budget' ? 'Budget reached · on-device'
      : 'Answered on-device';
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
  return (
    <div className="telemetry">
      <span>confidence <b>{r.consistency.toFixed(2)}</b></span>
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
          <div className="errline">⚠ {m.error}</div>
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
