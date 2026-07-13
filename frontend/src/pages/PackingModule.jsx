import { useEffect, useState, useCallback } from "react";
import { Package, FloppyDisk, Printer, ArrowCounterClockwise, Trash, FolderOpen } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

const COMPANY = { name: "GREWAL ENGG. WORKS", address: "5/1-G 20/3 Mathura Road Faridabad", vc: "302235" };

const EMPTY_SLIP = {
  invoice_number: "", item_name: "", item_code: "", total_quantity: "", single_packet_qty: "",
  boxes: 1, inside_cards: 0, lot_number: "", pdi_number: "",
  customer_name: "M/S TAFE MOTORS & TRACTORS LTD",
  customer_address: "P. No. 1 Sector D Mandideep Distt Raisen (M.P)",
};

const FIELDS = [
  { key: "invoice_number", label: "• Invoice Number" },
  { key: "item_name", label: "• Item Name (Description)" },
  { key: "item_code", label: "• Item Code (I.C.)" },
  { key: "total_quantity", label: "• Total Quantity", type: "number" },
  { key: "single_packet_qty", label: "Single Packet Qty", type: "number" },
  { key: "boxes", label: "• Boxes", type: "number" },
  { key: "inside_cards", label: "Inside Cards (0 = same as boxes)", type: "number" },
  { key: "lot_number", label: "• Lot Number" },
  { key: "pdi_number", label: "• PDI Number" },
  { key: "customer_name", label: "Customer Name" },
  { key: "customer_address", label: "Customer Address", span: 2 },
];

const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function perBoxQty(slip) {
  const single = parseFloat(slip.single_packet_qty) || 0;
  if (single > 0) return single;
  const total = parseFloat(slip.total_quantity) || 0;
  const boxes = parseInt(slip.boxes) || 1;
  return total && boxes ? Math.round((total / boxes) * 100) / 100 : total;
}

function OutsideSlip({ slip, index, total }) {
  return (
    <div className="slip-outside">
      <div className="slip-co">
        <b>{COMPANY.name}</b>
        <span>{COMPANY.address}</span>
      </div>
      <div className="slip-to">
        <span>To <b>{slip.customer_name || "—"}</b></span>
        <span>{slip.customer_address}</span>
      </div>
      <div className="slip-inv">
        <span className="slip-inv-label">INVOICE NO.</span>
        <span className="slip-inv-no" data-testid="outside-invoice-no">{slip.invoice_number || "—"}</span>
      </div>
      <div className="slip-field"><span>Description:</span><b>{slip.item_name || "—"}</b></div>
      <div className="slip-field"><span>Item Code:</span><b>{slip.item_code || "—"}</b></div>
      <div className="slip-field"><span>Qty:</span><b>{perBoxQty(slip) || "—"}</b></div>
      <div className="slip-boxrow">
        <span>No of Box:</span>
        <b>{index} / {total}</b>
        <span>Box</span>
      </div>
    </div>
  );
}

function InsideCard({ slip }) {
  return (
    <div className="slip-inside">
      <div className="slip-in-head">
        <b>{COMPANY.name}</b>
        <span data-testid="inside-vc">V.C. {COMPANY.vc}</span>
        <span className="slip-in-title" data-testid="inside-title">Lot Identification Card</span>
      </div>
      <div className="slip-in-body">
        <div className="slip-in-row"><span>Component</span><b>{slip.item_name || "—"}</b></div>
        <div className="slip-in-row"><span>Invoice No.</span><b data-testid="inside-invoice-no">{slip.invoice_number || "—"}</b></div>
        <div className="slip-in-row"><span>I.C.</span><b>{slip.item_code || "—"}</b></div>
        <div className="slip-in-row"><span>Lot No.</span><b>{slip.lot_number || "—"}</b></div>
        <div className="slip-in-row"><span>Qty.</span><b>{perBoxQty(slip) || "—"}</b></div>
        <div className="slip-in-row"><span>PDI No.</span><b>{slip.pdi_number || "—"}</b></div>
      </div>
    </div>
  );
}

