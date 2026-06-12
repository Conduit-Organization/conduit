import { Github } from "lucide-react";
import BrandMark from "./BrandMark";
import { REPO, RELEASES } from "@/lib/site";

const PROOF = ["Open source", "Peer-to-peer", "On-device", "Non-custodial"];

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-line py-14">
      <div className="wrap">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <BrandMark size={26} />
              <span className="display text-[22px] leading-none">Conduit</span>
            </div>
            <p className="mt-4 text-[14px] leading-relaxed text-muted">
              A serverless, peer-to-peer marketplace for AI inference. No cloud, no account, no middleman —
              your keys and prompts stay on your device.
            </p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {PROOF.map((p) => (
                <li
                  key={p}
                  className="mono rounded-full border border-line px-3 py-1 text-[11px] text-muted-2"
                >
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <nav className="flex flex-col gap-3 text-[14.5px]" aria-label="Footer">
            <span className="mono text-[11px] uppercase tracking-[0.16em] text-muted-2">Links</span>
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-muted transition-colors hover:text-text"
            >
              <Github size={15} aria-hidden /> GitHub
            </a>
            <a
              href={RELEASES}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted transition-colors hover:text-text"
            >
              All releases
            </a>
            <a href="#download" className="text-muted transition-colors hover:text-text">
              Download
            </a>
            <a href="#handshake" className="text-muted transition-colors hover:text-text">
              How it works
            </a>
          </nav>
        </div>

        <div className="seam my-9" />

        <div className="flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
          <p className="mono text-[12.5px] text-muted-2">
            Conduit · serverless P2P inference · open source
          </p>
          <p className="mono text-[12.5px] text-muted-2">
            Testnet release · test USD₮ on Sepolia · no real money
          </p>
        </div>
      </div>
    </footer>
  );
}
