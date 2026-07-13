import { motion } from "framer-motion";
import { Settings2 } from "lucide-react";

const machines = [
  { name: "CNC LMW Smart Turn", type: "CNC Turning Center" },
  { name: "CNC Macpower", type: "CNC Turning Center" },
  { name: "Power Press", type: "Sheet Metal Pressing" },
  { name: "Lathe Machines", type: "Conventional Turning" },
  { name: "Thread Rolling Machines", type: "Thread Forming" },
  { name: "Hydraulic Moulding", type: "Plastic Moulding" },
  { name: "Drill Machines", type: "Drilling Operations" },
  { name: "Tool Room", type: "Dies, Jigs & Fixtures" },
  { name: "Centerless Grinder", type: "Precision Grinding" },
];

const Machinery = () => (
  <section id="machinery" data-testid="machinery-section" className="py-24 sm:py-32 border-b border-[#262626]">
    <div className="max-w-7xl mx-auto px-6 lg:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-4">06 — Plant &amp; Machinery</p>
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight uppercase mb-16">Modern Machine Shop Floor</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 border-t border-l border-[#262626]">
        {machines.map((m, i) => (
          <motion.div
            key={m.name}
            data-testid={`machine-card-${i}`}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: (i % 3) * 0.08 }}
            className="border-r border-b border-[#262626] p-8 flex items-start gap-5 hover:bg-[#121212] transition-colors group"
          >
            <span className="font-heading font-black text-4xl text-[#1F1F1F] group-hover:text-[#F97316]/30 transition-colors leading-none">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="font-heading font-semibold text-base">{m.name}</h3>
              <p className="text-xs uppercase tracking-widest text-slate-500 mt-2 flex items-center gap-1.5">
                <Settings2 size={12} strokeWidth={1.5} className="text-[#F97316]" />
                {m.type}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default Machinery;
