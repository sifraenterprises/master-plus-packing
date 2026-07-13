import { MapPin, Phone, Mail, Cog } from "lucide-react";
import { scrollTo } from "./Navbar";

const quickLinks = [
  { label: "Home", id: "home" },
  { label: "About", id: "about" },
  { label: "Manufacturing", id: "capabilities" },
  { label: "Products", id: "gallery" },
  { label: "Customers", id: "customers" },
  { label: "Certifications", id: "quality" },
  { label: "Contact", id: "contact" },
];

const Footer = () => (
  <footer id="contact" data-testid="footer-section" className="bg-[#0A0A0A]">
    <div className="max-w-7xl mx-auto px-6 lg:px-8 py-20 grid md:grid-cols-3 gap-14">
      <div>
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 bg-[#F97316] flex items-center justify-center">
            <Cog size={20} strokeWidth={1.5} className="text-black" />
          </div>
          <div className="leading-none">
            <span className="font-heading font-black uppercase tracking-tight block">Grewal</span>
            <span className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Engineering Works</span>
          </div>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">
          Precision Engineering | CNC Machining | Sheet Metal Components | Fabricated Assemblies
        </p>
        <p className="mt-4 text-xs uppercase tracking-widest text-[#F97316] font-bold">
          ISO 9001:2015 Certified · Since 1972
        </p>
      </div>

      <div>
        <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-6">Quick Links</h4>
        <ul className="grid grid-cols-2 gap-3">
          {quickLinks.map((l) => (
            <li key={l.id}>
              <button
                data-testid={`footer-link-${l.label.toLowerCase()}`}
                onClick={() => scrollTo(l.id)}
                className="text-sm text-slate-400 hover:text-[#F97316] transition-colors"
              >
                {l.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-6">Contact</h4>
        <ul className="space-y-5">
          <li data-testid="contact-address" className="flex items-start gap-3 text-sm text-slate-400">
            <MapPin size={18} strokeWidth={1.5} className="text-[#F97316] shrink-0 mt-0.5" />
            5/1-G, Northern India Complex, 20/3 Mathura Road, Faridabad – 121006, Haryana, India
          </li>
          <li data-testid="contact-phone" className="flex items-start gap-3 text-sm text-slate-400">
            <Phone size={18} strokeWidth={1.5} className="text-[#F97316] shrink-0 mt-0.5" />
            <span>
              <a href="tel:+919871213582" className="hover:text-white transition-colors">+91 98712 13582</a>
              {" | "}
              <a href="tel:+919818767778" className="hover:text-white transition-colors">+91 98187 67778</a>
            </span>
          </li>
          <li data-testid="contact-email" className="flex items-start gap-3 text-sm text-slate-400">
            <Mail size={18} strokeWidth={1.5} className="text-[#F97316] shrink-0 mt-0.5" />
            <a href="mailto:grewalengg@hotmail.com" className="hover:text-white transition-colors">
              grewalengg@hotmail.com
            </a>
          </li>
        </ul>
      </div>
    </div>

    <div className="border-t border-[#262626]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-6 flex flex-col sm:flex-row justify-between gap-2">
        <p className="text-xs text-slate-600">
          © {new Date().getFullYear()} Grewal Engineering Works. All rights reserved.
        </p>
        <p className="text-xs text-slate-600 uppercase tracking-widest">Manufacturing Excellence Since 1972</p>
      </div>
    </div>
  </footer>
);

export default Footer;
