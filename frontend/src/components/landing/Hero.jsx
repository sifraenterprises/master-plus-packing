import { motion } from "framer-motion";
import { BadgeCheck, ArrowDown, Phone } from "lucide-react";
import { scrollTo } from "./Navbar";

const HERO_IMG =
  "https://images.unsplash.com/photo-1717386255767-52643970d483?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxOTF8MHwxfHNlYXJjaHwyfHxpbmR1c3RyaWFsJTIwZmFjdG9yeSUyMGNuYyUyMG1hY2hpbmUlMjBiYWNrZ3JvdW5kfGVufDB8fHx8MTc4Mzc1NzUzMXww&ixlib=rb-4.1.0&q=85";

const Hero = () => (
  <section id="home" data-testid="hero-section" className="relative min-h-screen flex items-center overflow-hidden">
    <div className="absolute inset-0">
      <img src={HERO_IMG} alt="CNC manufacturing facility" className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/70" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent" />
    </div>

    <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 w-full pt-32 pb-24">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="max-w-3xl"
      >
        <div data-testid="hero-iso-badge" className="inline-flex items-center gap-2 border border-[#F97316]/50 bg-[#F97316]/10 px-4 py-2 mb-8">
          <BadgeCheck size={16} strokeWidth={1.5} className="text-[#F97316]" />
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316]">
            ISO 9001:2015 Certified Company
          </span>
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tighter uppercase leading-[0.95] mb-6">
          Grewal
          <br />
          Engineering
          <br />
          <span className="text-[#F97316]">Works</span>
        </h1>

        <p className="text-lg sm:text-xl text-slate-300 font-light tracking-wide mb-4">
          Manufacturing Excellence Since <span className="text-[#F97316] font-semibold">1972</span>
        </p>
        <p className="text-base text-slate-400 leading-relaxed max-w-xl mb-10">
          Precision bar stock hardware, sheet metal components, fabricated assemblies, CNC turned
          parts &amp; plastic molded components for leading OEMs in tractor, railway and engineering industries.
        </p>

        <div className="flex flex-wrap gap-4">
          <button
            data-testid="hero-view-profile-btn"
            onClick={() => scrollTo("about")}
            className="bg-[#F97316] hover:bg-[#EA580C] text-black font-heading font-bold uppercase tracking-widest text-sm px-8 py-4 flex items-center gap-3 transition-colors"
          >
            View Company Profile
            <ArrowDown size={16} strokeWidth={2} />
          </button>
          <button
            data-testid="hero-contact-btn"
            onClick={() => scrollTo("contact")}
            className="border border-white/30 hover:bg-white/10 text-white font-heading font-bold uppercase tracking-widest text-sm px-8 py-4 flex items-center gap-3 transition-colors"
          >
            <Phone size={16} strokeWidth={1.5} />
            Contact Us
          </button>
        </div>
      </motion.div>
    </div>

    <div className="absolute bottom-0 inset-x-0 z-10 border-t border-white/10 bg-black/50 backdrop-blur-md hidden md:block">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 grid grid-cols-4 divide-x divide-white/10">
        {[
          ["50+", "Years of Excellence"],
          ["ISO", "9001:2015 Certified"],
          ["25+", "Skilled Employees"],
          ["5", "Major OEM Customers"],
        ].map(([num, label]) => (
          <div key={label} className="py-5 px-6 first:pl-0">
            <p className="font-heading font-black text-2xl text-[#F97316]">{num}</p>
            <p className="text-xs uppercase tracking-widest text-slate-400 mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default Hero;
