import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileCsv, Package } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api, { apiError } from "@/lib/api";

export const AllocationHistoryDialog = ({ open, onClose }) => {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");

  const load = async (s = search) => {
    try {
      const { data } = await api.get("/asn/batch-allocations", { params: s ? { search: s } : {} });
      setRows(data.items);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  useEffect(() => {
    if (open) load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const csv = () => {
    const header = ["ASN Number", "Dispatch No", "Invoice", "Part Number", "Batch Number", "Batch Qty", "Available Qty", "Allocated Qty", "Considerable", "Created By", "Created Date"];
    const lines = rows.map((r) => [r.asn_number, r.dispatch_no, r.invoice_no, r.part_number, r.batch_number,
      r.batch_quantity, r.available_quantity, r.allocated_quantity, r.batch_considerable, r.created_by, r.created_at?.slice(0, 19)]);
    const blob = new Blob(["\ufeff" + [header, ...lines].map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "batch_allocation_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] bg-card border-border" data-testid="allocation-history-dialog">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight flex items-center gap-2">
            <Package size={20} weight="duotone" className="text-primary" /> Batch Allocation Report
          </DialogTitle>
          <DialogDescription>Every batch allocated during ASN creation, linked to its ASN number.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input placeholder="Search ASN / invoice / part / batch…" value={search}
                 onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
                 data-testid="alloc-history-search" className="h-8 rounded-sm bg-input border-border text-xs" />
          <Button variant="secondary" size="sm" onClick={() => load()} className="rounded-sm h-8">Search</Button>
          <Button variant="secondary" size="sm" onClick={csv} data-testid="alloc-history-csv" className="rounded-sm h-8 gap-1"><FileCsv size={13} /> CSV</Button>
        </div>
        <div className="border border-border rounded-sm max-h-[50vh] overflow-y-auto">
          <table className="w-full text-xs" data-testid="alloc-history-table">
            <thead>
              <tr className="bg-secondary sticky top-0">
                {["ASN Number", "Invoice", "Part", "Batch Number", "Allocated", "Available", "Consider", "Date"].map((h) => (
                  <th key={h} className="text-left px-2.5 py-2 text-[9px] uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-muted-foreground py-8" data-testid="alloc-history-empty">No batch allocations recorded yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-2.5 py-1.5 font-mono text-emerald-400 whitespace-nowrap">{r.asn_number}</td>
                  <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">{r.invoice_no}</td>
                  <td className="px-2.5 py-1.5 font-mono">{r.part_number}</td>
                  <td className="px-2.5 py-1.5 font-mono max-w-[180px] truncate">{r.batch_number}</td>
                  <td className="px-2.5 py-1.5 font-mono">{r.allocated_quantity}</td>
                  <td className="px-2.5 py-1.5 font-mono text-muted-foreground">{r.available_quantity}</td>
                  <td className={`px-2.5 py-1.5 font-bold ${r.batch_considerable === "Yes" ? "text-emerald-400" : "text-muted-foreground"}`}>{r.batch_considerable}</td>
                  <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">{r.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
};
