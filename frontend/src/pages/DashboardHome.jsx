import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardText, Package, Truck, Receipt, Handshake, SealCheck, ChartBar, Gear, ArrowRight,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import MDStats from "@/components/md/MDStats";

const MODULE_ICONS = { Package, Truck, Receipt, Handshake, SealCheck };

function ModuleCard({ to, icon: Icon, title, description, badge, badgeVariant, testId, delay }) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="group border border-border bg-card p-6 rounded-sm flex flex-col gap-4 hover:-translate-y-1 hover:shadow-lg hover:border-primary/40 transition-[transform,box-shadow,border-color] duration-200 rise-in"
      style={{ animationDelay: `${delay * 60}ms` }}
    >
      <div className="flex items-start justify-between">
        <div className="w-11 h-11 bg-secondary group-hover:bg-primary/15 flex items-center justify-center rounded-sm transition-colors">
          <Icon size={24} weight="duotone" className="text-primary" />
        </div>
        {badge && (
          <Badge variant={badgeVariant || "secondary"} className="rounded-sm text-[10px] uppercase tracking-widest">
            {badge}
          </Badge>
        )}
      </div>
      <div className="flex-1">
        <h3 className="font-bold text-base mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
      <span className="text-xs text-primary font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        Open module <ArrowRight size={14} />
      </span>
    </Link>
  );
}

export default function DashboardHome() {
  const { user } = useAuth();
  const [modules, setModules] = useState([]);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.get("/modules").then((r) => setModules(r.data)).catch(() => {});
    api.get("/reports/summary").then((r) => setSummary(r.data)).catch(() => {});
  }, []);

  const stats = [
    { label: "Total Dispatches", value: summary?.total_dispatches ?? "—", testId: "stat-total-dispatches" },
    { label: "This Month", value: summary?.this_month ?? "—", testId: "stat-this-month" },
    { label: "Customers", value: summary?.unique_customers ?? "—", testId: "stat-customers" },
    { label: "Total Value (₹)", value: summary ? summary.total_value.toLocaleString("en-IN") : "—", testId: "stat-total-value" },
  ];

  return (
    <div className="max-w-7xl" data-testid="dashboard-home">
      <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">
        {user?.role === "admin" ? "Administrator Dashboard" : "Dispatch Dashboard"}
      </p>
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-8">
        Welcome, {user?.name?.split(" ")[0]}
      </h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 border border-border rounded-sm overflow-hidden mb-10">
        {stats.map((s, i) => (
          <div key={s.label} className={`bg-card p-5 ${i < 3 ? "border-r border-border" : ""} ${i < 2 ? "border-b lg:border-b-0 border-border" : ""}`} data-testid={s.testId}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">{s.label}</p>
            <p className="text-2xl font-black font-mono text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold mb-4">Master Dispatch Overview</h2>
      <div className="mb-10">
        <MDStats />
      </div>

      <h2 className="text-lg font-bold mb-4">Modules</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <ModuleCard
          to="/portal/master-dispatch/list"
          icon={ClipboardText}
          title="Master Dispatch"
          description="Central dispatch register — AI OCR invoice ingestion, verification, bulk uploads, search and exports."
          badge="Active"
          badgeVariant="default"
          testId="card-master-dispatch-module"
          delay={0}
        />
        <ModuleCard
          to="/portal/dispatch"
          icon={ClipboardText}
          title="Dispatch Entry"
          description="Upload invoice PDFs, AI-extract dispatch data, manage and export records."
          badge="Active"
          badgeVariant="default"
          testId="card-master-dispatch"
          delay={1}
        />
        {modules.map((m, i) => (
          <ModuleCard
            key={m.key}
            to={`/portal/modules/${m.key}`}
            icon={MODULE_ICONS[m.icon] || Package}
            title={m.name}
            description={m.description}
            badge={m.status === "active" ? "Active" : "Coming Soon"}
            badgeVariant={m.status === "active" ? "default" : "secondary"}
            testId={`card-module-${m.key}`}
            delay={i + 1}
          />
        ))}
        <ModuleCard
          to="/portal/reports"
          icon={ChartBar}
          title="Reports"
          description="Dispatch and invoice history with advanced search, filters and exports."
          badge="Active"
          badgeVariant="default"
          testId="card-reports"
          delay={modules.length + 1}
        />
        {user?.role === "admin" && (
          <ModuleCard
            to="/portal/settings"
            icon={Gear}
            title="Settings"
            description="User management, company profile publishing and system audit logs."
            badge="Admin"
            badgeVariant="outline"
            testId="card-settings"
            delay={modules.length + 2}
          />
        )}
      </div>
    </div>
  );
}
