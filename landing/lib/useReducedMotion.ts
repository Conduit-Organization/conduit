"use client";

import { useEffect, useState } from "react";

/**
 * Reactive `prefers-reduced-motion` flag. Defaults to `true` (the safe,
 * motion-free state) until mounted so SSR/first paint never starts animating
 * for users who opted out.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return reduced;
}

/** Non-reactive check for use inside effects (canvas, GSAP setup). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
