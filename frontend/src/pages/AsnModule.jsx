import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Truck, DownloadSimple, Play, ArrowsClockwise, ArrowsCounterClockwise, FileXls, PencilSimple, ListMagnifyingGlass, MagnifyingGlass, PauseCircle, Trash } from "@phosphor-icons/react";
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
  "Waiting for PDI Upload": "border-purple-500/60 text-purple-400",
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
  const [runInfo, setRunInfo] = useState(null);
  const [editRec, setEditRec] = useState(null);
  const [logView, setLogView] = useState(null);
  const [saving, setSaving] = useState(false);
  const [allocReq, setAllocReq] = useState(null);
  const [allocHistory, setAllocHistory] = useState(false);
  const [pdiReq, setPdiReq] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [stopBeforeSubmit, setStopBeforeSubmit] = useState(false);
  const pollRef = useRef(null);

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
        setPdiReq((prev) => {
          const next = data.awaiting_pdi || null;
          if (!!prev !== !!next) load();
          return next;
        });
        if (!data.running) {
          clearInterval(pollRef.current);
          setRunning(false);
          setAllocReq(null);
          setPdiReq(null);
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
    const d = await call("post", "/asn/run-ready", { stop_before_submit: stopBeforeSubmit }, (d) => `Queue started: ${d.total} record(s) (one at a time)`);
    if (d) { load(); startPoll(); }
  };

  const retryFailed = async () => {
    const d = await call("post", "/asn/retry-failed", { stop_before_submit: stopBeforeSubmit }, (d) => `Retrying ${d.total} failed record(s)`);
    if (d) { load(); startPoll(); }
  };

  const runOne = async (r) => {
    const d = await call("post", "/asn/run", { ids: [r.id], stop_before_submit: stopBeforeSubmit }, `Creating ASN for ${r.invoice_no}…`);
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
    if (!window.confirm(`Delete ASN entry for ${r.invoice_no}?`)) return;
    const d = await call("delete", `/asn/records/${r.id}`, undefined, "ASN entry deleted");
    if (d) load();
  };

  const uploadPdiConfirm = async () => {
    if (!pdiReq) return;
    setResuming(true);
    const d = await call("post", "/asn/pdi-wait/confirm", { record_id: pdiReq.record_id },
      "Resuming — worker is clicking Create ASN…");
    setResuming(false);
    if (d) setPdiReq(null);
  };

  const cancelPdiWait = async () => {
    if (!pdiReq) return;
    const d = await call("post", "/asn/pdi-wait/cancel", { record_id: pdiReq.record_id },
      "Run cancelled — ASN was NOT submitted");
    if (d) setPdiReq(null);
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
  const pdiSecsLeft = pdiReq
    ? Math.max(0, Math.floor((pdiReq.timeout_seconds || 900) - (Date.now() - Date.parse(pdiReq.requested_at)) / 1000))
    : 0;

  return (
    <div className="max-w-7xl space-y-6" data-testid="asn-page">
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
        <label className="flex items-center gap-2 h-9 px-3 rounded-sm border border-amber-500/60 text-xs text-amber-300 cursor-pointer" data-testid="asn-stop-before-submit">
          <input type="checkbox" checked={stopBeforeSubmit} onChange={(e) => setStopBeforeSubmit(e.target.checked)} /> Stop before submit
        </label>
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
        <Button variant="secondary" onClick={() => setAllocHistory(true)} data-testid="asn-batch-allocations" className="rounded-sm gap-1">
          <ListMagnifyingGlass size={14} /> Batch Allocations
        </Button>
        <Button variant="secondary" onClick={exportExcel} data-testid="asn-export" className="rounded-sm gap-1">
          <FileXls size={14} /> Export Excel
        </Button>
        <div className="flex-1" />
        <select value={filters.status} onChange={(e) => { const f = { ...filters, status: e.target.value }; setFilters(f); load(f); }}
                data-testid="asn-filter-status" className="h-9 rounded-sm bg-input border border-border text-xs px-2 focus:outline-none">
          {["All", "Draft", "Ready", "Processing", "Awaiting Allocation", "Waiting for PDI Upload", "Completed", "Failed"].map((s) => <option key={s}>{s}</option>)}
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
          {runInfo.phase ? ` — ${runInfo.phase}` : ""}
          {allocReq ? " — ⏸ paused: batch allocation required" : ""}
        </div>
      )}

      {pdiReq && (
        <div className="border-2 border-purple-500/60 bg-card rounded-sm p-4 space-y-3" data-testid="asn-pdi-wait-card">
          <p className="text-sm font-black text-purple-400 flex items-center gap-2">
            <PauseCircle size={20} weight="fill" /> Waiting for manual PDI upload — <span className="font-mono">{pdiReq.invoice_no}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            All ASN details are filled. The worker is paused at the PDI attachment stage and the portal browser session stays open —
            upload the AI-generated PDI PDF <b>directly on the TAFE portal</b>, then click Continue below. The ASN will <b>not</b> be submitted without your confirmation.
          </p>
          <p className={`text-xs font-mono ${pdiSecsLeft < 300 ? "text-red-400 font-bold" : "text-muted-foreground"}`} data-testid="asn-pdi-wait-timer">
            {pdiSecsLeft < 300 ? "⚠ " : ""}Time remaining: {Math.floor(pdiSecsLeft / 60)}m {pdiSecsLeft % 60}s — on timeout the run fails safely (nothing is submitted).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={uploadPdiConfirm} disabled={resuming} data-testid="asn-pdi-resume-btn" className="rounded-sm gap-1.5 bg-purple-600 hover:bg-purple-500 text-white">
              <Play size={14} weight="fill" /> {resuming ? "Resuming…" : "Resume after PDI upload — Create ASN"}
            </Button>
            <Button variant="secondary" onClick={cancelPdiWait} data-testid="asn-pdi-cancel-btn" className="rounded-sm text-red-400">
              Cancel run (do not submit)
            </Button>
          </div>
        </div>
      )}

      <div className="border border-border rounded-sm overflow-x-auto bg-card">
        <Table data-testid="asn-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              {["Invoice Number", "Invoice Date", "PO Number", "Transporter", "Parts", "Status", "ASN Number", "Action"].map((h) => (
                <TableHead key={h} className="text-[10px] uppercase tracking-[0.15em] whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10" data-testid="asn-no-records">
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
                          <button onClick={() => runOne(r)} disabled={running} className="p-1.5 text-muted-foreground hover:text-emerald-400 transition-colors disabled:opacity-40" data-testid={`asn-run-${r.invoice_no}`} aria-label="Run">
                            <Play size={16} />
                          </button>
                        </>
                      )}
                      <button onClick={() => setLogView(r)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`asn-log-${r.invoice_no}`} aria-label="View log">
                        <ListMagnifyingGlass size={16} />
                      </button>
                      {r.status !== "Processing" && r.status !== "Completed" && (
                        <button onClick={() => deleteRecord(r)} className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors" data-testid={`asn-delete-${r.invoice_no}`} aria-label="Delete ASN entry">
                          <Trash size={16} />
                        </button>
                      )}
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

