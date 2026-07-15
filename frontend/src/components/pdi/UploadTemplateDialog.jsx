import { useEffect, useRef, useState } from "react";
import { CloudArrowUp, PencilSimple, ArrowsMerge, Eye, CheckCircle } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import TemplateEditorDialog from "./TemplateEditorDialog";
import PdfPreviewDialog from "./PdfPreviewDialog";

export default function UploadTemplateDialog({ open, onClose, onSaved }) {
  const [uploadId, setUploadId] = useState("");
  const [status, setStatus] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [saved, setSaved] = useState([]);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setUploadId(""); setStatus(null); setDrafts([]); setSaved([]);
      if (pollRef.current) clearInterval(pollRef.current);
    }
  }, [open]);

  const pick = () => fileRef.current?.click();

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/pdi/templates/upload", fd);
      setUploadId(r.data.upload_id);
      setStatus({ status: "processing", processed: 0, pages: r.data.pages });
      toast.success(`Uploaded ${file.name} (${r.data.pages} pages) — OCR running`);
      pollRef.current = setInterval(async () => {
        try {
          const s = (await api.get(`/pdi/uploads/${r.data.upload_id}`)).data;
          setStatus(s);
          if (s.status !== "processing") {
            clearInterval(pollRef.current);
            setDrafts((s.drafts || []).map((d, i) => ({ ...d, _key: i })));
            if (s.status === "failed") toast.error(`OCR failed: ${s.errors?.[0] || "unknown"}`);
          }
        } catch { /* keep polling */ }
      }, 2500);
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  const merge = (i) => {
    setDrafts((ds) => {
      const a = ds[i], b = ds[i + 1];
      if (!b) return ds;
      const offset = a.page_end - a.page_start + 1;
      const merged = {
        ...a, page_end: b.page_end,
        part_name: a.part_name || b.part_name, item_code: a.item_code || b.item_code, drg_no: a.drg_no || b.drg_no,
        rows: [...a.rows, ...b.rows.map((r) => ({ ...r, page: (r.page || 1) + offset }))],
      };
      return [...ds.slice(0, i), merged, ...ds.slice(i + 2)];
    });
  };

  const progress = status?.pages ? Math.round(((status.processed || 0) / status.pages) * 100) : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-3xl rounded-sm max-h-[85vh] overflow-y-auto" data-testid="pdi-upload-dialog">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold">Upload New PDI Template</DialogTitle>
          </DialogHeader>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={upload} data-testid="pdi-upload-file-input" />
          {!uploadId && (
            <div className="border border-dashed border-border rounded-sm p-8 text-center space-y-3">
              <CloudArrowUp size={34} className="mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Upload a blank PDI template PDF. Each page is OCR-extracted with Gemini; consecutive continuation pages are grouped automatically. You review and edit everything before saving.</p>
              <Button onClick={pick} disabled={busy} data-testid="pdi-upload-pick-btn" className="rounded-sm gap-1.5">
                <CloudArrowUp size={15} /> {busy ? "Uploading…" : "Choose PDF"}
              </Button>
            </div>
          )}
          {uploadId && status?.status === "processing" && (
            <div className="space-y-2 py-4" data-testid="pdi-upload-progress">
              <p className="text-xs font-semibold">Gemini OCR running… {status.processed || 0}/{status.pages} pages</p>
              <Progress value={progress} className="h-2 rounded-sm" />
            </div>
          )}
          {uploadId && status?.status === "done" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {drafts.length} template draft{drafts.length !== 1 ? "s" : ""} detected. Review each one before saving.
                Use <b>Merge ↓</b> if consecutive drafts belong to the same multi-page template.
              </p>
              {drafts.map((d, i) => (
                <div key={d._key} className="border border-border rounded-sm px-3 py-2 flex items-center justify-between gap-2 bg-background" data-testid={`pdi-draft-${i}`}>
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{d.part_name || "(no part name)"} <span className="text-muted-foreground font-normal">· {d.item_code || "—"} · {d.rows.length} rows</span></p>
                    <p className="text-[11px] text-muted-foreground">Pages {d.page_start}–{d.page_end}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {saved.includes(d._key) ? (
                      <Badge variant="outline" className="rounded-sm text-[9px] border-emerald-500/50 text-emerald-500 gap-1"><CheckCircle size={11} /> SAVED</Badge>
                    ) : (
                      <>
                        <button title="View pages" onClick={() => setViewing(d)} className="p-1.5 text-muted-foreground hover:text-primary" data-testid={`pdi-draft-view-${i}`}><Eye size={15} /></button>
                        {i < drafts.length - 1 && !saved.includes(drafts[i + 1]._key) && (
                          <button title="Merge with next draft" onClick={() => merge(i)} className="p-1.5 text-muted-foreground hover:text-amber-500" data-testid={`pdi-draft-merge-${i}`}><ArrowsMerge size={15} /></button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => setEditing(d)} data-testid={`pdi-draft-review-${i}`} className="rounded-sm h-7 text-xs gap-1">
                          <PencilSimple size={13} /> Review & Save
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {status.errors?.length > 0 && (
                <p className="text-[11px] text-amber-500">{status.errors.length} OCR warning(s): {status.errors[0]}</p>
              )}
              <div className="flex justify-end pt-1">
                <Button variant="secondary" onClick={onClose} className="rounded-sm" data-testid="pdi-upload-done">Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {editing && (
        <TemplateEditorDialog draft={editing} uploadId={uploadId}
                              onClose={() => setEditing(null)}
                              onSaved={() => { setSaved((s) => [...s, editing._key]); setEditing(null); onSaved(); }} />
      )}
      <PdfPreviewDialog open={!!viewing} onClose={() => setViewing(null)}
                        title={viewing ? `Draft pages ${viewing.page_start}–${viewing.page_end}` : ""}
                        pdfUrl={viewing ? `/pdi/uploads/${uploadId}/pages.pdf?page_start=${viewing.page_start}&page_end=${viewing.page_end}` : ""}
                        downloadName="draft_pages.pdf" />
    </>
  );
}
