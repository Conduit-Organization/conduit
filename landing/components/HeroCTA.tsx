"use client";

import { ArrowRight, Download } from "lucide-react";
import Magnetic from "./Magnetic";
import { useDetectedOS, type OS } from "@/lib/os";
import { DOWNLOADS } from "@/lib/site";

function primary(os: OS): { label: string; href: string; external: boolean; note: React.ReactNode } {
  switch (os) {
    case "linux":
      return {
        label: "Download for Linux",
        href: DOWNLOADS.linuxAppImage,
        external: true,
        note: (
          <>
            AppImage · v0.1.0 · also available as{" "}
            <a href="#download" className="text-mint underline-offset-2 hover:underline">
              .deb
            </a>
          </>
        ),
      };
    case "mac":
      return {
        label: "Get Conduit for macOS",
        href: "#download",
        external: false,
        note: "Packaged .dmg coming soon — run from source today.",
      };
    case "win":
      return {
        label: "Get Conduit for Windows",
        href: "#download",
        external: false,
        note: "Packaged .exe coming soon — run from source today.",
      };
    default:
      return {
        label: "See all downloads",
        href: "#download",
        external: false,
        note: "Linux ready now · macOS & Windows coming soon.",
      };
  }
}

export default function HeroCTA() {
  const os = useDetectedOS();
  const p = primary(os);

  return (
    <div className="mt-9">
      <div className="flex flex-wrap items-center gap-3.5">
        <Magnetic>
          <a
            href={p.href}
            {...(p.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="group inline-flex items-center gap-2.5 rounded-xl bg-mint px-6 py-3.5 text-[15.5px] font-semibold text-[#062018] shadow-[0_10px_40px_-12px_var(--mint)] transition-shadow duration-300 hover:shadow-[0_16px_52px_-12px_var(--mint)]"
          >
            <Download size={18} aria-hidden />
            {p.label}
            <ArrowRight
              size={17}
              aria-hidden
              className="transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </a>
        </Magnetic>

        <a
          href="#handshake"
          className="inline-flex items-center gap-2 rounded-xl border border-line-2 px-5 py-3.5 text-[15.5px] font-semibold text-text transition-colors duration-300 hover:border-mint-line hover:bg-mint-soft"
        >
          See how it works
        </a>
      </div>
      <p className="mono mt-4 text-[12.5px] text-muted-2">{p.note}</p>
    </div>
  );
}
