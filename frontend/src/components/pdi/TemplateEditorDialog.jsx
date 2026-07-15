import { useEffect, useState } from "react";
import { Plus, Trash, FloppyDisk } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

const EMPTY_ROW = { sr: "", specified_dimension: "", method: "", freq: "5/Lot", nominal: null, tol_low: null, tol_high: null, value_type: "dimension", remarks: "" };

export default function TemplateEditorDialog({ template, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (template) setForm({ part_name: template.part_name, item_code: template.item_code, drg_no: template.drg_no, rows: template.rows.map((r) => ({ ...r })) });
  }, [template]);

  if (!template || !form) return null;

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setRow = (i, k, v) => setForm((f) => {
    const rows = [...f.rows];
    rows[i] = { ...rows[i], [k]: v };
    return { ...f, rows };
  });
  const numVal = (v) => (v === "" || v === null || v === undefined ? null : parseFloat(v));

  const save = async () => {
    setBusy(true);
    try {
      const rows = form.rows.map((r) => ({ ...r, nominal: numVal(r.nominal), tol_low: numVal(r.tol_low), tol_high: numVal(r.tol_high) }));
      await api.put(`/pdi/templates/${template.id}`, { ...form, rows });
      toast.success("Template saved");
      onSaved();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl rounded-sm max-h-[85vh] overflow-y-auto" data-testid="pdi-template-editor">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">Edit Template — Page {template.page_number}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          {[["part_name", "Part Name"], ["item_code", "Item Code"], ["drg_no", "Drg No"]].map(([k, label]) => (
            <div key={k}>
              <Label className="text-[11px] text-muted-foreground">{label}</Label>
              <Input value={form[k]} onChange={setField(k)} data-testid={`pdi-editor-${k}`}
                     className="h-8 mt-1 rounded-sm bg-input border-border text-xs" />
            </div>
          ))}
        </div>
        <div className="space-y-2 mt-2">
          <div className="grid grid-cols-[44px_1fr_110px_70px_70px_70px_70px_96px_28px] gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground px-0.5">
            <span>Sr</span><span>Specified Dimension</span><span>Method</span><span>Freq</span><span>Nominal</span><span>Tol −</span><span>Tol +</span><span>Type</span><span />
          </div>
          {form.rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[44px_1fr_110px_70px_70px_70px_70px_96px_28px] gap-1.5 items-center" data-testid={`pdi-editor-row-${i}`}>
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
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose} className="rounded-sm">Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid="pdi-editor-save" className="rounded-sm gap-1.5">
            <FloppyDisk size={15} /> {busy ? "Saving…" : "Save Template"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
