import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { EMPTY_FILTERS, DEFAULT_VISIBLE, COLUMNS, downloadBlob } from "@/components/reports/reportConfig";
import { KpiCards } from "@/components/reports/KpiCards";
import { AdvancedFilters } from "@/components/reports/AdvancedFilters";
import { QuickReports } from "@/components/reports/QuickReports";
import { ReportTable } from "@/components/reports/ReportTable";
import { ReportCharts } from "@/components/reports/ReportCharts";
import { WorkflowDialog } from "@/components/reports/WorkflowDialog";

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  #erp-report-print, #erp-report-print * { visibility: visible !important; }
  #erp-report-print { position: absolute !important; left: 0; top: 0; width: 100%; max-height: none !important; overflow: visible !important; border: none !important; background: #fff !important; }
  #erp-report-print table { min-width: 0 !important; width: 100% !important; table-layout: auto !important; }
  #erp-report-print th, #erp-report-print td { color: #000 !important; background: #fff !important; border: 1px solid #000 !important; padding: 3px 5px !important; font-size: 8pt !important; position: static !important; }
  #erp-report-print thead { display: table-header-group; }
  .no-print { display: none !important; }
}`;

export default function Reports() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState({});
  const [charts, setCharts] = useState(null);
  const [views, setViews] = useState([]);
  const [defaultViewId, setDefaultViewId] = useState("");
  const [visibleCols, setVisibleCols] = useState(DEFAULT_VISIBLE);
  const [sort, setSort] = useState({ by: "created_at", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);
  const [drillRec, setDrillRec] = useState(null);
  const booted = useRef(false);

  const activeParams = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v));

  const load = useCallback(async (f = filters, p = 1, s = sort) => {
    setLoading(true);
    try {
      const { data } = await api.get("/reports/erp", {
        params: { ...activeParams(f), page: p, page_size: 25, sort_by: s.by, sort_dir: s.dir },
      });
      setRows(data.items);
      setPageInfo({ total: data.total, pages: data.pages });
      setPage(data.page);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort]);

  const loadMeta = useCallback(() => {
    api.get("/reports/kpis").then((r) => setKpis(r.data)).catch(() => {});
    api.get("/reports/charts").then((r) => setCharts(r.data)).catch(() => {});
  }, []);

  const loadViews = useCallback(async (applyDefault = false) => {
    try {
      const { data } = await api.get("/reports/views");
      setViews(data.views);
      setDefaultViewId(data.default_view_id);
      if (applyDefault && data.default_view_id) {
        const v = data.views.find((x) => x.id === data.default_view_id);
        if (v) {
          applyView(v);
          return true;
        }
      }
    } catch (err) { /* ignore */ }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyView = (v) => {
    const f = { ...EMPTY_FILTERS, ...(v.filters || {}) };
    setFilters(f);
    if (v.columns?.length) setVisibleCols(v.columns.filter((k) => COLUMNS.some((c) => c.k === k)));
    load(f, 1);
    toast.info(`Report view "${v.name}" applied`);
  };

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    loadMeta();
    loadViews(true).then((applied) => { if (!applied) load(EMPTY_FILTERS, 1); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyKpiFilter = (patch) => {
    const f = { ...EMPTY_FILTERS, ...patch };
    setFilters(f);
    load(f, 1);
  };

  const applyQuick = (patch, quickSort) => {
    const f = { ...EMPTY_FILTERS, ...patch };
    const s = quickSort || sort;
    setFilters(f);
    if (quickSort) setSort(quickSort);
    load(f, 1, s);
  };

  const onSort = (key) => {
    const next = { by: key, dir: sort.by === key && sort.dir === "desc" ? "asc" : "desc" };
    setSort(next);
    load(filters, 1, next);
  };

  const exportFile = async (format) => {
    try {
      const res = await api.get("/reports/erp/export", {
        params: { ...activeParams(filters), format, columns: visibleCols.join(","), sort_by: sort.by, sort_dir: sort.dir },
        responseType: "blob",
      });
      downloadBlob(res.data, `erp_report.${format === "excel" ? "xlsx" : format}`);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  return (
    <div className="max-w-[1400px] space-y-5" data-testid="reports-page">
      <style>{PRINT_CSS}</style>
      <div className="no-print">
        <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">ERP Analytics</p>
        <h1 className="text-3xl font-black tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live workflow reporting across Master Dispatch, Packing, ASN, E-Way Bill, Vendor Acknowledgement and PDI.
        </p>
      </div>

      <div className="no-print"><KpiCards kpis={kpis} onApply={applyKpiFilter} /></div>
      <div className="no-print"><QuickReports onApply={applyQuick} /></div>
      <div className="no-print">
        <AdvancedFilters
          filters={filters} setFilters={setFilters} loading={loading}
          onSearch={() => load(filters, 1)}
          onReset={() => { setFilters(EMPTY_FILTERS); setSort({ by: "created_at", dir: "desc" }); load(EMPTY_FILTERS, 1, { by: "created_at", dir: "desc" }); }}
          onExport={exportFile} onPrint={() => window.print()}
          views={views} defaultViewId={defaultViewId} onApplyView={applyView}
          onViewsChanged={() => loadViews()} isAdmin={user?.role === "admin"}
        />
      </div>

      <ReportTable rows={rows} visibleCols={visibleCols} setVisibleCols={setVisibleCols}
                   sort={sort} onSort={onSort} onRowClick={setDrillRec}
                   page={page} pageInfo={pageInfo} onPage={(p) => load(filters, p)} loading={loading} />

      <ReportCharts charts={charts} />
      <WorkflowDialog record={drillRec} onClose={() => setDrillRec(null)} />
    </div>
  );
}
