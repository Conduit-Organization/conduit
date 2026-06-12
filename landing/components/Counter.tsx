"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/**
 * Counts up to `value` the first time it scrolls into view. Under
 * reduced-motion it shows the final value immediately.
 */
export default function Counter({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1.6,
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setN(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setN(v),
    });
    return () => controls.stop();
  }, [inView, reduced, value, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {n.toFixed(decimals)}
      {suffix}
    </span>
  );
}
