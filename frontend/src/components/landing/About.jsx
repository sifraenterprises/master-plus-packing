import { motion } from "framer-motion";
import { Factory } from "lucide-react";

const About = () => (
  <section id="about" data-testid="about-section" className="py-24 sm:py-32 border-b border-[#262626]">
    <div className="max-w-7xl mx-auto px-6 lg:px-8 grid lg:grid-cols-12 gap-12">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="lg:col-span-4"
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-4">02 — About Us</p>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight uppercase leading-tight">
          Five Decades of Precision Manufacturing
        </h2>
        <div className="mt-8 w-16 h-1 bg-[#F97316]" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="lg:col-span-8"
      >
        <p className="text-lg text-slate-300 leading-relaxed">
          Grewal Engineering Works is an <span className="text-white font-semibold">ISO 9001:2015 certified</span> engineering
          company established in <span className="text-[#F97316] font-semibold">1972</span>. We specialize in manufacturing
          precision bar stock hardware, sheet metal pressed components, fabricated assemblies, CNC turned parts, and plastic
          molded components for leading OEMs in the tractor, railway, and engineering industries.
        </p>
        <p className="mt-6 text-base text-slate-400 leading-relaxed">
          With more than five decades of manufacturing excellence, we are committed to delivering quality, precision, and
          timely delivery while continuously upgrading our technology and manufacturing capabilities.
        </p>
        <div className="mt-10 flex items-center gap-4 border border-[#262626] bg-[#121212] p-6">
          <Factory size={32} strokeWidth={1.5} className="text-[#F97316] shrink-0" />
          <p className="text-sm text-slate-400">
            Serving the <span className="text-white">tractor, railway &amp; engineering industries</span> from our
            manufacturing facility in Faridabad, Haryana — the industrial heart of North India.
          </p>
        </div>
      </motion.div>
    </div>
  </section>
);

export default About;
