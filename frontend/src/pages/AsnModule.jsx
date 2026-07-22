import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Truck, DownloadSimple, Play, ArrowsClockwise, ArrowsCounterClockwise, FileXls, PencilSimple, Paperclip, ListMagnifyingGlass, MagnifyingGlass, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BatchAllocationDialog } from "@/components/asn/BatchAllocationDialog";
import { AllocationHistoryDialog } from "@/components/asn/AllocationHistoryDialog";
import api, { apiError } from "@/lib/api";

const STATUS_CLS = {
  Draft: "border-zinc-500/50 text-zinc-400",
  Ready: "border-sky-500/50 text-sky-400",
  Processing: "border-amber-500/50 text-amber-400",
  "Awaiting Allocation": "border-orange-500/60 text-orange-400",
  Completed: "border-emerald-500/50 text-emerald-400",
  Failed: "border-red-500/50 text-red-400",
};

const TILES = [
  { key: "total", label: "Total ASN" },
  { key: "ready", label: "Ready" },
  { key: "processing", label: "Processing" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed", danger: true },
  { key: "today", label: "Today's ASN" },
];

export default function AsnModule() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [transporters, setTransporters] = useState([]);
  const [filters, setFilters] = useState({ status: "All", search: "" });
  const [running, setRunning] = useState(false);
  const [stopBeforeSubmit, setStopBeforeSubmit] = useState(false);
  const [runInfo, setRunInfo] = useState(null);
  const [editRec, setEditRec] = useState(null);
  const [logView, setLogView] = useState(null);
  const [saving, setSaving] = useState(false);
  const [allocReq, setAllocReq] = useState(null);
  const [allocHistory, setAllocHistory] = useState(false);
  const pollRef = useRef(null);
  const pdiRef = useRef(null);
  const pdiTarget = useRef(null);

  const load = useCallback(async (f = filters) => {
    try {
      const params = { page_size: 100 };
      if (f.status !== "All") params.status = f.status;
      if (f.search) params.search = f.search;
      const [r, s] = await Promise.all([api.get("/asn/records", { params }), api.get("/asn/stats")]);
      setRows(r.data.items);
      setStats(s.data);
    } catch (err) {
      toast.error(apiError(err));
    }
  }, [filters]);

  useEffect(() => {
    load();
    api.get("/master-dispatch/transporters").then((r) => setTransporters(r.data)).catch(() => {});
    api.get("/asn/run-status").then((r) => { if (r.data.running) startPoll(); }).catch(() => {});
    return () => pollRef.current && clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPoll = () => {
    setRunning(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get("/asn/run-status");
        setRunInfo(data);
        setAllocReq((prev) => {
          const next = data.awaiting_allocation || null;
          if (!next) return null;
          if (prev && prev.record_id === next.record_id && prev.part_number === next.part_number) return prev;
          return next;
        });
        if (!data.running) {
          clearInterval(pollRef.current);
          setRunning(false);
          setAllocReq(null);
          load();
          toast.success("ASN automation queue finished");
        }
      } catch (err) { /* keep polling */ }
    }, 1500);
  };

  const call = async (method, url, body, msg) => {
    try {
      const { data } = await api[method](url, body);
      if (msg) toast.info(typeof msg === "function" ? msg(data) : msg);
      if (data?.skipped?.length) {
        data.skipped.forEach((s) =>
          toast.warning(`${s.invoice_no}: blocked — missing ${s.missing.join(", ")}. Generate the PDI first.`, { duration: 8000 }));
      }
      return data;
    } catch (err) {
      toast.error(apiError(err));
      return null;
    }
  };

  const importMD = async () => {
    const d = await call("post", "/asn/import", {}, (d) => `${d.imported} record(s) imported from Master Dispatch`);
    if (d) load();
  };

  const runReady = async () => {
    const d = await call("post", "/asn/run-ready", {}, (d) => `Queue started: ${d.total} record(s) (one at a time)`);
    if (d) { load(); startPoll(); }
  };

  const retryFailed = async () => {
    const d = await call("post", "/asn/retry-failed", {}, (d) => `Retrying ${d.total} failed record(s)`);
    if (d) { load(); startPoll(); }
  };

  const runOne = async (r) => {
    if (stopBeforeSubmit) return toast.info("Stopped before submit");
    const d = await call("post", "/asn/run", { ids: [r.id] }, `Creating ASN for ${r.invoice_no}…`);
    if (d) { load(); startPoll(); }
  };

  const saveEdit = async () => {
    setSaving(true);
    const d = await call("put", `/asn/records/${editRec.id}`, {
      po_number: editRec.po_number, transporter: editRec.transporter,
      basic_amount: parseFloat(editRec.basic_amount) || 0, total_amount: parseFloat(editRec.total_amount) || 0,
    }, "ASN record updated");
    setSaving(false);
    if (d) { setEditRec(null); load(); }
  };
  const deleteRecord = async (r) => {
    if (!window.confirm(`Delete ASN record ${r.invoice_no}? This cannot be undone.`)) return;
    try { await api.delete(`/asn/records/${r.id}`); toast.success("ASN record deleted"); load(); }
    catch (err) { toast.error(apiError(err)); }
  };

  const uploadPdi = async (file) => {
    if (!file || !pdiTarget.current) return;
    const fd = new FormData();
    fd.append("file", file);
    const d = await call("post", `/asn/records/${pdiTarget.current.id}/pdi`, fd, `PDI attached: ${file.name}`);
    if (d) load();
    if (pdiRef.current) pdiRef.current.value = "";
  };

  const exportExcel = async () => {
    try {
      const res = await api.get("/asn/export", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "asn_creation.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  const transporterOptions = editRec?.transporter && !transporters.includes(editRec.transporter)
    ? [editRec.transporter, ...transporters] : transporters;

  return (
    <div className="max-w-7xl space-y-6" data-testid="asn-page">
      <input ref={pdiRef} type="file" accept=".pdf" className="hidden" data-testid="asn-pdi-input" onChange={(e) => uploadPdi(e.target.files?.[0])} />
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Automation Module</p>
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
          <Truck size={32} weight="duotone" className="text-primary" /> ASN Creation Automation
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          TAFE Vendor Portal · Create ASN — PO selection, part addition, invoice fill, PDI attach and ASN capture, all from Master Dispatch data.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 border border-border rounded-sm overflow-hidden" data-testid="asn-stats">
        {TILES.map((t, i) => (
          <div key={t.key} className={`bg-card p-4 border-border border-b lg:border-b-0 ${i < 5 ? "lg:border-r" : ""} ${i % 2 === 0 ? "border-r" : ""}`} data-testid={`asn-stat-${t.key}`}>
            <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground mb-1.5">{t.label}</p>
            <p className={`text-xl font-black font-mono ${t.danger && stats[t.key] > 0 ? "text-red-400" : ""}`}>{stats[t.key] ?? "—"}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={importMD} data-testid="asn-import" className="rounded-sm gap-2 active:scale-95 transition-transform">
          <DownloadSimple size={16} weight="bold" /> Import From Master Dispatch
        </Button>
        <Button variant="secondary" onClick={runReady} disabled={running} data-testid="asn-run-ready" className="rounded-sm gap-1">
          <Play size={14} weight="bold" /> Start Automation
        </Button>
        <Button variant="secondary" onClick={retryFailed} disabled={running} data-testid="asn-retry-failed" className="rounded-sm gap-1 text-red-400">
          <ArrowsCounterClockwise size={14} /> Retry Failed
        </Button>
        <Button variant="secondary" onClick={() => load()} data-testid="asn-refresh" className="rounded-sm gap-1">
          <ArrowsClockwise size={14} /> Refresh
        </Button>
        <Button variant="secondary" onClick={() => setStopBeforeSubmit(true)} disabled={stopBeforeSubmit} data-testid="asn-stop-before-submit" className="rounded-sm gap-1 text-red-400">Stop before submit</Button>
        <Button variant="secondary" onClick={() => setAllocHistory(true)} data-testid="asn-batch-allocations" className="rounded-sm gap-1">
          <ListMagnifyingGlass size={14} /> Batch Allocations
        </Button>
        <Button variant="secondary" onClick={exportExcel} data-testid="asn-export" className="rounded-sm gap-1">
          <FileXls size={14} /> Export Excel
        </Button>
        <div className="flex-1" />
        <select value={filters.status} onChange={(e) => { const f = { ...filters, status: e.target.value }; setFilters(f); load(f); }}
                data-testid="asn-filter-status" className="h-9 rounded-sm bg-input border border-border text-xs px-2 focus:outline-none">
          {["All", "Draft", "Ready", "Processing", "Awaiting Allocation", "Completed", "Failed"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Invoice / PO / ASN…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                 onKeyDown={(e) => e.key === "Enter" && load()} data-testid="asn-search"
                 className="h-9 w-48 pl-8 rounded-sm bg-input border-border text-xs" />
        </div>
      </div>

      {running && runInfo && (
        <div className="border border-primary/40 bg-card rounded-sm px-4 py-2.5 text-xs font-mono text-primary" data-testid="asn-run-progress">
          Queue running (one ASN at a time)… {runInfo.processed}/{runInfo.total} done{runInfo.current ? ` — current: ${runInfo.current}` : ""}
          {allocReq ? " — ⏸ paused: batch allocation required" : ""}
        </div>
      )}

      <div className="border border-border rounded-sm overflow-x-auto bg-card">
        <Table data-testid="asn-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              {["Invoice Number", "Invoice Date", "PO Number", "Transporter", "Parts", "PDI", "Status", "ASN Number", "Action"].map((h) => (
                <TableHead key={h} className="text-[10px] uppercase tracking-[0.15em] whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-10" data-testid="asn-no-records">
                  No ASN records — click "Import From Master Dispatch" to load pending dispatches.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className="border-border hover:bg-secondary/50" data-testid={`asn-row-${r.invoice_no}`}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{r.invoice_no}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{r.invoice_date}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{r.po_number || <span className="text-amber-400">add PO</span>}</TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate">{r.transporter || "—"}</TableCell>
                  <TableCell className="text-center text-xs">{r.items?.length || 0}</TableCell>
                  <TableCell className="text-xs max-w-[110px] truncate">
                    {r.pdi_file_name ? <span className="text-emerald-400">{r.pdi_file_name}</span> : <span className="text-amber-400">not attached</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${STATUS_CLS[r.status] || ""}`}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-emerald-400 text-xs whitespace-nowrap">{r.asn_number || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-0.5">
                      {r.status !== "Completed" && r.status !== "Processing" && (
                        <>
                          <button onClick={() => setEditRec({ ...r })} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`asn-edit-${r.invoice_no}`} aria-label="Edit PO / details">
                            <PencilSimple size={16} />
                          </button>
                          <button onClick={() => { pdiTarget.current = r; pdiRef.current?.click(); }} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`asn-pdi-${r.invoice_no}`} aria-label="Attach PDI">
                            <Paperclip size={16} />
                          </button>
                          <button onClick={() => runOne(r)} disabled={running} className="p-1.5 text-muted-foreground hover:text-emerald-400 transition-colors disabled:opacity-40" data-testid={`asn-run-${r.invoice_no}`} aria-label="Run">
                            <Play size={16} />
                          </button>
                        </>
                      )}
                      <button onClick={() => setLogView(r)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`asn-log-${r.invoice_no}`} aria-label="View log">
                        <ListMagnifyingGlass size={16} />
                      </button>
                      {r.status !== "Processing" && <button onClick={() => deleteRecord(r)} className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors" data-testid={`asn-delete-${r.invoice_no}`} aria-label="Delete ASN record"><Trash size={16} /></button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editRec} onOpenChange={(o) => !o && setEditRec(null)}>
        <DialogContent className="max-w-md bg-card border-border" data-testid="asn-edit-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">Edit ASN Record — <span className="text-primary font-mono">{editRec?.invoice_no}</span></DialogTitle>
            <DialogDescription>Add/correct the PO Number (also synced to Master Dispatch), transporter and amounts.</DialogDescription>
          </DialogHeader>
          {editRec && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">PO Number</label>
                <Input value={editRec.po_number || ""} placeholder="e.g. 5540011947" onChange={(e) => setEditRec({ ...editRec, po_number: e.target.value })} data-testid="asn-edit-po" className="h-9 rounded-sm bg-input border-border font-mono" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Transporter</label>
                <select value={editRec.transporter || ""} onChange={(e) => setEditRec({ ...editRec, transporter: e.target.value })} data-testid="asn-edit-transporter"
                        className="h-9 w-full rounded-sm bg-input border border-border text-sm px-2 focus:outline-none">
                  <option value="">— Select Transporter —</option>
                  {transporterOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Basic Amount</label>
                  <Input type="number" value={editRec.basic_amount ?? 0} onChange={(e) => setEditRec({ ...editRec, basic_amount: e.target.value })} data-testid="asn-edit-basic" className="h-9 rounded-sm bg-input border-border font-mono" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Total Amount</label>
                  <Input type="number" value={editRec.total_amount ?? 0} onChange={(e) => setEditRec({ ...editRec, total_amount: e.target.value })} data-testid="asn-edit-total" className="h-9 rounded-sm bg-input border-border font-mono" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={() => setEditRec(null)} className="rounded-sm">Cancel</Button>
                <Button onClick={saveEdit} disabled={saving} data-testid="asn-edit-save" className="rounded-sm">{saving ? "Saving…" : "Save"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!logView} onOpenChange={(o) => !o && setLogView(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-card border-border" data-testid="asn-log-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">Automation Log — <span className="text-primary font-mono">{logView?.invoice_no}</span></DialogTitle>
            <DialogDescription>
              {logView?.asn_number ? `ASN: ${logView.asn_number}` : logView?.error_message || "No ASN generated yet"}
            </DialogDescription>
          </DialogHeader>
          <div className="bg-background border border-border rounded-sm p-3 max-h-[50vh] overflow-y-auto font-mono text-[11px] space-y-1">
            {(logView?.automation_log || []).length === 0 ? (
              <p className="text-muted-foreground">No log entries.</p>
            ) : (
              logView.automation_log.map((l, i) => (
                <p key={i} className={l.level === "ERROR" ? "text-red-400" : l.level === "SUCCESS" ? "text-emerald-400" : l.level === "WARN" ? "text-amber-400" : "text-muted-foreground"}>
                  [{l.ts?.slice(11, 19)}] {l.event}: {l.message}
                </p>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
      <BatchAllocationDialog req={allocReq} onDone={() => setAllocReq(null)} />
      <AllocationHistoryDialog open={allocHistory} onClose={() => setAllocHistory(false)} />
    </div>
  );
}
