"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/useReducedMotion";

/* The mint accent in rgb parts, so we can vary alpha cheaply. */
const MINT = "43, 227, 168";

type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // depth 0 (far) .. 1 (near) — drives size, speed, parallax
  hot: boolean; // a few brighter "active peers"
  flash: number; // 0..1 transient glow when a packet arrives
};

type Pulse = {
  from: number;
  to: number;
  t: number; // 0..1 progress along the edge
  speed: number;
  hops: number; // remaining hops before it dies
};

function nodeCountFor(w: number): number {
  if (w < 560) return 26;
  if (w < 1024) return 42;
  return 64;
}

/**
 * A living peer-to-peer mesh: nodes drift, nearby peers link up, and bright
 * "packets" hop across the network (an answer crossing the conduit). Pointer
 * movement adds depth parallax. Pauses when offscreen or the tab is hidden.
 * Under reduced-motion it paints a single calm constellation and stops.
 */
export default function NodeSwarm({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    const maxDist = 168; // link radius (css px)
    const maxDist2 = maxDist * maxDist;

    // pointer parallax (eased)
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    function resize() {
      const parent = canvas!.parentElement;
      const rect = parent ? parent.getBoundingClientRect() : canvas!.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function seed() {
      const count = nodeCountFor(w);
      nodes = Array.from({ length: count }, () => {
        const z = Math.random();
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * (0.06 + z * 0.1),
          vy: (Math.random() - 0.5) * (0.06 + z * 0.1),
          z,
          hot: Math.random() < 0.16,
          flash: 0,
        };
      });
      pulses = [];
    }

    function neighbors(i: number): number[] {
      const a = nodes[i];
      const out: number[] = [];
      for (let j = 0; j < nodes.length; j++) {
        if (j === i) continue;
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy < maxDist2) out.push(j);
      }
      return out;
    }

    function spawnPulse() {
      if (pulses.length > 5 || nodes.length < 2) return;
      const from = Math.floor(Math.random() * nodes.length);
      const ns = neighbors(from);
      if (!ns.length) return;
      const to = ns[Math.floor(Math.random() * ns.length)];
      pulses.push({ from, to, t: 0, speed: 0.012 + Math.random() * 0.012, hops: 2 + Math.floor(Math.random() * 3) });
    }

    function step(dt: number) {
      // ease pointer
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;

      for (const n of nodes) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        // wrap softly around the edges
        if (n.x < -20) n.x = w + 20;
        if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20;
        if (n.y > h + 20) n.y = -20;
        if (n.flash > 0) n.flash -= dt * 0.04;
      }

      for (let p = pulses.length - 1; p >= 0; p--) {
        const pl = pulses[p];
        pl.t += pl.speed * dt;
        if (pl.t >= 1) {
          // arrived: flash the destination, then hop onward across the mesh
          nodes[pl.to].flash = 1;
          pl.hops -= 1;
          const ns = neighbors(pl.to).filter((j) => j !== pl.from);
          if (pl.hops > 0 && ns.length) {
            pl.from = pl.to;
            pl.to = ns[Math.floor(Math.random() * ns.length)];
            pl.t = 0;
          } else {
            pulses.splice(p, 1);
          }
        }
      }
    }

    function px(n: Node) {
      // parallax: nearer nodes (high z) shift more with the pointer
      return n.x + pointer.x * (6 + n.z * 26);
    }
    function py(n: Node) {
      return n.y + pointer.y * (6 + n.z * 26);
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);

      // edges
      ctx!.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const ax = px(nodes[i]);
        const ay = py(nodes[i]);
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = ax - px(nodes[j]);
          const dy = ay - py(nodes[j]);
          const d2 = dx * dx + dy * dy;
          if (d2 < maxDist2) {
            const d = Math.sqrt(d2);
            const a = (1 - d / maxDist) * 0.16;
            ctx!.strokeStyle = `rgba(${MINT}, ${a})`;
            ctx!.beginPath();
            ctx!.moveTo(ax, ay);
            ctx!.lineTo(px(nodes[j]), py(nodes[j]));
            ctx!.stroke();
          }
        }
      }

      // nodes
      for (const n of nodes) {
        const x = px(n);
        const y = py(n);
        const baseR = 0.8 + n.z * 1.9;
        const r = baseR + n.flash * 2.2;
        const a = 0.25 + n.z * 0.4 + (n.hot ? 0.18 : 0) + n.flash * 0.4;
        if (n.hot || n.flash > 0.02) {
          ctx!.shadowBlur = 8 + n.flash * 12;
          ctx!.shadowColor = `rgba(${MINT}, ${0.5})`;
        } else {
          ctx!.shadowBlur = 0;
        }
        ctx!.fillStyle = `rgba(${MINT}, ${Math.min(a, 0.9)})`;
        ctx!.beginPath();
        ctx!.arc(x, y, r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.shadowBlur = 0;

      // packets travelling the conduit
      for (const pl of pulses) {
        const a = nodes[pl.from];
        const b = nodes[pl.to];
        const ease = pl.t * pl.t * (3 - 2 * pl.t); // smoothstep
        const x = px(a) + (px(b) - px(a)) * ease;
        const y = py(a) + (py(b) - py(a)) * ease;
        ctx!.shadowBlur = 14;
        ctx!.shadowColor = `rgba(${MINT}, 0.9)`;
        ctx!.fillStyle = `rgba(${MINT}, 0.95)`;
        ctx!.beginPath();
        ctx!.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.shadowBlur = 0;
    }

    // ---- run loop / lifecycle -------------------------------------------
    let raf = 0;
    let last = 0;
    let lastSpawn = 0;
    let running = false;

    function frame(now: number) {
      if (!running) return;
      const dt = last ? Math.min((now - last) / 16.6667, 3) : 1; // frames elapsed, clamped
      last = now;
      step(dt);
      if (now - lastSpawn > 900) {
        spawnPulse();
        lastSpawn = now;
      }
      draw();
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || reduced) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    resize();

    if (reduced) {
      // one calm static frame, no animation
      draw();
    }

    const onResize = () => resize();
    window.addEventListener("resize", onResize, { passive: true });

    const onPointer = (e: PointerEvent) => {
      if (reduced) return;
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // pause when scrolled out of view
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) start();
          else stop();
        }
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    return () => {
      stop();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      io.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
