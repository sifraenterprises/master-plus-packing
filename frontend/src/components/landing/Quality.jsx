import { motion } from "framer-motion";
import { ShieldCheck, Ruler, Microscope, Gauge, CircleDot, Square, FileCheck2, ClipboardList } from "lucide-react";

const QA_IMG =
  "https://images.unsplash.com/photo-1661921364026-ab10edfd9031?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzd8MHwxfHNlYXJjaHwxfHxxdWFsaXR5JTIwYXNzdXJhbmNlJTIwbWljcm9tZXRlciUyMG1lYXN1cmVtZW50fGVufDB8fHx8MTc4Mzc1NzUzMXww&ixlib=rb-4.1.0&q=85";

const items = [
  { icon: ShieldCheck, label: "ISO 9001:2015" },
  { icon: Microscope, label: "Profile Projector" },
  { icon: Ruler, label: "Digital Vernier" },
  { icon: Gauge, label: "Micrometers" },
  { icon: CircleDot, label: "Bore Gauges" },
  { icon: Square, label: "Surface Plate" },
  { icon: FileCheck2, label: "Inspection Reports" },
  { icon: ClipboardList, label: "Monthly Quality Reviews" },
];

const Quality = () => (
  <section id="quality" data-testid="quality-section" className="py-24 sm:py-32 border-b border-[#262626] bg-[#0A0A0A]">
    <div className="max-w-7xl mx-auto px-6 lg:px-8 grid lg:grid-cols-2 gap-16 items-center">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-4">07 — Quality Assurance</p>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight uppercase mb-6">
          Measured. Verified. Certified.
        </h2>
        <p className="text-slate-400 leading-relaxed mb-10 max-w-lg">
          Every component passes through rigorous dimensional inspection using calibrated instruments,
          backed by documented inspection reports and monthly quality reviews under our ISO 9001:2015 quality system.
        </p>

        <div className="grid grid-cols-2 gap-px bg-[#262626] border border-[#262626]">
          {items.map((it, i) => (
            <motion.div
              key={it.label}
              data-testid={`quality-item-${i}`}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="bg-[#0A0A0A] hover:bg-[#121212] p-5 flex items-center gap-3 transition-colors"
            >
              <it.icon size={18} strokeWidth={1.5} className="text-[#F97316] shrink-0" />
              <span className="text-sm text-slate-300">{it.label}</span>
            </motion.div>
          ))}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, x: 30 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative"
      >
        <img src={QA_IMG} alt="Precision measurement instruments" className="w-full h-[480px] object-cover border border-[#262626]" />
        <div className="absolute -bottom-6 -left-6 bg-[#F97316] p-6 hidden sm:block">
          <p className="font-heading font-black text-3xl text-black">ISO</p>
          <p className="text-xs font-bold uppercase tracking-widest text-black/70">9001:2015 Certified</p>
        </div>
      </motion.div>
    </div>
  </section>
);

export default Quality;
