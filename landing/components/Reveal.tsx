"use client";

import { motion, useReducedMotion as useFramerReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  /** Stagger delay in seconds. */
  delay?: number;
  /** Travel distance in px before settling. */
  y?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
  once?: boolean;
};

/**
 * Scroll-into-view reveal. Transform + opacity only (GPU friendly). Under
 * reduced-motion it renders fully visible with no transition.
 */
export default function Reveal({
  children,
  delay = 0,
  y = 22,
  className,
  as = "div",
  once = true,
}: RevealProps) {
  const reduced = useFramerReducedMotion();
  const MotionTag = motion[as];

  const variants: Variants = {
    hidden: { opacity: 0, y: reduced ? 0 : y },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.7, delay, ease: [0.2, 0.8, 0.2, 1] },
    },
  };

  return (
    <MotionTag
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: "0px 0px -12% 0px" }}
    >
      {children}
    </MotionTag>
  );
}

/** Container that staggers its <RevealItem> children. */
export function RevealGroup({
  children,
  className,
  stagger = 0.08,
  once = true,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  once?: boolean;
  as?: "div" | "ul" | "section";
}) {
  const MotionTag = motion[as];
  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: "0px 0px -12% 0px" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger } },
      }}
    >
      {children}
    </MotionTag>
  );
}

/**
 * A child of <RevealGroup>. Declares only variants so the parent's stagger
 * timeline drives it (no independent in-view trigger).
 */
export function RevealItem({
  children,
  className,
  y = 22,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  y?: number;
  as?: "div" | "li" | "span";
}) {
  const reduced = useFramerReducedMotion();
  const MotionTag = motion[as];
  return (
    <MotionTag
      className={className}
      variants={{
        hidden: { opacity: 0, y: reduced ? 0 : y },
        show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] } },
      }}
    >
      {children}
    </MotionTag>
  );
}
