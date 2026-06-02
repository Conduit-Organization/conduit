// Conduit storefront wire protocol — newline-delimited JSON over a Hyperswarm connection.
// (bigints are sent as decimal strings; parse with BigInt on receipt.)
export type Msg =
  | { type: 'offer'; sellerWallet: string; model: string; priceBaseUnits: string; tps: number; token: string; chainId: number }
  | { type: 'quoteReq'; buyerConsumerPub: string; buyerWallet: string }
  | { type: 'quote'; price: string; sellerWallet: string; nonce: string; token: string; chainId: number }
  | { type: 'receipt'; nonce: string; txHash: string; buyerConsumerPub: string; buyerWallet: string; signature: string }
  | { type: 'grant'; providerPub: string }
  | { type: 'reject'; reason: string };

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
