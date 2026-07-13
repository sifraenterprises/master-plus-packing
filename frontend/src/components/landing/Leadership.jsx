import { motion } from "framer-motion";
import { UserRound, Award } from "lucide-react";

const partners = [
  {
    name: "Gurpreet Singh Grewal",
    role: "Partner",
    duties: ["Business Development", "Operations", "Customer Relations", "Strategic Planning"],
  },
  {
    name: "Pritpal Singh Grewal",
    role: "Partner",
    duties: ["Quality Assurance", "Production Development", "Manufacturing Excellence", "Technical Support"],
  },
];

const Leadership = () => (
  <section id="leadership" data-testid="leadership-section" className="py-24 sm:py-32 border-b border-[#262626] bg-[#0A0A0A]">
    <div className="max-w-7xl mx-auto px-6 lg:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-4">03 — Leadership</p>
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight uppercase mb-16">Driven by Experience</h2>

      <div className="grid md:grid-cols-2 gap-8 mb-8">
        {partners.map((p, i) => (
          <motion.div
            key={p.name}
            data-testid={`partner-card-${i}`}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: i * 0.15 }}
            className="border border-[#262626] bg-[#121212] p-8 hover:border-[#404040] hover:-translate-y-1 transition-[border-color,transform] duration-300"
          >
            <div className="w-14 h-14 border border-[#F97316]/40 bg-[#F97316]/10 flex items-center justify-center mb-6">
              <UserRound size={26} strokeWidth={1.5} className="text-[#F97316]" />
            </div>
            <h3 className="text-xl sm:text-2xl font-semibold font-heading">{p.name}</h3>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mt-1 mb-6">{p.role}</p>
            <ul className="grid grid-cols-2 gap-3">
              {p.duties.map((d) => (
                <li key={d} className="text-sm text-slate-400 border-l-2 border-[#262626] pl-3">
                  {d}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>

      <motion.div
        data-testid="founder-card"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="border border-[#F97316]/30 bg-[#121212] p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center gap-8"
      >
        <div className="w-16 h-16 bg-[#F97316] flex items-center justify-center shrink-0">
          <Award size={30} strokeWidth={1.5} className="text-black" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-2">Founder</p>
          <h3 className="text-2xl font-heading font-bold">M. S. Grewal</h3>
          <p className="text-slate-400 mt-3 max-w-2xl leading-relaxed">
            Established Grewal Engineering Works in 1972 with a vision to manufacture world-class engineering components.
          </p>
        </div>
      </motion.div>
    </div>
  </section>
);

export default Leadership;
