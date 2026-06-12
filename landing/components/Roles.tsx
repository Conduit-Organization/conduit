import { ShoppingCart, Server } from "lucide-react";
import SectionHeader from "./SectionHeader";
import Reveal from "./Reveal";

const BUYER = [
  <>Install Conduit and <b>create your wallet</b> — a 12-word recovery phrase, locked with a password.</>,
  <>Top it up with free <b>test USD₮</b> from the in-app faucet link.</>,
  <>Open the marketplace and <b>pick a seller</b> by reputation, price, and speed — or let Conduit auto-route.</>,
  <>Ask. An escrow channel opens, and each answer is paid with a signed voucher. <b>Answers in ~2s.</b></>,
];

const SELLER = [
  <>Conduit <b>benchmarks your device</b> and highlights the best model it can run profitably.</>,
  <>Pick that model (or any other your hardware can handle) and <b>go online</b>.</>,
  <>Your offer is published to the network; buyers anywhere can <b>discover you over the DHT</b>.</>,
  <>Serve answers and <b>earn USD₮</b>. Payments settle to your wallet — reputation builds with every request.</>,
];

function Lane({
  tone,
  tag,
  icon: Icon,
  steps,
}: {
  tone: "mint" | "amber";
  tag: string;
  icon: typeof ShoppingCart;
  steps: React.ReactNode[];
}) {
  const tagClass =
    tone === "mint"
      ? "border-mint-line bg-mint-soft text-mint"
      : "border-amber/30 bg-amber-soft text-amber";
  return (
    <div className="panel h-full p-6 sm:p-7">
      <span
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-semibold ${tagClass}`}
      >
        <Icon size={15} aria-hidden />
        {tag}
      </span>
      <ol className="mt-6 space-y-5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3.5">
            <span className="mono grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line-2 bg-ink-3 text-[13px] text-text">
              {i + 1}
            </span>
            <p className="pt-0.5 text-[14.5px] leading-relaxed text-muted [&_b]:font-semibold [&_b]:text-text">
              {s}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function Roles() {
  return (
    <section id="roles" className="wrap py-24 sm:py-28">
      <SectionHeader
        eyebrow="Two roles, one app"
        title={
          <>
            The same download is <em>both</em> sides of the market
          </>
        }
        lead="A non-custodial USD₮ wallet is created on first launch and lives only on your device. Flip between buying and selling whenever you like."
      />
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Reveal>
          <Lane tone="mint" tag="As a buyer" icon={ShoppingCart} steps={BUYER} />
        </Reveal>
        <Reveal delay={0.1}>
          <Lane tone="amber" tag="As a seller" icon={Server} steps={SELLER} />
        </Reveal>
      </div>
    </section>
  );
}
