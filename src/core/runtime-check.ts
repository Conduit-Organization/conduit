// Can this machine RECEIVE an answer? — asked before any money is committed.
//
// A buyer never loads a model locally: inference is delegated to the seller's GPU. But the
// delegated call still goes through this machine's own inference runtime, and if that
// runtime cannot start, the call fails — after the voucher has been signed and the seller
// has been paid.
//
// That is exactly what happened on a Mac whose native addon could not link:
//
//     paid 0.01 USDC but the answer never arrived —
//     RPC initialization timed out after 30000ms — the worker process may have failed to start
//
// Honest, but too late. The question "can I receive an answer?" has nothing to do with the
// seller, costs nothing to ask, and is answerable before spending anything.

export interface RuntimeStatus {
  /** true = the local runtime responded; false = it did not; null = not checked yet. */
  ok: boolean | null;
  /** Present when ok === false: what the runtime said, in its own words. */
  reason?: string;
}

/**
 * Ping the local inference runtime.
 *
 * `heartbeat()` is the cheapest call that forces the worker to exist — it loads no model
 * and starts no provider, so it neither downloads weights nor hands anyone a grant. A
 * worker that cannot start fails here in seconds instead of thirty seconds into a purchase.
 */
export async function checkLocalRuntime(sdk: any, timeoutMs = 45_000): Promise<RuntimeStatus> {
  try {
    await Promise.race([
      sdk.heartbeat(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`the local inference runtime did not respond within ${Math.round(timeoutMs / 1000)}s`)), timeoutMs),
      ),
    ]);
    return { ok: true };
  } catch (e: any) {
    // First line only: the runtime's own message is the useful part, the stack is not.
    return { ok: false, reason: String(e?.message ?? e).split('\n')[0] };
  }
}

/** What to tell a buyer whose own machine cannot receive an answer. */
export function cannotReceiveMessage(reason: string | undefined, symbol = 'USDC'): string {
  return (
    `this machine's inference runtime will not start, so an answer could not be delivered ` +
    `even if it were bought — nothing was charged. (${reason ?? 'no further detail'})`
  ).replace('USDC', symbol);
}
