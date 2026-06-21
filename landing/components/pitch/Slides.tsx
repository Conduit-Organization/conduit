"use client";

/**
 * Conduit pitch deck — the five slides. Same visual system as the landing site
 * (ink base, single mint accent, amber reserved for money, Instrument Serif /
 * Hanken Grotesk / JetBrains Mono). Each slide animates its contents in on mount;
 * the Deck shell handles navigation, the conduit rail, and slide transitions.
 */
import { motion } from "framer-motion";
import {
  Lock,
  Coins,
  Eye,
  Cpu,
  Network,
  Route,
  Receipt,
  Zap,
  Wallet,
  ShieldCheck,
  ArrowRight,
  Check,
  Github,
} from "lucide-react";
import BrandMark from "@/components/BrandMark";
import NodeSwarm from "@/components/NodeSwarm";
import { REPO } from "@/lib/site";

const LIVE = "https://www.conduitt.xyz";

/* ----------------------------------------------------------- shared motion */
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
};
const rise = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] } },
};

/* A slide is a centered stage; content lives in a constrained column. */
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full w-full items-center">
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="wrap w-full py-10 md:py-12"
      >
        {children}
      </motion.div>
    </div>
  );
}

function Kicker({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <motion.div variants={rise} className="mb-5 flex items-center gap-3">
      <span className="eyebrow">{children}</span>
      <span className="h-px flex-1 max-w-[120px] bg-line" />
      <span className="mono text-[12px] tracking-[0.18em] text-muted-2">{n} / 05</span>
    </motion.div>
  );
}

const M = motion.div;

