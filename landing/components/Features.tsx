import { Zap, Radio, Coins } from "lucide-react";
import SectionHeader from "./SectionHeader";
import Reveal, { RevealGroup, RevealItem } from "./Reveal";
import Counter from "./Counter";

const FEATURES = [
  {
    icon: Zap,
    title: "Instant micro-payments",
    body: "Open an escrow payment channel once, then pay per answer with signed off-chain EIP-712 vouchers. Answers come back in about two seconds — no waiting on a chain confirmation every time.",
  },
  {
    icon: Radio,
    title: "Serverless & private",
    body: "Peers find each other over a distributed hash table with NAT hole-punching. No backend, no relay, no telemetry. Your prompt goes straight to the peer that answers it.",
  },
  {
    icon: Coins,
    title: "Earn from your hardware",
    body: "Idle GPU? Run an open-weight model and get paid in USD₮ for every answer you serve. Conduit benchmarks your device and recommends the most profitable model it can run well.",
  },
];

const STATS = [
  { value: 2, prefix: "~", suffix: "s", decimals: 0, label: "typical answer latency" },
  { value: 0, suffix: "", decimals: 0, label: "servers in the middle" },
  { value: 100, suffix: "%", decimals: 0, label: "on-device keys & prompts" },
  { value: 4, suffix: "+", decimals: 0, label: "open models ready" },
];

export default function Features() {
  return (
    <section id="why" className="wrap py-24 sm:py-28">
      <SectionHeader
        eyebrow="Why it's different"
        title={
          <>
            Three things a <em>cloud API</em> can&rsquo;t do
          </>
        }
        lead="There's no key to provision and no account to create. The whole network runs on a DHT — there is no server in the middle to go down, rate-limit you, or read your prompts."
      />

      {/* honest stat strip */}
      <RevealGroup className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
        {STATS.map((s) => (
          <RevealItem key={s.label} className="bg-ink-1 px-5 py-6 text-center">
            <div className="display text-[clamp(30px,5vw,44px)] text-mint">
              <Counter value={s.value} prefix={s.prefix} suffix={s.suffix} decimals={s.decimals} />
            </div>
            <div className="mono mt-2 text-[11px] uppercase tracking-[0.12em] text-muted-2">
              {s.label}
            </div>
          </RevealItem>
        ))}
      </RevealGroup>

      <RevealGroup className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3" stagger={0.1}>
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <RevealItem key={f.title}>
              <article className="panel lift h-full p-6">
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-mint-line bg-mint-soft text-mint">
                  <Icon size={20} aria-hidden />
                </span>
                <h3 className="mt-5 text-[18px] font-semibold">{f.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{f.body}</p>
              </article>
            </RevealItem>
          );
        })}
      </RevealGroup>

      <Reveal delay={0.1}>
        <p className="mono mt-6 text-center text-[12.5px] text-muted-2">
          One download is both buyer and seller — flip between them anytime.
        </p>
      </Reveal>
    </section>
  );
}
