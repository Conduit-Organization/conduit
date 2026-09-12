// Conduit storefront wire protocol — newline-delimited JSON over a Hyperswarm connection.
// (bigints are sent as decimal strings; parse with BigInt on receipt.)
import type { HumanProof } from './humanity';

export type Msg =
  // ── per-inference settlement (M1–M3): one on-chain payment per escalation ──
  // `requireHuman` (ETHOnline 2026): this seller only admits buyers backed by a verified
  // unique human. Advertised so a buyer can see the policy BEFORE opening a channel,
  // rather than paying first and being refused at sessionOpen.
  | { type: 'offer'; sellerWallet: string; model: string; priceBaseUnits: string; tps: number; token: string; chainId: number; escrow?: string; requireHuman?: boolean }
  | { type: 'quoteReq'; buyerConsumerPub: string; buyerWallet: string }
  | { type: 'quote'; price: string; sellerWallet: string; nonce: string; token: string; chainId: number }
  | { type: 'receipt'; nonce: string; txHash: string; buyerConsumerPub: string; buyerWallet: string; signature: string }
  | { type: 'grant'; providerPub: string }
  | { type: 'reject'; reason: string }
  // ── escrow payment channel (M4e): open once on-chain, then instant off-chain vouchers ──
  // Buyer opened a channel on-chain → asks the seller to verify it and grant. Seller reads the
  // channel from the escrow contract (open, correct seller, deposit ≥ price, not expired) → grants.
  // `humanProof` (ETHOnline 2026): an optional World AgentKit proof that a unique human
  // is behind this buyer wallet. Optional on the wire so a seller that does not require
  // it is unaffected and old buyers still interoperate; sellers running with
  // `requireHuman` reject a session that arrives without one. See src/core/humanity.ts.
  // Asked BEFORE any money moves: "if I opened a channel, would you serve me?" The seller
  // runs every check that does not depend on the channel existing — its policy on humans,
  // the buyer's abandonment record, whether its own model is actually loadable — and
  // answers plainly. Opening a channel costs a real on-chain deposit, so a buyer who is
  // going to be refused must find out while that still costs nothing.
  //
  // Optional on the wire in both directions: a seller too old to know this message simply
  // never answers, and the buyer proceeds as it always did after a short wait.
  | { type: 'sessionProbe'; buyerWallet: string; humanProof?: HumanProof }
  | { type: 'sessionProbeAck'; ok: boolean; reason?: string }
  | { type: 'sessionOpen'; buyerConsumerPub: string; buyerWallet: string; epoch: string; humanProof?: HumanProof }
  | { type: 'sessionGrant'; providerPub: string; epoch: string }
  // Per inference: buyer sends a cumulative EIP-712 voucher (instant). Seller verifies + serves;
  // it redeems on-chain (claim/settle) later. `cumulative` is the running total owed this session.
  | { type: 'draw'; buyerWallet: string; cumulative: string; signature: string }
  | { type: 'drawAck'; cumulative: string };

export function send(conn: any, msg: Msg): void {
  conn.write(Buffer.from(JSON.stringify(msg) + '\n'));
}

/**
 * Called when a message handler rejects. Replaceable so a node can route it into its own
 * log; the default makes sure it is never silent.
 */
let onHandlerError: (m: Msg, e: Error) => void = (m, e) => {
  console.error(`[wire] handler for '${m.type}' threw and sent no reply: ${e.message}`);
};

export function setHandlerErrorReporter(fn: (m: Msg, e: Error) => void): void {
  onHandlerError = fn;
}

export function onMessages(conn: any, handler: (m: Msg) => void | Promise<void>): void {
  let buf = '';
  conn.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m: Msg;
      try { m = JSON.parse(line) as Msg; } catch { continue; }
      // A handler that throws used to vanish here. The peer was then left waiting on a
      // reply that would never come, and the only symptom anywhere was a timeout on the
      // other side — which is how a buyer paid for a channel and then watched a seller
      // say nothing at all. Surface it; the handler still owns answering.
      // try/catch AND .catch: a synchronous throw never reaches Promise.resolve, and an
      // async rejection never reaches the try. Both have to be covered.
      const report = (e: unknown) => onHandlerError(m, e instanceof Error ? e : new Error(String(e)));
      try {
        Promise.resolve(handler(m)).catch(report);
      } catch (e) {
        report(e);
      }
    }
  });
  conn.on('error', () => {});
}

// The message a buyer signs to bind: payer wallet ↔ consumer pubkey ↔ single-use nonce.
export function bindMessage(nonce: string, consumerPub: string, wallet: string): string {
  return `conduit-bind|${nonce}|${consumerPub}|${wallet}`;
}
