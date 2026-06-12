"use client";

import { useEffect, useRef } from "react";
import { useLenis } from "lenis/react";
import { Wallet, Cpu, FileSignature, Zap } from "lucide-react";
import { prefersReducedMotion } from "@/lib/useReducedMotion";

// Minimal shape of the lazily-loaded ScrollTrigger we hold onto.
type ScrollTriggerLike = { update: () => void; refresh: () => void };

const STEPS = [
  "Open the escrow channel",
  "Sign an EIP-712 voucher",
  "Voucher crosses the DHT",
  "Seller's GPU runs the model",
  "Answer returns · ~2s",
];

export default function Handshake() {
  const sectionRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const packetOutRef = useRef<HTMLDivElement>(null);
  const packetInRef = useRef<HTMLDivElement>(null);
  const stRef = useRef<ScrollTriggerLike | null>(null);

  // Keep ScrollTrigger's position in sync with Lenis' virtual scroll (once loaded).
  useLenis(() => stRef.current?.update());

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const section = sectionRef.current;
    const panel = panelRef.current;
    if (!section || !panel) return;

    let killed = false;
    let ctx: { revert: () => void } | undefined;

    async function setup() {
      // GSAP + ScrollTrigger load on demand — kept out of the initial bundle.
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (killed) return;
      gsap.registerPlugin(ScrollTrigger);
      stRef.current = ScrollTrigger as unknown as ScrollTriggerLike;

      ctx = gsap.context(() => {
        const distOut = () => (trackRef.current?.offsetWidth ?? 320) - 14;

        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: {
            trigger: section as HTMLElement,
            start: "top top",
            end: "+=2600",
            scrub: 0.8,
            pin: panel as HTMLElement,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

      // beat 1 — open the channel
      tl.from(".hs-line", { scaleX: 0, transformOrigin: "left center", duration: 1.1 }, 0)
        .from([".hs-buyer", ".hs-seller"], { autoAlpha: 0.35, scale: 0.96, duration: 0.8 }, 0)
        .from(".hs-step-0", { autoAlpha: 0.3, duration: 0.4 }, 0.15)
        .from(".hs-bar-0", { scaleX: 0, transformOrigin: "left center", duration: 0.9 }, 0.15)

        // beat 2 — sign voucher
        .from(".hs-voucher", { autoAlpha: 0, y: 16, scale: 0.95, duration: 0.7 }, 1.3)
        .from(".hs-step-1", { autoAlpha: 0.3, duration: 0.4 }, 1.3)
        .from(".hs-bar-1", { scaleX: 0, transformOrigin: "left center", duration: 0.9 }, 1.3)

        // beat 3 — voucher travels the conduit
        .fromTo(
          packetOutRef.current,
          { x: 0, autoAlpha: 0 },
          { x: distOut, autoAlpha: 1, duration: 1.1, ease: "power1.inOut" },
          2.5,
        )
        .to(packetOutRef.current, { autoAlpha: 0, duration: 0.2 }, 3.6)
        .from(".hs-step-2", { autoAlpha: 0.3, duration: 0.4 }, 2.5)
        .from(".hs-bar-2", { scaleX: 0, transformOrigin: "left center", duration: 0.9 }, 2.5)

        // beat 4 — seller runs the model
        .to(".hs-seller", { boxShadow: "0 0 0 1px var(--mint-line), 0 20px 60px -28px var(--mint)", duration: 0.4 }, 3.7)
        .from(".hs-running", { autoAlpha: 0, y: 8, duration: 0.5 }, 3.7)
        .fromTo(".hs-compute", { scaleY: 0.2, autoAlpha: 0.4 }, { scaleY: 1, autoAlpha: 1, duration: 0.5, stagger: 0.06 }, 3.8)
        .from(".hs-step-3", { autoAlpha: 0.3, duration: 0.4 }, 3.7)
        .from(".hs-bar-3", { scaleX: 0, transformOrigin: "left center", duration: 0.9 }, 3.7)

        // beat 5 — answer returns
        .fromTo(
          packetInRef.current,
          { x: distOut, autoAlpha: 0 },
          { x: 0, autoAlpha: 1, duration: 1.1, ease: "power1.inOut" },
          4.9,
        )
        .to(packetInRef.current, { autoAlpha: 0, duration: 0.2 }, 6.0)
        .from(".hs-answer", { autoAlpha: 0, y: 16, scale: 0.95, duration: 0.7 }, 5.4)
        .from(".hs-latency", { autoAlpha: 0, scale: 0.7, duration: 0.5 }, 5.9)
        .from(".hs-step-4", { autoAlpha: 0.3, duration: 0.4 }, 4.9)
          .from(".hs-bar-4", { scaleX: 0, transformOrigin: "left center", duration: 0.9 }, 4.9);
      }, section as HTMLElement);

      // recalc after fonts/layout settle so the pin aligns precisely
      ScrollTrigger.refresh();
      window.setTimeout(() => !killed && ScrollTrigger.refresh(), 300);
    }

    // Load GSAP only when the section approaches the viewport.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void setup();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(section);

    return () => {
      killed = true;
      io.disconnect();
      ctx?.revert();
    };
  }, []);

  return (
    <section ref={sectionRef} id="handshake" className="relative">
      <div ref={panelRef} className="flex min-h-[100svh] flex-col justify-center overflow-hidden py-20">
        <div className="wrap w-full">
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Under the hood</span>
            <h2 className="display mt-3 text-[clamp(30px,5vw,52px)]">
              A payment <em>is</em> the access handshake
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[16.5px] leading-relaxed text-muted">
              No API key to provision, no account to create. You open an instant escrow channel with a
              peer, and a settled USD₮ micro-payment is what unlocks the answer.
            </p>
          </div>

          {/* stage */}
          <div className="relative mx-auto mt-14 max-w-4xl">
            <div className="flex items-stretch gap-3 sm:gap-6">
              {/* buyer */}
              <div className="hs-buyer panel w-[34%] max-w-[230px] shrink-0 p-4 sm:p-5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-lg border border-mint-line bg-mint-soft text-mint">
                    <Wallet size={18} aria-hidden />
                  </span>
                  <div>
                    <div className="text-[14px] font-semibold">You — buyer</div>
                    <div className="mono text-[11px] text-muted-2">WDK wallet · USD₮</div>
                  </div>
                </div>
                <div className="hs-voucher mt-4 rounded-lg border border-line bg-ink-0 p-3">
                  <div className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-mint">
                    <FileSignature size={12} aria-hidden /> EIP-712 voucher
                  </div>
                  <div className="mono mt-1.5 text-[11px] leading-relaxed text-muted-2">
                    pay 0.0001 USD₮ → seller
                    <br />
                    sig 0x9f…c2 · off-chain
                  </div>
                </div>
                <div className="hs-answer mt-2.5 rounded-lg border border-mint-line bg-mint-soft p-3">
                  <div className="mono text-[10px] uppercase tracking-[0.12em] text-mint">answer</div>
                  <div className="mt-1 text-[12px] leading-snug text-text">
                    Returned, verified, and paid — settled wallet-to-wallet.
                  </div>
                </div>
              </div>

              {/* conduit */}
              <div className="relative flex flex-1 flex-col justify-center">
                <div ref={trackRef} className="relative h-px w-full">
                  <div
                    className="hs-line absolute inset-0 h-px"
                    style={{
                      background:
                        "linear-gradient(90deg, var(--mint-line), var(--mint) 50%, var(--mint-line))",
                      boxShadow: "0 0 12px rgba(43,227,168,0.4)",
                    }}
                  />
                  {/* travelling packets */}
                  <div
                    ref={packetOutRef}
                    className="absolute top-1/2 left-0 h-2.5 w-2.5 -translate-y-1/2 rounded-full opacity-0"
                    style={{ background: "var(--mint)", boxShadow: "0 0 14px 2px rgba(43,227,168,0.8)" }}
                  />
                  <div
                    ref={packetInRef}
                    className="absolute top-1/2 left-0 h-2.5 w-2.5 -translate-y-1/2 rounded-full opacity-0"
                    style={{ background: "var(--amber)", boxShadow: "0 0 14px 2px rgba(255,196,77,0.75)" }}
                  />
                </div>
                <div className="mono mt-4 text-center text-[10.5px] uppercase tracking-[0.16em] text-muted-2">
                  encrypted P2P · no relay
                </div>
              </div>

              {/* seller */}
              <div className="hs-seller panel w-[34%] max-w-[230px] shrink-0 rounded-[18px] p-4 sm:p-5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-lg border border-mint-line bg-mint-soft text-mint">
                    <Cpu size={18} aria-hidden />
                  </span>
                  <div>
                    <div className="text-[14px] font-semibold">Peer — seller</div>
                    <div className="mono text-[11px] text-muted-2">GPU · open-weight model</div>
                  </div>
                </div>
                <div className="hs-running mt-4 rounded-lg border border-line bg-ink-0 p-3">
                  <div className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-mint">
                    <Zap size={12} aria-hidden /> running on-device
                  </div>
                  <div className="mt-2 flex items-end gap-1" aria-hidden>
                    {[10, 18, 13, 22, 16, 24, 12].map((hgt, i) => (
                      <span
                        key={i}
                        className="hs-compute w-1.5 rounded-sm bg-mint/70"
                        style={{ height: hgt, transformOrigin: "bottom" }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* latency badge */}
            <div className="mt-7 flex justify-center">
              <span className="hs-latency mono inline-flex items-center gap-2 rounded-full border border-amber/40 bg-amber-soft px-4 py-1.5 text-[13px] text-amber">
                answer in ~2 seconds — not an on-chain wait
              </span>
            </div>
          </div>

          {/* steps */}
          <ol className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-2.5 sm:grid-cols-5 sm:gap-3">
            {STEPS.map((s, i) => (
              <li key={s} className={`hs-step-${i} rounded-xl border border-line bg-ink-2 p-3.5`}>
                <div className="mono text-[11px] text-mint">0{i + 1}</div>
                <div className="mt-1.5 text-[12.5px] leading-snug text-muted">{s}</div>
                <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className={`hs-bar-${i} h-full w-full rounded-full`}
                    style={{ background: "linear-gradient(90deg, var(--mint), #7af0cf)" }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
