import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { FilePdf, UploadSimple, Plus, FloppyDisk, X, CheckCircle, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import MDForm, { MD_EMPTY, normalizeMD } from "@/components/md/MDForm";

export default function CreateDispatch() {
  const [uploading, setUploading] = useState(false);
  const [batch, setBatch] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState(MD_EMPTY);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => stopPoll, []);

  const loadDrafts = useCallback(async (batchId) => {
    try {
      const { data } = await api.get("/master-dispatch", {
        params: { batch_id: batchId, verified: "false", page_size: 100 },
      });
      setDrafts(data.items);
      if (data.items.length) toast.success(`${data.items.length} invoice(s) extracted. Verify and save below.`);
    } catch (err) {
      toast.error(apiError(err));
    }
  }, []);

  const startPoll = (batchId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/master-dispatch/batches/${batchId}`);
        setBatch(data);
        if (data.status !== "processing") {
          stopPoll();
          setUploading(false);
          loadDrafts(batchId);
        }
      } catch (err) {
        stopPoll();
        setUploading(false);
      }
    }, 2500);
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) {
      toast.error("Only PDF files are allowed");
      return;
    }
    setUploading(true);
    setBatch(null);
    setDrafts([]);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    try {
      const { data } = await api.post("/master-dispatch/upload", fd, { timeout: 300000 });
      toast.info(`Processing ${data.files} file(s) in background…`);
      startPoll(data.batch_id);
    } catch (err) {
      toast.error(apiError(err));
      setUploading(false);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmDraft = async (draft) => {
    setSaving(true);
    try {
      await api.put(`/master-dispatch/${draft.id}`, { ...normalizeMD(draft), verified: true });
      toast.success(`${draft.dispatch_no} verified & saved`);
      setDrafts((d) => d.filter((x) => x.id !== draft.id));
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const discardDraft = async (draft) => {
    setDrafts((d) => d.filter((x) => x.id !== draft.id));
  };

  const saveManual = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/master-dispatch", { ...normalizeMD(manualEntry), verified: true });
      toast.success(`Created ${data.dispatch_no}`);
      setManualOpen(false);
      setManualEntry(MD_EMPTY);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const processedPct = batch ? Math.round(((batch.processed_files || 0) / (batch.total_files || 1)) * 100) : 0;

  return (
    <div className="max-w-7xl space-y-8" data-testid="md-create-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Master Dispatch</p>
          <h1 className="text-3xl font-black tracking-tight">Create Dispatch</h1>
        </div>
        <Button onClick={() => setManualOpen(true)} variant="secondary" data-testid="md-manual-entry-button" className="rounded-sm gap-2 active:scale-95 transition-transform w-fit">
          <Plus size={16} weight="bold" /> Manual Entry
        </Button>
      </div>

      <div
        className="border-2 border-dashed border-border hover:border-primary/50 bg-card rounded-sm p-10 text-center transition-colors cursor-pointer"
        onClick={() => !uploading && fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!uploading) handleFiles(e.dataTransfer.files);
        }}
        data-testid="md-upload-zone"
      >
        <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" data-testid="md-file-input" onChange={(e) => handleFiles(e.target.files)} />
        {uploading ? (
          <div className="flex flex-col items-center gap-3" data-testid="md-processing-indicator">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">
              AI is reading your invoice(s)… {batch ? `${batch.processed_files}/${batch.total_files} file(s) done` : "starting…"}
            </p>
            {batch && (
              <div className="w-64 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${processedPct}%` }} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 bg-primary/15 flex items-center justify-center rounded-sm">
              <FilePdf size={30} weight="duotone" className="text-primary" />
            </div>
            <p className="font-bold">Upload Invoice PDF(s)</p>
            <p className="text-sm text-muted-foreground max-w-lg">
              Single invoice, multiple PDFs, or one PDF containing multiple invoices — boundaries are detected and split automatically. One Master Dispatch record is created per invoice.
            </p>
            <Button size="sm" className="rounded-sm gap-2 mt-2 pointer-events-none">
              <UploadSimple size={16} weight="bold" /> Choose PDF(s)
            </Button>
          </div>
        )}
      </div>

      {batch && batch.status === "completed_with_errors" && (
        <div className="border border-red-500/40 bg-card rounded-sm p-4 flex items-start gap-3" data-testid="md-batch-errors">
          <Warning size={20} className="text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold text-red-400">{batch.failed_files} file(s) failed OCR</p>
            {batch.files.filter((f) => f.status === "failed").map((f) => (
              <p key={f.file_id} className="text-muted-foreground text-xs mt-1">{f.name}: {f.error}</p>
            ))}
            <Link to="/portal/master-dispatch/bulk" className="text-primary text-xs underline">Retry from Bulk Upload →</Link>
          </div>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="border border-primary/40 bg-card rounded-sm p-6 space-y-6 rise-in" data-testid="md-verification-section">
          <div>
            <h2 className="font-bold text-lg">Verification Screen</h2>
            <p className="text-sm text-muted-foreground">
              Review the extracted data. Fields with OCR confidence below <span className="text-amber-400 font-semibold">90%</span> are highlighted — edit before saving.
            </p>
          </div>
          {drafts.map((d) => (
            <div key={d.id} className="border border-border rounded-sm p-5 space-y-4" data-testid={`md-draft-${d.dispatch_no}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-sm text-[10px] uppercase tracking-widest border-primary/40 text-primary font-mono">
                    {d.dispatch_no}
                  </Badge>
                  {d.low_confidence_fields?.length > 0 && (
                    <Badge variant="outline" className="rounded-sm text-[9px] uppercase border-amber-500/50 text-amber-400">
                      {d.low_confidence_fields.length} low-confidence field(s)
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => discardDraft(d)} data-testid={`md-discard-${d.dispatch_no}`} className="rounded-sm gap-1">
                    <X size={14} /> Skip
                  </Button>
                  <Button size="sm" onClick={() => confirmDraft(d)} disabled={saving} data-testid={`md-confirm-${d.dispatch_no}`} className="rounded-sm gap-1 active:scale-95 transition-transform">
                    <CheckCircle size={14} weight="bold" /> Confirm & Save
                  </Button>
                </div>
              </div>
              <MDForm entry={d} onChange={(v) => setDrafts(drafts.map((x) => (x.id === d.id ? { ...v, id: d.id, dispatch_no: d.dispatch_no } : x)))} idPrefix={`verify-${d.dispatch_no}`} />
            </div>
          ))}
        </div>
      )}

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-card border-border" data-testid="md-manual-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">New Master Dispatch</DialogTitle>
            <DialogDescription>Fill in the dispatch details manually.</DialogDescription>
          </DialogHeader>
          <MDForm entry={manualEntry} onChange={setManualEntry} idPrefix="md-manual" />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" onClick={() => setManualOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={saveManual} disabled={saving} data-testid="md-manual-save" className="rounded-sm gap-1 active:scale-95 transition-transform">
              <FloppyDisk size={14} weight="bold" /> {saving ? "Saving…" : "Save Dispatch"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
