"use client";

import { ArrowUpRight, Download as DownloadIcon, Terminal } from "lucide-react";
import SectionHeader from "./SectionHeader";
import Reveal from "./Reveal";
import { LinuxGlyph, MacGlyph, WinGlyph } from "./OSGlyphs";
import { useDetectedOS, type OS } from "@/lib/os";
import { DOWNLOADS, RELEASES, RUN_FROM_SOURCE } from "@/lib/site";

function Card({
  detected,
  children,
}: {
  detected: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        "panel relative h-full p-6 transition-colors duration-300",
        detected
          ? "border-mint-line shadow-[0_0_0_1px_var(--mint-line),0_22px_60px_-30px_var(--mint)]"
          : "",
      ].join(" ")}
    >
      {detected ? (
        <span className="mono absolute right-4 top-4 rounded-full border border-mint-line bg-mint-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-mint">
          Your system
        </span>
      ) : null}
      {children}
    </div>
  );
}

function SoonBadge() {
  return (
    <span className="mono rounded-full border border-amber/30 bg-amber-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber">
      soon
    </span>
  );
}

export default function Download() {
  const os: OS = useDetectedOS();

  return (
    <section id="download" className="wrap py-24 sm:py-28">
      <SectionHeader
        eyebrow="Download"
        title={
          <>
            Get Conduit <span className="mono align-middle text-[0.5em] text-mint">v0.1.0</span>
          </>
        }
        lead="Pick your platform. Linux builds are ready now; macOS and Windows packaged installers are on the way — until then you can run Conduit from source on any of the three."
      />

      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Linux */}
        <Reveal>
          <Card detected={os === "linux"}>
            <span className="text-text/90">
              <LinuxGlyph />
            </span>
            <h3 className="mt-4 text-[18px] font-semibold">Linux</h3>
            <p className="mono mt-1 text-[12.5px] text-muted-2">x86_64 · AppImage or .deb</p>
            <div className="mt-5 flex flex-col gap-2.5">
              <a
                href={DOWNLOADS.linuxAppImage}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between rounded-lg border border-line-2 px-3.5 py-3 text-[14px] font-medium transition-colors hover:border-mint-line hover:bg-mint-soft"
              >
                <span className="inline-flex items-center gap-2">
                  <DownloadIcon size={15} aria-hidden /> AppImage
                  <span className="text-muted-2">· portable</span>
                </span>
                <span className="mono text-[12px] text-muted-2 group-hover:text-mint">.AppImage</span>
              </a>
              <a
                href={DOWNLOADS.linuxDeb}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between rounded-lg border border-line-2 px-3.5 py-3 text-[14px] font-medium transition-colors hover:border-mint-line hover:bg-mint-soft"
              >
                <span className="inline-flex items-center gap-2">
                  <DownloadIcon size={15} aria-hidden /> Debian / Ubuntu
                </span>
                <span className="mono text-[12px] text-muted-2 group-hover:text-mint">.deb</span>
              </a>
            </div>
          </Card>
        </Reveal>

        {/* macOS */}
        <Reveal delay={0.08}>
          <Card detected={os === "mac"}>
            <span className="text-text/90">
              <MacGlyph />
            </span>
            <h3 className="mt-4 flex items-center gap-2 text-[18px] font-semibold">
              macOS <SoonBadge />
            </h3>
            <p className="mono mt-1 text-[12.5px] text-muted-2">Apple Silicon &amp; Intel · .dmg</p>
            <p className="mt-5 text-[14px] leading-relaxed text-muted">
              Packaged build coming shortly (it has to be built on a Mac). Until then,{" "}
              <a
                href={RUN_FROM_SOURCE}
                target="_blank"
                rel="noopener noreferrer"
                className="text-mint underline-offset-2 hover:underline"
              >
                run from source
              </a>{" "}
              — same product, a few terminal commands.
            </p>
          </Card>
        </Reveal>

        {/* Windows */}
        <Reveal delay={0.16}>
          <Card detected={os === "win"}>
            <span className="text-text/90">
              <WinGlyph />
            </span>
            <h3 className="mt-4 flex items-center gap-2 text-[18px] font-semibold">
              Windows <SoonBadge />
            </h3>
            <p className="mono mt-1 text-[12.5px] text-muted-2">x86_64 · .exe installer</p>
            <p className="mt-5 text-[14px] leading-relaxed text-muted">
              Packaged build coming shortly (it has to be built on Windows). Until then,{" "}
              <a
                href={RUN_FROM_SOURCE}
                target="_blank"
                rel="noopener noreferrer"
                className="text-mint underline-offset-2 hover:underline"
              >
                run from source
              </a>{" "}
              — same product, a few terminal commands.
            </p>
          </Card>
        </Reveal>
      </div>

      {/* AppImage how-to (honest, practical) */}
      <Reveal delay={0.05}>
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber/25 bg-amber-soft p-4 text-[13.5px] text-[#f0d9a6]">
          <Terminal size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
          <p className="leading-relaxed">
            <b className="text-amber">Linux AppImage:</b> after downloading, run{" "}
            <code className="mono rounded bg-ink-0 px-1.5 py-0.5 text-text">chmod +x Conduit-0.1.0.AppImage</code>{" "}
            then double-click it (or run{" "}
            <code className="mono rounded bg-ink-0 px-1.5 py-0.5 text-text">./Conduit-0.1.0.AppImage</code>). On
            some distros you may need <code className="mono rounded bg-ink-0 px-1.5 py-0.5 text-text">--no-sandbox</code>.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <p className="mt-6 text-center text-[14px] text-muted">
          <a
            href={RELEASES}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-mint underline-offset-2 hover:underline"
          >
            Browse all releases on GitHub <ArrowUpRight size={15} aria-hidden />
          </a>
        </p>
      </Reveal>
    </section>
  );
}
