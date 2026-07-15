import { useEffect, useState, useCallback, useRef } from "react";
import { MagnifyingGlass, CloudArrowUp, Eye, PencilSimple, Power, ClockCounterClockwise, FilePdf, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import TemplateEditorDialog from "./TemplateEditorDialog";
import TemplatePreviewDialog from "./TemplatePreviewDialog";
import UploadTemplateDialog from "./UploadTemplateDialog";
import RevisionsDialog from "./RevisionsDialog";

export default function TemplateLibrary() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ total: 0, items: [] });
  const [importState, setImportState] = useState(null);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [revisions, setRevisions] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replacing, setReplacing] = useState(null); // {template, uploadId?, pageStart, pageEnd, polling}
  const replaceFileRef = useRef(null);
  const pollRef = useRef(null);

  const load = useCallback(() => {
    api.get("/pdi/templates", { params: { q, page, limit: 25 } })
      .then((r) => setData(r.data)).catch((err) => toast.error(apiError(err)));
  }, [q, page]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const pollStatus = useCallback(() => {
    api.get("/pdi/import-status").then((r) => {
      setImportState(r.data);
      if (!r.data.running && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        load();
      }
    }).catch(() => {});
  }, [load]);

  useEffect(() => {
    pollStatus();
    return () => pollRef.current && clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startImport = async () => {
    if (!window.confirm("Re-run OCR import of the master PDF via Gemini? Existing templates for the same pages get a new revision.")) return;
    try {
      await api.post("/pdi/import-master");
      toast.success("Import started — extracting templates with Gemini OCR");
      pollRef.current = setInterval(pollStatus, 3000);
    } catch (err) { toast.error(apiError(err)); }
  };

  const toggleStatus = async (t) => {
    try {
      const next = t.status === "active" ? "inactive" : "active";
      await api.put(`/pdi/templates/${t.id}`, { status: next });
      toast.success(`Template ${next === "active" ? "activated" : "deactivated"}`);
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  const removeTemplate = async (t) => {
    if (!window.confirm(`Delete template "${t.part_name}"? Only possible if no reports were generated from it.`)) return;
    try {
      await api.delete(`/pdi/templates/${t.id}`);
      toast.success("Template deleted");
      load();
      pollStatus();
    } catch (err) { toast.error(apiError(err)); }
  };

  const startReplace = (t) => {
    setReplacing({ template: t });
    replaceFileRef.current?.click();
  };

  const onReplaceFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !replacing) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/pdi/templates/upload", fd);
      toast.success("Replacement PDF uploaded — OCR running");
      const uploadId = r.data.upload_id;
      const timer = setInterval(async () => {
        try {
          const s = (await api.get(`/pdi/uploads/${uploadId}`)).data;
          if (s.status === "done") {
            clearInterval(timer);
            const draft = (s.drafts || [])[0];
            setReplacing((rep) => rep && {
              ...rep, uploadId, pageStart: 1, pageEnd: r.data.pages,
              template: { ...rep.template, rows: draft?.rows?.length ? draft.rows : rep.template.rows },
            });
          } else if (s.status === "failed") {
            clearInterval(timer);
            toast.error(`OCR failed: ${s.errors?.[0] || "unknown"}`);
            setReplacing(null);
          }
        } catch { /* keep polling */ }
      }, 2500);
    } catch (err) { toast.error(apiError(err)); setReplacing(null); }
  };

  const running = importState?.running;
  const progress = importState?.total ? Math.round((importState.processed / importState.total) * 100) : 0;
  const pages = Math.max(1, Math.ceil(data.total / 25));

  return (
    <div className="space-y-4" data-testid="pdi-template-library">
      <input ref={replaceFileRef} type="file" accept="application/pdf" className="hidden" onChange={onReplaceFile} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                 placeholder="Search part name, item code, drawing no, mapped part or customer…"
                 data-testid="pdi-library-search" className="h-8 pl-8 rounded-sm bg-input border-border text-xs" />
        </div>
        <Badge variant="outline" className="rounded-sm text-[10px] h-8 px-3 flex items-center" data-testid="pdi-library-total">
          {importState?.templates_in_library ?? data.total} templates
        </Badge>
        {isAdmin && (
          <>
            <Button size="sm" onClick={() => setUploadOpen(true)} data-testid="pdi-upload-template-btn" className="rounded-sm h-8 gap-1.5">
              <CloudArrowUp size={15} /> Upload New Template
            </Button>
            <Button size="sm" variant="secondary" onClick={startImport} disabled={running} data-testid="pdi-import-btn" className="rounded-sm h-8 gap-1.5">
              {running ? "Importing…" : "Re-import Master PDF"}
            </Button>
          </>
        )}
      </div>

      {running && (
        <div className="border border-primary/30 bg-primary/5 rounded-sm p-3 space-y-2" data-testid="pdi-import-progress">
          <p className="text-xs font-semibold">Gemini OCR import running… {importState.processed}/{importState.total} pages · {importState.imported} imported</p>
          <Progress value={progress} className="h-2 rounded-sm" />
        </div>
      )}

      <div className="border border-border rounded-sm overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {["#", "Part Name", "Item Code", "Drg No", "Mapped Parts", "Customer", "Rows", "Rev", "Status", "Actions"].map((h) => (
                <TableHead key={h} className="text-[10px] uppercase tracking-widest whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((t) => (
              <TableRow key={t.id} className={t.status !== "active" ? "opacity-50" : ""} data-testid={`pdi-template-row-${t.page_number}`}>
                <TableCell className="text-xs font-mono">{t.page_number}</TableCell>
                <TableCell className="text-xs font-semibold">{t.part_name || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{t.item_code || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{t.drg_no || "—"}</TableCell>
                <TableCell className="text-xs max-w-[120px] truncate">{(t.mapped_parts || []).join(", ") || "—"}</TableCell>
                <TableCell className="text-xs max-w-[110px] truncate">{t.customer || "—"}</TableCell>
                <TableCell className="text-xs">{t.rows?.length ?? 0}{(t.pages || 1) > 1 ? ` · ${t.pages}p` : ""}</TableCell>
                <TableCell className="text-xs font-mono">r{t.revision || 1}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${t.status === "active" ? "border-emerald-500/50 text-emerald-500" : "border-border text-muted-foreground"}`}>
                    {t.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-0.5">
                    <button title="Template preview (original / data / live sample)" onClick={() => setPreview(t)} data-testid={`pdi-template-view-${t.page_number}`}
                            className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><Eye size={15} /></button>
                    {isAdmin && (
                      <>
                        <button title="Edit template" onClick={() => setEditing(t)} data-testid={`pdi-template-edit-${t.page_number}`}
                                className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><PencilSimple size={15} /></button>
                        <button title={t.status === "active" ? "Deactivate" : "Activate"} onClick={() => toggleStatus(t)} data-testid={`pdi-template-toggle-${t.page_number}`}
                                className={`p-1.5 transition-colors ${t.status === "active" ? "text-emerald-500 hover:text-red-400" : "text-muted-foreground hover:text-emerald-500"}`}><Power size={15} /></button>
                        <button title="Replace PDF" onClick={() => startReplace(t)} data-testid={`pdi-template-replace-${t.page_number}`}
                                className="p-1.5 text-muted-foreground hover:text-amber-500 transition-colors"><FilePdf size={15} /></button>
                        <button title="Revision history" onClick={() => setRevisions(t)} data-testid={`pdi-template-revisions-${t.page_number}`}
                                className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><ClockCounterClockwise size={15} /></button>
                        <button title="Delete (only if unused)" onClick={() => removeTemplate(t)} data-testid={`pdi-template-delete-${t.page_number}`}
                                className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"><Trash size={15} /></button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {data.items.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-8">
                Library is empty. {isAdmin ? "Upload a template PDF or run the master import." : "Ask an admin to import templates."}
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-sm h-7 text-xs">Prev</Button>
          <span className="text-xs text-muted-foreground">Page {page} / {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-sm h-7 text-xs">Next</Button>
        </div>
      )}

      {preview && <TemplatePreviewDialog template={preview} onClose={() => setPreview(null)} />}
      {editing && <TemplateEditorDialog template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {revisions && <RevisionsDialog template={revisions} onClose={() => setRevisions(null)} />}
      {replacing?.uploadId && (
        <TemplateEditorDialog template={replacing.template}
                              replaceUpload={{ uploadId: replacing.uploadId, pageStart: replacing.pageStart, pageEnd: replacing.pageEnd }}
                              onClose={() => setReplacing(null)}
                              onSaved={() => { setReplacing(null); load(); }} />
      )}
      <UploadTemplateDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onSaved={() => { load(); pollStatus(); }} />
    </div>
  );
}
