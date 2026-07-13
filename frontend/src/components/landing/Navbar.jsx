import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, X, Cog, LockKeyhole } from "lucide-react";

const links = [
  { label: "Home", id: "home" },
  { label: "About", id: "about" },
  { label: "Manufacturing", id: "capabilities" },
  { label: "Products", id: "gallery" },
  { label: "Customers", id: "customers" },
  { label: "Contact", id: "contact" },
];

export const scrollTo = (id) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
};

const Navbar = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-testid="main-navbar"
      className={`fixed top-0 inset-x-0 z-50 border-b border-white/10 backdrop-blur-xl transition-colors duration-300 ${scrolled ? "bg-black/90" : "bg-black/60"}`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
        <button
          data-testid="navbar-logo"
          onClick={() => scrollTo("home")}
          className="flex items-center gap-2.5 group"
        >
          <div className="w-8 h-8 bg-[#F97316] flex items-center justify-center">
            <Cog size={18} strokeWidth={1.5} className="text-black group-hover:rotate-90 transition-transform duration-500" />
          </div>
          <div className="text-left leading-none">
            <span className="font-heading font-black uppercase tracking-tight text-sm block">Grewal</span>
            <span className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Engineering Works</span>
          </div>
        </button>

        <nav className="hidden lg:flex items-center gap-8">
          {links.map((l) => (
            <button
              key={l.id}
              data-testid={`nav-link-${l.id}`}
              onClick={() => scrollTo(l.id)}
              className="text-xs font-semibold uppercase tracking-widest text-slate-300 hover:text-[#F97316] transition-colors"
            >
              {l.label}
            </button>
          ))}
          <button
            data-testid="nav-contact-cta"
            onClick={() => scrollTo("contact")}
            className="bg-[#F97316] hover:bg-[#EA580C] text-black font-heading font-bold text-xs uppercase tracking-widest px-5 py-2.5 transition-colors"
          >
            Get a Quote
          </button>
          <button
            data-testid="nav-portal-login"
            onClick={() => navigate("/login")}
            className="border border-white/30 hover:bg-white/10 text-white font-heading font-bold text-xs uppercase tracking-widest px-5 py-2.5 flex items-center gap-2 transition-colors"
          >
            <LockKeyhole size={14} strokeWidth={1.5} />
            Portal Login
          </button>
        </nav>

        <button
          data-testid="mobile-menu-toggle"
          className="lg:hidden text-white"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {open && (
        <nav data-testid="mobile-menu" className="lg:hidden bg-black/95 border-t border-white/10 px-6 py-6 flex flex-col gap-5">
          {links.map((l) => (
            <button
              key={l.id}
              data-testid={`mobile-nav-link-${l.id}`}
              onClick={() => { scrollTo(l.id); setOpen(false); }}
              className="text-left text-sm font-semibold uppercase tracking-widest text-slate-200 hover:text-[#F97316]"
            >
              {l.label}
            </button>
          ))}
          <button
            data-testid="mobile-nav-portal-login"
            onClick={() => navigate("/login")}
            className="text-left text-sm font-bold uppercase tracking-widest text-[#F97316] flex items-center gap-2"
          >
            <LockKeyhole size={14} strokeWidth={1.5} />
            Portal Login
          </button>
        </nav>
      )}
    </header>
  );
};

export default Navbar;
