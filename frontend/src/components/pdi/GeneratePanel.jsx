import { useEffect, useState } from "react";
import { MagnifyingGlass, Sparkle, FileText } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import PdfPreviewDialog from "./PdfPreviewDialog";

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

const fmtDate = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

const EMPTY = {
  report_date: today(), lot_size: "", lot_no: "", challan_no_dt: "", min_no_dt: "",
  vender_code: "", inspector: "", approver: "", sample_count: "10",
  parameters_note: "All dimensions as per drawing", identification_mark: "Sticker on box",
};

export default function GeneratePanel() {
  const [dispatchQ, setDispatchQ] = useState("");
  const [dispatches, setDispatches] = useState([]);
  const [dispatch, setDispatch] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [lots, setLots] = useState([]);
  const [template, setTemplate] = useState(null);
  const [tplQ, setTplQ] = useState("");
  const [tplResults, setTplResults] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [inspectors, setInspectors] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    api.get("/pdi/masters/inspectors").then((r) => setInspectors(r.data)).catch(() => {});
    api.get("/pdi/masters/approvers").then((r) => setApprovers(r.data)).catch(() => {});
    api.get("/pdi/last-used").then((r) => {
      setForm((f) => ({ ...f, inspector: r.data.inspector || f.inspector, approver: r.data.approver || f.approver }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get("/pdi/dispatch-options", { params: { q: dispatchQ } }).then((r) => setDispatches(r.data)).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [dispatchQ]);

  useEffect(() => {
    if (!tplQ.trim()) { setTplResults([]); return; }
    const t = setTimeout(() => {
      api.get("/pdi/templates", { params: { q: tplQ, limit: 8 } }).then((r) => setTplResults(r.data.items)).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [tplQ]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target?.value ?? e }));

  const pickItem = async (d, item) => {
    setDispatch(d);
    setSelectedItem(item);
    const invDate = fmtDate(d.invoice_date) || d.invoice_date || "";
    const dLots = d.lot_numbers || [];
    setLots(dLots);
    setForm((f) => ({
      ...f,
      report_date: invDate || f.report_date,
      lot_size: d.total_quantity ? String(d.total_quantity) : f.lot_size,
      lot_no: dLots.length === 1 ? dLots[0] : dLots.includes(f.lot_no) ? f.lot_no : "",
      challan_no_dt: d.invoice_number || f.challan_no_dt,
      vender_code: d.customer_code || f.vender_code,
    }));
    if (dLots.length > 1) toast.info(`${dLots.length} lot numbers found for this invoice — select the correct one.`);
    if (dLots.length === 0) toast.warning("No packing slip found for this invoice — enter the Lot No manually.");
    try {
      const r = await api.get("/pdi/match", { params: { identifier: item.part_number || item.description, customer: d.customer_name || "" } });
      if (r.data.matched) {
        setTemplate(r.data.template);
        const alt = r.data.alternatives?.length ? ` (${r.data.alternatives.length} alternative${r.data.alternatives.length > 1 ? "s" : ""} available)` : "";
        toast.success(`Template matched: ${r.data.template.part_name} · rev ${r.data.template.revision || 1}${alt}`);
      } else {
        setTemplate(null);
        toast.warning("No matching template — search and select one manually below.");
      }
    } catch (err) { toast.error(apiError(err)); }
  };

  const generate = async () => {
    if (!template) return toast.error("Select a PDI template first");
    setBusy(true);
    try {
      const r = await api.post("/pdi/generate", {
        ...form, sample_count: Number(form.sample_count) || 10,
        template_id: template.id, master_dispatch_id: dispatch?.id || "",
        part_name: selectedItem?.description || "", item_code: selectedItem?.part_number || "",
      });
      setGenerated(r.data);
      setPreviewOpen(true);
      toast.success(`Report ${r.data.report_no} generated`);
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5" data-testid="pdi-generate-panel">
      <div className="space-y-4">
        <div className="border border-border bg-card rounded-sm p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">1 · Pick dispatch item (optional)</p>
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input value={dispatchQ} onChange={(e) => setDispatchQ(e.target.value)} placeholder="Search invoice, customer or part…"
                   data-testid="pdi-dispatch-search" className="h-8 pl-8 rounded-sm bg-input border-border text-xs" />
          </div>
          <div className="max-h-56 overflow-y-auto mt-2 space-y-1">
            {dispatches.map((d) => (
              <div key={d.id} className="border border-border rounded-sm px-2.5 py-1.5 bg-background">
                <p className="text-xs font-semibold">{d.invoice_number} <span className="text-muted-foreground font-normal">· {d.invoice_date} · {d.customer_name}</span></p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {d.items.map((it, i) => (
                    <button key={i} onClick={() => pickItem(d, it)}
                            data-testid={`pdi-pick-item-${d.invoice_number}-${i}`}
                            className={`text-[11px] px-2 py-0.5 rounded-sm border transition-colors ${
                              dispatch?.id === d.id ? "border-primary/60 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"}`}>
                      {it.part_number || it.description} · qty {it.quantity}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {dispatches.length === 0 && <p className="text-xs text-muted-foreground py-3 text-center">No dispatches found.</p>}
          </div>
        </div>

        <div className="border border-border bg-card rounded-sm p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">2 · PDI template</p>
          {template ? (
            <div className="flex items-center justify-between border border-primary/40 rounded-sm px-3 py-2 bg-primary/5" data-testid="pdi-selected-template">
              <div>
                <p className="text-sm font-bold">{template.part_name}</p>
                <p className="text-[11px] text-muted-foreground">Item {template.item_code} · Drg {template.drg_no} · rev {template.revision || 1} · {template.rows.length} dimensions</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTemplate(null)} className="rounded-sm text-xs" data-testid="pdi-clear-template">Change</Button>
            </div>
          ) : (
            <>
              <Input value={tplQ} onChange={(e) => setTplQ(e.target.value)} placeholder="Search part name, item code or drawing no…"
                     data-testid="pdi-template-search" className="h-8 rounded-sm bg-input border-border text-xs" />
              <div className="max-h-40 overflow-y-auto mt-2 space-y-1">
                {tplResults.map((t) => (
                  <button key={t.id} onClick={() => { setTemplate(t); setTplQ(""); }}
                          data-testid={`pdi-template-option-${t.page_number}`}
                          className="w-full text-left border border-border rounded-sm px-2.5 py-1.5 bg-background text-xs hover:border-primary/40 transition-colors">
                    <b>{t.part_name}</b> · {t.item_code} · Drg {t.drg_no} <span className="text-muted-foreground">(page {t.page_number})</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border border-border bg-card rounded-sm p-4 space-y-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">3 · Report details</p>
        <div className="grid grid-cols-2 gap-3">
          {[["report_date", "Report Date"], ["lot_size", "Lot Size"]].map(([k, label]) => (
            <div key={k}>
              <Label className="text-[11px] text-muted-foreground">{label}</Label>
              <Input value={form[k]} onChange={set(k)} data-testid={`pdi-field-${k}`}
                     className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
            </div>
          ))}
          <div>
            <Label className="text-[11px] text-muted-foreground">Lot No {lots.length > 1 && <span className="text-amber-500">({lots.length} lots — select)</span>}</Label>
            {lots.length > 1 ? (
              <Select value={form.lot_no} onValueChange={(v) => setForm((f) => ({ ...f, lot_no: v }))}>
                <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="pdi-lot-select">
                  <SelectValue placeholder="Select lot number" />
                </SelectTrigger>
                <SelectContent>
                  {lots.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input value={form.lot_no} onChange={set("lot_no")} data-testid="pdi-field-lot_no"
                     className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
            )}
          </div>
          {[["challan_no_dt", "Challan No / Dt."], ["min_no_dt", "MIN No / Dt."], ["vender_code", "Vender Code"]].map(([k, label]) => (
            <div key={k}>
              <Label className="text-[11px] text-muted-foreground">{label}</Label>
              <Input value={form[k]} onChange={set(k)} data-testid={`pdi-field-${k}`}
                     className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
            </div>
          ))}
          <div>
            <Label className="text-[11px] text-muted-foreground">Samples per Dimension</Label>
            <Select value={form.sample_count} onValueChange={(v) => setForm((f) => ({ ...f, sample_count: v }))}>
              <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="pdi-sample-count-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 samples</SelectItem>
                <SelectItem value="10">10 samples</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Inspected By</Label>
            <Select value={form.inspector} onValueChange={(v) => setForm((f) => ({ ...f, inspector: v }))}>
              <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="pdi-inspector-select">
                <SelectValue placeholder="Select inspector" />
              </SelectTrigger>
              <SelectContent>
                {inspectors.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Approved By</Label>
            <Select value={form.approver} onValueChange={(v) => setForm((f) => ({ ...f, approver: v }))}>
              <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="pdi-approver-select">
                <SelectValue placeholder="Select approver" />
              </SelectTrigger>
              <SelectContent>
                {approvers.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Parameters Note</Label>
            <Input value={form.parameters_note} onChange={set("parameters_note")} data-testid="pdi-field-parameters_note"
                   className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Identification Mark</Label>
            <Input value={form.identification_mark} onChange={set("identification_mark")} data-testid="pdi-field-identification_mark"
                   className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
          </div>
        </div>
        {(inspectors.length === 0 || approvers.length === 0) && (
          <p className="text-[11px] text-amber-500">Tip: add Inspector / Approver names in Settings → Masters.</p>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button onClick={generate} disabled={busy || !template} data-testid="pdi-generate-btn" className="rounded-sm gap-1.5">
            <Sparkle size={15} weight="fill" /> {busy ? "Generating…" : "Generate PDI Report"}
          </Button>
          {generated && (
            <Button variant="secondary" onClick={() => setPreviewOpen(true)} data-testid="pdi-open-preview" className="rounded-sm gap-1.5">
              <FileText size={15} /> {generated.report_no} <Badge variant="outline" className="rounded-sm text-[9px] ml-1">preview</Badge>
            </Button>
          )}
        </div>
      </div>

      <PdfPreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)}
                        title={generated ? `${generated.report_no} · ${generated.part_name}` : ""}
                        pdfUrl={generated ? `/pdi/reports/${generated.id}/pdf` : ""}
                        downloadName={generated ? `${generated.report_no}_${generated.item_code}.pdf` : ""} />
    </div>
  );
}
