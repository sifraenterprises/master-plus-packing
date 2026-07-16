import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HeartStraight, Warning, ArrowRight } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";

export default function HealthWidget() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.get("/pdi/templates/health").then((r) => setHealth(r.data)).catch(() => {});
  }, []);

  if (!health) return null;
  const score = health.health_score ?? 100;
  const level = score < 90 ? "critical" : score < 95 ? "warning" : "ok";
  const tone = level === "critical" ? "text-red-400 border-red-500/40" : level === "warning" ? "text-amber-500 border-amber-500/40" : "text-emerald-500 border-emerald-500/40";
  const stats = [
    ["Total Templates", health.total, "total-templates"],
    ["Active", health.active, "active-templates"],
    ["Duplicates", health.counts?.dup_item_code ?? 0, "duplicates"],
    ["OCR Failures", health.counts?.missing_rows ?? 0, "ocr-failures"],
    ["No Item Code", health.counts?.missing_item_code ?? 0, "missing-item-codes"],
    ["Broken PDFs", health.counts?.broken_pdf ?? 0, "broken-pdfs"],
  ];
  return (
    <div className="border border-border bg-card rounded-sm p-5 mb-10" data-testid="dashboard-pdi-health">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <HeartStraight size={18} weight="duotone" className="text-primary" />
        <h2 className="text-sm font-bold">PDI Template Library Health</h2>
        <Badge variant="outline" className={`rounded-sm text-sm font-bold ${tone}`} data-testid="dashboard-health-score">{score}%</Badge>
        {health.last_integrity_check && (
          <span className="text-[10px] text-muted-foreground" data-testid="dashboard-last-integrity">
            Last integrity check: {health.last_integrity_check.slice(0, 16).replace("T", " ")}
          </span>
        )}
      </div>
      {level !== "ok" && (
        <div className={`flex items-center justify-between gap-3 border rounded-sm px-3 py-2 mb-4 ${level === "critical" ? "border-red-500/40 bg-red-500/5" : "border-amber-500/40 bg-amber-500/5"}`}
             data-testid={`dashboard-health-${level}`}>
          <p className={`text-xs font-semibold flex items-center gap-1.5 ${level === "critical" ? "text-red-400" : "text-amber-500"}`}>
            <Warning size={14} weight="fill" />
            {level === "critical" ? "Critical: template library health below 90% — PDI generation may be affected." : "Warning: template library health below 95%."}
          </p>
          <Link to="/portal/modules/pdi?tab=library" data-testid="dashboard-health-shortcut"
                className={`text-xs font-semibold flex items-center gap-1 shrink-0 ${level === "critical" ? "text-red-400" : "text-amber-500"} hover:underline`}>
            Open Integrity Report <ArrowRight size={12} />
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {stats.map(([label, value, id]) => (
          <div key={id} className={`border rounded-sm px-3 py-2 bg-background ${["duplicates", "ocr-failures", "missing-item-codes", "broken-pdfs"].includes(id) && value > 0 ? "border-amber-500/40" : "border-border"}`}
               data-testid={`dashboard-health-${id}`}>
            <p className="text-lg font-black font-mono leading-none">{value}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
