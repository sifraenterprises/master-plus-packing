import { motion } from "framer-motion";
import { Telescope } from "lucide-react";

const Vision = () => (
  <section id="vision" data-testid="vision-section" className="py-24 sm:py-32 border-b border-[#262626]">
    <div className="max-w-5xl mx-auto px-6 lg:px-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7 }}
      >
        <div className="inline-flex w-14 h-14 border border-[#F97316]/40 bg-[#F97316]/10 items-center justify-center mb-8">
          <Telescope size={26} strokeWidth={1.5} className="text-[#F97316]" />
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-6">10 — Our Vision</p>
        <blockquote className="font-heading text-2xl sm:text-3xl lg:text-4xl font-bold leading-snug tracking-tight">
          "To become the preferred manufacturing partner by delivering{" "}
          <span className="text-[#F97316]">technically superior</span> and commercially viable engineering
          solutions while continuously improving technology, quality systems, and customer satisfaction."
        </blockquote>
      </motion.div>
    </div>
  </section>
);

export default Vision;
