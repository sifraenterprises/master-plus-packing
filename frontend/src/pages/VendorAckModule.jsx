import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Handshake, Play, ArrowsClockwise, MagnifyingGlass, Camera, ListMagnifyingGlass, ArrowsCounterClockwise, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api, { apiError } from "@/lib/api";

const STATUS_CLS = {
  Pending: "border-amber-500/50 text-amber-400",
  Processing: "border-sky-500/50 text-sky-400",
  Completed: "border-emerald-500/50 text-emerald-400",
  "Retry Scheduled": "border-orange-500/50 text-orange-400",
  Failed: "border-red-500/50 text-red-400",
};

const STAT_TILES = [
  { key: "total", label: "Total Dispatches" },
  { key: "pending", label: "Pending" },
  { key: "completed", label: "Completed" },
  { key: "retry_scheduled", label: "Retry Scheduled" },
  { key: "failed", label: "Failed", danger: true },
];

export default function VendorAckModule() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [plants, setPlants] = useState([]);
  const [transporters, setTransporters] = useState([]);

  const [filters, setFilters] = useState({ status: "All", search: "" });
  const [mode, setMode] = useState("test");
  const [selectedId, setSelectedId] = useState("");
  const [panel, setPanel] = useState(null);
  const [running, setRunning] = useState(false);
  const [stopBeforeSubmit, setStopBeforeSubmit] = useState(false);
  const [logView, setLogView] = useState(null);
  const [shotView, setShotView] = useState(null);
  const [shotUrls, setShotUrls] = useState({});
  const pollRef = useRef(null);

  const load = useCallback(async (f = filters) => {
    try {
      const params = { page_size: 100 };
      if (f.status !== "All") params.status = f.status;
      if (f.search) params.search = f.search;
      const [r, s] = await Promise.all([
        api.get("/vendor-ack/records", { params }),
        api.get("/vendor-ack/stats"),
      ]);
      setRows(r.data.items);
      setStats(s.data);
    } catch (err) {
      toast.error(apiError(err));
    }
  }, [filters]);

  useEffect(() => {
    load();
    api.get("/master-dispatch/plants").then((r) => setPlants(r.data)).catch(() => {});
    api.get("/master-dispatch/transporters").then((r) => setTransporters(r.data)).catch(() => {});
    api.get("/eway/settings").then((r) => setMode(r.data.mode)).catch(() => {});
    return () => pollRef.current && clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickRecord = (id) => {
    setSelectedId(id);
    const r = rows.find((x) => x.dispatch_id === id);
    if (!r) return setPanel(null);
    setPanel({
      dispatch_id: r.dispatch_id, dispatch_no: r.dispatch_no, invoice_number: r.invoice_number,
      asn_number: r.asn_number, company_code: "TMTL",
      transporter: r.transporter, plant: r.plant,
    });
  };

  const startPoll = () => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get("/vendor-ack/run-status");
        if (!data.running) {
          clearInterval(pollRef.current);
          setRunning(false);
          load();
          toast.success("Automation run finished — check status in the grid");
        }
      } catch (err) { /* keep polling */ }
    }, 1500);
  };

  const startAutomation = async () => {
    if (!panel) return;
    setRunning(true);
    try {
      await api.post("/vendor-ack/run", {
        dispatch_id: panel.dispatch_id, company_code: panel.company_code,
        transporter: panel.transporter, plant: panel.plant, dry_run: stopBeforeSubmit,
      });
      toast.info(`Automation started for ${panel.dispatch_no}`);
      load();
      startPoll();
    } catch (err) {
      toast.error(apiError(err));
      setRunning(false);
    }
  };

  const retry = async (r) => {
    if (!r.ack) return;
    setRunning(true);
    try {
      await api.post(`/vendor-ack/retry/${r.ack.id}`);
      toast.info(`Retrying ${r.dispatch_no}…`);
      load();
      startPoll();
    } catch (err) {
      toast.error(apiError(err));
      setRunning(false);
    }
  };
  const deleteRecord = async (r) => {
    const pending = !r.ack;
    if (!window.confirm(`Delete ${pending ? "pending dispatch" : "acknowledgement record"} ${r.dispatch_no}? This cannot be undone.`)) return;
    try { await api.delete(pending ? `/vendor-ack/dispatches/${r.dispatch_id}` : `/vendor-ack/records/${r.ack.id}`); toast.success("Record deleted"); load(); }
    catch (err) { toast.error(apiError(err)); }
  };

  const viewShots = async (r) => {
    const shots = r.ack?.screenshots || {};
    if (!Object.keys(shots).length) return toast.info("No screenshots captured for this record yet");
    const urls = {};
    for (const [k, p] of Object.entries(shots)) {
      try {
        const name = p.split("/").pop();
        const res = await api.get(`/vendor-ack/screenshots/${name}`, { responseType: "blob" });
        urls[k] = URL.createObjectURL(res.data);
      } catch (err) { /* skip missing */ }
    }
    setShotUrls(urls);
    setShotView(r);
  };

  const plantOptions = panel?.plant && !plants.includes(panel.plant) ? [panel.plant, ...plants] : plants;
  const transporterOptions = panel?.transporter && !transporters.includes(panel.transporter)
    ? [panel.transporter, ...transporters] : transporters;
  const canStart = panel && panel.asn_number && panel.transporter && panel.plant && !running;

  return (
    <div className="max-w-7xl space-y-6" data-testid="vendor-ack-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Automation Module</p>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Handshake size={32} weight="duotone" className="text-primary" /> Vendor E-Way Bill Acknowledgement
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            TAFE Vendor Portal · Vendor → E Way Bill Acknowledgement — all data pulled from Master Dispatch, no re-typing.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-border bg-card text-xs font-semibold" data-testid="vack-mode-badge">
          <span className={`h-2 w-2 rounded-full animate-pulse ${mode === "live" ? "bg-emerald-500" : "bg-amber-500"}`} />
          {mode === "live" ? "LIVE MODE" : "TEST MODE"}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 border border-border rounded-sm overflow-hidden" data-testid="vack-stats">
        {STAT_TILES.map((t, i) => (
          <div key={t.key} className={`bg-card p-4 border-border border-b lg:border-b-0 ${i < 4 ? "lg:border-r" : ""} ${i % 2 === 0 ? "border-r" : ""}`} data-testid={`vack-stat-${t.key}`}>
            <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground mb-1.5">{t.label}</p>
            <p className={`text-xl font-black font-mono ${t.danger && stats[t.key] > 0 ? "text-red-400" : ""}`}>{stats[t.key] ?? "—"}</p>
          </div>
        ))}
      </div>

      <div className="border border-primary/40 bg-card rounded-sm p-5 space-y-4" data-testid="vack-panel">
        <p className="text-[10px] uppercase tracking-[0.25em] text-primary">Acknowledgement Panel — select a dispatch, review, start</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Master Dispatch Record</label>
            <select value={selectedId} onChange={(e) => pickRecord(e.target.value)} data-testid="vack-record-select"
                    className="h-9 w-full rounded-sm bg-input border border-border text-sm px-2 focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">— Select dispatch —</option>
              {rows.map((r) => (
                <option key={r.dispatch_id} value={r.dispatch_id}>
                  {`${r.dispatch_no} · ${r.invoice_number} ${r.asn_number ? `· ASN ${r.asn_number}` : "· (no ASN)"}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Company Code</label>
            <Input value={panel?.company_code || "TMTL"} onChange={(e) => setPanel({ ...panel, company_code: e.target.value })}
                   disabled={!panel} data-testid="vack-company-code" className="h-9 rounded-sm bg-input border-border" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Transporter</label>
            <select value={panel?.transporter || ""} onChange={(e) => setPanel({ ...panel, transporter: e.target.value })}
                    disabled={!panel} data-testid="vack-transporter"
                    className="h-9 w-full rounded-sm bg-input border border-border text-sm px-2 focus:outline-none disabled:opacity-50">
              <option value="">— Select Transporter —</option>
              {transporterOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Plant</label>
            <select value={panel?.plant || ""} onChange={(e) => setPanel({ ...panel, plant: e.target.value })}
                    disabled={!panel} data-testid="vack-plant"
                    className="h-9 w-full rounded-sm bg-input border border-border text-sm px-2 focus:outline-none disabled:opacity-50">
              <option value="">— Select Plant —</option>
              {plantOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">ASN No. (read-only)</label>
            <Input value={panel?.asn_number || ""} disabled data-testid="vack-asn" className="h-9 rounded-sm bg-input border-border font-mono opacity-70" />
          </div>
        </div>
        {panel && !panel.asn_number && (
          <p className="text-xs text-amber-400" data-testid="vack-no-asn-warning">
            This dispatch has no ASN Number — add it in Master Dispatch (Edit record → ASN Number) first.
          </p>
        )}
        <div className="flex gap-2">
          <Button onClick={startAutomation} disabled={!canStart} data-testid="vack-start-automation" className="rounded-sm gap-2 active:scale-95 transition-transform">
            <Play size={16} weight="bold" /> {running ? "Automation Running…" : "Start Automation"}
          </Button>
          <Button variant="secondary" onClick={() => load()} data-testid="vack-refresh" className="rounded-sm gap-1">
            <ArrowsClockwise size={14} /> Refresh
          </Button>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-red-500/40 bg-red-500/5 px-3 text-sm text-red-300" title="Pause the worker before the final TAFE submission">
            <input type="checkbox" checked={stopBeforeSubmit} onChange={(e) => setStopBeforeSubmit(e.target.checked)} data-testid="vack-stop-before-submit" className="h-4 w-4 accent-red-500" />
            Stop before submit
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={filters.status} onChange={(e) => { const f = { ...filters, status: e.target.value }; setFilters(f); load(f); }}
                data-testid="vack-filter-status" className="h-9 rounded-sm bg-input border border-border text-xs px-2 focus:outline-none">
          {["All", "Pending", "Processing", "Completed", "Retry Scheduled", "Failed"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Dispatch / Invoice / ASN…" value={filters.search}
                 onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                 onKeyDown={(e) => e.key === "Enter" && load()}
                 data-testid="vack-search" className="h-9 w-56 pl-8 rounded-sm bg-input border-border text-xs" />
        </div>
      </div>

      <div className="border border-border rounded-sm overflow-x-auto bg-card">
        <Table data-testid="vack-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              {["Dispatch No", "Invoice No", "ASN No", "Transporter", "Plant", "Status", "Ack Date", "Portal Message", "Actions"].map((h) => (
                <TableHead key={h} className="text-[10px] uppercase tracking-[0.15em] whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-10" data-testid="vack-no-records">
                  No dispatch records found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.dispatch_id} className="border-border hover:bg-secondary/50" data-testid={`vack-row-${r.dispatch_no}`}>
                  <TableCell className="font-mono text-primary text-xs whitespace-nowrap">{r.dispatch_no}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{r.invoice_number}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{r.asn_number || <span className="text-muted-foreground/50">—</span>}</TableCell>
                  <TableCell className="text-xs max-w-[130px] truncate">{r.transporter || "—"}</TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate">{r.plant || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`rounded-sm text-[9px] uppercase whitespace-nowrap ${STATUS_CLS[r.ack_status] || ""}`}>
                      {r.ack_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{r.ack_date || "—"}</TableCell>
                  <TableCell className="text-xs max-w-[160px] truncate" title={r.portal_message || ""}>{r.portal_message || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-0.5">
                      <button onClick={() => viewShots(r)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`vack-screenshot-${r.dispatch_no}`} aria-label="View screenshots">
                        <Camera size={16} />
                      </button>
                      <button onClick={() => r.ack ? setLogView(r) : toast.info("No execution log yet")} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`vack-log-${r.dispatch_no}`} aria-label="View log">
                        <ListMagnifyingGlass size={16} />
                      </button>
                      {r.ack && r.ack_status !== "Completed" && r.ack_status !== "Processing" && (
                        <button onClick={() => retry(r)} disabled={running} className="p-1.5 text-muted-foreground hover:text-orange-400 transition-colors disabled:opacity-40" data-testid={`vack-retry-${r.dispatch_no}`} aria-label="Retry">
                          <ArrowsCounterClockwise size={16} />
                        </button>
                      )}
                      <button onClick={() => deleteRecord(r)} disabled={r.ack_status === "Processing"} title={r.ack_status === "Processing" ? "Processing records cannot be deleted" : "Delete record"} className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:cursor-not-allowed disabled:opacity-35" data-testid={`vack-delete-${r.dispatch_no}`} aria-label="Delete record"><Trash size={16} /> <span>Delete</span></button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!logView} onOpenChange={(o) => !o && setLogView(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-card border-border" data-testid="vack-log-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">Execution Log — <span className="text-primary font-mono">{logView?.dispatch_no}</span></DialogTitle>
            <DialogDescription>
              Retry count: {logView?.ack?.retry_count ?? 0} · Execution time: {logView?.ack?.execution_time_ms ?? "—"} ms
            </DialogDescription>
          </DialogHeader>
          <div className="bg-background border border-border rounded-sm p-3 max-h-[50vh] overflow-y-auto font-mono text-[11px] space-y-1">
            {(logView?.ack?.execution_log || []).length === 0 ? (
              <p className="text-muted-foreground">No log entries.</p>
            ) : (
              logView.ack.execution_log.map((l, i) => (
                <p key={i} className={l.level === "ERROR" ? "text-red-400" : l.level === "SUCCESS" ? "text-emerald-400" : l.level === "WARN" ? "text-amber-400" : "text-muted-foreground"}>
                  [{l.ts?.slice(11, 19)}] {l.event}: {l.message}
                </p>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shotView} onOpenChange={(o) => { if (!o) { setShotView(null); Object.values(shotUrls).forEach(URL.revokeObjectURL); setShotUrls({}); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-card border-border" data-testid="vack-screenshot-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">Screenshots — <span className="text-primary font-mono">{shotView?.dispatch_no}</span></DialogTitle>
            <DialogDescription>Captured before submit / after success / after failure.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {Object.entries(shotUrls).map(([k, url]) => (
              <div key={k}>
                <p className="text-[10px] uppercase tracking-[0.2em] text-primary mb-1">{k.replace(/_/g, " ")}</p>
                <img src={url} alt={k} className="border border-border rounded-sm max-w-full" />
              </div>
            ))}
            {Object.keys(shotUrls).length === 0 && <p className="text-sm text-muted-foreground">No screenshots available.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
