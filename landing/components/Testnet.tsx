import { FlaskConical, Droplets } from "lucide-react";
import Reveal from "./Reveal";

export default function Testnet() {
  return (
    <section id="testnet" className="wrap py-12">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-amber/25 p-8 sm:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(700px 300px at 12% -30%, rgba(255,196,77,0.10), transparent 70%), var(--ink-2)",
            }}
          />
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <span className="eyebrow inline-flex items-center gap-2 text-amber">
                <FlaskConical size={14} aria-hidden /> Public testnet · v0.1.0
              </span>
              <h2 className="display mt-3 text-[clamp(26px,3.6vw,38px)]">
                Try the real architecture, <em className="not-italic text-amber italic">end to end</em>
              </h2>
              <p className="mt-4 text-[15.5px] leading-relaxed text-muted">
                Payments use <b className="font-semibold text-text">test USD₮ on the Sepolia network</b> — no
                real money moves. Everything else is the genuine thing: real P2P discovery, real escrow
                channels, real signed vouchers, real on-device inference. Grab free test USD₮ from the in-app
                faucet link and exercise the whole flow.
              </p>
            </div>
            <ul className="flex shrink-0 flex-col gap-2.5">
              {[
                { icon: FlaskConical, label: "Test USD₮ · Sepolia" },
                { icon: Droplets, label: "Free in-app faucet" },
              ].map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="mono inline-flex items-center gap-2.5 rounded-xl border border-line bg-ink-1 px-4 py-3 text-[13px] text-muted"
                >
                  <Icon size={15} className="text-amber" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
