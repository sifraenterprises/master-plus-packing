import { useState } from "react";
import { CaretDown, CaretUp, Funnel, ArrowCounterClockwise, FloppyDisk, FileXls, FilePdf, FileCsv, Printer, Star, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api, { apiError } from "@/lib/api";

const TEXT_FIELDS = [
  ["invoice", "Invoice Number"], ["customer", "Customer"], ["vendor", "Vendor / Customer Code"],
  ["plant", "Plant"], ["transporter", "Transporter"], ["vehicle", "Vehicle Number"],
  ["packing_slip", "Packing Slip Number"], ["asn", "ASN Number"], ["eway", "E-Way Bill Number"],
  ["po", "PO Number"], ["part", "Part Number"], ["description", "Item Description"],
];
const DATE_FIELDS = [
  ["dispatch_from", "Dispatch Date From"], ["dispatch_to", "Dispatch Date To"],
  ["inv_from", "Invoice Date From"], ["inv_to", "Invoice Date To"],
];
const STATUS_FIELDS = [
  ["packing_status", "Packing Status"], ["asn_status", "ASN Status"], ["eway_status", "E-Way Bill Status"],
  ["vendor_ack_status", "Vendor Ack Status"], ["pdi_status", "PDI Status"],
];

export const AdvancedFilters = ({ filters, setFilters, onSearch, onReset, onExport, onPrint,
                                  views, defaultViewId, onApplyView, onViewsChanged, isAdmin, loading }) => {
  const [open, setOpen] = useState(true);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveShared, setSaveShared] = useState(false);
  const [selectedView, setSelectedView] = useState("");

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  const saveView = async () => {
    if (!saveName.trim()) return toast.error("Enter a name for this report view");
    try {
      await api.post("/reports/views", { name: saveName.trim(), filters, scope: saveShared ? "shared" : "personal" });
      toast.success(`Report view "${saveName}" saved${saveShared ? " (shared)" : ""}`);
      setSaveOpen(false);
      setSaveName("");
      setSaveShared(false);
      onViewsChanged();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const applyView = (id) => {
    setSelectedView(id);
    const v = views.find((x) => x.id === id);
    if (v) onApplyView(v);
  };

  const setDefault = async () => {
    if (!selectedView) return toast.error("Select a saved view first");
    try {
      await api.post(`/reports/views/${selectedView}/default`);
      toast.success("Default report view set");
      onViewsChanged();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const deleteView = async () => {
    if (!selectedView) return toast.error("Select a saved view first");
    try {
      await api.delete(`/reports/views/${selectedView}`);
      toast.success("Report view deleted");
      setSelectedView("");
      onViewsChanged();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const inputCls = "rounded-sm bg-input border-border h-8 text-xs";
  const labelCls = "text-[9px] uppercase tracking-[0.12em] text-muted-foreground block mb-1";

  return (
    <div className="border border-border bg-card rounded-sm" data-testid="advanced-filters">
      <div className="flex items-center justify-between px-4 py-2.5">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors" data-testid="filters-toggle">
          <Funnel size={14} className="text-primary" /> Advanced Search {open ? <CaretUp size={12} /> : <CaretDown size={12} />}
        </button>
        <div className="flex items-center gap-1.5">
          <select value={selectedView} onChange={(e) => applyView(e.target.value)} data-testid="saved-view-select"
                  className="h-8 rounded-sm bg-input border border-border text-xs px-2 max-w-[200px] focus:outline-none">
            <option value="">— Saved Views —</option>
            {views.filter((v) => v.scope === "shared").length > 0 && (
              <optgroup label="Shared Templates">
                {views.filter((v) => v.scope === "shared").map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.id === defaultViewId ? " ★" : ""}</option>
                ))}
              </optgroup>
            )}
            {views.filter((v) => v.scope === "personal").length > 0 && (
              <optgroup label="My Views">
                {views.filter((v) => v.scope === "personal").map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.id === defaultViewId ? " ★" : ""}</option>
                ))}
              </optgroup>
            )}
          </select>
          <button onClick={setDefault} title="Set as my default view" data-testid="view-set-default" className="p-1.5 text-muted-foreground hover:text-amber-400 transition-colors"><Star size={15} /></button>
          <button onClick={deleteView} title="Delete selected view" data-testid="view-delete" className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"><Trash size={15} /></button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {DATE_FIELDS.map(([k, label]) => (
              <div key={k}>
                <label className={labelCls}>{label}</label>
                <Input type="date" value={filters[k]} onChange={set(k)} data-testid={`filter-${k}`} className={inputCls} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {TEXT_FIELDS.map(([k, label]) => (
              <div key={k}>
                <label className={labelCls}>{label}</label>
                <Input value={filters[k]} onChange={set(k)} onKeyDown={(e) => e.key === "Enter" && onSearch()}
                       data-testid={`filter-${k}`} className={inputCls} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {STATUS_FIELDS.map(([k, label]) => (
              <div key={k}>
                <label className={labelCls}>{label}</label>
                <select value={filters[k]} onChange={set(k)} data-testid={`filter-${k}`}
                        className="h-8 w-full rounded-sm bg-input border border-border text-xs px-2 focus:outline-none">
                  <option value="">All</option>
                  {["Completed", "Pending", "Failed"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={onSearch} disabled={loading} data-testid="filters-search" className="rounded-sm h-8">
              {loading ? "Searching…" : "Search"}
            </Button>
            <Button size="sm" variant="secondary" onClick={onReset} data-testid="filters-reset" className="rounded-sm h-8 gap-1">
              <ArrowCounterClockwise size={13} /> Reset
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSaveOpen(true)} data-testid="filters-save" className="rounded-sm h-8 gap-1">
              <FloppyDisk size={13} /> Save Filter
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" onClick={() => onExport("excel")} data-testid="filters-export-excel" className="rounded-sm h-8 gap-1"><FileXls size={13} /> Excel</Button>
            <Button size="sm" variant="secondary" onClick={() => onExport("pdf")} data-testid="filters-export-pdf" className="rounded-sm h-8 gap-1"><FilePdf size={13} /> PDF</Button>
            <Button size="sm" variant="secondary" onClick={() => onExport("csv")} data-testid="filters-export-csv" className="rounded-sm h-8 gap-1"><FileCsv size={13} /> CSV</Button>
            <Button size="sm" variant="secondary" onClick={onPrint} data-testid="filters-print" className="rounded-sm h-8 gap-1"><Printer size={13} /> Print</Button>
          </div>
        </div>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm bg-card border-border" data-testid="save-view-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">Save Report View</DialogTitle>
            <DialogDescription>Saves the current filters {isAdmin ? "as a personal or shared template" : "as a personal template"}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="View name e.g. Pending ASN — Bhopal" value={saveName} onChange={(e) => setSaveName(e.target.value)}
                   data-testid="save-view-name" className="rounded-sm bg-input border-border" />
            {isAdmin && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={saveShared} onChange={(e) => setSaveShared(e.target.checked)} data-testid="save-view-shared" />
                Shared template (visible to all users)
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSaveOpen(false)} className="rounded-sm">Cancel</Button>
              <Button size="sm" onClick={saveView} data-testid="save-view-confirm" className="rounded-sm">Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
