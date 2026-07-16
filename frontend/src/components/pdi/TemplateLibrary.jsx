import { useEffect, useState, useCallback, useRef } from "react";
import { MagnifyingGlass, CloudArrowUp, Eye, PencilSimple, Power, ClockCounterClockwise, FilePdf, Trash, Copy, Export, DownloadSimple, ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import TemplateEditorDialog from "./TemplateEditorDialog";
import TemplatePreviewDialog from "./TemplatePreviewDialog";
import UploadTemplateDialog from "./UploadTemplateDialog";
import RevisionsDialog from "./RevisionsDialog";

const fmt = (iso) => (iso || "").slice(0, 10).split("-").reverse().join(".");

export default function TemplateLibrary() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ total: 0, items: [] });
  const [importState, setImportState] = useState(null);
  const [reocrState, setReocrState] = useState(null);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [revisions, setRevisions] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replacing, setReplacing] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const replaceFileRef = useRef(null);
  const importFileRef = useRef(null);
  const pollRef = useRef(null);
  const reocrPollRef = useRef(null);

  const load = useCallback(() => {
    api.get("/pdi/templates", { params: { q, status: statusFilter === "all" ? "" : statusFilter, page, limit: 25 } })
      .then((r) => setData(r.data)).catch((err) => toast.error(apiError(err)));
  }, [q, statusFilter, page]);

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

  const pollReocr = useCallback(() => {
    api.get("/pdi/templates/reocr-status").then((r) => {
      setReocrState(r.data);
      if (!r.data.running && reocrPollRef.current) {
        clearInterval(reocrPollRef.current);
        reocrPollRef.current = null;
        load();
        if (r.data.finished_at) toast.success(`Re-OCR finished: ${r.data.updated}/${r.data.total} updated${r.data.errors?.length ? `, ${r.data.errors.length} errors` : ""}`);
      }
    }).catch(() => {});
  }, [load]);

  useEffect(() => {
    pollStatus();
    api.get("/pdi/templates/reocr-status").then((r) => {
      setReocrState(r.data);
      if (r.data.running) reocrPollRef.current = setInterval(pollReocr, 3000);
    }).catch(() => {});
    return () => { pollRef.current && clearInterval(pollRef.current); reocrPollRef.current && clearInterval(reocrPollRef.current); };
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
    if (t.status === "active") {
      if (!window.confirm(`Deactivate template "${t.part_name}"? (Safe default — it stays restorable. Permanent delete is offered on inactive, unused templates.)`)) return;
      return toggleStatus(t);
    }
    if (!window.confirm(`Permanently delete "${t.part_name}"? Only possible if no reports were generated from it. This cannot be undone.`)) return;
    try {
      await api.delete(`/pdi/templates/${t.id}`);
      toast.success("Template permanently deleted");
      load();
      pollStatus();
    } catch (err) { toast.error(apiError(err)); }
  };

  const duplicateTemplate = async (t) => {
    try {
      const r = await api.post(`/pdi/templates/${t.id}/duplicate`);
      toast.success(`Duplicated as "${r.data.part_name}" — set its item code via Edit`);
      load();
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

  // ---- Selection & bulk ----
  const toggleSelect = (id) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const pageIds = data.items.map((t) => t.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleSelectAll = () => setSelected((s) => {
    const n = new Set(s);
    allPageSelected ? pageIds.forEach((id) => n.delete(id)) : pageIds.forEach((id) => n.add(id));
    return n;
  });

  const bulk = async (action) => {
    const label = { activate: "activate", deactivate: "deactivate", delete: "delete" }[action];
    if (!window.confirm(`${label[0].toUpperCase() + label.slice(1)} ${selected.size} selected template(s)?${action === "delete" ? " Templates used by reports will be deactivated instead of deleted." : ""}`)) return;
    setBulkBusy(true);
    try {
      const r = await api.post("/pdi/templates/bulk", { action, ids: [...selected] });
      const d = r.data;
      toast.success(`Done — ${d.activated || 0} activated, ${d.deactivated || 0} deactivated, ${d.deleted || 0} deleted${d.skipped ? `, ${d.skipped} skipped` : ""}`);
      setSelected(new Set());
      load();
      pollStatus();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBulkBusy(false); }
  };

  const bulkReocr = async () => {
    if (!window.confirm(`Re-run Gemini OCR on ${selected.size} template(s)? Each gets a new revision with freshly extracted rows.`)) return;
    try {
      await api.post("/pdi/templates/bulk-reocr", { ids: [...selected] });
      toast.success("Bulk re-OCR started");
      setSelected(new Set());
      reocrPollRef.current = setInterval(pollReocr, 3000);
    } catch (err) { toast.error(apiError(err)); }
  };

  const exportLibrary = async (idsOnly = false) => {
    setExporting(true);
    try {
      const params = idsOnly ? { ids: [...selected].join(",") } : {};
      const r = await api.get("/pdi/templates/export", { params, responseType: "blob", timeout: 300000 });
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url; a.download = `pdi_template_library_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${idsOnly ? selected.size : data.total} template(s) with PDFs`);
      if (idsOnly) setSelected(new Set());
    } catch (err) { toast.error(apiError(err)); }
    finally { setExporting(false); }
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/pdi/templates/import", fd, { timeout: 300000 });
      const d = r.data;
      toast.success(`Import complete — ${d.imported} new, ${d.updated} updated (merged), ${d.skipped} skipped`);
      if (d.errors?.length) toast.warning(`${d.errors.length} warning(s): ${d.errors[0]}`);
      load();
      pollStatus();
    } catch (err) { toast.error(apiError(err)); }
    finally { setImporting(false); }
  };

  const running = importState?.running;
  const progress = importState?.total ? Math.round((importState.processed / importState.total) * 100) : 0;
  const reocrRunning = reocrState?.running;
  const reocrProgress = reocrState?.total ? Math.round((reocrState.processed / reocrState.total) * 100) : 0;
  const pages = Math.max(1, Math.ceil(data.total / 25));

  return (
    <div className="space-y-4" data-testid="pdi-template-library">
      <input ref={replaceFileRef} type="file" accept="application/pdf" className="hidden" onChange={onReplaceFile} />
      <input ref={importFileRef} type="file" accept=".zip" className="hidden" onChange={onImportFile} data-testid="pdi-import-library-input" />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                 placeholder="Search part name, item code, drawing no, mapped part or customer…"
                 data-testid="pdi-library-search" className="h-8 pl-8 rounded-sm bg-input border-border text-xs" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-28 rounded-sm bg-input border-border text-xs" data-testid="pdi-library-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="rounded-sm text-[10px] h-8 px-3 flex items-center" data-testid="pdi-library-total">
          {data.total} templates
        </Badge>
        {isAdmin && (
          <>
            <Button size="sm" onClick={() => setUploadOpen(true)} data-testid="pdi-upload-template-btn" className="rounded-sm h-8 gap-1.5">
              <CloudArrowUp size={15} /> Upload New Template
            </Button>
            <Button size="sm" variant="secondary" onClick={() => exportLibrary(false)} disabled={exporting} data-testid="pdi-export-library-btn" className="rounded-sm h-8 gap-1.5">
              <Export size={15} /> {exporting ? "Preparing…" : "Export All"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => importFileRef.current?.click()} disabled={importing} data-testid="pdi-import-library-btn" className="rounded-sm h-8 gap-1.5">
              <DownloadSimple size={15} /> {importing ? "Importing…" : "Import"}
            </Button>
            <Button size="sm" variant="secondary" onClick={startImport} disabled={running} data-testid="pdi-import-btn" className="rounded-sm h-8 gap-1.5">
              {running ? "Importing…" : "Re-import Master PDF"}
            </Button>
          </>
        )}
      </div>

      {isAdmin && selected.size > 0 && (
        <div className="border border-primary/30 bg-primary/5 rounded-sm p-2.5 flex flex-wrap items-center gap-2" data-testid="pdi-bulk-toolbar">
          <span className="text-xs font-semibold px-1">{selected.size} selected</span>
          <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => bulk("activate")} data-testid="pdi-bulk-activate" className="rounded-sm h-7 text-xs gap-1"><Power size={12} /> Activate</Button>
          <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => bulk("deactivate")} data-testid="pdi-bulk-deactivate" className="rounded-sm h-7 text-xs gap-1"><Power size={12} /> Deactivate</Button>
          <Button size="sm" variant="secondary" disabled={bulkBusy || reocrRunning} onClick={bulkReocr} data-testid="pdi-bulk-reocr" className="rounded-sm h-7 text-xs gap-1"><ArrowsClockwise size={12} /> Re-run OCR</Button>
          <Button size="sm" variant="secondary" disabled={exporting} onClick={() => exportLibrary(true)} data-testid="pdi-bulk-export" className="rounded-sm h-7 text-xs gap-1"><Export size={12} /> Export Selected</Button>
          <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => bulk("delete")} data-testid="pdi-bulk-delete" className="rounded-sm h-7 text-xs gap-1 text-red-400"><Trash size={12} /> Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="rounded-sm h-7 text-xs">Clear</Button>
        </div>
      )}

      {running && (
        <div className="border border-primary/30 bg-primary/5 rounded-sm p-3 space-y-2" data-testid="pdi-import-progress">
          <p className="text-xs font-semibold">Gemini OCR import running… {importState.processed}/{importState.total} pages · {importState.imported} imported</p>
          <Progress value={progress} className="h-2 rounded-sm" />
        </div>
      )}
      {reocrRunning && (
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-sm p-3 space-y-2" data-testid="pdi-reocr-progress">
          <p className="text-xs font-semibold">Bulk re-OCR running… {reocrState.processed}/{reocrState.total} templates · {reocrState.updated} updated</p>
          <Progress value={reocrProgress} className="h-2 rounded-sm" />
        </div>
      )}

      <div className="border border-border rounded-sm overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin && (
                <TableHead className="w-8">
                  <Checkbox checked={allPageSelected} onCheckedChange={toggleSelectAll} data-testid="pdi-select-all" className="rounded-sm" />
                </TableHead>
              )}
              {["#", "Part Name", "Item Code", "Drg No", "Rows", "Rev", "Status", "Created", "Updated", "Actions"].map((h) => (
                <TableHead key={h} className="text-[10px] uppercase tracking-widest whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((t) => (
              <TableRow key={t.id} className={t.status !== "active" ? "opacity-50" : ""} data-testid={`pdi-template-row-${t.page_number}`}>
                {isAdmin && (
                  <TableCell>
                    <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSelect(t.id)}
                              data-testid={`pdi-select-${t.page_number}`} className="rounded-sm" />
                  </TableCell>
                )}
                <TableCell className="text-xs font-mono">{t.page_number}</TableCell>
                <TableCell className="text-xs font-semibold max-w-[180px] truncate" title={`${t.part_name}${t.mapped_parts?.length ? ` · mapped: ${t.mapped_parts.join(", ")}` : ""}${t.customer ? ` · ${t.customer}` : ""}`}>{t.part_name || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{t.item_code || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{t.drg_no || "—"}</TableCell>
                <TableCell className="text-xs">{t.rows?.length ?? 0}{(t.pages || 1) > 1 ? ` · ${t.pages}p` : ""}</TableCell>
                <TableCell className="text-xs font-mono">r{t.revision || 1}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${t.status === "active" ? "border-emerald-500/50 text-emerald-500" : "border-border text-muted-foreground"}`}>
                    {t.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap" title={t.created_by ? `by ${t.created_by}` : ""}>{fmt(t.created_at)}</TableCell>
                <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap" title={t.updated_by ? `by ${t.updated_by}` : ""}>{fmt(t.updated_at)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-0.5">
                    <button title="Template preview (original / data / live sample)" onClick={() => setPreview(t)} data-testid={`pdi-template-view-${t.page_number}`}
                            className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><Eye size={15} /></button>
                    {isAdmin && (
                      <>
                        <button title="Edit template" onClick={() => setEditing(t)} data-testid={`pdi-template-edit-${t.page_number}`}
                                className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><PencilSimple size={15} /></button>
                        <button title="Duplicate template" onClick={() => duplicateTemplate(t)} data-testid={`pdi-template-duplicate-${t.page_number}`}
                                className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><Copy size={15} /></button>
                        <button title={t.status === "active" ? "Deactivate" : "Activate"} onClick={() => toggleStatus(t)} data-testid={`pdi-template-toggle-${t.page_number}`}
                                className={`p-1.5 transition-colors ${t.status === "active" ? "text-emerald-500 hover:text-red-400" : "text-muted-foreground hover:text-emerald-500"}`}><Power size={15} /></button>
                        <button title="Replace PDF" onClick={() => startReplace(t)} data-testid={`pdi-template-replace-${t.page_number}`}
                                className="p-1.5 text-muted-foreground hover:text-amber-500 transition-colors"><FilePdf size={15} /></button>
                        <button title="Revision history / rollback" onClick={() => setRevisions(t)} data-testid={`pdi-template-revisions-${t.page_number}`}
                                className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><ClockCounterClockwise size={15} /></button>
                        <button title={t.status === "active" ? "Deactivate (safe delete)" : "Delete permanently (only if unused)"} onClick={() => removeTemplate(t)} data-testid={`pdi-template-delete-${t.page_number}`}
                                className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"><Trash size={15} /></button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {data.items.length === 0 && (
              <TableRow><TableCell colSpan={isAdmin ? 11 : 10} className="text-center text-xs text-muted-foreground py-8">
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
      {revisions && <RevisionsDialog template={revisions} onClose={() => setRevisions(null)} onRestored={load} />}
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
