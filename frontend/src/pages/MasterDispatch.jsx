import { useEffect, useState, useCallback, useRef } from "react";
import {
  FilePdf, UploadSimple, Plus, PencilSimple, Trash, FileXls, FilePdf as FilePdfIcon,
  MagnifyingGlass, FloppyDisk, X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import DispatchEntryForm, { EMPTY_ENTRY, normalizeEntry } from "@/components/DispatchEntryForm";

export default function MasterDispatch() {
  const [records, setRecords] = useState([]);
  const [search, setSearch] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [draftFile, setDraftFile] = useState("");
  const [saving, setSaving] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState(EMPTY_ENTRY);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, pages: 1 });
  const fileRef = useRef(null);

  const loadRecords = useCallback(async (q = "", p = 1) => {
    try {
      const { data } = await api.get("/dispatch", { params: { page: p, ...(q ? { search: q } : {}) } });
      setRecords(data.items);
      setPageInfo({ total: data.total, pages: data.pages });
      setPage(data.page);
    } catch (err) {
      toast.error(apiError(err));
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are allowed");
      return;
    }
    setExtracting(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/dispatch/extract", fd, { timeout: 120000 });
      setDrafts(data.entries);
      setDraftFile(data.filename);
      toast.success(`Extracted ${data.entries.length} item(s) from ${data.filename}. Review and save.`);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveDrafts = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/dispatch/bulk", { entries: drafts.map(normalizeEntry) });
      toast.success(`Saved ${data.count} dispatch entries (${data.created.join(", ")})`);
      setDrafts([]);
      setDraftFile("");
      loadRecords();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const saveManual = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/dispatch", normalizeEntry(manualEntry));
      toast.success(`Created ${data.dispatch_id}`);
      setManualOpen(false);
      setManualEntry(EMPTY_ENTRY);
      loadRecords();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const { id, dispatch_id, created_by, created_at, updated_at, ...payload } = editEntry;
      await api.put(`/dispatch/${id}`, normalizeEntry(payload));
      toast.success(`Updated ${dispatch_id}`);
      setEditEntry(null);
      loadRecords(search, page);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/dispatch/${deleteId}`);
      toast.success("Entry deleted");
      setDeleteId(null);
      loadRecords(search, page);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const exportFile = async (type) => {
    try {
      const res = await api.get(`/dispatch/export/${type}`, {
        params: search ? { search } : {},
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "excel" ? "dispatch_entries.xlsx" : "dispatch_report.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  return (
    <div className="max-w-7xl space-y-8" data-testid="master-dispatch-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Central Module</p>
          <h1 className="text-3xl font-black tracking-tight">Master Dispatch Entry</h1>
        </div>
        <Button
          onClick={() => setManualOpen(true)}
          variant="secondary"
          data-testid="manual-entry-button"
          className="rounded-sm gap-2 active:scale-95 transition-transform w-fit"
        >
          <Plus size={16} weight="bold" /> Manual Entry
        </Button>
      </div>

      <div
        className="border-2 border-dashed border-border hover:border-primary/50 bg-card rounded-sm p-10 text-center transition-colors cursor-pointer"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFile(e.dataTransfer.files?.[0]);
        }}
        data-testid="pdf-upload-zone"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          className="hidden"
          data-testid="pdf-file-input"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {extracting ? (
          <div className="flex flex-col items-center gap-3" data-testid="extracting-indicator">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">AI is reading your invoice… this can take up to a minute.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 bg-primary/15 flex items-center justify-center rounded-sm">
              <FilePdf size={30} weight="duotone" className="text-primary" />
            </div>
            <p className="font-bold">Upload Invoice PDF</p>
            <p className="text-sm text-muted-foreground">
              Drop your invoice here or click to browse. AI will extract all dispatch fields automatically.
            </p>
            <Button size="sm" className="rounded-sm gap-2 mt-2 pointer-events-none">
              <UploadSimple size={16} weight="bold" /> Choose PDF
            </Button>
          </div>
        )}
      </div>

      {drafts.length > 0 && (
        <div className="border border-primary/40 bg-card rounded-sm p-6 space-y-6 rise-in" data-testid="extraction-review-section">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-bold text-lg">Review Extracted Data</h2>
              <p className="text-sm text-muted-foreground">
                From <span className="text-primary font-mono">{draftFile}</span> — edit before saving.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDrafts([])} data-testid="discard-drafts-button" className="rounded-sm gap-1">
                <X size={14} /> Discard
              </Button>
              <Button size="sm" onClick={saveDrafts} disabled={saving} data-testid="save-drafts-button" className="rounded-sm gap-1 active:scale-95 transition-transform">
                <FloppyDisk size={14} weight="bold" /> {saving ? "Saving..." : `Save ${drafts.length} Entr${drafts.length > 1 ? "ies" : "y"}`}
              </Button>
            </div>
          </div>
          {drafts.map((d, i) => (
            <div key={i} className="border border-border rounded-sm p-5 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="rounded-sm text-[10px] uppercase tracking-widest border-primary/40 text-primary">
                  Item {i + 1}
                </Badge>
                {drafts.length > 1 && (
                  <button
                    onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-red-400 transition-colors"
                    data-testid={`remove-draft-${i}`}
                    aria-label="Remove item"
                  >
                    <Trash size={16} />
                  </button>
                )}
              </div>
              <DispatchEntryForm entry={d} onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? v : x)))} idPrefix={`draft-${i}`} />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <h2 className="font-bold text-lg">Dispatch Records</h2>
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadRecords(search)}
                placeholder="Search invoice, part, customer…"
                data-testid="dispatch-search-input"
                className="pl-9 h-9 w-64 rounded-sm bg-input border-border focus-visible:ring-primary"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={() => loadRecords(search)} data-testid="dispatch-search-button" className="rounded-sm">
              Search
            </Button>
            <Button variant="secondary" size="sm" onClick={() => exportFile("excel")} data-testid="export-excel-button" className="rounded-sm gap-1">
              <FileXls size={15} /> Excel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => exportFile("pdf")} data-testid="export-pdf-button" className="rounded-sm gap-1">
              <FilePdfIcon size={15} /> PDF
            </Button>
          </div>
        </div>

        <div className="border border-border rounded-sm overflow-x-auto bg-card">
          <Table data-testid="dispatch-records-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                {["Dispatch ID", "Invoice No", "Date", "Customer", "Part No", "Qty", "Rate", "Total", "Vendor", "Actions"].map((h) => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-[0.15em] whitespace-nowrap">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-10" data-testid="no-records-message">
                    No dispatch records yet. Upload an invoice PDF or create a manual entry.
                  </TableCell>
                </TableRow>
              ) : (
                records.map((r) => (
                  <TableRow key={r.id} className="border-border hover:bg-secondary/50" data-testid={`dispatch-row-${r.dispatch_id}`}>
                    <TableCell className="font-mono text-primary text-xs whitespace-nowrap">{r.dispatch_id}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.invoice_number}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.invoice_date}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{r.customer_name}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.part_number}</TableCell>
                    <TableCell>{r.quantity}</TableCell>
                    <TableCell>{r.rate}</TableCell>
                    <TableCell className="font-mono">{r.total_value?.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="max-w-[120px] truncate">{r.vendor_name}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditEntry(r)}
                          className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                          data-testid={`edit-entry-${r.dispatch_id}`}
                          aria-label="Edit"
                        >
                          <PencilSimple size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteId(r.id)}
                          className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                          data-testid={`delete-entry-${r.dispatch_id}`}
                          aria-label="Delete"
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3" data-testid="dispatch-pagination">
          <p className="text-xs text-muted-foreground" data-testid="dispatch-total-count">
            {pageInfo.total} record(s) — page {page} of {pageInfo.pages}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => loadRecords(search, page - 1)} data-testid="dispatch-prev-page" className="rounded-sm">
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= pageInfo.pages} onClick={() => loadRecords(search, page + 1)} data-testid="dispatch-next-page" className="rounded-sm">
              Next
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-card border-border" data-testid="manual-entry-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">New Dispatch Entry</DialogTitle>
            <DialogDescription>Fill in the dispatch details manually.</DialogDescription>
          </DialogHeader>
          <DispatchEntryForm entry={manualEntry} onChange={setManualEntry} idPrefix="manual" />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" onClick={() => setManualOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={saveManual} disabled={saving} data-testid="manual-save-button" className="rounded-sm active:scale-95 transition-transform">
              {saving ? "Saving..." : "Save Entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editEntry} onOpenChange={(o) => !o && setEditEntry(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-card border-border" data-testid="edit-entry-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Edit <span className="text-primary font-mono">{editEntry?.dispatch_id}</span>
            </DialogTitle>
            <DialogDescription>Update the dispatch record fields below.</DialogDescription>
          </DialogHeader>
          {editEntry && <DispatchEntryForm entry={editEntry} onChange={setEditEntry} idPrefix="edit" />}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" onClick={() => setEditEntry(null)} className="rounded-sm">Cancel</Button>
            <Button onClick={saveEdit} disabled={saving} data-testid="edit-save-button" className="rounded-sm active:scale-95 transition-transform">
              {saving ? "Saving..." : "Update Entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="bg-card border-border" data-testid="delete-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this dispatch entry?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The record will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-sm">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid="confirm-delete-button" className="rounded-sm bg-red-600 hover:bg-red-500 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
