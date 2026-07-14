import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Package } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api, { apiError } from "@/lib/api";

export const BatchAllocationDialog = ({ req, onDone }) => {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!req) return;
    const init = req.batches.map((b, i) => {
      let qty = 0;
      if (req.batches.length === 1 && b.available_qty >= req.asn_qty) qty = req.asn_qty;
      return { ...b, allocate_qty: qty, consider: qty > 0, idx: i };
    });
    setRows(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.record_id, req?.part_number]);

  const totals = useMemo(() => {
    const allocated = rows.reduce((a, r) => a + (parseFloat(r.allocate_qty) || 0), 0);
    const over = rows.some((r) => (parseFloat(r.allocate_qty) || 0) > r.available_qty);
    return { allocated, remaining: (req?.asn_qty || 0) - allocated, over };
  }, [rows, req]);

  const singleShort = req?.batches.length === 1 && req.batches[0].available_qty < req.asn_qty;
  const canConfirm = !busy && !totals.over && Math.abs(totals.remaining) < 0.001 && totals.allocated > 0;

  const setQty = (idx, value) => {
    setRows(rows.map((r) => r.idx === idx
      ? { ...r, allocate_qty: value, consider: (parseFloat(value) || 0) > 0 }
      : r));
  };

  const autoAllocate = () => {
    let left = req.asn_qty;
    setRows(rows.map((r) => {
      const take = Math.min(left, r.available_qty);
      left -= take;
      return { ...r, allocate_qty: take, consider: take > 0 };
    }));
  };

  const clearAll = () => setRows(rows.map((r) => ({ ...r, allocate_qty: 0, consider: false })));

  const confirm = async () => {
    setBusy(true);
    try {
      await api.post("/asn/allocation/confirm", {
        record_id: req.record_id,
        allocations: rows.map((r) => ({ batch_no: r.batch_no, allocate_qty: parseFloat(r.allocate_qty) || 0, consider: r.consider })),
      });
      toast.success("Batch allocation confirmed — automation continuing");
      onDone();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api.post("/asn/allocation/cancel", { record_id: req.record_id });
      toast.info("Batch allocation cancelled — ASN run stopped for this invoice");
      onDone();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!req) return null;
  return (
    <Dialog open={!!req} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl bg-card border-border [&>button]:hidden" data-testid="batch-allocation-dialog">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight flex items-center gap-2">
            <Package size={22} weight="duotone" className="text-primary" />
            Batch Allocation — <span className="text-primary font-mono">{req.part_number}</span>
          </DialogTitle>
          <DialogDescription>
            Invoice {req.invoice_no} · The portal requires allocation from available production batches. Automation is paused until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 border border-border rounded-sm overflow-hidden text-center">
          <div className="bg-background p-3 border-r border-border">
            <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground mb-1">ASN Qty</p>
            <p className="text-lg font-black font-mono" data-testid="alloc-asn-qty">{req.asn_qty}</p>
          </div>
          <div className="bg-background p-3 border-r border-border">
            <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground mb-1">Total Allocated</p>
            <p className="text-lg font-black font-mono text-primary" data-testid="alloc-total">{totals.allocated}</p>
          </div>
          <div className="bg-background p-3">
            <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground mb-1">Remaining Qty</p>
            <p className={`text-lg font-black font-mono ${Math.abs(totals.remaining) < 0.001 ? "text-emerald-400" : "text-amber-400"}`} data-testid="alloc-remaining">
              {totals.remaining}
            </p>
          </div>
        </div>

        {singleShort && (
          <p className="text-xs text-red-400 border border-red-500/40 bg-red-500/10 rounded-sm px-3 py-2" data-testid="alloc-exceeds-error">
            ASN Quantity exceeds Available Batch Quantity.
          </p>
        )}

        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-xs" data-testid="alloc-table">
            <thead>
              <tr className="bg-secondary">
                {["Batch No", "Batch Qty", "Available Qty", "Allocate Qty", "Consider"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const over = (parseFloat(r.allocate_qty) || 0) > r.available_qty;
                return (
                  <tr key={r.batch_no} className="border-t border-border" data-testid={`alloc-row-${r.idx}`}>
                    <td className="px-3 py-2 font-mono max-w-[220px] truncate">{r.batch_no}</td>
                    <td className="px-3 py-2 font-mono">{r.batch_qty}</td>
                    <td className="px-3 py-2 font-mono text-sky-400">{r.available_qty}</td>
                    <td className="px-3 py-2">
                      <Input type="number" min="0" value={r.allocate_qty} onChange={(e) => setQty(r.idx, e.target.value)}
                             data-testid={`alloc-qty-${r.idx}`}
                             className={`h-8 w-24 rounded-sm bg-input font-mono ${over ? "border-red-500" : "border-border"}`} />
                      {over && <p className="text-[10px] text-red-400 mt-1" data-testid={`alloc-over-${r.idx}`}>Allocation cannot exceed Available Quantity.</p>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <Switch checked={r.consider} onCheckedChange={(v) => setRows(rows.map((x) => x.idx === r.idx ? { ...x, consider: v } : x))}
                                data-testid={`alloc-consider-${r.idx}`} />
                        <span className={`text-[10px] font-bold ${r.consider ? "text-emerald-400" : "text-muted-foreground"}`}>
                          {r.consider ? "Yes" : "No"}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="secondary" size="sm" onClick={autoAllocate} disabled={busy} data-testid="alloc-auto" className="rounded-sm">Auto Allocate</Button>
          <Button variant="secondary" size="sm" onClick={clearAll} disabled={busy} data-testid="alloc-clear" className="rounded-sm">Clear Allocation</Button>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={cancel} disabled={busy} data-testid="alloc-cancel" className="rounded-sm text-red-400">Cancel</Button>
          <Button size="sm" onClick={confirm} disabled={!canConfirm} data-testid="alloc-confirm" className="rounded-sm">
            {busy ? "Confirming…" : "Confirm Allocation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
