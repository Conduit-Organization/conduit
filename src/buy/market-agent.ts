// Conduit market agent — same "answer-free-or-pay-to-escalate" brain as the single-machine agent,
// but escalation goes through the live storefront (a real REMOTE seller) instead of a local provider.
// Router recommends → SpendPolicy authorises → storefront.purchase pays the active seller → delegate.
import type { Router } from './router';
import type { SpendPolicy } from './policy';
import type { Storefront } from './storefront';
import type { AgentResult } from './agent';

export interface MarketAgentDeps {
  router: Router;
  policy: SpendPolicy;
  storefront: Storefront;
  predict?: number;
  log?: (m: string) => void;
}

export interface MarketAgent {
  ask(prompt: string): Promise<AgentResult>;
}

export function createMarketAgent(deps: MarketAgentDeps): MarketAgent {
  const log = deps.log ?? (() => {});
  return {
    async ask(prompt: string): Promise<AgentResult> {
      const r = await deps.router.route(prompt);
      if (r.decision === 'local') {
        return { source: 'local', answer: r.draft, consistency: r.consistency, cost: 0n };
      }

      // Router wants to escalate — but only if there's a seller AND the spend policy authorises it.
      const seller = deps.storefront.getActive();
      if (!seller) {
        return { source: 'declined', reason: 'no-seller', answer: r.draft, consistency: r.consistency, cost: 0n, note: 'no peer online to escalate to — answered locally' };
      }
      const verdict = deps.policy.check(seller.priceBaseUnits);
      if (!verdict.ok) {
        return { source: 'declined', reason: 'budget', answer: r.draft, consistency: r.consistency, cost: 0n, note: `${verdict.reason} — answered locally` };
      }

      try {
        log(`[agent] escalating to ${seller.model} @ ${seller.sellerWallet.slice(0, 10)}…`);
        const res = await deps.storefront.purchase(seller, prompt, { predict: deps.predict ?? 1024 });
        deps.policy.record(res.cost);
        return { source: 'paid', answer: res.answer, consistency: r.consistency, cost: res.cost, tx: res.txHash, stats: res.stats };
      } catch (e: any) {
        // pay/grant/delegate failed (timeout, disconnect, unconfirmed) — fall back to the local draft
        return { source: 'declined', reason: 'error', answer: r.draft, consistency: r.consistency, cost: 0n, note: `escalation failed (${String(e?.message ?? e)}) — answered locally` };
      }
    },
  };
}
