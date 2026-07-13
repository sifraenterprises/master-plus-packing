import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Play, PlayCircle, ArrowsClockwise, ArrowsCounterClockwise, FileXls,
  Warning, PencilSimple, MagnifyingGlass,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const STATUS_CLS = {
  Pending: "border-amber-500/50 text-amber-400",
  Completed: "border-emerald-500/50 text-emerald-400",
  Failed: "border-red-500/50 text-red-400",
};

export default function EwayEntryTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState({});
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [running, setRunning] = useState(false);
  const [runInfo, setRunInfo] = useState(null);
  const [settings, setSettings] = useState({ mode: "test" });
  const [confirmLive, setConfirmLive] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [filters, setFilters] = useState({ status: "All", invoice: "", dispatch: "", date: "" });
  const [editRec, setEditRec] = useState(null);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef(null);

  const fetchData = useCallback(async (f = filters) => {
    try {
      const params = {};
      if (f.status !== "All") params.status = f.status;
      if (f.invoice) params.invoice = f.invoice;
      if (f.dispatch) params.dispatch = f.dispatch;
      if (f.date) params.date = f.date;
      const [r, s, l] = await Promise.all([
        api.get("/eway/records", { params }),
        api.get("/eway/stats"),
        api.get("/eway/logs", { params: { limit: 150 } }),
      ]);
      setRecords(r.data.items);
      setStats(s.data);
      setLogs(l.data);
    } catch (err) {
      toast.error(apiError(err));
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
    api.get("/eway/settings").then((r) => setSettings(r.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!running) return;
    pollRef.current = setInterval(async () => {
      try {
        const [st, l] = await Promise.all([
          api.get("/eway/run-status"),
          api.get("/eway/logs", { params: { limit: 150 } }),
        ]);
        setRunInfo(st.data);
        setLogs(l.data);
        if (!st.data.running) {
          setRunning(false);
          setSelected([]);
          fetchData();
          toast.success("Automation run finished");
        }
      } catch (err) { /* keep polling */ }
    }, 1500);
    return () => clearInterval(pollRef.current);
  }, [running, fetchData]);

  const startRun = async (endpoint, body) => {
    try {
      const res = await api.post(endpoint, body || {});
      setRunning(true);
      setRunInfo({ running: true, total: res.data.total, processed: 0 });
      toast.info(`Run started: ${res.data.total} record(s)`);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const setMode = async (next) => {
    try {
      await api.post("/eway/settings/mode", { mode: next });
      setSettings((s) => ({ ...s, mode: next }));
      toast.success(`Switched to ${next.toUpperCase()} mode`);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const toggleMode = () => {
    if (!isAdmin) return toast.error("Admin role required to change automation mode");
    if (settings.mode === "test") {
      api.get("/eway/validation/status").then((r) => setReadiness(r.data)).catch(() => setReadiness(null));
      setConfirmLive(true);
    } else setMode("test");
  };

  const saveDetails = async () => {
    setSaving(true);
    try {
      await api.put(`/eway/records/${editRec.id}`, {
        company_code: editRec.company_code, from_validity: editRec.from_validity, to_validity: editRec.to_validity,
      });
      toast.success(`E-Way details saved for ${editRec.dispatch_no}`);
      setEditRec(null);
      fetchData();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleSelect = (id) => setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  const pendingIds = records.filter((r) => r.eway_status === "Pending").map((r) => r.id);
  const allSelected = pendingIds.length > 0 && pendingIds.every((id) => selected.includes(id));

  const applyFilter = (key, value) => {
    const f = { ...filters, [key]: value };
    setFilters(f);
    fetchData(f);
  };

  const exportExcel = async () => {
    try {
      const params = {};
      if (filters.status !== "All") params.status = filters.status;
      if (filters.invoice) params.invoice = filters.invoice;
      if (filters.dispatch) params.dispatch = filters.dispatch;
      if (filters.date) params.date = filters.date;
      const res = await api.get("/eway/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "eway_bill_entries.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  const STAT_TILES = [
    { key: "total", label: "Total Records" },
    { key: "pending", label: "Pending" },
    { key: "completed", label: "Completed" },
    { key: "failed", label: "Failed", danger: true },
  ];

  return (
    <div className="space-y-6" data-testid="eway-entry-tab">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          TAFE Vendor Portal · E-Way Bill → E-Way Bill Entry — records sourced from Master Dispatch
        </p>
        <button
          onClick={toggleMode}
          data-testid="eway-mode-toggle"
          disabled={!isAdmin}
          title={isAdmin ? "Switch automation mode" : "Admin role required"}
          className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-border bg-card text-xs font-semibold hover:bg-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span className={`h-2 w-2 rounded-full animate-pulse ${settings.mode === "live" ? "bg-emerald-500" : "bg-amber-500"}`} />
          {settings.mode === "live" ? "LIVE MODE" : "TEST MODE"}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 border border-border rounded-sm overflow-hidden" data-testid="eway-stats">
        {STAT_TILES.map((t, i) => (
          <div key={t.key} className={`bg-card p-4 ${i < 3 ? "lg:border-r" : ""} ${i % 2 === 0 ? "border-r lg:border-r" : ""} border-border border-b lg:border-b-0`} data-testid={`eway-stat-${t.key}`}>
            <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground mb-1.5">{t.label}</p>
            <p className={`text-xl font-black font-mono ${t.danger && stats[t.key] > 0 ? "text-red-400" : ""}`}>{stats[t.key] ?? "—"}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border border-border bg-card rounded-sm p-3">
        <select value={filters.status} onChange={(e) => applyFilter("status", e.target.value)} data-testid="eway-filter-status"
                className="h-9 rounded-sm bg-input border border-border text-xs px-2 focus:outline-none">
          <option>All</option><option>Pending</option><option>Completed</option><option>Failed</option>
        </select>
        <Input type="date" value={filters.date} onChange={(e) => applyFilter("date", e.target.value)} data-testid="eway-filter-date" className="h-9 w-36 rounded-sm bg-input border-border text-xs" />
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Invoice No" value={filters.invoice} onChange={(e) => applyFilter("invoice", e.target.value)} data-testid="eway-filter-invoice" className="h-9 w-36 pl-8 rounded-sm bg-input border-border text-xs" />
        </div>
        <Input placeholder="Dispatch No" value={filters.dispatch} onChange={(e) => applyFilter("dispatch", e.target.value)} data-testid="eway-filter-dispatch" className="h-9 w-36 rounded-sm bg-input border-border text-xs" />
        <div className="flex-1" />
        <Button size="sm" onClick={() => startRun("/eway/run", { ids: selected })} disabled={running || selected.length === 0} data-testid="eway-run-selected" className="rounded-sm gap-1 h-9">
          <Play size={14} weight="bold" /> Run Selected ({selected.length})
        </Button>
        <Button size="sm" variant="secondary" onClick={() => startRun("/eway/run-all-pending")} disabled={running} data-testid="eway-run-all-pending" className="rounded-sm gap-1 h-9">
          <PlayCircle size={14} /> Run All Pending
        </Button>
        <Button size="sm" variant="secondary" onClick={() => startRun("/eway/retry-failed")} disabled={running} data-testid="eway-retry-failed" className="rounded-sm gap-1 h-9 text-red-400">
          <ArrowsCounterClockwise size={14} /> Retry Failed
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fetchData()} data-testid="eway-refresh" className="rounded-sm gap-1 h-9">
          <ArrowsClockwise size={14} /> Refresh
        </Button>
        <Button size="sm" variant="secondary" onClick={exportExcel} data-testid="eway-export-excel" className="rounded-sm gap-1 h-9">
          <FileXls size={14} /> Excel
        </Button>
      </div>

      {running && runInfo && (
        <div className="border border-primary/40 bg-card rounded-sm px-4 py-2.5 text-xs font-mono text-primary" data-testid="eway-run-progress">
          Automation running… {runInfo.processed}/{runInfo.total} processed
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 border border-border rounded-sm overflow-x-auto bg-card">
          <Table data-testid="eway-records-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead className="w-8">
                  <input type="checkbox" data-testid="eway-select-all" checked={allSelected}
                         onChange={() => setSelected(allSelected ? [] : pendingIds)} />
                </TableHead>
                {["Dispatch No", "Invoice No", "E-Way Bill", "Validity", "Status", "Error", "Retry", "Actions"].map((h) => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-[0.15em] whitespace-nowrap">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-10" data-testid="eway-no-records">
                    No records found. Create dispatches in Master Dispatch first.
                  </TableCell>
                </TableRow>
              ) : (
                records.map((r) => (
                  <TableRow key={r.id} className="border-border hover:bg-secondary/50" data-testid={`eway-row-${r.dispatch_no}`}>
                    <TableCell>
                      <input type="checkbox" data-testid={`eway-select-${r.dispatch_no}`} checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} />
                    </TableCell>
                    <TableCell className="font-mono text-primary text-xs whitespace-nowrap">{r.dispatch_no}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{r.invoice_no}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {r.eway_bill_number || <span className="text-muted-foreground/50">blank</span>}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] whitespace-nowrap text-muted-foreground">
                      {r.from_validity || r.to_validity ? `${r.from_validity || "—"} → ${r.to_validity || "—"}` : <span className="text-amber-400">not set</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${STATUS_CLS[r.eway_status] || ""}`}>
                        {r.eway_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-red-400 text-xs max-w-[140px] truncate" title={r.error || ""}>{r.error || "—"}</TableCell>
                    <TableCell className="font-mono text-center text-xs">{r.retry_count ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button onClick={() => setEditRec(r)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`eway-edit-${r.dispatch_no}`} aria-label="Edit E-Way details">
                          <PencilSimple size={15} />
                        </button>
                        <Button size="sm" variant="secondary" onClick={() => startRun("/eway/run", { ids: [r.id] })}
                                disabled={running || r.eway_status === "Completed"} data-testid={`eway-run-${r.dispatch_no}`}
                                className="rounded-sm h-6 text-[10px] px-2">
                          Run
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border border-border rounded-sm bg-card p-4" data-testid="eway-log-panel">
          <p className="text-[10px] uppercase tracking-[0.25em] text-primary mb-3">Automation Log</p>
          <div className="bg-background border border-border rounded-sm p-3 h-[420px] overflow-y-auto font-mono text-[11px] space-y-1">
            {logs.length === 0 ? (
              <p className="text-muted-foreground">No log entries yet.</p>
            ) : (
              logs.map((l, i) => (
                <p key={i} className={l.level === "ERROR" ? "text-red-400" : l.level === "SUCCESS" ? "text-emerald-400" : l.level === "WARN" ? "text-amber-400" : "text-muted-foreground"}>
                  [{l.timestamp?.slice(11, 19)}] {l.event}: {l.message}
                </p>
              ))
            )}
          </div>
        </div>
      </div>

      <Dialog open={!!editRec} onOpenChange={(o) => !o && setEditRec(null)}>
        <DialogContent className="max-w-md bg-card border-border" data-testid="eway-edit-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              E-Way Details — <span className="text-primary font-mono">{editRec?.dispatch_no}</span>
            </DialogTitle>
            <DialogDescription>
              E-Way Bill number comes from the Master Dispatch record. Set company code and validity dates (DD/MM/YYYY) for portal entry.
            </DialogDescription>
          </DialogHeader>
          {editRec && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">E-Way Bill Number (from Master Dispatch)</label>
                <Input value={editRec.eway_bill_number} disabled data-testid="eway-edit-billno" className="h-9 rounded-sm bg-input border-border font-mono opacity-70" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Company Code</label>
                <Input value={editRec.company_code} onChange={(e) => setEditRec({ ...editRec, company_code: e.target.value })} data-testid="eway-edit-company" className="h-9 rounded-sm bg-input border-border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">From Validity (DD/MM/YYYY)</label>
                  <Input value={editRec.from_validity} placeholder="13/07/2026" onChange={(e) => setEditRec({ ...editRec, from_validity: e.target.value })} data-testid="eway-edit-from" className="h-9 rounded-sm bg-input border-border font-mono" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">To Validity (DD/MM/YYYY)</label>
                  <Input value={editRec.to_validity} placeholder="18/07/2026" onChange={(e) => setEditRec({ ...editRec, to_validity: e.target.value })} data-testid="eway-edit-to" className="h-9 rounded-sm bg-input border-border font-mono" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={() => setEditRec(null)} className="rounded-sm">Cancel</Button>
                <Button onClick={saveDetails} disabled={saving} data-testid="eway-edit-save" className="rounded-sm">
                  {saving ? "Saving…" : "Save Details"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmLive} onOpenChange={setConfirmLive}>
        <AlertDialogContent className="bg-card border-border" data-testid="eway-live-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Warning size={20} className="text-red-400" /> Switch to LIVE mode?
            </AlertDialogTitle>
            <AlertDialogDescription>
              LIVE mode executes real transactions on the TAFE Vendor Portal using stored credentials.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {readiness && (
            <div className="space-y-1 text-[11px] font-mono" data-testid="eway-live-readiness">
              <p className={readiness.portal_validation?.all_ok ? "text-emerald-400" : "text-red-400"}>
                {readiness.portal_validation?.all_ok ? "✓" : "✗"} Portal selector validation {readiness.portal_validation?.all_ok ? "passed" : readiness.portal_validation ? "incomplete" : "not run"}
              </p>
              <p className={readiness.test_validation?.all_ok ? "text-emerald-400" : "text-red-400"}>
                {readiness.test_validation?.all_ok ? "✓" : "✗"} TEST workflow validation {readiness.test_validation?.all_ok ? "passed" : readiness.test_validation ? "failed" : "not run"}
              </p>
              {!readiness.ready_for_live && (
                <p className="text-amber-400">Switch will be rejected until both validations pass (Selector Config tab).</p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-sm" data-testid="eway-live-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setMode("live")} data-testid="eway-live-accept" className="rounded-sm bg-red-600 hover:bg-red-500 text-white">
              Yes, go LIVE
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
