import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Eye, DownloadSimple, ArrowsClockwise, Sparkle, UploadSimple, CheckCircle } from "@phosphor-icons/react";
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
  const [uploading, setUploading] = useState(false);
  const [reports, setReports] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [preview, setPreview] = useState(null); // {id, report_no}
  const fileRef = useRef(null);
  const hasPdi = !!record?.pdi_report_no;

  const loadReports = () => {
    if (!record?.id) return;
    api.get(`/pdi/dispatch/${record.id}/reports`).then((r) => {
      setReports(r.data.reports);
      setActiveId(r.data.active_id);
    }).catch(() => {});
  };

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, record?.pdi_report_id]);

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
      loadReports();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  const uploadManual = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) return toast.error("Only PDF files are supported");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("master_dispatch_id", record.id);
      fd.append("part_name", item?.description || "");
      fd.append("item_code", item?.part_number || "");
      fd.append("lot_no", lotNo || "");
      const r = await api.post("/pdi/manual-upload", fd);
      toast.success(`Manual PDI ${r.data.report_no} uploaded & set as Active`);
      onChanged();
      loadReports();
    } catch (err) { toast.error(apiError(err)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const setActive = async (rep) => {
    try {
      await api.post(`/pdi/reports/${rep.id}/set-active`);
      toast.success(`${rep.report_no} is now the Active PDI`);
      onChanged();
      loadReports();
    } catch (err) { toast.error(apiError(err)); }
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

  const uploadButton = (
    <>
      <input ref={fileRef} type="file" accept=".pdf" className="hidden" data-testid="md-pdi-manual-file-input"
             onChange={(e) => uploadManual(e.target.files?.[0])} />
      <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}
              data-testid="md-pdi-manual-upload-btn" className="rounded-sm gap-1.5">
        <UploadSimple size={14} /> {uploading ? "Uploading…" : "Upload Manual PDI"}
      </Button>
    </>
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-sm" data-testid="md-pdi-panel">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">PDI — {record.invoice_number} · {record.customer_name}</DialogTitle>
        </DialogHeader>
        {hasPdi ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[["Report No", record.pdi_report_no],
                ["Type", record.pdi_source === "manual" ? "Manual Upload" : "AI Generated"],
                ["Generated", (record.pdi_generated_at || "").slice(0, 16).replace("T", " ")],
                ["Template Revision", record.pdi_source === "manual" ? "—" : `r${record.pdi_template_revision || 1}`],
                ["Inspector", record.pdi_inspector || "—"],
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
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPreview({ id: record.pdi_report_id, report_no: record.pdi_report_no })} data-testid="md-pdi-preview-btn" className="rounded-sm gap-1.5"><Eye size={14} /> Preview</Button>
              <Button size="sm" variant="secondary" onClick={download} data-testid="md-pdi-download-btn" className="rounded-sm gap-1.5"><DownloadSimple size={14} /> Download</Button>
              {record.pdi_source !== "manual" && (
                <Button size="sm" variant="secondary" onClick={regenerate} data-testid="md-pdi-regenerate-btn" className="rounded-sm gap-1.5 text-amber-500"><ArrowsClockwise size={14} /> Regenerate</Button>
              )}
              {uploadButton}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">No PDI attached yet. Generate one via AI below, or upload a ready PDI PDF manually.</p>
            <div className="flex justify-end">{uploadButton}</div>
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

        {reports.length > 1 && (
          <div className="space-y-1.5" data-testid="md-pdi-reports-list">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">All PDIs for this dispatch — only the Active one is used for ASN &amp; downloads</p>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {reports.map((rep) => (
                <div key={rep.id} className="flex items-center justify-between border border-border rounded-sm px-2.5 py-1.5 bg-background" data-testid={`md-pdi-report-row-${rep.report_no}`}>
                  <div className="flex items-center gap-2 text-xs">
                    <b>{rep.report_no}</b>
                    <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${rep.source === "manual" ? "border-sky-500/50 text-sky-500" : "border-primary/40 text-primary"}`}>
                      {rep.source === "manual" ? "Manual" : "AI"}
                    </Badge>
                    <span className="text-muted-foreground">{(rep.created_at || "").slice(0, 16).replace("T", " ")}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button title="Preview" onClick={() => setPreview(rep)} data-testid={`md-pdi-report-preview-${rep.report_no}`}
                            className="p-1 text-muted-foreground hover:text-primary transition-colors"><Eye size={14} /></button>
                    {rep.id === activeId ? (
                      <Badge className="rounded-sm text-[9px] uppercase gap-1 bg-emerald-600/15 text-emerald-500 border border-emerald-500/40" data-testid={`md-pdi-active-badge-${rep.report_no}`}>
                        <CheckCircle size={11} weight="fill" /> Active
                      </Badge>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setActive(rep)} data-testid={`md-pdi-set-active-${rep.report_no}`}
                              className="rounded-sm h-6 px-2 text-[10px] uppercase">Set Active</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <PdfPreviewDialog open={!!preview} onClose={() => setPreview(null)}
                          title={`${preview?.report_no || ""} · ${record.invoice_number}`}
                          pdfUrl={preview?.id ? `/pdi/reports/${preview.id}/pdf` : ""}
                          downloadName={`${preview?.report_no || "pdi"}.pdf`} />
      </DialogContent>
    </Dialog>
  );
}
