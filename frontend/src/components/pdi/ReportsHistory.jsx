import { useEffect, useState, useCallback } from "react";
import { Eye, DownloadSimple, ArrowsClockwise, Trash, MagnifyingGlass } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import PdfPreviewDialog from "./PdfPreviewDialog";

export default function ReportsHistory() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ total: 0, items: [] });
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => {
    api.get("/pdi/reports", { params: { q, status: status === "all" ? "" : status, date_from: dateFrom, date_to: dateTo, page, limit: 25 } })
      .then((r) => setData(r.data)).catch((err) => toast.error(apiError(err)));
  }, [q, status, dateFrom, dateTo, page]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const download = async (rep) => {
    try {
      const r = await api.get(`/pdi/reports/${rep.id}/pdf`, { params: { download: 1 }, responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${rep.report_no}_${rep.item_code}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast.error(apiError(err)); }
  };

  const regenerate = async (rep) => {
    try {
      await api.post(`/pdi/reports/${rep.id}/regenerate`);
      toast.success(`${rep.report_no} regenerated with fresh observations`);
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  const remove = async (rep) => {
    if (!window.confirm(`Delete report ${rep.report_no}?`)) return;
    try {
      await api.delete(`/pdi/reports/${rep.id}`);
      toast.success(`${rep.report_no} deleted`);
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  const pages = Math.max(1, Math.ceil(data.total / 25));

  return (
    <div className="space-y-4" data-testid="pdi-reports-history">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                 placeholder="Search report no, invoice, part, item code, customer, lot no…"
                 data-testid="pdi-reports-search" className="h-8 pl-8 rounded-sm bg-input border-border text-xs" />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-36 rounded-sm bg-input border-border text-xs" data-testid="pdi-reports-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="generated">Generated</SelectItem>
            <SelectItem value="regenerated">Regenerated</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
               data-testid="pdi-reports-date-from" className="h-8 w-36 rounded-sm bg-input border-border text-xs" />
        <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
               data-testid="pdi-reports-date-to" className="h-8 w-36 rounded-sm bg-input border-border text-xs" />
        <Badge variant="outline" className="rounded-sm text-[10px] h-8 px-3 flex items-center" data-testid="pdi-reports-total">{data.total} reports</Badge>
      </div>

      <div className="border border-border rounded-sm overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {["Report No", "Date", "Part Name", "Item Code", "Invoice", "Customer", "Lot No", "Status", "Actions"].map((h) => (
                <TableHead key={h} className="text-[10px] uppercase tracking-widest whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((rep) => (
              <TableRow key={rep.id} data-testid={`pdi-report-row-${rep.report_no}`}>
                <TableCell className="text-xs font-bold whitespace-nowrap">{rep.report_no}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{rep.report_date}</TableCell>
                <TableCell className="text-xs">{rep.part_name}</TableCell>
                <TableCell className="text-xs font-mono">{rep.item_code}</TableCell>
                <TableCell className="text-xs">{rep.invoice_number || "—"}</TableCell>
                <TableCell className="text-xs max-w-[160px] truncate">{rep.customer_name || "—"}</TableCell>
                <TableCell className="text-xs">{rep.lot_no || "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${rep.status === "regenerated" ? "border-amber-500/50 text-amber-500" : "border-primary/40 text-primary"}`}>
                    {rep.status}{rep.regenerated_count ? ` ×${rep.regenerated_count}` : ""}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <button title="Preview / Reprint" onClick={() => setPreview(rep)} data-testid={`pdi-report-preview-${rep.report_no}`}
                            className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><Eye size={15} /></button>
                    <button title="Download" onClick={() => download(rep)} data-testid={`pdi-report-download-${rep.report_no}`}
                            className="p-1.5 text-muted-foreground hover:text-primary transition-colors"><DownloadSimple size={15} /></button>
                    <button title="Regenerate observations" onClick={() => regenerate(rep)} data-testid={`pdi-report-regenerate-${rep.report_no}`}
                            className="p-1.5 text-muted-foreground hover:text-amber-500 transition-colors"><ArrowsClockwise size={15} /></button>
                    {user?.role === "admin" && (
                      <button title="Delete" onClick={() => remove(rep)} data-testid={`pdi-report-delete-${rep.report_no}`}
                              className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"><Trash size={15} /></button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {data.items.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">No PDI reports yet. Generate one from the Generate tab.</TableCell></TableRow>
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
                        title={preview ? `${preview.report_no} · ${preview.part_name}` : ""}
                        pdfUrl={preview ? `/pdi/reports/${preview.id}/pdf` : ""}
                        downloadName={preview ? `${preview.report_no}_${preview.item_code}.pdf` : ""} />
    </div>
  );
}
