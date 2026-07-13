import { useEffect, useState, useCallback } from "react";
import { FileXls, FilePdf, Funnel, ArrowCounterClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

const EMPTY_FILTERS = { invoice: "", part: "", customer: "", date_from: "", date_to: "" };

export default function Reports() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, pages: 1 });

  const activeParams = useCallback((f) => {
    const params = {};
    Object.entries(f).forEach(([k, v]) => {
      if (v) params[k] = v;
    });
    return params;
  }, []);

  const load = useCallback(
    async (f, p = 1) => {
      setLoading(true);
      try {
        const { data } = await api.get("/dispatch", { params: { ...activeParams(f), page: p } });
        setRecords(data.items);
        setPageInfo({ total: data.total, pages: data.pages });
        setPage(data.page);
      } catch (err) {
        toast.error(apiError(err));
      } finally {
        setLoading(false);
      }
    },
    [activeParams]
  );

  useEffect(() => {
    load(EMPTY_FILTERS);
    api.get("/reports/summary").then((r) => setSummary(r.data)).catch(() => {});
  }, [load]);

  const exportFile = async (type) => {
    try {
      const res = await api.get(`/dispatch/export/${type}`, { params: activeParams(filters), responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "excel" ? "dispatch_report.xlsx" : "dispatch_report.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <div className="max-w-7xl space-y-8" data-testid="reports-page">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Analytics</p>
        <h1 className="text-3xl font-black tracking-tight">Reports</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 border border-border rounded-sm overflow-hidden">
        {[
          { label: "Total Dispatches", value: summary?.total_dispatches },
          { label: "This Month", value: summary?.this_month },
          { label: "Customers", value: summary?.unique_customers },
          { label: "PDFs Processed", value: summary?.pdfs_uploaded },
          { label: "Total Value (₹)", value: summary?.total_value?.toLocaleString("en-IN") },
        ].map((s, i) => (
          <div key={s.label} className={`bg-card p-5 ${i < 4 ? "lg:border-r border-border" : ""} ${i % 2 === 0 ? "border-r lg:border-r" : ""} border-b lg:border-b-0 border-border`} data-testid={`report-stat-${i}`}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">{s.label}</p>
            <p className="text-xl font-black font-mono">{s.value ?? "—"}</p>
          </div>
        ))}
      </div>

      <div className="border border-border bg-card rounded-sm p-6 space-y-4" data-testid="report-filters">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
          <Funnel size={14} className="text-primary" /> Search & Filter
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { key: "invoice", label: "Invoice Number" },
            { key: "part", label: "Part Number" },
            { key: "customer", label: "Customer" },
            { key: "date_from", label: "Date From", type: "date" },
            { key: "date_to", label: "Date To", type: "date" },
          ].map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{f.label}</Label>
              <Input
                type={f.type || "text"}
                value={filters[f.key]}
                onChange={set(f.key)}
                data-testid={`filter-${f.key.replace(/_/g, "-")}-input`}
                className="rounded-sm bg-input border-border focus-visible:ring-primary h-9"
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => load(filters)} data-testid="apply-filters-button" className="rounded-sm active:scale-95 transition-transform">
            {loading ? "Searching..." : "Apply Filters"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              load(EMPTY_FILTERS);
            }}
            data-testid="reset-filters-button"
            className="rounded-sm gap-1"
          >
            <ArrowCounterClockwise size={14} /> Reset
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={() => exportFile("excel")} data-testid="report-export-excel-button" className="rounded-sm gap-1">
            <FileXls size={15} /> Export Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => exportFile("pdf")} data-testid="report-export-pdf-button" className="rounded-sm gap-1">
            <FilePdf size={15} /> Export PDF
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-sm overflow-x-auto bg-card">
        <Table data-testid="report-results-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              {["Dispatch ID", "Invoice No", "Invoice Date", "Customer", "PO No", "Part No", "Qty", "Total", "Dispatch Date", "Vendor"].map((h) => (
                <TableHead key={h} className="text-[10px] uppercase tracking-[0.15em] whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-10" data-testid="report-no-results">
                  No records match your filters.
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id} className="border-border hover:bg-secondary/50">
                  <TableCell className="font-mono text-primary text-xs whitespace-nowrap">{r.dispatch_id}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.invoice_number}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.invoice_date}</TableCell>
                  <TableCell className="max-w-[160px] truncate">{r.customer_name}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.po_number}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.part_number}</TableCell>
                  <TableCell>{r.quantity}</TableCell>
                  <TableCell className="font-mono">{r.total_value?.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.dispatch_date}</TableCell>
                  <TableCell className="max-w-[120px] truncate">{r.vendor_name}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3" data-testid="report-pagination">
        <p className="text-xs text-muted-foreground" data-testid="report-record-count">
          {pageInfo.total} record(s) — page {page} of {pageInfo.pages}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => load(filters, page - 1)} data-testid="report-prev-page" className="rounded-sm">
            Previous
          </Button>
          <Button variant="secondary" size="sm" disabled={page >= pageInfo.pages} onClick={() => load(filters, page + 1)} data-testid="report-next-page" className="rounded-sm">
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
