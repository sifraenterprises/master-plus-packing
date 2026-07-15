import { useEffect, useState, useCallback, useRef } from "react";
import { MagnifyingGlass, CloudArrowUp, Eye, PencilSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import PdfPreviewDialog from "./PdfPreviewDialog";
import TemplateEditorDialog from "./TemplateEditorDialog";

export default function TemplateLibrary() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ total: 0, items: [] });
  const [importState, setImportState] = useState(null);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);
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
    if (!window.confirm("Run OCR import of the 120-page PDI master PDF via Gemini? Existing templates for the same pages will be refreshed.")) return;
    try {
      await api.post("/pdi/import-master");
      toast.success("Import started — extracting templates with Gemini OCR");
      pollRef.current = setInterval(pollStatus, 3000);
    } catch (err) { toast.error(apiError(err)); }
  };

  const running = importState?.running;
  const progress = importState?.total ? Math.round((importState.processed / importState.total) * 100) : 0;
  const pages = Math.max(1, Math.ceil(data.total / 25));

  return (
    <div className="space-y-4" data-testid="pdi-template-library">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                 placeholder="Search part name, item code or drawing no…"
                 data-testid="pdi-library-search" className="h-8 pl-8 rounded-sm bg-input border-border text-xs" />
        </div>
        <Badge variant="outline" className="rounded-sm text-[10px] h-8 px-3 flex items-center" data-testid="pdi-library-total">
          {importState?.templates_in_library ?? data.total} templates
        </Badge>
        {user?.role === "admin" && (
          <Button size="sm" onClick={startImport} disabled={running} data-testid="pdi-import-btn" className="rounded-sm h-8 gap-1.5">
            <CloudArrowUp size={15} /> {running ? "Importing…" : "Import Master PDF (OCR)"}
          </Button>
        )}
      </div>

      {running && (
        <div className="border border-primary/30 bg-primary/5 rounded-sm p-3 space-y-2" data-testid="pdi-import-progress">
          <p className="text-xs font-semibold">Gemini OCR import running… {importState.processed}/{importState.total} pages · {importState.imported} imported</p>
          <Progress value={progress} className="h-2 rounded-sm" />
        </div>
      )}
      {!running && importState?.errors?.length > 0 && (
        <div className="border border-amber-500/40 bg-amber-500/5 rounded-sm p-3">
          <p className="text-xs font-semibold text-amber-500 mb-1">Import warnings ({importState.errors.length})</p>
          {importState.errors.slice(0, 5).map((e, i) => <p key={i} className="text-[11px] text-muted-foreground">{e}</p>)}
        </div>
      )}

      <div className="border border-border rounded-sm overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {["Page", "Part Name", "Item Code", "Drg No", "Dimensions", "Updated", "Actions"].map((h) => (
                <TableHead key={h} className="text-[10px] uppercase tracking-widest whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((t) => (
              <TableRow key={t.id} data-testid={`pdi-template-row-${t.page_number}`}>
                <TableCell className="text-xs font-mono">{t.page_number}</TableCell>
                <TableCell className="text-xs font-semibold">{t.part_name || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{t.item_code || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{t.drg_no || "—"}</TableCell>
                <TableCell className="text-xs">{t.rows?.length ?? 0} rows</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{(t.updated_at || "").slice(0, 10)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <button title="View original page" onClick={() => setPreview(t)} data-testid={`pdi-template-view-${t.page_number}`}
                            className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><Eye size={15} /></button>
                    {user?.role === "admin" && (
                      <button title="Edit template" onClick={() => setEditing(t)} data-testid={`pdi-template-edit-${t.page_number}`}
                              className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><PencilSimple size={15} /></button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {data.items.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">
                Library is empty. {user?.role === "admin" ? "Click “Import Master PDF (OCR)” to extract all 120 templates." : "Ask an admin to run the master import."}
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

      <PdfPreviewDialog open={!!preview} onClose={() => setPreview(null)}
                        title={preview ? `Original template — ${preview.part_name} (page ${preview.page_number})` : ""}
                        pdfUrl={preview ? `/pdi/templates/${preview.id}/source.pdf` : ""}
                        downloadName={preview ? `pdi_template_p${preview.page_number}.pdf` : ""} />
      <TemplateEditorDialog template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </div>
  );
}
