import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const categories = [
  {
    id: "hardware",
    label: "Hardware Components",
    img: "https://static.prod-images.emergentagent.com/jobs/57cd4c35-bafb-4207-b9bb-ffa68ba67f9a/images/5e58b44836dc0d7bb0fe7c0e0f84cbdb80cd1c20eaa6263280dc6793217982de.png",
    desc: "Precision bar stock hardware — bolts, studs, pins, bushings and turned fasteners machined to exact OEM specifications.",
  },
  {
    id: "cnc",
    label: "CNC Components",
    img: "https://static.prod-images.emergentagent.com/jobs/57cd4c35-bafb-4207-b9bb-ffa68ba67f9a/images/1730b2321282e4ea4726f87a12f3d84e28c3036f205ee27e0f5a575de5575ac2.png",
    desc: "High-precision CNC turned parts produced on LMW Smart Turn and Macpower machines with tight tolerances.",
  },
  {
    id: "sheet-metal",
    label: "Sheet Metal Parts",
    img: "https://static.prod-images.emergentagent.com/jobs/57cd4c35-bafb-4207-b9bb-ffa68ba67f9a/images/3b6da65ec1e232e63be7c5152be47064bc71a5502a0b1beb1fbc822066da2f03.png",
    desc: "Pressed and stamped sheet metal components — brackets, clamps and stampings produced on power presses.",
  },
  {
    id: "assemblies",
    label: "Assemblies",
    img: "https://static.prod-images.emergentagent.com/jobs/57cd4c35-bafb-4207-b9bb-ffa68ba67f9a/images/07cc61e794656d8139c101fb09f6035ab1a5b100f9070f3b1c267c6c84300d4e.png",
    desc: "Welded and fabricated assemblies and sub-assemblies for tractor, railway and engineering applications.",
  },
  {
    id: "plastic",
    label: "Plastic Molded Parts",
    img: "https://static.prod-images.emergentagent.com/jobs/57cd4c35-bafb-4207-b9bb-ffa68ba67f9a/images/1d239fdb73966988bdda30974fecde9589d803fa9e7b20d2c7868e05ae7c0c1a.png",
    desc: "Hydraulic plastic molded components — caps, knobs, housings and grommets for industrial use.",
  },
];

const Gallery = () => {
  const [active, setActive] = useState(categories[0]);

  return (
    <section id="gallery" data-testid="gallery-section" className="py-24 sm:py-32 border-b border-[#262626] bg-[#0A0A0A]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-4">09 — Product Gallery</p>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight uppercase mb-12">What We Manufacture</h2>

        <div className="flex flex-wrap gap-x-8 gap-y-3 border-b border-[#262626] mb-12">
          {categories.map((c) => (
            <button
              key={c.id}
              data-testid={`gallery-tab-${c.id}`}
              onClick={() => setActive(c)}
              className={`pb-4 text-xs sm:text-sm font-bold uppercase tracking-widest transition-colors border-b-2 -mb-px ${
                active.id === c.id
                  ? "text-[#F97316] border-[#F97316]"
                  : "text-slate-500 border-transparent hover:text-slate-300"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            data-testid="gallery-active-panel"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35 }}
            className="grid lg:grid-cols-5 gap-10 items-center"
          >
            <div className="lg:col-span-3">
              <img
                src={active.img}
                alt={active.label}
                className="w-full h-[320px] sm:h-[440px] object-cover border border-[#262626]"
              />
            </div>
            <div className="lg:col-span-2">
              <h3 className="font-heading font-bold text-2xl mb-4">{active.label}</h3>
              <p className="text-slate-400 leading-relaxed">{active.desc}</p>
              <div className="mt-8 w-12 h-1 bg-[#F97316]" />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
};

export default Gallery;
