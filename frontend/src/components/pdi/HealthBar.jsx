import { Badge } from "@/components/ui/badge";

const CARDS = [
  { key: "total", label: "Total", type: "none" },
  { key: "active", label: "Active", type: "status", value: "active", tone: "text-emerald-500" },
  { key: "inactive", label: "Inactive", type: "status", value: "inactive" },
  { key: "missing_item_code", label: "No Item Code", type: "flag" },
  { key: "missing_part_name", label: "No Part Name", type: "flag" },
  { key: "missing_drg_no", label: "No Drg No", type: "flag" },
  { key: "missing_rows", label: "No Parameters", type: "flag" },
  { key: "dup_item_code", label: "Dup Item Codes", type: "flag" },
  { key: "dup_name_drg", label: "Dup Name+Drg", type: "flag" },
  { key: "broken_pdf", label: "Broken PDFs", type: "flag" },
  { key: "never_used", label: "Never Used", type: "flag", neutral: true },
];

export default function HealthBar({ health, flag, status, onFlag, onStatus }) {
  if (!health) return null;
  const score = health.health_score ?? 100;
  const scoreTone = score >= 90 ? "text-emerald-500 border-emerald-500/40" : score >= 60 ? "text-amber-500 border-amber-500/40" : "text-red-400 border-red-500/40";
  return (
    <div className="border border-border bg-card rounded-sm p-3 space-y-2" data-testid="pdi-health-bar">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mr-1">Library Health</p>
        <Badge variant="outline" className={`rounded-sm text-xs font-bold ${scoreTone}`} data-testid="pdi-health-score">
          {score}%
        </Badge>
        {health.last_ocr_run && (
          <span className="text-[10px] text-muted-foreground" data-testid="pdi-health-last-ocr">
            Last OCR: {health.last_ocr_run.slice(0, 16).replace("T", " ")}{health.last_ocr_errors ? ` · ${health.last_ocr_errors} errors` : ""}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CARDS.map((c) => {
          const count = c.type === "flag" ? (health.counts?.[c.key] ?? 0) : health[c.key] ?? 0;
          const isActive = (c.type === "flag" && flag === c.key) || (c.type === "status" && status === c.value);
          const problem = !c.neutral && c.type === "flag" && count > 0;
          return (
            <button key={c.key} data-testid={`pdi-health-${c.key}`}
                    onClick={() => {
                      if (c.type === "flag") onFlag(isActive ? "" : c.key);
                      else if (c.type === "status") onStatus(isActive ? "all" : c.value);
                      else { onFlag(""); onStatus("all"); }
                    }}
                    className={`px-2.5 py-1.5 rounded-sm border text-left transition-colors ${
                      isActive ? "border-primary/60 bg-primary/10" : "border-border bg-background hover:border-primary/40"}`}>
              <span className={`block text-sm font-bold leading-none ${problem ? "text-amber-500" : c.tone || ""}`}>{count}</span>
              <span className="block text-[9px] uppercase tracking-wider text-muted-foreground mt-1">{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
