import Marquee from "react-fast-marquee";
import { motion } from "framer-motion";

const customers = [
  "TAFE Motors & Tractors Ltd.",
  "Eicher Tractor",
  "Eicher Engine",
  "Plasser India Pvt. Ltd.",
  "Promtech Industrial Products",
];

const Customers = () => (
  <section id="customers" data-testid="customers-section" className="py-24 sm:py-32 border-b border-[#262626] overflow-hidden">
    <div className="max-w-7xl mx-auto px-6 lg:px-8 mb-16">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-4">08 — Our Customers</p>
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight uppercase">
        Trusted by Leading OEMs
      </h2>
    </div>

    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
    >
      <Marquee gradient gradientColor="#050505" gradientWidth={120} speed={40} pauseOnHover>
        {customers.map((c) => (
          <span
            key={c}
            data-testid={`customer-${c.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            className="mx-10 font-heading text-2xl sm:text-3xl font-black uppercase tracking-widest text-[#404040] hover:text-white transition-colors cursor-default whitespace-nowrap"
          >
            {c}
          </span>
        ))}
      </Marquee>
    </motion.div>
  </section>
);

export default Customers;
