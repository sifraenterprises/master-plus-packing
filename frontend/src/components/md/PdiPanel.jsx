import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Eye, DownloadSimple, ArrowsClockwise, Sparkle } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import PdfPreviewDialog from "@/components/pdi/PdfPreviewDialog";

const fmtDate = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

export default function PdiPanel({ record, onClose, onChanged }) {
  const [template, setTemplate] = useState(null);
  const [itemIdx, setItemIdx] = useState(0);
  const [inspectors, setInspectors] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [inspector, setInspector] = useState("");
  const [approver, setApprover] = useState("");
  const [lots, setLots] = useState([]);
  const [lotNo, setLotNo] = useState("");
  const [sampleCount, setSampleCount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const hasPdi = !!record?.pdi_report_no;

  useEffect(() => {
    if (!record || hasPdi) return;
    api.get("/pdi/masters/inspectors").then((r) => setInspectors(r.data)).catch(() => {});
    api.get("/pdi/masters/approvers").then((r) => setApprovers(r.data)).catch(() => {});
    api.get("/pdi/last-used").then((r) => { setInspector(r.data.inspector || ""); setApprover(r.data.approver || ""); }).catch(() => {});
    api.get("/pdi/dispatch-options", { params: { q: record.invoice_number } }).then((r) => {
      const d = r.data.find((x) => x.id === record.id);
      const ls = d?.lot_numbers || [];
      setLots(ls);
      if (ls.length === 1) setLotNo(ls[0]);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]);

  useEffect(() => {
    if (!record || hasPdi) return;
    const item = record.items?.[itemIdx];
    if (!item) return;
    api.get("/pdi/match", { params: { identifier: item.part_number || item.description, customer: record.customer_name || "" } })
      .then((r) => setTemplate(r.data.matched ? r.data.template : null))
      .catch(() => setTemplate(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, itemIdx]);

  if (!record) return null;
  const item = record.items?.[itemIdx];

  const generate = async () => {
    if (!template) return toast.error("No matching PDI template — add one in the AI PDI Generator library first");
    setBusy(true);
    try {
      const totalQty = (record.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
      await api.post("/pdi/generate", {
        template_id: template.id, master_dispatch_id: record.id,
        part_name: item?.description || "", item_code: item?.part_number || "",
        report_date: fmtDate(record.invoice_date), lot_size: String(totalQty || ""),
        lot_no: lotNo, challan_no_dt: record.invoice_number || "",
        vender_code: record.customer_code || "", inspector, approver,
        sample_count: Number(sampleCount) || 10,
      });
      toast.success("PDI generated & attached to this dispatch");
      onChanged();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  const download = async () => {
    try {
      const r = await api.get(`/pdi/reports/${record.pdi_report_id}/pdf`, { params: { download: 1 }, responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${record.pdi_report_no}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast.error(apiError(err)); }
  };

  const regenerate = async () => {
    try {
      await api.post(`/pdi/reports/${record.pdi_report_id}/regenerate`);
      toast.success("PDI regenerated with fresh observations");
      onChanged();
    } catch (err) { toast.error(apiError(err)); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-sm" data-testid="md-pdi-panel">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">PDI — {record.invoice_number} · {record.customer_name}</DialogTitle>
        </DialogHeader>
        {hasPdi ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[["Report No", record.pdi_report_no], ["Generated", (record.pdi_generated_at || "").slice(0, 16).replace("T", " ")],
                ["Template Revision", `r${record.pdi_template_revision || 1}`], ["Inspector", record.pdi_inspector || "—"],
                ["Approver", record.pdi_approver || "—"],
                ["Upload Status", record.pdi_upload_status || "Pending Upload"],
                ["Last Upload", record.pdi_last_upload_at ? record.pdi_last_upload_at.slice(0, 16).replace("T", " ") : "—"]].map(([k, v]) => (
                <div key={k} className="border border-border rounded-sm px-2.5 py-1.5 bg-background">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{k}</p>
                  <p className="font-semibold" data-testid={`md-pdi-${k.toLowerCase().replace(/ /g, "-")}`}>{String(v)}</p>
                </div>
              ))}
            </div>
            <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${record.pdi_upload_status === "Uploaded to Portal" ? "border-emerald-500/50 text-emerald-500" : "border-amber-500/50 text-amber-500"}`}>
              {record.pdi_upload_status === "Uploaded to Portal" ? "Uploaded to TAFE portal during ASN" : "Will auto-upload during ASN creation"}
            </Badge>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPreviewOpen(true)} data-testid="md-pdi-preview-btn" className="rounded-sm gap-1.5"><Eye size={14} /> Preview</Button>
              <Button size="sm" variant="secondary" onClick={download} data-testid="md-pdi-download-btn" className="rounded-sm gap-1.5"><DownloadSimple size={14} /> Download</Button>
              <Button size="sm" variant="secondary" onClick={regenerate} data-testid="md-pdi-regenerate-btn" className="rounded-sm gap-1.5 text-amber-500"><ArrowsClockwise size={14} /> Regenerate</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">No PDI attached yet. Everything below is auto-populated from this dispatch — just confirm and generate.</p>
            {record.items?.length > 1 && (
              <div>
                <Label className="text-[11px] text-muted-foreground">Item</Label>
                <Select value={String(itemIdx)} onValueChange={(v) => setItemIdx(Number(v))}>
                  <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="md-pdi-item-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {record.items.map((it, i) => <SelectItem key={i} value={String(i)}>{it.part_number} · {it.description}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="border border-border rounded-sm px-3 py-2 bg-background text-xs" data-testid="md-pdi-template-info">
              {template
                ? <>Template: <b>{template.part_name}</b> · {template.item_code} · rev {template.revision || 1} · {template.rows?.length} dimensions</>
                : <span className="text-amber-500">No matching template for {item?.part_number} — add/map one in the PDI Template Library.</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] text-muted-foreground">Inspector</Label>
                <Select value={inspector} onValueChange={setInspector}>
                  <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="md-pdi-inspector-select"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{inspectors.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Approver</Label>
                <Select value={approver} onValueChange={setApprover}>
                  <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="md-pdi-approver-select"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{approvers.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-[11px] text-muted-foreground">Lot No {lots.length > 1 && <span className="text-amber-500">({lots.length} lots — select)</span>}</Label>
                {lots.length > 1 ? (
                  <Select value={lotNo} onValueChange={setLotNo}>
                    <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="md-pdi-lot-select"><SelectValue placeholder="Select lot" /></SelectTrigger>
                    <SelectContent>{lots.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="Lot number"
                         data-testid="md-pdi-lot-input" className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
                )}
              </div>
              <div className="col-span-2">
                <Label className="text-[11px] text-muted-foreground">Samples per Dimension</Label>
                <Select value={sampleCount} onValueChange={setSampleCount}>
                  <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="md-pdi-sample-count-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 samples</SelectItem>
                    <SelectItem value="10">10 samples</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={generate} disabled={busy || !template} data-testid="md-pdi-generate-btn" className="rounded-sm gap-1.5 w-full">
              <Sparkle size={15} weight="fill" /> {busy ? "Generating…" : "Generate & Attach PDI"}
            </Button>
          </div>
        )}
        <PdfPreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)}
                          title={`${record.pdi_report_no || ""} · ${record.invoice_number}`}
                          pdfUrl={record.pdi_report_id ? `/pdi/reports/${record.pdi_report_id}/pdf` : ""}
                          downloadName={`${record.pdi_report_no || "pdi"}.pdf`} />
      </DialogContent>
    </Dialog>
  );
}
