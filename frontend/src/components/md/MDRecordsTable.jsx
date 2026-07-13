import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, PencilSimple, Trash, Copy, CaretUp, CaretDown } from "@phosphor-icons/react";

export const STATUS_STYLES = {
  pending: "border-amber-500/50 text-amber-400",
  ready_for_asn: "border-sky-500/50 text-sky-400",
  ready_for_eway: "border-violet-500/50 text-violet-400",
  completed: "border-emerald-500/50 text-emerald-400",
};

export const STATUS_LABELS = {
  pending: "Pending",
  ready_for_asn: "Ready for ASN",
  ready_for_eway: "Ready for E-Way",
  completed: "Completed",
};

const SORTABLE = [
  { key: "dispatch_no", label: "Dispatch No" },
  { key: "invoice_number", label: "Invoice No" },
  { key: "invoice_date", label: "Date" },
  { key: "customer_name", label: "Customer" },
  { key: null, label: "GSTIN" },
  { key: null, label: "Items" },
  { key: "invoice_total", label: "Total (₹)" },
  { key: "status", label: "Status" },
  { key: null, label: "Review" },
  { key: null, label: "Actions" },
];

export default function MDRecordsTable({ records, sort, onSort, isAdmin, onView, onEdit, onDuplicate, onDelete }) {
  return (
    <div className="border border-border rounded-sm overflow-x-auto bg-card">
      <Table data-testid="md-records-table">
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border">
            {SORTABLE.map((h) => (
              <TableHead
                key={h.label}
                onClick={() => h.key && onSort?.(h.key)}
                data-testid={h.key ? `md-sort-${h.key}` : undefined}
                className={`text-[10px] uppercase tracking-[0.15em] whitespace-nowrap ${h.key ? "cursor-pointer select-none hover:text-primary" : ""}`}
              >
                <span className="inline-flex items-center gap-1">
                  {h.label}
                  {sort?.by === h.key && (sort.dir === "asc" ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />)}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="text-center text-muted-foreground py-10" data-testid="md-no-records">
                No master dispatch records found.
              </TableCell>
            </TableRow>
          ) : (
            records.map((r) => (
              <TableRow key={r.id} className="border-border hover:bg-secondary/50" data-testid={`md-row-${r.dispatch_no}`}>
                <TableCell className="font-mono text-primary text-xs whitespace-nowrap">{r.dispatch_no}</TableCell>
                <TableCell className="whitespace-nowrap">{r.invoice_number}</TableCell>
                <TableCell className="whitespace-nowrap">{r.invoice_date}</TableCell>
                <TableCell className="max-w-[180px] truncate">{r.customer_name}</TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap">{r.gstin}</TableCell>
                <TableCell className="text-center">{r.items?.length || 0}</TableCell>
                <TableCell className="font-mono whitespace-nowrap">{r.invoice_total?.toLocaleString("en-IN")}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`rounded-sm text-[9px] uppercase tracking-wider whitespace-nowrap ${STATUS_STYLES[r.status] || ""}`}>
                    {STATUS_LABELS[r.status] || r.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {r.verified ? (
                    <Badge variant="outline" className="rounded-sm text-[9px] uppercase border-emerald-500/50 text-emerald-400">Verified</Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-sm text-[9px] uppercase border-amber-500/50 text-amber-400">Needs Review</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-0.5">
                    <button onClick={() => onView(r)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`md-view-${r.dispatch_no}`} aria-label="View">
                      <Eye size={16} />
                    </button>
                    <button onClick={() => onEdit(r)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`md-edit-${r.dispatch_no}`} aria-label="Edit">
                      <PencilSimple size={16} />
                    </button>
                    <button onClick={() => onDuplicate(r)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`md-duplicate-${r.dispatch_no}`} aria-label="Duplicate">
                      <Copy size={16} />
                    </button>
                    {isAdmin && (
                      <button onClick={() => onDelete(r)} className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors" data-testid={`md-delete-${r.dispatch_no}`} aria-label="Delete">
                        <Trash size={16} />
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