/* ============================================================ 01 — WHY NOW */
function Why() {
  return (
    <div className="relative h-full w-full">
      {/* ambient living mesh — the network itself */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-70 [mask-image:radial-gradient(120%_90%_at_70%_40%,#000_30%,transparent_75%)]">
        <NodeSwarm className="h-full w-full" />
      </div>
      <Stage>
        <Kicker n="01">The pitch</Kicker>
        <M variants={rise}>
          <h1 className="display max-w-[18ch] text-[clamp(2.4rem,6.2vw,4.6rem)]">
            AI answers, bought and sold <em>between peers</em>.
          </h1>
        </M>
        <M variants={rise} className="mt-6 max-w-[58ch] text-[clamp(1.05rem,1.6vw,1.3rem)] text-muted">
          Conduit is a serverless marketplace for AI inference. A settled USD₮ micro-payment is the
          only access handshake — <span className="text-text">no cloud, no account, no middleman.</span>
        </M>
        <M
          variants={rise}
          className="mono mt-9 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] tracking-[0.04em] text-muted-2"
        >
          <span className="text-mint">Why now</span>
          <span className="text-line-2">/</span>
          <span>inference demand is exploding</span>
          <span className="text-line-2">·</span>
          <span>capable GPUs sit idle</span>
          <span className="text-line-2">·</span>
          <span>the cloud gatekeeps both</span>
        </M>
      </Stage>
    </div>
  );
}

/* ============================================================ 02 — PROBLEM */
function Bullet({ icon: Icon, children }: { icon: typeof Lock; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line-2 bg-ink-3 text-muted">
        <Icon size={15} aria-hidden />
      </span>
      <span className="text-[14.5px] leading-relaxed text-muted">{children}</span>
    </li>
  );
}

function Problem() {
  return (
    <Stage>
      <Kicker n="02">The problem</Kicker>
      <M variants={rise}>
        <h2 className="display max-w-[20ch] text-[clamp(2rem,4.6vw,3.4rem)]">
          Inference is <em>gated</em> on one side, idle on the other.
        </h2>
      </M>
      <div className="mt-9 grid gap-4 md:grid-cols-2">
        <M variants={rise} className="panel p-6">
          <div className="mono text-[12px] tracking-[0.16em] text-muted-2">TO USE A MODEL TODAY</div>
          <ul className="mt-5 space-y-4">
            <Bullet icon={Lock}>An account and an API key before you can ask a single question.</Bullet>
            <Bullet icon={Coins}>Usage metered and marked up — you rent compute you can&apos;t see.</Bullet>
            <Bullet icon={Eye}>Your prompts leave your machine for someone else&apos;s cloud.</Bullet>
          </ul>
        </M>
        <M variants={rise} className="panel p-6">
          <div className="mono text-[12px] tracking-[0.16em] text-muted-2">MEANWHILE, ON THE SUPPLY SIDE</div>
          <ul className="mt-5 space-y-4">
            <Bullet icon={Cpu}>Millions of capable GPUs sit idle most of the day.</Bullet>
            <Bullet icon={Wallet}>Their owners have no simple way to turn that silicon into income.</Bullet>
            <Bullet icon={Network}>There&apos;s no open market — and no open price — for inference.</Bullet>
          </ul>
        </M>
      </div>
      <M variants={rise} className="mt-6 mono text-center text-[13px] text-muted-2">
        Two unmet needs. Nothing connecting them.
      </M>
    </Stage>
  );
}

/* =========================================================== 03 — SOLUTION */
function Pillar({
  icon: Icon,
  title,
  children,
  money = false,
}: {
  icon: typeof Lock;
  title: string;
  children: React.ReactNode;
  money?: boolean;
}) {
  return (
    <M variants={rise} className="panel lift p-6">
      <span
        className={[
          "grid h-10 w-10 place-items-center rounded-xl border",
          money ? "border-amber/30 bg-amber-soft text-amber" : "border-mint-line bg-mint-soft text-mint",
        ].join(" ")}
      >
        <Icon size={19} aria-hidden />
      </span>
      <h3 className="mt-4 text-[16.5px] font-semibold text-text">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{children}</p>
    </M>
  );
}

function Solution() {
  return (
    <Stage>
      <Kicker n="03">The solution</Kicker>
      <M variants={rise}>
        <h2 className="display text-[clamp(2rem,4.8vw,3.6rem)]">
          The <em>payment</em> is the handshake.
        </h2>
      </M>
      <M variants={rise} className="mt-5 max-w-[62ch] text-[15.5px] text-muted">
        Buyers pay a fraction of a cent per answer in USD₮. Sellers earn from hardware they already own.
        A confirmed payment — not an API key — is what unlocks the model.
      </M>
      <div className="mt-9 grid gap-4 md:grid-cols-3">
        <Pillar icon={Coins} title="Pay per answer" money>
          A fraction of a cent in USD₮. Open a channel once, then settle off-chain per answer — instantly.
        </Pillar>
        <Pillar icon={ShieldCheck} title="Private &amp; serverless">
          Peers find each other directly. Your keys and your prompts never leave your device.
        </Pillar>
        <Pillar icon={Zap} title="Earn from idle silicon">
          Turn an idle GPU into income. Conduit benchmarks your machine and serves the model it runs best.
        </Pillar>
      </div>
    </Stage>
  );
}

/* ===================================================== 04 — HOW IT / QVAC */
const STEPS = [
  {
    n: "1",
    icon: Network,
    title: "Discover",
    body: "Peers meet over a DHT (Hyperswarm / Holepunch), NAT hole-punched. No server in the middle.",
  },
  {
    n: "2",
    icon: Route,
    title: "Route",
    body: "An on-device router answers easy prompts free, and escalates only the hard ones to a peer.",
  },
  {
    n: "3",
    icon: Receipt,
    title: "Pay",
    body: "Open an escrow channel, then pay per answer with signed EIP-712 vouchers. ~2s, no on-chain wait.",
  },
  {
    n: "4",
    icon: Cpu,
    title: "Run",
    body: "The seller's model executes on-device via QVAC — delegated to the buyer, firewall-gated.",
  },
];

function How() {
  return (
    <Stage>
      <Kicker n="04">How it works</Kicker>
      <M variants={rise}>
        <h2 className="display text-[clamp(1.9rem,4.4vw,3.2rem)]">
          Four hops from question to <em>paid answer</em>.
        </h2>
      </M>
      <div className="mt-8 grid gap-3 md:grid-cols-4">
        {STEPS.map((s) => (
          <M key={s.n} variants={rise} className="panel relative p-5">
            <div className="flex items-center justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-mint-line bg-mint-soft text-mint">
                <s.icon size={17} aria-hidden />
              </span>
              <span className="mono text-[28px] leading-none text-line-2">{s.n}</span>
            </div>
            <h3 className="mt-4 text-[15.5px] font-semibold text-text">{s.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
          </M>
        ))}
      </div>

      {/* QVAC integration — the engine that makes private, serverless inference possible */}
      <M
        variants={rise}
        className="mt-5 overflow-hidden rounded-2xl border border-mint-line bg-mint-soft p-5 md:p-6"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-[64ch]">
            <div className="mono text-[12px] tracking-[0.16em] text-mint">POWERED BY QVAC</div>
            <p className="mt-2 text-[14.5px] leading-relaxed text-text">
              Every model runs <span className="text-mint">fully on-device</span> through the QVAC runtime —
              private inference with delegated, firewall-gated execution. No prompt ever touches a cloud,
              and the seller never sees the buyer&apos;s keys.
            </p>
          </div>
          <ul className="mono grid shrink-0 gap-1.5 text-[12px] text-muted">
            {["QVAC on-device runtime", "WDK non-custodial wallet", "Hyperswarm discovery", "EIP-712 escrow vouchers"].map(
              (t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check size={13} className="text-mint" aria-hidden />
                  {t}
                </li>
              )
            )}
          </ul>
        </div>
      </M>
    </Stage>
  );
}

/* ===================================================== 05 — STATUS / VISION */
function Status() {
  const shipped = [
    "Public testnet, live on Sepolia",
    "Instant escrow payment channels",
    "Desktop app — Linux, macOS & Windows",
    "First-party seller reputation",
  ];
  const next = [
    "Mainnet USD₮ settlement",
    "Model auctions & richer routing",
    "A standing market of seed sellers",
    "Mobile & browser clients",
  ];
  return (
    <Stage>
      <Kicker n="05">Where it stands</Kicker>
      <M variants={rise}>
        <h2 className="display text-[clamp(2rem,4.8vw,3.6rem)]">
          Live on testnet. <em>Built to scale.</em>
        </h2>
      </M>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <M variants={rise} className="panel p-6">
          <div className="mono text-[12px] tracking-[0.16em] text-mint">SHIPPED</div>
          <ul className="mt-4 space-y-3">
            {shipped.map((t) => (
              <li key={t} className="flex items-start gap-3 text-[14.5px] text-text">
                <Check size={17} className="mt-0.5 shrink-0 text-mint" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </M>
        <M variants={rise} className="panel p-6">
          <div className="mono text-[12px] tracking-[0.16em] text-muted-2">NEXT</div>
          <ul className="mt-4 space-y-3">
            {next.map((t) => (
              <li key={t} className="flex items-start gap-3 text-[14.5px] text-muted">
                <ArrowRight size={16} className="mt-1 shrink-0 text-muted-2" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </M>
      </div>

      <M variants={rise} className="mt-7 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <p className="display max-w-[24ch] text-[clamp(1.3rem,2.4vw,1.9rem)] text-text">
          An open market for AI compute — <em>owned by no one, open to everyone.</em>
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <a
            href={LIVE}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-mint px-5 py-3 text-[14.5px] font-semibold text-[#062018] shadow-[0_10px_40px_-12px_var(--mint)] transition-shadow hover:shadow-[0_16px_52px_-12px_var(--mint)]"
          >
            Try Conduit <ArrowRight size={16} aria-hidden />
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-line-2 px-5 py-3 text-[14.5px] font-semibold text-text transition-colors hover:border-mint-line hover:bg-mint-soft"
          >
            <Github size={16} aria-hidden /> View the code
          </a>
        </div>
      </M>
    </Stage>
  );
}

/* The deck, in order. `label` shows in the deck chrome. */
export const SLIDES: { label: string; Comp: () => JSX.Element }[] = [
  { label: "Why now", Comp: Why },
  { label: "The problem", Comp: Problem },
  { label: "The solution", Comp: Solution },
  { label: "How it works", Comp: How },
  { label: "Status & vision", Comp: Status },
];
