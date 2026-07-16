import { useEffect, useState, useCallback } from "react";
import { MagnifyingGlass, FileXls, FilePdf, FloppyDisk } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import MDForm, { STATUS_OPTIONS, normalizeMD, formatEway } from "@/components/md/MDForm";
import MDRecordsTable, { STATUS_LABELS, STATUS_STYLES } from "@/components/md/MDRecordsTable";
import MDStats from "@/components/md/MDStats";
import PdiPanel from "@/components/md/PdiPanel";

export default function DispatchList() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [records, setRecords] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "", date_from: "", date_to: "" });
  const [sort, setSort] = useState({ by: "created_at", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, pages: 1 });
  const [pageSize, setPageSize] = useState(25);
  const [viewRec, setViewRec] = useState(null);
  const [editRec, setEditRec] = useState(null);
  const [deleteRec, setDeleteRec] = useState(null);
  const [pdiRec, setPdiRec] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (p = 1, f = filters, s = sort, ps = pageSize) => {
    try {
      const params = { page: p, page_size: ps, sort_by: s.by, sort_dir: s.dir };
      Object.entries(f).forEach(([k, v]) => v && (params[k] = v));
      const { data } = await api.get("/master-dispatch", { params });
      setRecords(data.items);
      setPageInfo({ total: data.total, pages: data.pages });
      setPage(data.page);
    } catch (err) {
      toast.error(apiError(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, pageSize]);

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, pageSize]);

  const toggleSort = (key) =>
    setSort((s) => ({ by: key, dir: s.by === key && s.dir === "desc" ? "asc" : "desc" }));

  const saveEdit = async () => {
    setSaving(true);
    try {
      await api.put(`/master-dispatch/${editRec.id}`, { ...normalizeMD(editRec), verified: true });
      toast.success(`Updated ${editRec.dispatch_no}`);
      setEditRec(null);
      load(page);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (r) => {
    try {
      const { data } = await api.post(`/master-dispatch/${r.id}/duplicate`);
      toast.success(`Duplicated as ${data.dispatch_no}`);
      load(page);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/master-dispatch/${deleteRec.id}`);
      toast.success(`${deleteRec.dispatch_no} deleted`);
      setDeleteRec(null);
      load(page);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const exportFile = async (type) => {
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => v && (params[k] = v));
      const res = await api.get(`/master-dispatch/export/${type}`, { params, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "excel" ? "master_dispatch.xlsx" : "master_dispatch_report.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  const viewPdf = async (r) => {
    const fid = r.split_file_id || r.source_file_id;
    if (!fid) {
      toast.error("No PDF stored for this record");
      return;
    }
    try {
      const res = await api.get(`/master-dispatch/files/${fid}`, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
    } catch (err) {
      toast.error("Could not load PDF");
    }
  };

  return (
    <div className="max-w-7xl space-y-6" data-testid="md-list-page">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Master Dispatch</p>
        <h1 className="text-3xl font-black tracking-tight">Dispatch List</h1>
      </div>

      <MDStats refreshKey={refreshKey} />

      <div className="flex flex-wrap gap-2 items-end">
        <div className="relative">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && load(1)}
            placeholder="Search invoice, customer, part, e-way…"
            data-testid="md-list-search"
            className="pl-9 h-9 w-64 rounded-sm bg-input border-border focus-visible:ring-primary"
          />
        </div>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          data-testid="md-list-status-filter"
          className="h-9 rounded-sm bg-input border border-border text-sm px-2 focus:outline-none"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} data-testid="md-list-date-from" className="h-9 w-36 rounded-sm bg-input border-border" />
        <Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} data-testid="md-list-date-to" className="h-9 w-36 rounded-sm bg-input border-border" />
        <Button variant="secondary" size="sm" onClick={() => load(1)} data-testid="md-list-apply-filters" className="rounded-sm h-9">Apply</Button>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => exportFile("excel")} data-testid="md-export-excel" className="rounded-sm gap-1 h-9">
          <FileXls size={15} /> Excel
        </Button>
        <Button variant="secondary" size="sm" onClick={() => exportFile("pdf")} data-testid="md-export-pdf" className="rounded-sm gap-1 h-9">
          <FilePdf size={15} /> PDF
        </Button>
      </div>

      <MDRecordsTable
        records={records} sort={sort} onSort={toggleSort} isAdmin={isAdmin}
        onView={setViewRec} onEdit={setEditRec} onDuplicate={duplicate} onDelete={setDeleteRec}
        onPdi={setPdiRec}
      />

      <div className="flex items-center justify-between flex-wrap gap-3" data-testid="md-list-pagination">
        <p className="text-xs text-muted-foreground" data-testid="md-list-total">
          {pageInfo.total} record(s) — page {page} of {pageInfo.pages}
        </p>
        <div className="flex gap-2 items-center">
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} data-testid="md-list-page-size" className="h-8 rounded-sm bg-input border border-border text-xs px-2">
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => load(page - 1)} data-testid="md-list-prev" className="rounded-sm">Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= pageInfo.pages} onClick={() => load(page + 1)} data-testid="md-list-next" className="rounded-sm">Next</Button>
        </div>
      </div>

      <Dialog open={!!viewRec} onOpenChange={(o) => !o && setViewRec(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-card border-border" data-testid="md-view-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              <span className="text-primary font-mono">{viewRec?.dispatch_no}</span> — {viewRec?.invoice_number}
            </DialogTitle>
            <DialogDescription>
              Created by {viewRec?.created_by} on {viewRec?.created_at?.slice(0, 10)}
            </DialogDescription>
          </DialogHeader>
          {viewRec && (
            <Badge variant="outline" className={`rounded-sm text-[9px] uppercase w-fit ${STATUS_STYLES[viewRec.status] || ""}`}>
              {STATUS_LABELS[viewRec.status] || viewRec.status}
            </Badge>
          )}
          {viewRec && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                {[
                  ["Customer", viewRec.customer_name], ["Customer Code", viewRec.customer_code], ["GSTIN", viewRec.gstin],
                  ["Invoice Date", viewRec.invoice_date], ["PO Number", viewRec.po_number], ["PO Date", viewRec.po_date],
                  ["Boxes", viewRec.boxes], ["Gross Wt", viewRec.gross_weight], ["Net Wt", viewRec.net_weight],
                  ["Vehicle", viewRec.vehicle_number], ["LR No", viewRec.lr_number], ["Transporter", viewRec.transporter_name],
                  ["CGST", viewRec.cgst], ["SGST", viewRec.sgst], ["IGST", viewRec.igst],
                  ["GST Total", viewRec.gst_total], ["Invoice Total", `₹ ${viewRec.invoice_total?.toLocaleString("en-IN")}`],
                  ["E-Way Bill", formatEway(viewRec.eway_bill_number) || viewRec.eway_bill_number], ["IRN", viewRec.irn], ["ACK No", viewRec.ack_number],
                ].map(([label, val]) => (
                  <div key={label}>
                    <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
                    <p className="font-medium break-all">{val || "—"}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-primary mb-2">Items ({viewRec.items?.length || 0})</p>
                <div className="border border-border rounded-sm divide-y divide-border">
                  {viewRec.items?.map((it, i) => (
                    <div key={i} className="p-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                      <span className="font-mono text-primary">{it.part_number}</span>
                      <span className="flex-1 min-w-[120px]">{it.description}</span>
                      <span>HSN {it.hsn}</span>
                      <span>{it.quantity} {it.unit}</span>
                      <span>@ {it.rate}</span>
                      <span className="font-mono">₹ {it.amount?.toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {(viewRec.split_file_id || viewRec.source_file_id) && (
                  <Button variant="secondary" size="sm" onClick={() => viewPdf(viewRec)} data-testid="md-view-pdf" className="rounded-sm gap-1">
                    <FilePdf size={14} /> View Invoice PDF
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editRec} onOpenChange={(o) => !o && setEditRec(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-card border-border" data-testid="md-edit-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Edit <span className="text-primary font-mono">{editRec?.dispatch_no}</span>
            </DialogTitle>
            <DialogDescription>Update the master dispatch record. Saving marks it verified.</DialogDescription>
          </DialogHeader>
          {editRec && <MDForm entry={editRec} onChange={setEditRec} idPrefix="md-edit" />}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" onClick={() => setEditRec(null)} className="rounded-sm">Cancel</Button>
            <Button onClick={saveEdit} disabled={saving} data-testid="md-edit-save" className="rounded-sm gap-1 active:scale-95 transition-transform">
              <FloppyDisk size={14} weight="bold" /> {saving ? "Saving…" : "Update Record"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {pdiRec && (
        <PdiPanel record={pdiRec} onClose={() => setPdiRec(null)}
                  onChanged={async () => {
                    await load(page);
                    try {
                      const { data } = await api.get(`/master-dispatch/${pdiRec.id}`);
                      setPdiRec(data);
                    } catch { setPdiRec(null); }
                  }} />
      )}

      <AlertDialog open={!!deleteRec} onOpenChange={(o) => !o && setDeleteRec(null)}>
        <AlertDialogContent className="bg-card border-border" data-testid="md-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteRec?.dispatch_no}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The master dispatch record will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-sm">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid="md-confirm-delete" className="rounded-sm bg-red-600 hover:bg-red-500 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
