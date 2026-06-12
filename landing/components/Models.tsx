import { Cpu, Smartphone } from "lucide-react";
import SectionHeader from "./SectionHeader";
import Reveal, { RevealGroup, RevealItem } from "./Reveal";
import { MODELS } from "@/lib/site";

const MAX_B = 4;

function paramsOf(size: string): number {
  return parseFloat(size); // "0.6B" -> 0.6, "1B" -> 1
}

export default function Models() {
  return (
    <section id="models" className="wrap py-24 sm:py-28">
      <SectionHeader
        eyebrow="Models"
        title={<>What you can run</>}
        lead="Open-weight models download on demand and run fully on-device through the QVAC runtime — no API calls leave your machine. Go online as a seller and Conduit benchmarks your hardware, then highlights the most profitable model it can serve smoothly. Buyers just see the answer."
      />

      <RevealGroup className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4" stagger={0.08}>
        {MODELS.map((m) => {
          const pct = Math.max(8, (paramsOf(m.size) / MAX_B) * 100);
          return (
            <RevealItem key={`${m.family}-${m.size}`}>
              <article className="panel lift h-full p-5">
                <div className="mono text-[12.5px] text-muted">{m.family}</div>
                <div className="display mt-1 text-[40px] leading-none text-text">
                  {m.size.replace("B", "")}
                  <span className="text-[20px] text-mint">B</span>
                </div>
                {m.note ? (
                  <span className="mono mt-3 inline-block rounded-full border border-line-2 px-2.5 py-1 text-[10.5px] text-mint">
                    {m.note}
                  </span>
                ) : (
                  <span className="mono mt-3 inline-block text-[10.5px] text-muted-2">params</span>
                )}
                <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--mint), #7af0cf)" }}
                  />
                </div>
              </article>
            </RevealItem>
          );
        })}
      </RevealGroup>

      <Reveal delay={0.05}>
        <p className="mono mt-5 text-center text-[13px] text-muted-2">
          …and larger open-weight models on capable GPUs.
        </p>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Reveal>
          <div className="panel flex h-full items-start gap-4 p-6">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line-2 bg-ink-3 text-mint">
              <Smartphone size={18} aria-hidden />
            </span>
            <div>
              <h3 className="text-[16px] font-semibold">Minimum to buy</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                Any modern laptop. Buying answers needs almost nothing locally — a small on-device router
                picks the right seller for you.
              </p>
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="panel flex h-full items-start gap-4 p-6">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-mint-line bg-mint-soft text-mint">
              <Cpu size={18} aria-hidden />
            </span>
            <div>
              <h3 className="text-[16px] font-semibold">To sell</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                A discrete GPU or Apple Silicon is ideal. Conduit measures your tokens-per-second and only
                recommends models you can serve well.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
