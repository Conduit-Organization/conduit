import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import TrustStrip from "@/components/TrustStrip";
import Handshake from "@/components/Handshake";
import Features from "@/components/Features";
import Roles from "@/components/Roles";
import Models from "@/components/Models";
import Download from "@/components/Download";
import Testnet from "@/components/Testnet";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <TrustStrip />
        <Handshake />
        <Features />
        <Roles />
        <Models />
        <Download />
        <Testnet />
      </main>
      <Footer />
    </>
  );
}
