import { useEffect, useState } from "react";
import { MagnifyingGlass, DownloadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import api from "@/lib/api";

// One-time field copy from Master Dispatch into a new Packing Slip.
// No live link is created — edits in either module never affect the other.
// If the Master Dispatch API is unavailable, Packing keeps working normally.
export default function PackingImportDialog({ open, onOpenChange, onImport }) {
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/master-dispatch", {
        params: { page_size: 25, ...(search ? { search } : {}) },
      });
      setRecords(data.items);
    } catch (err) {
      setRecords([]);
      toast.error("Master Dispatch is unavailable right now — you can continue filling the slip manually.");
    } finally {
      setLoading(false);
    }
  };

  const pick = (r, item) => {
    onImport({
      invoice_number: r.invoice_number || "",
      item_name: item?.description || "",
      item_code: item?.part_number || "",
      total_quantity: item?.quantity || "",
      boxes: r.boxes > 0 ? r.boxes : 1,
      customer_name: r.customer_name || "",
    });
    toast.success(`Copied fields from ${r.dispatch_no} — this is a one-time copy, no link is kept.`);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open && records === null) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-card border-border" data-testid="packing-import-dialog">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">Import from Master Dispatch</DialogTitle>
          <DialogDescription>
            Copies common fields into this packing slip once. The two records stay independent — later edits are never synced.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Search invoice, customer, part…"
              data-testid="packing-import-search"
              className="pl-9 h-9 rounded-sm bg-input border-border focus-visible:ring-primary"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={load} disabled={loading} data-testid="packing-import-search-button" className="rounded-sm h-9">
            {loading ? "Loading…" : "Search"}
          </Button>
        </div>
        <div className="border border-border rounded-sm divide-y divide-border max-h-96 overflow-y-auto">
          {records === null || loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Loading dispatches…</p>
          ) : records.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground" data-testid="packing-import-empty">
              No Master Dispatch records found.
            </p>
          ) : (
            records.map((r) => (
              <div key={r.id} className="p-3 space-y-2" data-testid={`packing-import-record-${r.dispatch_no}`}>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-mono text-primary">{r.dispatch_no}</span>
                  <span className="font-semibold">{r.invoice_number}</span>
                  <span className="text-muted-foreground flex-1 truncate">{r.customer_name}</span>
                  <Badge variant="outline" className="rounded-sm text-[9px] uppercase border-border text-muted-foreground">
                    {r.invoice_date}
                  </Badge>
                </div>
                <div className="space-y-1">
                  {(r.items?.length ? r.items : [null]).map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-secondary/50 rounded-sm px-2 py-1.5">
                      <span className="font-mono">{item?.part_number || "—"}</span>
                      <span className="flex-1 truncate text-muted-foreground">{item?.description || "No item details"}</span>
                      <span>{item ? `${item.quantity} ${item.unit}` : ""}</span>
                      <Button
                        size="sm" variant="secondary"
                        onClick={() => pick(r, item)}
                        data-testid={`packing-import-pick-${r.dispatch_no}-${i}`}
                        className="rounded-sm h-6 gap-1 text-[10px]"
                      >
                        <DownloadSimple size={11} weight="bold" /> Import
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
