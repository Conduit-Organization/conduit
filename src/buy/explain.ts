// Turn a failed purchase into a sentence a buyer can act on.
//
// The agent used to surface `e.message` verbatim. For a seller's refusal that is exactly
// right — "unverified human", "buyer abandonment history" — those reasons are the whole
// point of the accountability layers and must not be flattened. But for anything below
// that, the buyer got the library's own words, and the library talks about ABI decoding:
//
//     could not decode result data (value="0x", info={ "method": "channels" ... })
//
// which tells someone who wants an answer to a question nothing at all, and hides the one
// fact that mattered (the escrow address belonged to another network).
//
// So: pass a seller's reasoning through untouched, and translate the plumbing.

export interface Explained {
  /** What to show the buyer. */
  note: string;
  /** The original text, kept for the log so nothing is lost. */
  raw: string;
}

/** Reasons that come from the seller are already in human terms — never rewrite them. */
function isSellerRefusal(msg: string): boolean {
  return /^seller rejected:/i.test(msg) || /\bseller (refused|rejected)\b/i.test(msg);
}

/**
 * Matched in order; the first hit wins. Each pattern names a failure the buyer can
 * actually do something about, and the replacement says what that is.
 */
const RULES: Array<{ test: RegExp; note: (m: string, sym: string) => string }> = [
  {
    // The escrow address holds no code on this chain — a wrong-network deployment.
    test: /could not decode result data|BAD_DATA|call revert exception/i,
    note: () =>
      'The escrow contract did not answer on this network. The app is pointed at a chain where it is not deployed — check the network in the marketplace panel.',
  },
  {
    // Arc: gas and settlement are the same asset, so this is one balance to top up.
    test: /insufficient funds|gas required exceeds|cannot estimate gas/i,
    note: (_m, sym) =>
      `Not enough ${sym} in your wallet to cover this transaction. Add funds from the faucet in the wallet menu and try again.`,
  },
  {
    test: /transfer amount exceeds balance|ERC20: transfer amount|insufficient allowance/i,
    note: (_m, sym) =>
      `Not enough ${sym} to fund a payment channel with this seller. Add funds from the faucet in the wallet menu and try again.`,
  },
  {
    test: /timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network error|failed to fetch|SERVER_ERROR/i,
    note: () =>
      'Could not reach the network to settle the payment. Check your connection and try again — nothing was charged.',
  },
  {
    test: /nonce|replacement fee too low|already known/i,
    note: () =>
      'A previous transaction from this wallet is still pending. Wait a few seconds and try again.',
  },
  {
    test: /channel (is )?expired|expiry/i,
    note: () =>
      'Your payment channel with this seller expired. Ask again and a fresh one will be opened automatically.',
  },
];

/**
 * @param err    the thrown error (or anything stringifiable)
 * @param symbol the settlement ticker, so the advice names the right asset
 */
export function explainPurchaseFailure(err: unknown, symbol = 'USDC'): Explained {
  const raw = String((err as any)?.message ?? err ?? 'unknown error');

  // A seller telling us why it said no is already the clearest possible answer.
  if (isSellerRefusal(raw)) return { note: raw, raw };

  for (const r of RULES) {
    if (r.test.test(raw)) return { note: r.note(raw, symbol), raw };
  }
  // Unrecognised: keep the original rather than inventing a friendlier lie about it.
  return { note: raw, raw };
}
