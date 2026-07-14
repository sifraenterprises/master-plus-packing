import { useRef, useState } from "react";
import { CaretUp, CaretDown, Columns } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { COLUMNS, STATUS_BADGE } from "./reportConfig";

export const ReportTable = ({ rows, visibleCols, setVisibleCols, sort, onSort, onRowClick,
                              page, pageInfo, onPage, loading }) => {
  const [colsOpen, setColsOpen] = useState(false);
  const [widths, setWidths] = useState({});
  const drag = useRef(null);

  const cols = COLUMNS.filter((c) => visibleCols.includes(c.k));

  const startResize = (e, key, startW) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key, startX: e.clientX, startW };
    const move = (ev) => {
      const d = drag.current;
      if (d) setWidths((w) => ({ ...w, [d.key]: Math.max(60, d.startW + ev.clientX - d.startX) }));
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground" data-testid="report-record-count">
          {loading ? "Loading…" : `${pageInfo.total} record(s) — page ${page} of ${pageInfo.pages}`}
        </p>
        <div className="relative">
          <Button variant="secondary" size="sm" onClick={() => setColsOpen(!colsOpen)} data-testid="columns-toggle" className="rounded-sm h-8 gap-1">
            <Columns size={13} /> Columns
          </Button>
          {colsOpen && (
            <div className="absolute right-0 top-9 z-30 bg-card border border-border rounded-sm p-3 w-56 shadow-xl space-y-1.5 max-h-72 overflow-y-auto" data-testid="columns-menu">
              {COLUMNS.map((c) => (
                <label key={c.k} className="flex items-center gap-2 text-xs cursor-pointer hover:text-primary">
                  <input type="checkbox" checked={visibleCols.includes(c.k)} data-testid={`col-toggle-${c.k}`}
                         onChange={(e) => setVisibleCols(e.target.checked ? [...visibleCols, c.k] : visibleCols.filter((k) => k !== c.k))} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div id="erp-report-print" className="border border-border rounded-sm bg-card overflow-auto max-h-[62vh]" onClick={() => colsOpen && setColsOpen(false)}>
        <table className="w-full text-sm" data-testid="erp-report-table" style={{ tableLayout: "fixed", minWidth: cols.reduce((a, c) => a + (widths[c.k] || c.w), 0) }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k} style={{ width: widths[c.k] || c.w }}
                    className="sticky top-0 z-10 bg-secondary text-left text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold px-3 py-2.5 border-b border-border select-none relative">
                  <button onClick={() => onSort(c.k)} className="flex items-center gap-1 hover:text-foreground" data-testid={`sort-${c.k}`}>
                    {c.label}
                    {sort.by === c.k && (sort.dir === "asc" ? <CaretUp size={10} /> : <CaretDown size={10} />)}
                  </button>
                  <span onMouseDown={(e) => startResize(e, c.k, widths[c.k] || c.w)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50 no-print" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="text-center text-muted-foreground py-10" data-testid="report-no-results">
                No records match your filters.
              </td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} onClick={() => onRowClick(r)} data-testid={`report-row-${r.invoice_number}`}
                    className="border-b border-border hover:bg-secondary/50 cursor-pointer transition-colors">
                  {cols.map((c) => (
                    <td key={c.k} className="px-3 py-2 text-xs truncate">
                      {c.status ? (
                        <Badge variant="outline" className={`rounded-sm text-[9px] uppercase ${STATUS_BADGE[r[c.k]] || ""}`}>
                          {r[c.k] || "—"}
                        </Badge>
                      ) : c.k === "invoice_number" ? (
                        <span className="font-mono text-primary">{r[c.k]}</span>
                      ) : (
                        <span className={["quantity", "boxes", "asn_no", "eway_bill_number"].includes(c.k) ? "font-mono" : ""}>
                          {r[c.k] ?? ""}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 no-print" data-testid="report-pagination">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="report-prev-page" className="rounded-sm h-8">Previous</Button>
        <Button variant="secondary" size="sm" disabled={page >= pageInfo.pages} onClick={() => onPage(page + 1)} data-testid="report-next-page" className="rounded-sm h-8">Next</Button>
      </div>
    </div>
  );
};
