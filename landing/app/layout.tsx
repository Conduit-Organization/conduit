import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { REPO } from "@/lib/site";
import SmoothScroll from "@/components/SmoothScroll";
import "./globals.css";

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display",
});

const ui = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ui",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const title = "Conduit - buy AI answers from peers, pay per answer in USD₮";
const description =
  "A serverless, peer-to-peer marketplace for AI inference. Pay a fraction of a cent in USD₮ per answer, or run a model on your own GPU and earn. No cloud, no account, no middleman — your keys and prompts stay on your device.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  applicationName: "Conduit",
  keywords: [
    "AI inference",
    "peer-to-peer",
    "P2P",
    "serverless",
    "USDT",
    "micropayments",
    "local AI",
    "on-device LLM",
    "open source",
    "Hyperswarm",
    "Holepunch",
  ],
  authors: [{ name: "Conduit", url: REPO }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Conduit",
    title: "Conduit — a peer-to-peer market for AI answers",
    description:
      "Pay peers a fraction of a cent in USD₮ for AI answers, or run a model and earn. Serverless, no account, keys stay on your device.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Conduit — a peer-to-peer market for AI answers",
    description:
      "Pay peers a fraction of a cent in USD₮ for AI answers, or run a model and earn. Serverless, no account, keys stay on your device.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0a0e13",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
