import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const EMPTY_ENTRY = {
  invoice_number: "", invoice_date: "", customer_name: "", customer_code: "",
  po_number: "", part_number: "", part_description: "", quantity: 0, unit: "",
  rate: 0, total_value: 0, gst: "", vehicle: "", dispatch_date: "", vendor_name: "",
  remarks: "", pdf_id: "",
};

const FIELDS = [
  { key: "invoice_number", label: "Invoice Number" },
  { key: "invoice_date", label: "Invoice Date", type: "date" },
  { key: "customer_name", label: "Customer Name" },
  { key: "customer_code", label: "Customer Code" },
  { key: "po_number", label: "PO Number" },
  { key: "part_number", label: "Part Number" },
  { key: "part_description", label: "Part Description", span: 2 },
  { key: "quantity", label: "Quantity", type: "number" },
  { key: "unit", label: "Unit" },
  { key: "rate", label: "Rate", type: "number" },
  { key: "total_value", label: "Total Value", type: "number" },
  { key: "gst", label: "GST" },
  { key: "vehicle", label: "Vehicle (optional)" },
  { key: "dispatch_date", label: "Dispatch Date", type: "date" },
  { key: "vendor_name", label: "Vendor Name" },
  { key: "remarks", label: "Remarks", span: 2 },
];

export function normalizeEntry(entry) {
  return {
    ...entry,
    quantity: parseFloat(entry.quantity) || 0,
    rate: parseFloat(entry.rate) || 0,
    total_value: parseFloat(entry.total_value) || 0,
  };
}

export default function DispatchEntryForm({ entry, onChange, idPrefix = "entry" }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {FIELDS.map((f) => (
        <div key={f.key} className={`space-y-1.5 ${f.span === 2 ? "sm:col-span-2" : ""}`}>
          <Label htmlFor={`${idPrefix}-${f.key}`} className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {f.label}
          </Label>
          <Input
            id={`${idPrefix}-${f.key}`}
            data-testid={`${idPrefix}-${f.key.replace(/_/g, "-")}-input`}
            type={f.type || "text"}
            step={f.type === "number" ? "any" : undefined}
            value={entry[f.key] ?? ""}
            onChange={(e) => onChange({ ...entry, [f.key]: e.target.value })}
            className="rounded-sm bg-input border-border focus-visible:ring-primary h-9"
          />
        </div>
      ))}
    </div>
  );
}