export default function PackingModule() {
  const [slip, setSlip] = useState(EMPTY_SLIP);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [printMode, setPrintMode] = useState(null);
  const [tab, setTab] = useState("new");

  const boxes = Math.max(1, parseInt(slip.boxes) || 1);
  const insideCount = parseInt(slip.inside_cards) > 0 ? parseInt(slip.inside_cards) : boxes;

  const loadHistory = useCallback(() => api.get("/packing/slips").then((r) => setHistory(r.data)).catch(() => {}), []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const normalize = () => ({
    ...slip,
    total_quantity: parseFloat(slip.total_quantity) || 0,
    single_packet_qty: parseFloat(slip.single_packet_qty) || 0,
    boxes,
    inside_cards: parseInt(slip.inside_cards) || 0,
  });

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/packing/slips", normalize());
      toast.success("Packing record saved");
      loadHistory();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const printSlips = (mode) => {
    setPrintMode(mode);
    setTimeout(() => {
      window.print();
      setPrintMode(null);
    }, 350);
  };

  const removeRecord = async (id) => {
    try {
      await api.delete(`/packing/slips/${id}`);
      toast.success("Record deleted");
      loadHistory();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const loadRecord = (r) => {
    setSlip({
      invoice_number: r.invoice_number, item_name: r.item_name, item_code: r.item_code,
      total_quantity: r.total_quantity || "", single_packet_qty: r.single_packet_qty || "",
      boxes: r.boxes, inside_cards: r.inside_cards, lot_number: r.lot_number,
      pdi_number: r.pdi_number, customer_name: r.customer_name, customer_address: r.customer_address,
    });
    toast.info(`Loaded record for invoice ${r.invoice_number}`);
    setTab("new");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="max-w-7xl space-y-8" data-testid="packing-module-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Automation Module</p>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Package size={32} weight="duotone" className="text-primary" /> Packing Slip Studio
          </h1>
        </div>
        <Badge className="rounded-sm text-[10px] uppercase tracking-widest" data-testid="packing-status-badge">Active</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-sm bg-secondary">
          <TabsTrigger value="new" className="rounded-sm" data-testid="tab-new-slip">New Slip</TabsTrigger>
          <TabsTrigger value="history" className="rounded-sm" data-testid="tab-slip-history">History ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="border border-border bg-card rounded-sm p-6 space-y-4" data-testid="packing-form">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Shipment details — fields marked with • appear on the printed slips
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {FIELDS.map((f) => (
                  <div key={f.key} className={`space-y-1.5 ${f.span === 2 ? "sm:col-span-2" : ""}`}>
                    <Label htmlFor={`pk-${f.key}`} className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      {f.label}
                    </Label>
                    <Input
                      id={`pk-${f.key}`}
                      data-testid={`packing-${f.key.replace(/_/g, "-")}-input`}
                      type={f.type || "text"}
                      step={f.type === "number" ? "any" : undefined}
                      value={slip[f.key] ?? ""}
                      onChange={(e) => setSlip({ ...slip, [f.key]: e.target.value })}
                      className="rounded-sm bg-input border-border focus-visible:ring-primary h-9"
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" onClick={save} disabled={saving} data-testid="packing-save-button" className="rounded-sm gap-1 active:scale-95 transition-transform">
                  <FloppyDisk size={15} weight="bold" /> {saving ? "Saving..." : "Save Record"}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => printSlips("outside")} data-testid="packing-print-outside-button" className="rounded-sm gap-1">
                  <Printer size={15} /> Print Outside
                </Button>
                <Button variant="secondary" size="sm" onClick={() => printSlips("inside")} data-testid="packing-print-inside-button" className="rounded-sm gap-1">
                  <Printer size={15} /> Print Inside
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setSlip(EMPTY_SLIP)} data-testid="packing-reset-button" className="rounded-sm gap-1">
                  <ArrowCounterClockwise size={15} /> Reset
                </Button>
              </div>
              <p className="text-xs text-muted-foreground" data-testid="packing-generation-note">
                {boxes} outside slip{boxes > 1 ? "s" : ""} · {insideCount} inside lot card{insideCount > 1 ? "s" : ""} will be generated.
                Outside: 8 per A4. Inside: 16 per A4 (2×8 strips).
              </p>
            </div>

            <div className="border border-border bg-card rounded-sm p-6 space-y-4" data-testid="packing-live-preview">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Live preview — outside slip</p>
              <div className="preview-scale rounded-sm p-4 w-full max-w-[420px] mx-auto">
                <OutsideSlip slip={slip} index={1} total={boxes} />
              </div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground pt-2">Inside lot card</p>
              <div className="preview-scale rounded-sm p-4 w-full max-w-[420px] mx-auto">
                <InsideCard slip={slip} />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <div className="border border-border rounded-sm overflow-x-auto bg-card">
            <Table data-testid="packing-history-table">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  {["Invoice", "Item", "Item Code", "Qty", "Boxes", "Lot No", "PDI No", "Created", "Actions"].map((h) => (
                    <TableHead key={h} className="text-[10px] uppercase tracking-[0.15em] whitespace-nowrap">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-10" data-testid="packing-no-history">
                      No packing records yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map((r) => (
                    <TableRow key={r.id} className="border-border hover:bg-secondary/50" data-testid={`packing-row-${r.id}`}>
                      <TableCell className="whitespace-nowrap">{r.invoice_number}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{r.item_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.item_code}</TableCell>
                      <TableCell>{r.total_quantity}</TableCell>
                      <TableCell>{r.boxes}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.lot_number}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.pdi_number}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.created_at?.slice(0, 10)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <button onClick={() => loadRecord(r)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" data-testid={`packing-load-${r.id}`} aria-label="Load record">
                            <FolderOpen size={16} />
                          </button>
                          <button onClick={() => removeRecord(r.id)} className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors" data-testid={`packing-delete-${r.id}`} aria-label="Delete record">
                            <Trash size={16} />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {printMode && (
        <div className="print-wrap" data-testid="packing-print-area" aria-hidden="true">
          {printMode === "outside" &&
            chunk(Array.from({ length: boxes }, (_, i) => i + 1), 8).map((sheet, si) => (
              <div className="print-sheet" key={si}>
                {sheet.map((n) => (
                  <OutsideSlip key={n} slip={slip} index={n} total={boxes} />
                ))}
              </div>
            ))}
          {printMode === "inside" &&
            chunk(Array.from({ length: insideCount }, (_, i) => i + 1), 16).map((sheet, si) => (
              <div className="print-sheet" key={si}>
                {sheet.map((n) => (
                  <InsideCard key={n} slip={slip} />
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
