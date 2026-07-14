import { useEffect, useState } from "react";
import { ArrowDown, DownloadSimple, CheckCircle, Clock, XCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api, { apiError } from "@/lib/api";
import { STATUS_BADGE, downloadBlob } from "./reportConfig";

const ICON = { Completed: CheckCircle, Pending: Clock, Failed: XCircle };
const ICON_CLS = { Completed: "text-emerald-400", Pending: "text-amber-400", Failed: "text-red-400" };

export const WorkflowDialog = ({ record, onClose }) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!record) return setData(null);
    api.get(`/reports/workflow/${record.id}`).then((r) => setData(r.data)).catch((err) => toast.error(apiError(err)));
  }, [record]);

  const download = async (path, name) => {
    try {
      const res = await api.get(path, { responseType: "blob" });
      downloadBlob(res.data, name);
    } catch (err) {
      toast.error("Download failed");
    }
  };

  const d = data?.dispatch;
  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-card border-border" data-testid="workflow-dialog">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Dispatch Details — <span className="text-primary font-mono">{record?.invoice_number}</span>
          </DialogTitle>
          <DialogDescription>Complete workflow status for this dispatch.</DialogDescription>
        </DialogHeader>
        {d && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border border-border rounded-sm p-3 bg-background" data-testid="workflow-summary">
            {[["Dispatch No", d.dispatch_no], ["Invoice Date", d.invoice_date], ["Customer", d.customer_name],
              ["Plant", d.plant], ["PO Number", d.po_number], ["Transporter", d.transporter_name],
              ["Vehicle", d.vehicle_number], ["Boxes", d.boxes], ["Invoice Total", `₹${(d.invoice_total || 0).toLocaleString("en-IN")}`]].map(([label, value]) => (
              <p key={label}><span className="text-muted-foreground">{label}:</span> <span className="font-mono">{value || "—"}</span></p>
            ))}
          </div>
        )}
        <div className="space-y-0" data-testid="workflow-steps">
          {(data?.steps || []).map((s, i) => {
            const Icon = ICON[s.status] || Clock;
            return (
              <div key={s.key}>
                <div className="flex items-start gap-3 border border-border rounded-sm p-3 bg-background" data-testid={`workflow-step-${s.key}`}>
                  <Icon size={20} weight="fill" className={`mt-0.5 shrink-0 ${ICON_CLS[s.status] || "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold">{s.label}</p>
                      <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${STATUS_BADGE[s.status] || ""}`}>{s.status}</Badge>
                    </div>
                    {s.doc_no && <p className="text-xs font-mono text-primary mt-0.5">{s.doc_no}</p>}
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{s.detail}</p>
                    {s.batches?.length > 0 && (
                      <div className="mt-1.5 border border-border rounded-sm overflow-hidden" data-testid="workflow-batches">
                        {s.batches.map((b, bi) => (
                          <p key={bi} className="text-[10px] font-mono px-2 py-1 border-b border-border last:border-0 bg-secondary/40">
                            {b.part_number} · {b.batch_number} → <span className="text-primary">{b.allocated_quantity}</span> ({b.batch_considerable})
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {s.timestamp && <p className="text-[10px] font-mono text-muted-foreground">{String(s.timestamp).slice(0, 19).replace("T", " ")}</p>}
                      {s.download && (
                        <button onClick={() => download(s.download, `${s.doc_no || s.key}.pdf`)} data-testid={`workflow-download-${s.key}`}
                                className="text-[10px] text-primary hover:underline flex items-center gap-1">
                          <DownloadSimple size={11} /> Download PDF
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {i < data.steps.length - 1 && (
                  <div className="flex justify-center py-0.5"><ArrowDown size={13} className="text-muted-foreground" /></div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
