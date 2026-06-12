"use client";

import { useEffect, useState } from "react";
import { Github } from "lucide-react";
import BrandMark from "./BrandMark";
import { REPO } from "@/lib/site";

const LINKS = [
  { href: "#handshake", label: "How it works" },
  { href: "#models", label: "Models" },
  { href: "#download", label: "Download" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={[
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled ? "border-b border-line bg-ink-1/80 backdrop-blur-xl" : "border-b border-transparent",
      ].join(" ")}
    >
      <nav className="wrap flex items-center justify-between pb-4 pt-4">
        <a href="#top" className="flex items-center gap-2.5" aria-label="Conduit — home">
          <BrandMark size={28} />
          <span className="display text-[23px] leading-none">Conduit</span>
          <span className="mono ml-1 hidden rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-2 sm:inline-block">
            testnet · v0.1.0
          </span>
        </a>

        <div className="flex items-center gap-1 sm:gap-2">
          <ul className="mr-2 hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="rounded-lg px-3 py-2 text-[14.5px] text-muted transition-colors hover:text-text"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-line-2 px-3.5 py-2 text-[14px] text-text transition-colors hover:border-mint-line hover:bg-mint-soft"
          >
            <Github size={16} aria-hidden />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </nav>
    </header>
  );
}
