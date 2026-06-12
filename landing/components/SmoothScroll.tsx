"use client";

import { ReactLenis } from "lenis/react";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * App-wide smooth scroll. Lenis drives its own RAF loop (autoRaf). GSAP is NOT
 * imported here — it ships only with the one section that needs ScrollTrigger
 * (Handshake), keeping it out of the initial bundle. Under reduced-motion the
 * smoothing is neutralized (instant scroll, native wheel).
 */
export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();

  const options = reduced
    ? { lerp: 1, smoothWheel: false, syncTouch: false }
    : { lerp: 0.1, smoothWheel: true, syncTouch: false };

  return (
    <ReactLenis root options={options}>
      {children}
    </ReactLenis>
  );
}
