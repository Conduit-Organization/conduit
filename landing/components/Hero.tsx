"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import NodeSwarm from "./NodeSwarm";
import HeroCTA from "./HeroCTA";

const LINE_ONE = ["Buy", "AI", "answers", "from"];
const LINE_TWO = ["Pay", "per", "answer."];

const wordVariants = {
  hidden: { opacity: 0, y: "0.5em" },
  show: { opacity: 1, y: "0em" },
};

function Word({ children, mint }: { children: string; mint?: boolean }) {
  return (
    <motion.span
      className={`mr-[0.26em] inline-block ${mint ? "italic text-mint" : ""}`}
      variants={wordVariants}
      transition={{ duration: 0.72, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.span>
  );
}

export default function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const mul = reduced ? 0 : 1;

  const { scrollY } = useScroll();
  const yGlow = useTransform(scrollY, [0, 800], [0, 140 * mul]);
  const ySwarm = useTransform(scrollY, [0, 800], [0, 80 * mul]);
  const yGrid = useTransform(scrollY, [0, 800], [0, 46 * mul]);
  const yContent = useTransform(scrollY, [0, 800], [0, -34 * mul]);

  return (
    <section
      ref={ref}
      id="top"
      className="relative flex min-h-[100svh] items-center overflow-hidden pt-28 pb-20"
    >
      {/* layer: mesh glow */}
      <motion.div
        aria-hidden
        style={{ y: yGlow }}
        className="pointer-events-none absolute inset-0 -z-30"
      >
        <div
          className="absolute left-1/2 top-[-10%] h-[620px] w-[1100px] -translate-x-1/2 rounded-full opacity-70 blur-[60px]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(43,227,168,0.18), rgba(43,227,168,0.05) 55%, transparent 78%)",
          }}
        />
      </motion.div>

      {/* layer: coordinate grid */}
      <motion.div
        aria-hidden
        style={{ y: yGrid }}
        className="pointer-events-none absolute inset-0 -z-20"
      >
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
            backgroundSize: "52px 52px",
            maskImage:
              "radial-gradient(900px 540px at 60% 38%, rgba(0,0,0,0.55), transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(900px 540px at 60% 38%, rgba(0,0,0,0.55), transparent 78%)",
          }}
        />
      </motion.div>

      {/* layer: living mesh */}
      <motion.div
        aria-hidden
        style={{ y: ySwarm }}
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <NodeSwarm className="h-full w-full" />
      </motion.div>

      {/* bottom fade into the page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40"
        style={{ background: "linear-gradient(180deg, transparent, var(--ink-1))" }}
      />

      <motion.div style={{ y: yContent }} className="wrap relative">
        <div className="max-w-[20ch]">
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
            className="inline-flex items-center gap-2 rounded-full border border-mint-line bg-mint-soft px-3.5 py-1.5 text-[12.5px] font-medium tracking-[0.02em] text-mint"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_10px_var(--mint)]" />
            </span>
            Public testnet · v0.1.0
          </motion.span>
        </div>

        <motion.h1
          className="display mt-6 text-[clamp(42px,7vw,82px)]"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } }}
        >
          <span className="block max-w-[16ch]">
            {LINE_ONE.map((w) => (
              <Word key={w}>{w}</Word>
            ))}
            <Word mint>peers.</Word>
          </span>
          <span className="mt-1 block">
            {LINE_TWO.map((w) => (
              <Word key={w}>{w}</Word>
            ))}
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-6 max-w-[60ch] text-[clamp(17px,2vw,20px)] leading-relaxed text-muted"
        >
          Conduit is a <strong className="font-semibold text-text">serverless, peer-to-peer marketplace for AI inference</strong>.
          Run a model on your machine and earn, or pay a fraction of a cent in USD₮ for an answer from
          someone who does. No cloud, no account, no middleman — your keys and prompts stay on your device.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <HeroCTA />
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.95 }}
          className="mono mt-7 flex items-center gap-2.5 text-[12.5px] text-muted-2"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
          Test USD₮ on Sepolia — no real money, all of the real architecture.
        </motion.p>
      </motion.div>
    </section>
  );
}
