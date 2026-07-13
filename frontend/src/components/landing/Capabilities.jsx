import { motion } from "framer-motion";
import {
  Cog, Wrench, Layers, Boxes, Package, Hammer, RefreshCw, Flame, Puzzle,
} from "lucide-react";

const capabilities = [
  { icon: Cog, title: "CNC Turning", desc: "High-precision CNC turned components with tight tolerances for critical applications." },
  { icon: Wrench, title: "Bar Stock Hardware", desc: "Precision-machined bolts, studs, pins, bushings and turned fasteners from bar stock." },
  { icon: Layers, title: "Sheet Metal Press Components", desc: "Pressed and stamped sheet metal parts produced on power presses." },
  { icon: Boxes, title: "Fabricated Assemblies", desc: "Welded and fabricated sub-assemblies built to OEM specifications." },
  { icon: Package, title: "Plastic Moulding", desc: "Hydraulic plastic molded components — caps, knobs, housings and grommets." },
  { icon: Hammer, title: "Tool Room", desc: "In-house tool room for dies, jigs, fixtures and tooling maintenance." },
  { icon: RefreshCw, title: "Thread Rolling", desc: "Cold thread rolling for strong, precise and consistent threads." },
  { icon: Flame, title: "Welding", desc: "MIG and arc welding capabilities for fabricated structures." },
  { icon: Puzzle, title: "Assembly", desc: "Complete component assembly and sub-assembly services." },
];

const Capabilities = () => (
  <section id="capabilities" data-testid="capabilities-section" className="py-24 sm:py-32 border-b border-[#262626] bg-[#0A0A0A]">
    <div className="max-w-7xl mx-auto px-6 lg:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-4">05 — Manufacturing Capabilities</p>
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight uppercase mb-16 max-w-2xl">
        End-to-End Manufacturing Under One Roof
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {capabilities.map((c, i) => (
          <motion.div
            key={c.title}
            data-testid={`capability-card-${i}`}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: (i % 3) * 0.1 }}
            className="border border-[#262626] bg-[#121212] p-8 hover:border-[#F97316]/50 hover:-translate-y-1 transition-[border-color,transform] duration-300 group"
          >
            <c.icon size={28} strokeWidth={1.5} className="text-[#F97316] mb-6 group-hover:rotate-6 transition-transform" />
            <h3 className="font-heading font-semibold text-lg mb-3">{c.title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{c.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default Capabilities;
