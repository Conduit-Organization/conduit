import type { Metadata } from "next";
import Deck from "@/components/pitch/Deck";

export const metadata: Metadata = {
  title: "Conduit — the pitch",
  description:
    "Conduit in five slides: a serverless, peer-to-peer marketplace for AI inference, powered by QVAC.",
  robots: { index: false, follow: false },
};

export default function PitchPage() {
  return <Deck />;
}
