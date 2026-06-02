// Conduit buyer agent — autonomous "answer-free-or-pay-to-escalate".
//
// For each prompt: ask the confidence router (local 0.6B + self-consistency). If confident → return
// the free local answer. If unsure → the SPEND POLICY (not the model, not the seller) decides whether
// a payment is allowed; if so, pay USD₮ → confirm on-chain → delegate the real inference to the seller
// over E2E P2P and return that answer. If the budget says no, fall back to the local best.
import type { Router } from './router';
import type { ConduitAccount } from '../core/wallet';
import type { SpendPolicy } from './policy';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AgentDeps {
  router: Router;
  buyer: ConduitAccount; // pays
  sellerAccount: ConduitAccount; // read-only here, to confirm receipt
  token: string; // USD₮ contract
  sellerModel: string; // model-constant name to delegate
  providerPub: string; // seller's gated provider pubkey
  price: bigint; // USD₮ base units per escalation
  policy: SpendPolicy;
  log?: (m: string) => void;
}

export interface AgentResult {
  source: 'local' | 'paid' | 'declined';
  answer: string;
  consistency: number;
  cost: bigint;
  tx?: string;
  note?: string;
  stats?: { ttftMs?: number; tps?: number; promptTokens?: number };
}

export interface Agent {
  ask(prompt: string): Promise<AgentResult>;
}

export async function createAgent(deps: AgentDeps): Promise<Agent> {
  const sdk: any = await import('@qvac/sdk');
  const log = deps.log ?? (() => {});
  let delegatedId: string | undefined;

  async function ensureDelegated(): Promise<string> {
    if (!delegatedId) {
      delegatedId = await sdk.loadModel({
        modelSrc: sdk[deps.sellerModel],
        modelType: 'llm',
        delegate: { providerPublicKey: deps.providerPub, timeout: 60000, fallbackToLocal: false },
      });
    }
    return delegatedId!;
  }

  return {
    async ask(prompt: string): Promise<AgentResult> {
      const r = await deps.router.route(prompt);
      if (r.decision === 'local') {
        return { source: 'local', answer: r.draft, consistency: r.consistency, cost: 0n };
      }

      // Router recommends escalation — but ONLY the spend policy authorizes a payment.
      const verdict = deps.policy.check(deps.price);
      if (!verdict.ok) {
        return { source: 'declined', answer: r.draft, consistency: r.consistency, cost: 0n, note: `${verdict.reason} — answered locally` };
      }

      // Pay, then confirm the seller actually received it before delegating.
      const s0 = await deps.sellerAccount.tokenBalance(deps.token);
      const tx = await deps.buyer.transferToken(deps.token, deps.sellerAccount.address, deps.price);
      log(`    paid (tx ${String(tx?.hash).slice(0, 14)}…), confirming on-chain…`);
      let s1 = s0;
      for (let i = 0; i < 45 && s1 <= s0; i++) {
        await sleep(2000);
        s1 = await deps.sellerAccount.tokenBalance(deps.token);
      }
      if (s1 - s0 < deps.price) {
        return { source: 'declined', answer: r.draft, consistency: r.consistency, cost: 0n, note: 'payment unconfirmed — answered locally' };
      }
      deps.policy.record(deps.price);

      // Delegate the real inference (runs on the seller's GPU, E2E).
      const modelId = await ensureDelegated();
      const run = sdk.completion({ modelId, history: [{ role: 'user', content: prompt }], stream: true, captureThinking: true, kvCache: false });
      let answer = '';
      for await (const ev of run.events) {
        if (ev.type === 'contentDelta') answer += ev.text;
      }
      const final = await run.final.catch(() => null);
      return {
        source: 'paid',
        answer: answer.trim(),
        consistency: r.consistency,
        cost: deps.price,
        tx: tx?.hash,
        stats: { ttftMs: final?.stats?.timeToFirstToken, tps: final?.stats?.tokensPerSecond, promptTokens: final?.stats?.promptTokens },
      };
    },
  };
}
