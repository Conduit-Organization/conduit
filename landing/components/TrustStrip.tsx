import { PRIMITIVES } from "@/lib/site";

function Row({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <ul
      className="flex shrink-0 items-center gap-0"
      aria-hidden={ariaHidden || undefined}
      role={ariaHidden ? undefined : "list"}
    >
      {PRIMITIVES.map((p) => (
        <li key={p} className="flex items-center">
          <span className="mono whitespace-nowrap px-7 text-[13px] tracking-wide text-muted">
            {p}
          </span>
          <span className="h-1 w-1 rounded-full bg-mint/60" aria-hidden />
        </li>
      ))}
    </ul>
  );
}

/**
 * Honest "trusted by the architecture" strip — the real primitives Conduit is
 * built on, scrolling as a marquee. No fake logos, no invented metrics.
 */
export default function TrustStrip() {
  return (
    <section aria-label="What Conduit is built on" className="border-y border-line bg-ink-0/40 py-5">
      <p className="mono mb-4 text-center text-[11px] uppercase tracking-[0.18em] text-muted-2">
        No servers · no accounts · no middleman — just the real plumbing
      </p>
      <div
        className="group relative overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(90deg, transparent, #000 9%, #000 91%, transparent)",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent, #000 9%, #000 91%, transparent)",
        }}
      >
        <div className="flex w-max animate-marquee will-change-transform group-hover:[animation-play-state:paused]">
          <Row />
          <Row ariaHidden />
        </div>
      </div>
    </section>
  );
}
