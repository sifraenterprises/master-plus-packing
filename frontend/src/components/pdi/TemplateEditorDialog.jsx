import { useEffect, useState } from "react";
import { Plus, Trash, FloppyDisk, Eye } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

const EMPTY_ROW = { sr: "", specified_dimension: "", method: "", freq: "5/Lot", nominal: null, tol_low: null, tol_high: null, value_type: "dimension", page: 1, remarks: "" };
const numVal = (v) => (v === "" || v === null || v === undefined ? null : parseFloat(v));

export default function TemplateEditorDialog({ template, draft, uploadId, replaceUpload, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const isDraft = !!draft;
  const src = template || draft;
  const multiPage = src ? (isDraft ? draft.page_end > draft.page_start : (src.pages || 1) > 1) || !!replaceUpload : false;

  useEffect(() => {
    if (src) {
      setForm({
        part_name: src.part_name || "", item_code: src.item_code || "", drg_no: src.drg_no || "",
        mapped_parts: (src.mapped_parts || []).join(", "),
        customer: src.customer || "", plant: src.plant || "",
        effective_from: src.effective_from || "", effective_to: src.effective_to || "",
        status: src.status || "active",
        rows: (src.rows || []).map((r) => ({ ...EMPTY_ROW, ...r })),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, draft]);

  if (!src || !form) return null;

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.value ?? e }));
  const setRow = (i, k, v) => setForm((f) => {
    const rows = [...f.rows];
    rows[i] = { ...rows[i], [k]: v };
    return { ...f, rows };
  });

  const payloadRows = () => form.rows.map((r) => ({
    ...r, nominal: numVal(r.nominal), tol_low: numVal(r.tol_low), tol_high: numVal(r.tol_high),
    page: parseInt(r.page) || 1,
  }));

  const basePayload = () => ({
    part_name: form.part_name, item_code: form.item_code, drg_no: form.drg_no,
    mapped_parts: form.mapped_parts.split(",").map((s) => s.trim()).filter(Boolean),
    customer: form.customer, plant: form.plant,
    effective_from: form.effective_from, effective_to: form.effective_to,
    status: form.status, rows: payloadRows(),
  });

  const save = async (onDuplicate = "") => {
    setBusy(true);
    try {
      if (isDraft) {
        const r = await api.post("/pdi/templates", { ...basePayload(), upload_id: uploadId, page_start: draft.page_start, page_end: draft.page_end, on_duplicate: onDuplicate });
        if (r.data.skipped) toast.info(r.data.detail || "Skipped duplicate template");
        else toast.success(onDuplicate === "replace" ? "Existing template replaced (new revision)" : "Template saved to library");
      } else {
        const extra = replaceUpload ? { upload_id: replaceUpload.uploadId, page_start: replaceUpload.pageStart, page_end: replaceUpload.pageEnd } : {};
        await api.put(`/pdi/templates/${template.id}`, { ...basePayload(), ...extra });
        toast.success(`Template saved (new revision${replaceUpload ? " · PDF replaced" : ""})`);
      }
      onSaved();
    } catch (err) {
      const detail = err?.response?.status === 409 ? err.response.data?.detail : null;
      if (detail?.code === "duplicate") {
        setDuplicate(detail);
      } else toast.error(apiError(err));
    }
    finally { setBusy(false); }
  };

  const previewSample = async () => {
    try {
      const r = isDraft || replaceUpload
        ? await api.post("/pdi/templates/preview-draft", {
            upload_id: isDraft ? uploadId : replaceUpload.uploadId,
            page_start: isDraft ? draft.page_start : replaceUpload.pageStart,
            page_end: isDraft ? draft.page_end : replaceUpload.pageEnd,
            rows: payloadRows(),
          }, { responseType: "blob" })
        : await api.post(`/pdi/templates/${template.id}/preview`, {}, { responseType: "blob" });
      window.open(URL.createObjectURL(new Blob([r.data], { type: "application/pdf" })), "_blank");
    } catch (err) { toast.error(apiError(err)); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl rounded-sm max-h-[88vh] overflow-y-auto" data-testid="pdi-template-editor">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">
            {isDraft ? `Review Imported Template — pages ${draft.page_start}–${draft.page_end}` : `Edit Template — rev ${template.revision || 1}${replaceUpload ? " (replacing PDF)" : ""}`}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          {[["part_name", "Part Name"], ["item_code", "Item Code"], ["drg_no", "Drg No"],
            ["customer", "Customer (optional)"], ["plant", "Plant (optional)"]].map(([k, label]) => (
            <div key={k}>
              <Label className="text-[11px] text-muted-foreground">{label}</Label>
              <Input value={form[k]} onChange={setField(k)} data-testid={`pdi-editor-${k}`}
                     className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
            </div>
          ))}
          <div>
            <Label className="text-[11px] text-muted-foreground">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger className="h-8 mt-1 rounded-sm bg-input border-border text-xs" data-testid="pdi-editor-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-3">
            <Label className="text-[11px] text-muted-foreground">Mapped Part Numbers / Item Codes (comma separated — matching uses these first)</Label>
            <Input value={form.mapped_parts} onChange={setField("mapped_parts")} data-testid="pdi-editor-mapped_parts"
                   placeholder="e.g. 1968889, 1011716-A" className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Effective From</Label>
            <Input type="date" value={form.effective_from} onChange={setField("effective_from")} data-testid="pdi-editor-effective_from"
                   className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Effective To</Label>
            <Input type="date" value={form.effective_to} onChange={setField("effective_to")} data-testid="pdi-editor-effective_to"
                   className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
          </div>
        </div>
        <div className="space-y-2 mt-2">
          <div className={`grid ${multiPage ? "grid-cols-[44px_1fr_105px_65px_65px_65px_65px_92px_46px_28px]" : "grid-cols-[44px_1fr_110px_70px_70px_70px_70px_96px_28px]"} gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground px-0.5`}>
            <span>Sr</span><span>Specified Dimension</span><span>Method</span><span>Freq</span><span>Nominal</span><span>Tol −</span><span>Tol +</span><span>Type</span>{multiPage && <span>Page</span>}<span />
          </div>
          {form.rows.map((r, i) => (
            <div key={i} className={`grid ${multiPage ? "grid-cols-[44px_1fr_105px_65px_65px_65px_65px_92px_46px_28px]" : "grid-cols-[44px_1fr_110px_70px_70px_70px_70px_96px_28px]"} gap-1.5 items-center`} data-testid={`pdi-editor-row-${i}`}>
              <Input value={r.sr} onChange={(e) => setRow(i, "sr", e.target.value)} className="h-7 rounded-sm bg-input border-border text-[11px] px-1.5" />
              <Input value={r.specified_dimension} onChange={(e) => setRow(i, "specified_dimension", e.target.value)} className="h-7 rounded-sm bg-input border-border text-[11px] px-1.5" />
              <Input value={r.method} onChange={(e) => setRow(i, "method", e.target.value)} className="h-7 rounded-sm bg-input border-border text-[11px] px-1.5" />
              <Input value={r.freq} onChange={(e) => setRow(i, "freq", e.target.value)} className="h-7 rounded-sm bg-input border-border text-[11px] px-1.5" />
              <Input value={r.nominal ?? ""} onChange={(e) => setRow(i, "nominal", e.target.value)} type="number" step="0.01" className="h-7 rounded-sm bg-input border-border text-[11px] px-1.5" />
              <Input value={r.tol_low ?? ""} onChange={(e) => setRow(i, "tol_low", e.target.value)} type="number" step="0.01" className="h-7 rounded-sm bg-input border-border text-[11px] px-1.5" />
              <Input value={r.tol_high ?? ""} onChange={(e) => setRow(i, "tol_high", e.target.value)} type="number" step="0.01" className="h-7 rounded-sm bg-input border-border text-[11px] px-1.5" />
              <Select value={r.value_type} onValueChange={(v) => setRow(i, "value_type", v)}>
                <SelectTrigger className="h-7 rounded-sm bg-input border-border text-[11px] px-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dimension">dimension</SelectItem>
                  <SelectItem value="visual">visual</SelectItem>
                </SelectContent>
              </Select>
              {multiPage && (
                <Input value={r.page || 1} onChange={(e) => setRow(i, "page", e.target.value)} type="number" min="1"
                       className="h-7 rounded-sm bg-input border-border text-[11px] px-1.5" />
              )}
              <button onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((_, j) => j !== i) }))}
                      className="text-muted-foreground hover:text-red-400 transition-colors" title="Remove row"
                      data-testid={`pdi-editor-row-delete-${i}`}>
                <Trash size={14} />
              </button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, { ...EMPTY_ROW, sr: String(f.rows.length + 1).padStart(2, "0") }] }))}
                  data-testid="pdi-editor-add-row" className="rounded-sm h-7 text-xs gap-1"><Plus size={13} /> Add Row</Button>
        </div>
        <div className="flex justify-between gap-2 mt-2">
          <Button variant="secondary" onClick={previewSample} data-testid="pdi-editor-sample-preview" className="rounded-sm gap-1.5">
            <Eye size={15} /> Preview Sample PDI
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} className="rounded-sm">Cancel</Button>
            <Button onClick={() => save()} disabled={busy} data-testid="pdi-editor-save" className="rounded-sm gap-1.5">
              <FloppyDisk size={15} /> {busy ? "Saving…" : isDraft ? "Save to Library" : "Save (new revision)"}
            </Button>
          </div>
        </div>

        {duplicate && (
          <div className="border border-amber-500/40 bg-amber-500/5 rounded-sm p-3 space-y-2" data-testid="pdi-duplicate-prompt">
            <p className="text-xs font-semibold text-amber-500">Duplicate detected</p>
            <p className="text-xs text-muted-foreground">A template with the same identity already exists: <b>{duplicate.existing}</b>. What do you want to do?</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => { setDuplicate(null); save("replace"); }}
                      data-testid="pdi-duplicate-replace" className="rounded-sm h-7 text-xs">Replace Existing</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setDuplicate(null); save("keep"); }}
                      data-testid="pdi-duplicate-keep" className="rounded-sm h-7 text-xs">Keep Both</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDuplicate(null); save("skip"); }}
                      data-testid="pdi-duplicate-skip" className="rounded-sm h-7 text-xs">Skip</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
