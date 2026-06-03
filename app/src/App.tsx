import { useCallback, useEffect, useRef, useState } from 'react';
import { ask, getSellers, getState, selectSeller, type Peer, type State } from './api';
import type { ChatMsg } from './types';
import Rail from './components/Rail';
import Thread from './components/Thread';
import Composer from './components/Composer';
import WalletGate from './components/WalletGate';
import WalletMenu from './components/WalletMenu';
import { Mark } from './components/icons';

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [sellers, setSellers] = useState<Peer[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const idRef = useRef(0);
  const prevUsdt = useRef<number | null>(null);
  const nextId = () => ++idRef.current;

  const refresh = useCallback(async () => {
    try {
      const s = await getState();
      if (s.buyer) {
        // flash the balance amber when it drops (a peer was just paid)
        const usdt = Number(s.buyer.usdt);
        if (prevUsdt.current !== null && usdt < prevUsdt.current - 1e-9) {
          setFlash(true);
          setTimeout(() => setFlash(false), 900);
        }
        prevUsdt.current = usdt;
      }
      setState(s);
    } catch {
      /* engine still booting — keep last good state */
    }
    try {
      const sl = await getSellers();
      setSellers(sl.sellers);
    } catch {
      /* keep last seller list */
    }
  }, []);

  const onSelect = useCallback(
    async (id: string) => {
      try { await selectSeller(id); } catch { /* ignore */ }
      void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3500);
    return () => clearInterval(t);
  }, [refresh]);

  const send = useCallback(
    async (prompt: string) => {
      if (busy) return;
      setBusy(true);
      const meId = nextId();
      const aiId = nextId();
      setMessages((m) => [
        ...m,
        { id: meId, role: 'me', text: prompt },
        { id: aiId, role: 'ai', text: '', pending: true },
      ]);

      try {
        const r = await ask(prompt);
        setMessages((m) =>
          m.map((msg) =>
            msg.id === aiId
              ? r.error
                ? { ...msg, pending: false, error: r.error }
                : { ...msg, pending: false, text: r.answer, result: r }
              : msg,
          ),
        );
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        setMessages((m) => m.map((msg) => (msg.id === aiId ? { ...msg, pending: false, error } : msg)));
      } finally {
        setBusy(false);
        void refresh();
      }
    },
    [busy, refresh],
  );

  // ---- render ----
  if (!state) {
    return (
      <div className="boot">
        <Mark size={40} />
        <span>starting Conduit…</span>
      </div>
    );
  }
  if (!state.wallet.unlocked) {
    return <WalletGate status={state.wallet} onUnlocked={refresh} />;
  }
  return (
    <div className="app">
      <Rail state={state} sellers={sellers} flash={flash} onSelect={onSelect} onManage={() => setMenuOpen(true)} />
      <main className="main">
        <Thread messages={messages} onExample={send} />
        <Composer onSend={send} busy={busy} ready={!!state.ready} setupErr={state.setupErr} />
      </main>
      {menuOpen && state.wallet.address && (
        <WalletMenu
          address={state.wallet.address}
          onClose={() => setMenuOpen(false)}
          onLocked={() => { setMenuOpen(false); setMessages([]); void refresh(); }}
        />
      )}
    </div>
  );
}
