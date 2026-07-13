import { useState } from "react";
import { MagnifyingGlass, FileXls, FilePdf } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { STATUS_OPTIONS } from "@/components/md/MDForm";
import MDRecordsTable from "@/components/md/MDRecordsTable";

const EMPTY_FILTERS = { invoice: "", customer: "", part: "", gstin: "", po: "", eway: "", status: "", date_from: "", date_to: "" };

const FIELDS = [
  { k: "invoice", label: "Invoice Number" },
  { k: "customer", label: "Customer Name" },
  { k: "part", label: "Part Number" },
  { k: "gstin", label: "GSTIN" },
  { k: "po", label: "PO Number" },
  { k: "eway", label: "E-Way Bill Number" },
];

export default function SearchDispatch() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [records, setRecords] = useState(null);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, pages: 1 });
  const [sort, setSort] = useState({ by: "created_at", dir: "desc" });

  const activeParams = (f = filters) => {
    const params = {};
    Object.entries(f).forEach(([k, v]) => v && (params[k] = v));
    return params;
  };

  const search = async (p = 1, s = sort) => {
    try {
      const { data } = await api.get("/master-dispatch", {
        params: { ...activeParams(), page: p, page_size: 25, sort_by: s.by, sort_dir: s.dir },
      });
      setRecords(data.items);
      setPageInfo({ total: data.total, pages: data.pages });
      setPage(data.page);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const toggleSort = (key) => {
    const next = { by: key, dir: sort.by === key && sort.dir === "desc" ? "asc" : "desc" };
    setSort(next);
    if (records) search(1, next);
  };

  const exportFile = async (type) => {
    try {
      const res = await api.get(`/master-dispatch/export/${type}`, { params: activeParams(), responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "excel" ? "master_dispatch_search.xlsx" : "master_dispatch_search.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  return (
    <div className="max-w-7xl space-y-6" data-testid="md-search-page">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Master Dispatch</p>
        <h1 className="text-3xl font-black tracking-tight">Search Dispatch</h1>
      </div>

      <div className="border border-border bg-card rounded-sm p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {FIELDS.map((f) => (
            <div key={f.k}>
              <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">{f.label}</label>
              <Input
                value={filters[f.k]}
                onChange={(e) => setFilters({ ...filters, [f.k]: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && search(1)}
                data-testid={`md-search-${f.k}`}
                className="h-9 rounded-sm bg-input border-border focus-visible:ring-primary"
              />
            </div>
          ))}
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              data-testid="md-search-status"
              className="h-9 w-full rounded-sm bg-input border border-border text-sm px-2 focus:outline-none"
            >
              <option value="">Any status</option>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Invoice Date From</label>
            <Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} data-testid="md-search-date-from" className="h-9 rounded-sm bg-input border-border" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Invoice Date To</label>
            <Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} data-testid="md-search-date-to" className="h-9 rounded-sm bg-input border-border" />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => search(1)} data-testid="md-search-button" className="rounded-sm gap-2 active:scale-95 transition-transform">
            <MagnifyingGlass size={16} weight="bold" /> Search
          </Button>
          <Button variant="secondary" onClick={() => { setFilters(EMPTY_FILTERS); setRecords(null); }} data-testid="md-search-reset" className="rounded-sm">
            Reset
          </Button>
          {records && (
            <>
              <Button variant="secondary" size="sm" onClick={() => exportFile("excel")} data-testid="md-search-export-excel" className="rounded-sm gap-1 h-9">
                <FileXls size={15} /> Excel
              </Button>
              <Button variant="secondary" size="sm" onClick={() => exportFile("pdf")} data-testid="md-search-export-pdf" className="rounded-sm gap-1 h-9">
                <FilePdf size={15} /> PDF
              </Button>
            </>
          )}
        </div>
      </div>

      {records && (
        <div className="space-y-4 rise-in">
          <p className="text-sm text-muted-foreground" data-testid="md-search-result-count">
            {pageInfo.total} matching record(s)
          </p>
          <MDRecordsTable
            records={records} sort={sort} onSort={toggleSort} isAdmin={user?.role === "admin"}
            onView={() => toast.info("Open Dispatch List to view/edit full records")}
            onEdit={() => toast.info("Open Dispatch List to view/edit full records")}
            onDuplicate={() => toast.info("Open Dispatch List to duplicate records")}
            onDelete={() => toast.info("Open Dispatch List to delete records")}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => search(page - 1)} data-testid="md-search-prev" className="rounded-sm">Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= pageInfo.pages} onClick={() => search(page + 1)} data-testid="md-search-next" className="rounded-sm">Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
