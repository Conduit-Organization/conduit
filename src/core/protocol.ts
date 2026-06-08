// Conduit storefront wire protocol — newline-delimited JSON over a Hyperswarm connection.
// (bigints are sent as decimal strings; parse with BigInt on receipt.)
export type Msg =
  // ── per-inference settlement (M1–M3): one on-chain payment per escalation ──
  | { type: 'offer'; sellerWallet: string; model: string; priceBaseUnits: string; tps: number; token: string; chainId: number; escrow?: string }
  | { type: 'quoteReq'; buyerConsumerPub: string; buyerWallet: string }
  | { type: 'quote'; price: string; sellerWallet: string; nonce: string; token: string; chainId: number }
  | { type: 'receipt'; nonce: string; txHash: string; buyerConsumerPub: string; buyerWallet: string; signature: string }
  | { type: 'grant'; providerPub: string }
  | { type: 'reject'; reason: string }
  // ── escrow payment channel (M4e): open once on-chain, then instant off-chain vouchers ──
  // Buyer opened a channel on-chain → asks the seller to verify it and grant. Seller reads the
  // channel from the escrow contract (open, correct seller, deposit ≥ price, not expired) → grants.
  | { type: 'sessionOpen'; buyerConsumerPub: string; buyerWallet: string; epoch: string }
  | { type: 'sessionGrant'; providerPub: string; epoch: string }
  // Per inference: buyer sends a cumulative EIP-712 voucher (instant). Seller verifies + serves;
  // it redeems on-chain (claim/settle) later. `cumulative` is the running total owed this session.
  | { type: 'draw'; buyerWallet: string; cumulative: string; signature: string }
  | { type: 'drawAck'; cumulative: string };

export function send(conn: any, msg: Msg): void {
  conn.write(Buffer.from(JSON.stringify(msg) + '\n'));
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
      void handler(m);
    }
  });
  conn.on('error', () => {});
}

// The message a buyer signs to bind: payer wallet ↔ consumer pubkey ↔ single-use nonce.
export function bindMessage(nonce: string, consumerPub: string, wallet: string): string {
  return `conduit-bind|${nonce}|${consumerPub}|${wallet}`;
}
