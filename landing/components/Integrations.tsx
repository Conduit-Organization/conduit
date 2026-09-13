import { ArrowUpRight } from "lucide-react";
import SectionHeader from "./SectionHeader";
import Reveal from "./Reveal";
import { INTEGRATIONS } from "@/lib/site";

/**
 * The three things the marketplace rests on, and what each one is actually for.
 *
 * Deliberately framed as the gap each one closes rather than as a list of partners. A market
 * with no reputation makes every stranger a coin flip; reputation counted per address is free
 * to forge; and a seller earning one asset while paying gas in another does not add up. Arc,
 * The Graph and World answer those three in that order, and none of them is sufficient alone.
 *
 * Every address shown is deployed and links to a public explorer, so a reader can check the
 * claim instead of taking it.
 */
export default function Integrations() {
  return (
    <section id="integrations" className="wrap py-24 sm:py-28">
      <SectionHeader
        eyebrow="Built on"
        title={
          <>
            Three problems a market{" "}
            <em className="not-italic italic text-mint">cannot solve alone</em>
          </>
        }
        lead="Buying compute from a stranger needs somewhere for value to move, a record of how that stranger has behaved, and a reason that record cannot be manufactured."
      />

      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        {INTEGRATIONS.map((it, i) => (
          <Reveal key={it.name} delay={i * 0.08}>
            <div className="panel h-full p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[19px] font-semibold">{it.name}</h3>
                <span className="eyebrow text-mint">{it.role}</span>
              </div>

              <p className="mt-4 text-[14.5px] leading-relaxed text-muted">{it.what}</p>

              <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-line pt-4">
                {it.facts.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="mono text-[10px] uppercase tracking-[0.12em] text-muted-2">{k}</dt>
                    <dd className="mono text-[11.5px] text-text">{v}</dd>
                  </div>
                ))}
              </dl>

              <a
                href={it.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mono mt-5 inline-flex items-center gap-1.5 text-[12px] text-mint underline-offset-2 hover:underline"
              >
                verify on-chain <ArrowUpRight size={13} aria-hidden />
              </a>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
