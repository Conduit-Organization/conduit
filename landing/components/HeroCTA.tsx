"use client";

import { ArrowRight, Download } from "lucide-react";
import Magnetic from "./Magnetic";
import { LinuxGlyph, MacGlyph, WinGlyph } from "./OSGlyphs";
import { useDetectedOS, type OS } from "@/lib/os";
import { DOWNLOADS, MAC_AVAILABLE } from "@/lib/site";

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
        label: "Download for Windows",
        href: DOWNLOADS.winExe,
        external: true,
        note: ".exe installer · v0.1.0",
      };
    default:
      return {
        label: "See all downloads",
        href: "#download",
        external: false,
        note: "Linux & Windows ready now · macOS coming soon.",
      };
  }
}

function Pill({
  icon,
  label,
  href,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-mint-line bg-mint-soft text-mint"
          : "border-line-2 text-muted hover:border-mint-line hover:bg-mint-soft hover:text-text",
      ].join(" ")}
    >
      {icon}
      {label}
    </a>
  );
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

      {/* every platform, one tap away — the visitor's OS is highlighted */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="mono mr-1 text-[11px] uppercase tracking-[0.16em] text-muted-2">Download</span>
        <Pill icon={<LinuxGlyph size={16} />} label="Linux" href={DOWNLOADS.linuxAppImage} active={os === "linux"} />
        <Pill icon={<WinGlyph size={15} />} label="Windows" href={DOWNLOADS.winExe} active={os === "win"} />
        {MAC_AVAILABLE ? (
          <Pill icon={<MacGlyph size={15} />} label="macOS" href={DOWNLOADS.macDmg} active={os === "mac"} />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line-2/60 px-3 py-1.5 text-[13px] font-medium text-muted-2">
            <MacGlyph size={15} /> macOS
            <span className="ml-0.5 rounded bg-amber-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber">
              soon
            </span>
          </span>
        )}
      </div>

      <p className="mono mt-3 text-[12.5px] text-muted-2">{p.note}</p>
    </div>
  );
}
