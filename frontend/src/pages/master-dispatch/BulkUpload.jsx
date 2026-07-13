import { useEffect, useRef, useState, useCallback } from "react";
import { FilePdf, UploadSimple, ArrowsClockwise, CheckCircle, XCircle, CircleNotch, Clock } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

const FILE_ICON = {
  queued: <Clock size={14} className="text-muted-foreground" />,
  processing: <CircleNotch size={14} className="text-primary animate-spin" />,
  done: <CheckCircle size={14} weight="fill" className="text-emerald-400" />,
  failed: <XCircle size={14} weight="fill" className="text-red-400" />,
};

export default function BulkUpload() {
  const [selected, setSelected] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [batch, setBatch] = useState(null);
  const [history, setHistory] = useState([]);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get("/master-dispatch/batches", { params: { page_size: 10 } });
      setHistory(data.items);
    } catch (err) { /* ignore */ }
  }, []);

  useEffect(() => {
    loadHistory();
    return stopPoll;
  }, [loadHistory]);

  const startPoll = (batchId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/master-dispatch/batches/${batchId}`);
        setBatch(data);
        if (data.status !== "processing") {
          stopPoll();
          setUploading(false);
          loadHistory();
          toast[data.status === "completed" ? "success" : "warning"](
            `Batch finished: ${data.invoices_created} record(s) created${data.failed_files ? `, ${data.failed_files} file(s) failed` : ""}`
          );
        }
      } catch (err) {
        stopPoll();
        setUploading(false);
      }
    }, 2500);
  };

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) {
      toast.error("Only PDF files are allowed");
      return;
    }
    setSelected((prev) => [...prev, ...files].slice(0, 100));
    if (fileRef.current) fileRef.current.value = "";
  };

  const upload = async () => {
    if (!selected.length) return;
    setUploading(true);
    setBatch(null);
    const fd = new FormData();
    selected.forEach((f) => fd.append("files", f));
    try {
      const { data } = await api.post("/master-dispatch/upload", fd, { timeout: 600000 });
      toast.info(`Batch queued: ${data.files} file(s) processing in background`);
      setSelected([]);
      startPoll(data.batch_id);
    } catch (err) {
      toast.error(apiError(err));
      setUploading(false);
    }
  };

  const retry = async (batchId) => {
    try {
      const { data } = await api.post(`/master-dispatch/batches/${batchId}/retry`);
      toast.info(`Retrying ${data.retrying} failed file(s)…`);
      setUploading(true);
      startPoll(batchId);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const pct = batch ? Math.round(((batch.processed_files || 0) / (batch.total_files || 1)) * 100) : 0;

  return (
    <div className="max-w-7xl space-y-8" data-testid="md-bulk-page">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Master Dispatch</p>
        <h1 className="text-3xl font-black tracking-tight">Bulk Upload</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Upload up to 100 invoice PDFs at once — including PDFs containing hundreds of invoices. Files are processed in the background; failed invoices can be retried individually.
        </p>
      </div>

      <div
        className="border-2 border-dashed border-border hover:border-primary/50 bg-card rounded-sm p-8 text-center transition-colors cursor-pointer"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        data-testid="md-bulk-upload-zone"
      >
        <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" data-testid="md-bulk-file-input" onChange={(e) => addFiles(e.target.files)} />
        <div className="flex flex-col items-center gap-2">
          <FilePdf size={28} weight="duotone" className="text-primary" />
          <p className="font-bold text-sm">Drop PDFs here or click to browse</p>
          <p className="text-xs text-muted-foreground">Max 100 files, 25MB each</p>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="border border-border bg-card rounded-sm p-4 space-y-3" data-testid="md-bulk-selected">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">{selected.length} file(s) selected</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSelected([])} data-testid="md-bulk-clear" className="rounded-sm">Clear</Button>
              <Button size="sm" onClick={upload} disabled={uploading} data-testid="md-bulk-start" className="rounded-sm gap-1 active:scale-95 transition-transform">
                <UploadSimple size={14} weight="bold" /> {uploading ? "Uploading…" : "Start Processing"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selected.map((f, i) => (
              <Badge key={i} variant="outline" className="rounded-sm text-[10px] border-border text-muted-foreground font-mono">{f.name}</Badge>
            ))}
          </div>
        </div>
      )}

      {batch && (
        <div className="border border-primary/40 bg-card rounded-sm p-5 space-y-4 rise-in" data-testid="md-bulk-progress">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-bold">Batch Progress</h2>
              <p className="text-xs text-muted-foreground font-mono">{batch.batch_id}</p>
            </div>
            <Badge variant="outline" className={`rounded-sm text-[10px] uppercase tracking-widest ${
              batch.status === "processing" ? "border-primary/50 text-primary" :
              batch.status === "completed" ? "border-emerald-500/50 text-emerald-400" : "border-red-500/50 text-red-400"
            }`} data-testid="md-bulk-batch-status">
              {batch.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{batch.processed_files}/{batch.total_files} files processed — {batch.invoices_created || 0} record(s) created</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="border border-border rounded-sm divide-y divide-border max-h-64 overflow-y-auto">
            {batch.files.map((f) => (
              <div key={f.file_id} className="p-2.5 flex items-center gap-2.5 text-xs" data-testid={`md-bulk-file-${f.status}`}>
                {FILE_ICON[f.status]}
                <span className="flex-1 truncate font-mono">{f.name}</span>
                {f.invoices_found > 0 && <span className="text-emerald-400">{f.invoices_found} invoice(s)</span>}
                {f.error && <span className="text-red-400 max-w-[280px] truncate" title={f.error}>{f.error}</span>}
              </div>
            ))}
          </div>
          {batch.status === "completed_with_errors" && (
            <Button size="sm" variant="secondary" onClick={() => retry(batch.batch_id)} data-testid="md-bulk-retry" className="rounded-sm gap-1">
              <ArrowsClockwise size={14} /> Retry Failed Files Only
            </Button>
          )}
          {batch.logs?.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-primary mb-2">Processing Logs</p>
              <div className="bg-background border border-border rounded-sm p-3 max-h-40 overflow-y-auto font-mono text-[11px] space-y-1" data-testid="md-bulk-logs">
                {batch.logs.slice(-50).map((l, i) => (
                  <p key={i} className={l.level === "error" ? "text-red-400" : l.level === "success" ? "text-emerald-400" : "text-muted-foreground"}>
                    [{l.ts?.slice(11, 19)}] {l.message}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-bold text-lg">Recent Batches</h2>
        <div className="border border-border rounded-sm divide-y divide-border bg-card" data-testid="md-bulk-history">
          {history.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No upload batches yet.</p>
          ) : (
            history.map((b) => (
              <div key={b.batch_id} className="p-3 flex items-center gap-3 text-xs flex-wrap">
                <span className="font-mono text-muted-foreground">{b.created_at?.slice(0, 16).replace("T", " ")}</span>
                <span className="font-mono flex-1 truncate">{b.batch_id}</span>
                <span>{b.total_files} file(s)</span>
                <span className="text-emerald-400">{b.invoices_created || 0} record(s)</span>
                {b.failed_files > 0 && <span className="text-red-400">{b.failed_files} failed</span>}
                <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${
                  b.status === "processing" ? "border-primary/50 text-primary" :
                  b.status === "completed" ? "border-emerald-500/50 text-emerald-400" : "border-red-500/50 text-red-400"
                }`}>
                  {b.status.replace(/_/g, " ")}
                </Badge>
                {b.status === "completed_with_errors" && (
                  <Button size="sm" variant="secondary" onClick={() => retry(b.batch_id)} data-testid={`md-history-retry-${b.batch_id}`} className="rounded-sm h-7 gap-1 text-[10px]">
                    <ArrowsClockwise size={12} /> Retry
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
