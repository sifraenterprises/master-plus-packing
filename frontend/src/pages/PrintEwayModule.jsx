import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Printer, Play, ArrowsClockwise, ArrowsCounterClockwise, DownloadSimple, ListMagnifyingGlass, MagnifyingGlass, PauseCircle, Trash, GearSix } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const STATUS_CLS = {
  Pending: "border-zinc-500/50 text-zinc-400",
  "Waiting for Portal Login": "border-sky-500/60 text-sky-400",
  Processing: "border-amber-500/50 text-amber-400",
  "Waiting for Review": "border-purple-500/60 text-purple-400",
  Completed: "border-emerald-500/50 text-emerald-400",
  Failed: "border-red-500/50 text-red-400",
};

const secsLeft = (req) => req
  ? Math.max(0, Math.floor((req.timeout_seconds || 900) - (Date.now() - Date.parse(req.requested_at)) / 1000))
  : 0;

export default function PrintEwayModule() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [selected, setSelected] = useState([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [stopBefore, setStopBefore] = useState(false);
  const [running, setRunning] = useState(false);
  const [runInfo, setRunInfo] = useState(null);
  const [loginReq, setLoginReq] = useState(null);
  const [reviewReq, setReviewReq] = useState(null);
  const [logsFor, setLogsFor] = useState(null);
  const [logs, setLogs] = useState([]);
  const [selOpen, setSelOpen] = useState(false);
  const [selText, setSelText] = useState("");
  const pollRef = useRef(null);

  const call = async (method, url, body, okMsg) => {
    try {
      const res = await api[method](url, body || {});
      if (okMsg) toast.success(okMsg);
      return res.data;
    } catch (e) {
      toast.error(e.response?.data?.detail || "Request failed");
      return null;
    }
  };

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        api.get("/eway-print/records", { params: { status: statusFilter, search, page_size: 100 } }),
        api.get("/eway-print/stats"),
      ]);
      setRows(r.data.items);
      setStats(s.data);
    } catch { /* toast handled globally */ }
  }, [statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const startPoll = () => {
    setRunning(true);
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get("/eway-print/run-status");
        setRunInfo(data);
        setLoginReq(data.awaiting_login || null);
        setReviewReq((prev) => {
          const next = data.awaiting_review || null;
          if (!!prev !== !!next) load();
          return next;
        });
        if (!data.running) {
          clearInterval(pollRef.current);
          setRunning(false);
          setLoginReq(null);
          setReviewReq(null);
          load();
          toast.success("Print E-Way Bill queue finished");
        }
      } catch { /* keep polling */ }
    }, 1500);
  };

  useEffect(() => () => clearInterval(pollRef.current), []);
  useEffect(() => {
    api.get("/eway-print/run-status").then(({ data }) => { if (data.running) { setRunInfo(data); startPoll(); } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runJobs = async (url, body, msg) => {
    const d = await call("post", url, { stop_before_download: stopBefore, ...body }, msg);
    if (d) { setSelected([]); startPoll(); load(); }
  };

  const importJobs = async () => {
    const d = await call("post", "/eway-print/import");
    if (d) { toast.success(`${d.created} job(s) queued${d.skipped_invalid ? ` · ${d.skipped_invalid} skipped (invalid EWB number)` : ""}`); load(); }
  };

  const openLogs = async (r) => {
    setLogsFor(r);
    try {
      const { data } = await api.get("/eway-print/logs", { params: { dispatch_no: r.dispatch_no, limit: 100 } });
      setLogs(data);
    } catch { setLogs([]); }
  };

  const downloadPdf = async (r) => {
    try {
      const res = await api.get(`/eway-print/records/${r.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = r.pdf_name || `EWB_${r.eway_bill_number}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("PDF not available"); }
  };

  const openSelectors = async () => {
    try {
      const { data } = await api.get("/eway-print/selectors");
      setSelText(JSON.stringify(data, null, 2));
      setSelOpen(true);
    } catch { toast.error("Could not load selector config"); }
  };

  const saveSelectors = async () => {
    let parsed;
    try { parsed = JSON.parse(selText); } catch { return toast.error("Invalid JSON"); }
    const d = await call("put", "/eway-print/selectors", parsed, "Selector configuration saved");
    if (d) setSelOpen(false);
  };

  const toggleAll = (checked) => setSelected(checked ? rows.filter((r) => r.status !== "Processing").map((r) => r.id) : []);
  const toggleOne = (id, checked) => setSelected((p) => checked ? [...p, id] : p.filter((x) => x !== id));
  const loginSecs = secsLeft(loginReq);
  const reviewSecs = secsLeft(reviewReq);

  return (
    <div className="max-w-7xl space-y-6" data-testid="print-eway-page">
      <div>
        <div className="flex items-center gap-3">
          <Printer size={26} className="text-primary" weight="duotone" />
          <h1 className="text-2xl font-black uppercase tracking-tight">Print E-Way Bill</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Government e-way bill portal · read-only Print EWB jobs — you log in manually (username, password, CAPTCHA, OTP are never stored or automated); the worker prints and downloads the PDF. It never generates, cancels or updates e-way bills.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={importJobs} variant="secondary" className="rounded-sm gap-1.5" data-testid="print-eway-import">
          <ArrowsCounterClockwise size={15} /> Import From Master Dispatch
        </Button>
        <Button onClick={() => selected.length ? runJobs("/eway-print/run", { ids: selected }, `Run started: ${selected.length} job(s)`) : toast.error("Select at least one job")}
                disabled={running} className="rounded-sm gap-1.5" data-testid="print-eway-run-selected">
          <Play size={15} weight="fill" /> Run Selected {selected.length ? `(${selected.length})` : ""}
        </Button>
        <Button onClick={() => runJobs("/eway-print/run-all-pending", {}, "Run started: all pending jobs")}
                disabled={running} variant="secondary" className="rounded-sm gap-1.5" data-testid="print-eway-run-all">
          <Play size={15} /> Run All Pending
        </Button>
        <Button onClick={() => runJobs("/eway-print/retry-failed", {}, "Retrying failed jobs")}
                disabled={running} variant="secondary" className="rounded-sm gap-1.5" data-testid="print-eway-retry-failed">
          <ArrowsClockwise size={15} /> Retry Failed
        </Button>
        <Button onClick={load} variant="secondary" className="rounded-sm gap-1.5" data-testid="print-eway-refresh">
          <ArrowsCounterClockwise size={15} /> Refresh
        </Button>
        {isAdmin && (
          <Button onClick={openSelectors} variant="secondary" className="rounded-sm gap-1.5" data-testid="print-eway-selectors-btn">
            <GearSix size={15} /> Selectors
          </Button>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground ml-2 cursor-pointer" data-testid="print-eway-stop-before-label">
          <Checkbox checked={stopBefore} onCheckedChange={(v) => setStopBefore(!!v)} data-testid="print-eway-stop-before" />
          Stop before print/download (review each result first)
        </label>
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-mono" data-testid="print-eway-stats">
        {["pending", "processing", "completed", "failed"].map((k) => (
          <span key={k} className="border border-border rounded-sm px-2.5 py-1 uppercase">{k}: {stats[k] ?? 0}</span>
        ))}
      </div>

      {running && runInfo && (
        <div className="border border-primary/40 bg-card rounded-sm px-4 py-2.5 text-xs font-mono text-primary" data-testid="print-eway-run-progress">
          Queue running… {runInfo.processed}/{runInfo.total} done{runInfo.current ? ` — current EWB: ${runInfo.current}` : ""}{runInfo.phase ? ` — ${runInfo.phase}` : ""}
        </div>
      )}

      {loginReq && (
        <div className="border-2 border-sky-500/60 bg-card rounded-sm p-4 space-y-3" data-testid="print-eway-login-wait-card">
          <p className="text-sm font-black text-sky-400 flex items-center gap-2">
            <PauseCircle size={20} weight="fill" /> Waiting for manual portal login
          </p>
          <p className="text-xs text-muted-foreground">
            A visible browser window is open at the e-way bill portal login page. Complete the <b>username, password, CAPTCHA and OTP yourself</b> — they are never stored or automated. One login covers all queued jobs. Then click Continue below.
          </p>
          <p className={`text-xs font-mono ${loginSecs < 300 ? "text-red-400 font-bold" : "text-muted-foreground"}`} data-testid="print-eway-login-timer">
            {loginSecs < 300 ? "⚠ " : ""}Time remaining: {Math.floor(loginSecs / 60)}m {loginSecs % 60}s — on timeout the run stops safely.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => call("post", "/eway-print/login-wait/confirm", {}, "Resuming — printing queued e-way bills…")}
                    className="rounded-sm gap-1.5 bg-sky-600 hover:bg-sky-500 text-white" data-testid="print-eway-login-confirm-btn">
              <Play size={14} weight="fill" /> I have logged in — Continue
            </Button>
            <Button variant="secondary" onClick={() => call("post", "/eway-print/login-wait/cancel", {}, "Run cancelled")}
                    className="rounded-sm text-red-400" data-testid="print-eway-login-cancel-btn">
              Cancel run
            </Button>
          </div>
        </div>
      )}

      {reviewReq && (
        <div className="border-2 border-purple-500/60 bg-card rounded-sm p-4 space-y-3" data-testid="print-eway-review-wait-card">
          <p className="text-sm font-black text-purple-400 flex items-center gap-2">
            <PauseCircle size={20} weight="fill" /> Review before print/download — EWB <span className="font-mono">{reviewReq.eway_bill_number}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            The portal shows a matching result for dispatch {reviewReq.dispatch_no || "—"}. Review it in the browser window, then continue to download the PDF or cancel.
          </p>
          <p className={`text-xs font-mono ${reviewSecs < 300 ? "text-red-400 font-bold" : "text-muted-foreground"}`} data-testid="print-eway-review-timer">
            {reviewSecs < 300 ? "⚠ " : ""}Time remaining: {Math.floor(reviewSecs / 60)}m {reviewSecs % 60}s
          </p>
          <div className="flex gap-2">
            <Button onClick={() => call("post", "/eway-print/review-wait/confirm", { record_id: reviewReq.record_id }, "Downloading PDF…")}
                    className="rounded-sm gap-1.5 bg-purple-600 hover:bg-purple-500 text-white" data-testid="print-eway-review-confirm-btn">
              <DownloadSimple size={14} weight="fill" /> Continue — Print &amp; Download
            </Button>
            <Button variant="secondary" onClick={() => call("post", "/eway-print/review-wait/cancel", { record_id: reviewReq.record_id }, "Job cancelled — nothing downloaded")}
                    className="rounded-sm text-red-400" data-testid="print-eway-review-cancel-btn">
              Cancel this job
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search dispatch / invoice / EWB…"
                 className="h-8 pl-8 pr-3 text-xs bg-input border border-border rounded-sm w-64" data-testid="print-eway-search" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="h-8 text-xs bg-input border border-border rounded-sm px-2" data-testid="print-eway-filter-status">
          {["All", "Pending", "Waiting for Portal Login", "Processing", "Waiting for Review", "Completed", "Failed"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="border border-border rounded-sm overflow-x-auto">
        <Table data-testid="print-eway-table">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-8">
                <Checkbox checked={selected.length > 0 && selected.length === rows.filter((r) => r.status !== "Processing").length}
                          onCheckedChange={toggleAll} data-testid="print-eway-select-all" />
              </TableHead>
              {["Dispatch No.", "Invoice No.", "E-Way Bill No.", "Status", "Error", "Actions"].map((h) => (
                <TableHead key={h} className="text-[10px] uppercase tracking-wider whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-10" data-testid="print-eway-no-records">
                  No print jobs — click "Import From Master Dispatch" to queue dispatches that have an e-way bill number.
                </TableCell>
              </TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id} className="border-border" data-testid={`print-eway-row-${r.eway_bill_number}`}>
                <TableCell>
                  <Checkbox checked={selected.includes(r.id)} onCheckedChange={(v) => toggleOne(r.id, !!v)}
                            disabled={r.status === "Processing"} data-testid={`print-eway-select-${r.eway_bill_number}`} />
                </TableCell>
                <TableCell className="text-xs font-mono">{r.dispatch_no || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{r.invoice_no || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{r.eway_bill_number}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`rounded-sm text-[9px] uppercase whitespace-nowrap ${STATUS_CLS[r.status] || "border-border"}`}
                         data-testid={`print-eway-status-${r.eway_bill_number}`}>
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-red-400 max-w-[240px] truncate" title={r.error_message}>{r.error_message || ""}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => runJobs("/eway-print/run", { ids: [r.id] }, `Run started: EWB ${r.eway_bill_number}`)}
                            disabled={running} className="p-1.5 text-muted-foreground hover:text-emerald-400 transition-colors disabled:opacity-40"
                            data-testid={`print-eway-run-${r.eway_bill_number}`} aria-label="Run">
                      <Play size={16} />
                    </button>
                    <button onClick={() => openLogs(r)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                            data-testid={`print-eway-logs-${r.eway_bill_number}`} aria-label="Logs">
                      <ListMagnifyingGlass size={16} />
                    </button>
                    {r.has_pdf && (
                      <button onClick={() => downloadPdf(r)} className="p-1.5 text-muted-foreground hover:text-emerald-400 transition-colors"
                              data-testid={`print-eway-pdf-${r.eway_bill_number}`} aria-label="Download PDF">
                        <DownloadSimple size={16} />
                      </button>
                    )}
                    {isAdmin && (
                      <button onClick={async () => { const d = await call("delete", `/eway-print/records/${r.id}`, null, "Job deleted"); if (d) load(); }}
                              className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                              data-testid={`print-eway-delete-${r.eway_bill_number}`} aria-label="Delete">
                        <Trash size={16} />
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!logsFor} onOpenChange={(o) => !o && setLogsFor(null)}>
        <DialogContent className="bg-card border-border max-w-3xl" data-testid="print-eway-logs-dialog">
          <DialogHeader>
            <DialogTitle className="uppercase text-sm tracking-wider">Execution Log — EWB {logsFor?.eway_bill_number}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto space-y-1 font-mono text-[11px]">
            {logs.length === 0 ? <p className="text-muted-foreground">No log entries yet.</p> : logs.map((l) => (
              <div key={l.id} className={`px-2 py-1 border-l-2 ${l.level === "ERROR" ? "border-red-500 text-red-400" : l.level === "SUCCESS" ? "border-emerald-500 text-emerald-400" : l.level === "WARN" ? "border-amber-500 text-amber-400" : "border-border text-muted-foreground"}`}>
                <span className="text-foreground">{l.event}</span> · {l.message}
                <span className="opacity-60"> — {l.timestamp?.slice(0, 19).replace("T", " ")}</span>
              </div>
            ))}
            {logsFor && Object.keys(logsFor.screenshots || {}).length > 0 && (
              <div className="pt-2 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Screenshots</p>
                {Object.entries(logsFor.screenshots).map(([k, v]) => v && (
                  <p key={k} className="text-xs">
                    <a href={`${api.defaults.baseURL}/eway-print/${v}`} target="_blank" rel="noreferrer" className="text-primary underline" data-testid={`print-eway-shot-${k}`}>{k}: {v.split("/").pop()}</a>
                  </p>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={selOpen} onOpenChange={setSelOpen}>
        <DialogContent className="bg-card border-border max-w-2xl" data-testid="print-eway-selectors-dialog">
          <DialogHeader>
            <DialogTitle className="uppercase text-sm tracking-wider">Print EWB — Selector Configuration</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">CSS selectors used on the government portal. Adjust here if the portal layout changes — no code deploy needed.</p>
          <Textarea value={selText} onChange={(e) => setSelText(e.target.value)} rows={14}
                    className="font-mono text-xs bg-input border-border rounded-sm" data-testid="print-eway-selectors-text" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSelOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={saveSelectors} className="rounded-sm" data-testid="print-eway-selectors-save">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
