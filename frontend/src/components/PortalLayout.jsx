import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Outlet, NavLink, useNavigate, Link, useLocation } from "react-router-dom";
import {
  Wrench, SquaresFour, Truck, Package, SealCheck,
  ChartBar, Gear, SignOut, List, X, ClipboardText, Stack, CaretDown,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";

const MD_SUBMENU = [
  { to: "/portal/master-dispatch/create", label: "Create Dispatch" },
  { to: "/portal/master-dispatch/list", label: "Dispatch List" },
  { to: "/portal/master-dispatch/bulk", label: "Bulk Upload" },
  { to: "/portal/master-dispatch/search", label: "Search Dispatch" },
  { to: "/portal/master-dispatch/daily-report", label: "Daily Dispatch Report" },
];

const AUTOMATION_SUBMENU = [
  { to: "/portal/modules/asn", label: "ASN Creation" },
  { to: "/portal/modules/eway-bill", label: "E-Way Bill Entry" },
  { to: "/portal/modules/vendor-ack", label: "Vendor E-Way Bill Ack." },
];

const NAV = [
  { to: "/portal", label: "Dashboard", icon: SquaresFour, end: true },
  { group: "Master Dispatch", icon: Stack, children: MD_SUBMENU },
  { to: "/portal/dispatch", label: "Dispatch Entry", icon: ClipboardText },
  { to: "/portal/modules/packing", label: "Packing", icon: Package },
  { group: "Automation", icon: Truck, children: AUTOMATION_SUBMENU },
  { to: "/portal/modules/pdi", label: "AI PDI Generator", icon: SealCheck },
  { to: "/portal/reports", label: "Reports", icon: ChartBar },
];

function NavGroup({ item, onNavigate }) {
  const location = useLocation();
  const routeActive = item.children.some((c) => location.pathname.startsWith(c.to));
  const [expanded, setExpanded] = useState(true);
  const Icon = item.icon;
  const slug = item.group.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        data-testid={`nav-${slug}-group`}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors ${
          routeActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
        }`}
      >
        <Icon size={19} weight="duotone" />
        <span className="flex-1 text-left">{item.group}</span>
        <CaretDown size={13} weight="bold" className={`transition-transform ${expanded ? "" : "-rotate-90"}`} />
      </button>
      {expanded && (
        <div className="ml-5 border-l border-border pl-2 space-y-0.5 mt-0.5">
          {item.children.map((c) => (
            <NavLink
              key={c.to}
              to={c.to}
              onClick={onNavigate}
              data-testid={`nav-md-${c.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              className={({ isActive }) =>
                `flex items-center px-3 py-2 rounded-sm text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-primary/15 text-primary border-l-2 border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`
              }
            >
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PortalLayout() {
  const [env, setEnv] = useState(null);

  useEffect(() => {
    const fetchEnv = () => api.get("/admin/environment").then((r) => setEnv(r.data)).catch(() => {});
    fetchEnv();
    const t = setInterval(fetchEnv, 60000);
    window.addEventListener("env-changed", fetchEnv);
    return () => { clearInterval(t); window.removeEventListener("env-changed", fetchEnv); };
  }, []);

  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    api.get("/health").then((r) => setVersion(r.data.version)).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const items = user?.role === "admin" ? [...NAV, { to: "/portal/settings", label: "Settings", icon: Gear }] : NAV;

  return (
    <div className="min-h-screen bg-background flex" data-testid="portal-layout">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-card border-r border-border flex flex-col transition-transform duration-200 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        data-testid="portal-sidebar"
      >
        <Link to="/" className="flex items-center gap-3 px-5 h-16 border-b border-border shrink-0">
          <div className="w-9 h-9 bg-primary flex items-center justify-center rounded-sm">
            <Wrench size={20} weight="bold" className="text-primary-foreground" />
          </div>
          <div>
            <p className="font-black text-xs tracking-tight leading-none">GREWAL ENGINEERING WORKS</p>
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground mt-0.5">TAFE Vendor Automation</p>
          </div>
        </Link>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {items.map((item) =>
            item.group ? (
              <NavGroup key={item.group} item={item} onNavigate={() => setOpen(false)} />
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                data-testid={`nav-${item.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary/15 text-primary border-l-2 border-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`
                }
              >
                <item.icon size={19} weight="duotone" />
                {item.label}
              </NavLink>
            )
          )}
        </nav>
        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold" data-testid="sidebar-user-name">{user?.name}</p>
              <Badge variant="outline" className="mt-1 text-[10px] uppercase tracking-widest border-primary/40 text-primary rounded-sm" data-testid="sidebar-user-role">
                {user?.role}
              </Badge>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleLogout}
            data-testid="logout-button"
            className="w-full rounded-sm gap-2 active:scale-95 transition-transform"
          >
            <SignOut size={16} /> Sign Out
          </Button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <div className="flex-1 lg:ml-64 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-xl sticky top-0 z-20 flex items-center justify-between px-4 sm:px-8">
          <button
            className="lg:hidden p-2 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(!open)}
            data-testid="mobile-menu-toggle"
            aria-label="Toggle menu"
          >
            {open ? <X size={22} /> : <List size={22} />}
          </button>
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground hidden sm:block">
            Internal Automation Platform
          </p>
          <div className="flex items-center gap-3">
            {env && (
              <Badge variant="outline" data-testid="header-env-badge"
                     className={`rounded-sm text-[10px] font-black uppercase tracking-wider ${
                       env.mode === "live" ? "border-emerald-500/50 text-emerald-500"
                       : env.mode === "maintenance" ? "border-sky-500/50 text-sky-500"
                       : "border-amber-500/50 text-amber-500"}`}>
                {env.mode === "live" ? "LIVE MODE" : env.mode === "maintenance" ? "MAINTENANCE" : "TEST MODE"}
              </Badge>
            )}
            <p className="text-xs text-muted-foreground font-mono" data-testid="header-username">
              {user?.username}@gew
            </p>
          </div>
        </header>
        {env?.mode === "test" && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-500 text-[11px] font-bold uppercase tracking-widest text-center py-1.5" data-testid="test-mode-banner">
            TEST MODE — No data will be submitted to the live TAFE portal
          </div>
        )}
        {env?.mode === "maintenance" && (
          <div className="bg-sky-500/10 border-b border-sky-500/30 text-sky-500 text-[11px] font-bold uppercase tracking-widest text-center py-1.5" data-testid="maintenance-banner">
            MAINTENANCE MODE — New portal automation is temporarily blocked
          </div>
        )}
        {env?.live_automation_stopped && (
          <div className="bg-red-500/10 border-b border-red-500/40 text-red-400 text-[11px] font-bold uppercase tracking-widest text-center py-1.5" data-testid="emergency-stop-banner">
            EMERGENCY STOP ACTIVE — Live automation is paused by admin
          </div>
        )}
        <main className="flex-1 p-4 sm:p-8">
          <Outlet />
        </main>
        <footer className="border-t border-border px-4 sm:px-8 py-3 no-print" data-testid="portal-footer">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-center">
            © {new Date().getFullYear()} Grewal Engineering Works. All Rights Reserved.
            {version ? ` · v${version}` : ""}
          </p>
        </footer>
      </div>
    </div>
  );
}
