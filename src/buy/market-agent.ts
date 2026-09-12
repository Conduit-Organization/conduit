// Conduit market agent — decides where an answer comes from and pays for it.
//
// Two modes:
//
//   alwaysPay: true  (default)  every answer is bought from a peer. No local drafts, no
//                               silent downgrade — if nobody can serve you, you are told
//                               so rather than handed a worse answer pretending to be
//                               the same thing. Every question is a real settlement.
//
//   alwaysPay: false            the original routing brain: an on-device confidence
//                               router answers easy prompts free and escalates only
//                               genuinely uncertain ones. Kept intact and selectable.
//
// In always-pay mode the router is skipped entirely rather than run and ignored — five
// local samples per question is real latency, and paying for work whose result is
// discarded would be dishonest telemetry.
import type { Router } from './router';
import type { SpendPolicy } from './policy';
import type { Storefront } from './storefront';
import type { AgentResult } from './agent';

export interface MarketAgentDeps {
  router: Router;
  policy: SpendPolicy;
  storefront: Storefront;
  predict?: number;
  /** Buy every answer from a peer instead of ever answering locally. Default true. */
  alwaysPay?: boolean;
  log?: (m: string) => void;
}

export interface MarketAgent {
  ask(prompt: string): Promise<AgentResult>;
}

export function createMarketAgent(deps: MarketAgentDeps): MarketAgent {
  const log = deps.log ?? (() => {});
  const alwaysPay = deps.alwaysPay !== false;

  /** Buy the answer from `seller`, or explain precisely why we could not. */
  async function buy(prompt: string, draft: string, consistency: number): Promise<AgentResult> {
    const seller = deps.storefront.getActive();
    if (!seller) {
      return {
        source: 'declined', reason: 'no-seller', answer: draft, consistency, cost: 0n,
        note: alwaysPay
          ? 'No GPU peer is online. Start a seller, or wait for one to appear in the marketplace.'
          : 'no peer online to escalate to — answered locally',
      };
    }
    const verdict = deps.policy.check(seller.priceBaseUnits);
    if (!verdict.ok) {
      return {
        source: 'declined', reason: 'budget', answer: draft, consistency, cost: 0n,
        note: alwaysPay ? verdict.reason : `${verdict.reason} — answered locally`,
      };
    }

    try {
      log(`[agent] buying from ${seller.model} @ ${seller.sellerWallet.slice(0, 10)}…`);
      const res = await deps.storefront.purchase(seller, prompt, { predict: deps.predict ?? 1024 });
      deps.policy.record(res.cost);
      return { source: 'paid', answer: res.answer, consistency, cost: res.cost, tx: res.txHash, stats: res.stats };
    } catch (e: any) {
      // The seller's refusal reason matters — it is how the accountability layers become
      // visible ('unverified human', 'buyer abandonment history'), so pass it through
      // verbatim rather than flattening it into a generic failure.
      return {
        source: 'declined', reason: 'error', answer: draft, consistency, cost: 0n,
        note: String(e?.message ?? e),
      };
    }
  }

  return {
    async ask(prompt: string): Promise<AgentResult> {
      if (alwaysPay) return buy(prompt, '', 0);

      const r = await deps.router.route(prompt);
      if (r.decision === 'local') {
        return { source: 'local', answer: r.draft, consistency: r.consistency, cost: 0n };
      }
      return buy(prompt, r.draft, r.consistency);
    },
  };
}
