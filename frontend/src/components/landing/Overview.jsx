import { motion } from "framer-motion";
import { CalendarDays, BadgeCheck, LandPlot, Building2, Users, MapPin } from "lucide-react";

const stats = [
  { icon: CalendarDays, value: "1972", label: "Established" },
  { icon: BadgeCheck, value: "ISO 9001:2015", label: "Certified" },
  { icon: LandPlot, value: "1100 Sq. Yds", label: "Manufacturing Facility" },
  { icon: Building2, value: "800 Sq. Yds", label: "Built-up Area" },
  { icon: Users, value: "25+", label: "Employees" },
  { icon: MapPin, value: "Faridabad", label: "Haryana, India" },
];

const Overview = () => (
  <section id="overview" data-testid="overview-section" className="py-24 sm:py-32 border-b border-[#262626]">
    <div className="max-w-7xl mx-auto px-6 lg:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F97316] mb-4">04 — Company Overview</p>
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight uppercase mb-16">The Numbers That Define Us</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border-t border-l border-[#262626]">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            data-testid={`overview-stat-${i}`}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className="border-r border-b border-[#262626] p-8 hover:bg-[#121212] transition-colors group"
          >
            <s.icon size={24} strokeWidth={1.5} className="text-[#F97316] mb-6 group-hover:scale-110 transition-transform" />
            <p className="font-heading font-black text-xl sm:text-2xl tracking-tight">{s.value}</p>
            <p className="text-xs uppercase tracking-widest text-slate-500 mt-2">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default Overview;
