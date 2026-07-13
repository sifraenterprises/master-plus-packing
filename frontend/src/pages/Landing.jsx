import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import About from "@/components/landing/About";
import Leadership from "@/components/landing/Leadership";
import Overview from "@/components/landing/Overview";
import Capabilities from "@/components/landing/Capabilities";
import Machinery from "@/components/landing/Machinery";
import Quality from "@/components/landing/Quality";
import Customers from "@/components/landing/Customers";
import Gallery from "@/components/landing/Gallery";
import Vision from "@/components/landing/Vision";
import Footer from "@/components/landing/Footer";

export default function Landing() {
  return (
    <div className="grain bg-[#050505] text-slate-50" data-testid="landing-page">
      <Navbar />
      <Hero />
      <About />
      <Leadership />
      <Overview />
      <Capabilities />
      <Machinery />
      <Quality />
      <Customers />
      <Gallery />
      <Vision />
      <Footer />
    </div>
  );
}
