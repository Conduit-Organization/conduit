import { useEffect, useRef } from 'react';
import type { ChatMsg } from '../types';
import Message from './Message';

const EXAMPLES = [
  'Explain how end-to-end encryption works',
  'Write a haiku about the ocean at night',
  'Plan a focused 3-day trip to Kyoto',
];

export default function Thread({
  messages,
  onExample,
}: {
  messages: ChatMsg[];
  onExample: (q: string) => void;
}) {
  const threadRef = useRef<HTMLDivElement>(null);

  // Position the most recent question near the top so long answers read top-down
  // (instead of yanking the view to the very bottom of a tall reply).
  useEffect(() => {
    const c = threadRef.current;
    if (!c) return;
    const mine = c.querySelectorAll<HTMLElement>('.msg.me');
    const last = mine[mine.length - 1];
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [messages]);

  return (
    <div className="thread" ref={threadRef}>
      <div className="thread-inner">
        {messages.length === 0 ? (
          <div className="hero">
            <h1>
              Ask <em>anything.</em>
            </h1>
            <p>
              Easy questions are answered <b>free, on your device</b>. Hard ones quietly{' '}
              <span className="pay">pay a peer's GPU</span> a fraction of a cent in USD₮ — end-to-end
              encrypted, never through a cloud.
            </p>
            <div className="chips">
              {EXAMPLES.map((q) => (
                <button key={q} className="chip" onClick={() => onExample(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} m={m} />)
        )}
      </div>
    </div>
  );
}
