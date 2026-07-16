import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

const ISSUE_LABELS = {
  missing_item_code: "Missing item code",
  missing_part_name: "Missing part name",
  missing_drg_no: "Missing drawing number",
  missing_rows: "Missing inspection parameters",
  duplicate_item_codes: "Duplicate item codes",
  duplicate_name_drg: "Duplicate part name + drg",
  broken_pdf_links: "Broken PDF links",
  revision_conflicts: "Revision conflicts",
  orphan_reports: "Reports referencing missing templates",
};

export default function IntegrityDialog({ open, onClose, isAdmin }) {
  const [reports, setReports] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/pdi/templates/integrity-reports").then((r) => setReports(r.data)).catch(() => {});
  useEffect(() => { if (open) load(); }, [open]);

  const runNow = async () => {
    setBusy(true);
    try {
      await api.post("/pdi/templates/integrity-check");
      toast.success("Integrity check complete");
      load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  const latest = reports[0];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl rounded-sm" data-testid="pdi-integrity-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold flex items-center gap-2"><ShieldCheck size={16} className="text-primary" /> Library Integrity Reports</DialogTitle>
        </DialogHeader>
        {isAdmin && (
          <Button size="sm" onClick={runNow} disabled={busy} data-testid="pdi-integrity-run" className="rounded-sm w-fit h-7 text-xs">
            {busy ? "Checking…" : "Run Check Now"}
          </Button>
        )}
        {latest ? (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="border border-border rounded-sm p-3 bg-background space-y-2" data-testid="pdi-integrity-latest">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${latest.status === "clean" ? "border-emerald-500/50 text-emerald-500" : "border-amber-500/50 text-amber-500"}`}>
                  {latest.status === "clean" ? "Clean" : "Issues Found"}
                </Badge>
                <b>Score {latest.health_score}%</b>
                <span className="text-muted-foreground">{latest.total} templates · {latest.trigger} · by {latest.triggered_by} · {(latest.created_at || "").slice(0, 16).replace("T", " ")}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {Object.entries(latest.issues || {}).map(([k, v]) => (
                  <div key={k} className={`border rounded-sm px-2 py-1.5 ${v > 0 ? "border-amber-500/40" : "border-border"}`}>
                    <span className={`text-sm font-bold ${v > 0 ? "text-amber-500" : "text-emerald-500"}`}>{v}</span>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{ISSUE_LABELS[k] || k}</p>
                  </div>
                ))}
              </div>
              {latest.duplicate_item_codes?.length > 0 && (
                <p className="text-[11px] text-muted-foreground">Dup item codes: <span className="font-mono">{latest.duplicate_item_codes.slice(0, 12).join(", ")}{latest.duplicate_item_codes.length > 12 ? "…" : ""}</span></p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">History</p>
              {reports.slice(1).map((r, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] border border-border rounded-sm px-2.5 py-1.5">
                  <span>{(r.created_at || "").slice(0, 16).replace("T", " ")} · {r.trigger} · by {r.triggered_by}</span>
                  <span className={r.status === "clean" ? "text-emerald-500" : "text-amber-500"}>{r.health_score}% · {Object.values(r.issues || {}).reduce((a, b) => a + b, 0)} issue(s)</span>
                </div>
              ))}
              {reports.length <= 1 && <p className="text-[11px] text-muted-foreground">No earlier reports.</p>}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-4">No integrity reports yet. Checks run automatically after imports, bulk OCR and template updates.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
