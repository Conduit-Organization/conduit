"use client";

/**
 * Conduit pitch deck shell. A fixed, full-viewport slideshow: one slide at a
 * time, advanced with ← → / space / buttons / the conduit rail / touch swipe.
 *
 * Signature element: the top "conduit rail" — progress rendered as a pipe with a
 * node per slide and a glowing packet that travels to the current slide. It
 * doubles as jump-nav. Everything else stays quiet so the rail is the one
 * memorable flourish.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Maximize2, Minimize2 } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import { SLIDES } from "./Slides";

const N = SLIDES.length;

const variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 64 : -64 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir >= 0 ? -64 : 64 }),
};

export default function Deck() {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(0);
  const [fs, setFs] = useState(false);

  const go = useCallback((to: number) => {
    setI((cur) => {
      const next = Math.max(0, Math.min(N - 1, to));
      if (next !== cur) setDir(next > cur ? 1 : -1);
      return next;
    });
  }, []);

  const next = useCallback(() => go(iRef.current + 1), [go]);
  const prev = useCallback(() => go(iRef.current - 1), [go]);

  // keep a ref so the global key handler always sees the latest index
  const iRef = useRef(i);
  iRef.current = i;

  // keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(N - 1);
          break;
        case "f":
        case "F":
          toggleFs();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, go]);

  // track fullscreen state changes (incl. Esc exit)
  useEffect(() => {
    const onFs = () => setFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  function toggleFs() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // touch swipe
  const touch = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.changedTouches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
    touch.current = null;
  }

  const { Comp, label } = SLIDES[i];
  const pct = N > 1 ? (i / (N - 1)) * 100 : 0;

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="fixed inset-0 z-[60] flex flex-col bg-ink-1"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* ambient corner glow (matches the site) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(1100px 560px at 80% -10%, rgba(43,227,168,0.07), transparent 60%), radial-gradient(900px 700px at -10% 110%, rgba(43,227,168,0.045), transparent 55%)",
          }}
        />

        {/* ---- top bar: brand · conduit rail · controls ---- */}
        <header className="shrink-0">
          <div className="wrap flex h-16 items-center justify-between gap-4">
            <a href="/" className="flex items-center gap-2.5" aria-label="Conduit home">
              <BrandMark size={26} />
              <span className="display text-[20px] leading-none">Conduit</span>
              <span className="mono ml-1 hidden text-[11px] tracking-[0.18em] text-muted-2 sm:inline">
                / PITCH
              </span>
            </a>
            <div className="flex items-center gap-4">
              <span className="mono text-[12px] tracking-[0.18em] text-muted-2">
                <span className="text-text">{String(i + 1).padStart(2, "0")}</span> / {String(N).padStart(2, "0")}
              </span>
              <button
                onClick={toggleFs}
                className="grid h-9 w-9 place-items-center rounded-lg border border-line-2 text-muted transition-colors hover:border-mint-line hover:text-mint"
                aria-label={fs ? "Exit fullscreen" : "Present fullscreen"}
              >
                {fs ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
              </button>
            </div>
          </div>

          {/* the conduit rail — pipe + nodes + traveling packet (also jump-nav) */}
          <div className="wrap pb-1">
            <div className="relative h-6">
              {/* pipe */}
              <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-line" />
              {/* energized portion */}
              <div
                className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-mint/70 shadow-[0_0_10px_var(--mint)] transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
              {/* nodes */}
              {SLIDES.map((s, idx) => {
                const done = idx <= i;
                return (
                  <button
                    key={s.label}
                    onClick={() => go(idx)}
                    aria-label={`Slide ${idx + 1}: ${s.label}`}
                    aria-current={idx === i ? "true" : undefined}
                    title={s.label}
                    className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-2"
                    style={{ left: `${N > 1 ? (idx / (N - 1)) * 100 : 0}%` }}
                  >
                    <span
                      className={[
                        "block h-2.5 w-2.5 rounded-full border transition-all duration-300",
                        idx === i
                          ? "scale-125 border-mint bg-mint shadow-[0_0_12px_var(--mint)]"
                          : done
                            ? "border-mint-line bg-mint/60"
                            : "border-line-2 bg-ink-3 group-hover:border-mint-line",
                      ].join(" ")}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/* ---- slide stage ---- */}
        <main className="relative min-h-0 flex-1">
          <AnimatePresence custom={dir} mode="wait" initial={false}>
            <motion.section
              key={i}
              custom={dir}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
              className="absolute inset-0 overflow-y-auto"
            >
              <Comp />
            </motion.section>
          </AnimatePresence>
        </main>

        {/* ---- bottom bar: current label · prev/next ---- */}
        <footer className="shrink-0">
          <div className="wrap flex h-16 items-center justify-between gap-4">
            <div className="mono flex items-center gap-2.5 text-[12.5px] text-muted-2">
              <span className="hidden sm:inline">{label}</span>
              <span className="hidden text-line-2 md:inline">·</span>
              <span className="hidden text-muted-2/80 md:inline">← → to navigate</span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                onClick={prev}
                disabled={i === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 px-3.5 py-2 text-[13.5px] font-medium text-text transition-colors hover:border-mint-line hover:bg-mint-soft disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-2 disabled:hover:bg-transparent"
                aria-label="Previous slide"
              >
                <ArrowLeft size={15} aria-hidden /> Prev
              </button>
              {i < N - 1 ? (
                <button
                  onClick={next}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-mint px-4 py-2 text-[13.5px] font-semibold text-[#062018] shadow-[0_8px_30px_-12px_var(--mint)] transition-shadow hover:shadow-[0_12px_40px_-12px_var(--mint)]"
                  aria-label="Next slide"
                >
                  Next <ArrowRight size={15} aria-hidden />
                </button>
              ) : (
                <a
                  href="/"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-mint-line bg-mint-soft px-4 py-2 text-[13.5px] font-semibold text-mint transition-colors hover:bg-mint/15"
                >
                  Back to site
                </a>
              )}
            </div>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
