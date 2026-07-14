import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Trash } from "@phosphor-icons/react";

export const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "ready_for_asn", label: "Ready for ASN" },
  { value: "ready_for_eway", label: "Ready for E-Way" },
  { value: "completed", label: "Completed" },
];

export const EMPTY_ITEM = { part_number: "", description: "", hsn: "", quantity: 0, unit: "", rate: 0, amount: 0 };

export const MD_EMPTY = {
  customer_name: "", customer_code: "", gstin: "",
  invoice_number: "", invoice_date: "", po_number: "", po_date: "",
  items: [{ ...EMPTY_ITEM }],
  boxes: 0, gross_weight: "", net_weight: "",
  vehicle_number: "", lr_number: "", transporter_name: "",
  cgst: 0, sgst: 0, igst: 0, gst_total: 0, invoice_total: 0,
  eway_bill_number: "", irn: "", ack_number: "", remarks: "",
  status: "pending", verified: false,
};

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function formatEway(v) {
  const digits = String(v || "").replace(/\D/g, "").slice(0, 12);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function normalizeMD(e) {
  const base = Object.fromEntries(Object.keys(MD_EMPTY).map((k) => [k, e[k] ?? MD_EMPTY[k]]));
  return {
    ...base,
    boxes: Math.round(num(e.boxes)),
    cgst: num(e.cgst), sgst: num(e.sgst), igst: num(e.igst),
    gst_total: num(e.gst_total), invoice_total: num(e.invoice_total),
    items: (e.items?.length ? e.items : [EMPTY_ITEM]).map((it) => ({
      part_number: it.part_number || "", description: it.description || "", hsn: it.hsn || "",
      quantity: num(it.quantity), unit: it.unit || "", rate: num(it.rate), amount: num(it.amount),
    })),
  };
}

function Field({ label, k, entry, onChange, idPrefix, type = "text" }) {
  const conf = entry.confidence?.[k];
  const low = conf !== undefined && conf < 90;
  const isEway = k === "eway_bill_number";
  return (
    <div>
      <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1.5 mb-1">
        {label}
        {conf !== undefined && (
          <Badge
            variant="outline"
            className={`rounded-sm text-[9px] px-1 py-0 ${low ? "border-amber-500 text-amber-400" : "border-border text-muted-foreground"}`}
            data-testid={`${idPrefix}-${k}-confidence`}
          >
            {conf}%
          </Badge>
        )}
      </label>
      <Input
        type={type}
        value={isEway ? formatEway(entry[k]) || (entry[k] ?? "") : entry[k] ?? ""}
        placeholder={isEway ? "XXXX XXXX XXXX" : undefined}
        onChange={(e) => onChange({ ...entry, [k]: isEway ? e.target.value.replace(/[^\d\s]/g, "").slice(0, 14) : e.target.value })}
        data-testid={`${idPrefix}-${k}`}
        className={`h-9 rounded-sm bg-input border-border focus-visible:ring-primary ${isEway ? "font-mono" : ""} ${low ? "border-amber-500/70 ring-1 ring-amber-500/30" : ""}`}
      />
    </div>
  );
}

function Section({ title, children, cols = 3 }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.25em] text-primary mb-2">{title}</p>
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${cols} gap-3`}>{children}</div>
    </div>
  );
}

const ITEM_COLS = [
  { k: "part_number", label: "Part No", w: "w-32" },
  { k: "description", label: "Description", w: "flex-1 min-w-[140px]" },
  { k: "hsn", label: "HSN", w: "w-24" },
  { k: "quantity", label: "Qty", w: "w-20", type: "number" },
  { k: "unit", label: "Unit", w: "w-16" },
  { k: "rate", label: "Rate", w: "w-24", type: "number" },
  { k: "amount", label: "Amount", w: "w-28", type: "number" },
];

export default function MDForm({ entry, onChange, idPrefix }) {
  const itemsConf = entry.confidence?.items;
  const setItem = (i, k, v) =>
    onChange({ ...entry, items: entry.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) });

  return (
    <div className="space-y-5" data-testid={`${idPrefix}-md-form`}>
      <Section title="Customer">
        <Field label="Customer Name" k="customer_name" {...{ entry, onChange, idPrefix }} />
        <Field label="Customer Code" k="customer_code" {...{ entry, onChange, idPrefix }} />
        <Field label="GSTIN" k="gstin" {...{ entry, onChange, idPrefix }} />
      </Section>
      <Section title="Invoice" cols={4}>
        <Field label="Invoice Number" k="invoice_number" {...{ entry, onChange, idPrefix }} />
        <Field label="Invoice Date" k="invoice_date" type="date" {...{ entry, onChange, idPrefix }} />
        <Field label="PO Number" k="po_number" {...{ entry, onChange, idPrefix }} />
        <Field label="PO Date" k="po_date" type="date" {...{ entry, onChange, idPrefix }} />
      </Section>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-[0.25em] text-primary flex items-center gap-2">
            Item Details
            {itemsConf !== undefined && itemsConf < 90 && (
              <Badge variant="outline" className="rounded-sm text-[9px] px-1 py-0 border-amber-500 text-amber-400">
                {itemsConf}% — verify items
              </Badge>
            )}
          </p>
          <Button
            type="button" variant="secondary" size="sm"
            onClick={() => onChange({ ...entry, items: [...entry.items, { ...EMPTY_ITEM }] })}
            data-testid={`${idPrefix}-add-item`} className="rounded-sm h-7 gap-1 text-xs"
          >
            <Plus size={12} weight="bold" /> Add Item
          </Button>
        </div>
        <div className="space-y-2 overflow-x-auto">
          {entry.items?.map((it, i) => (
            <div key={i} className="flex gap-2 items-end min-w-[720px]" data-testid={`${idPrefix}-item-row-${i}`}>
              {ITEM_COLS.map((c) => (
                <div key={c.k} className={c.w}>
                  {i === 0 && <label className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground block mb-1">{c.label}</label>}
                  <Input
                    type={c.type || "text"}
                    value={it[c.k] ?? ""}
                    onChange={(e) => setItem(i, c.k, e.target.value)}
                    data-testid={`${idPrefix}-item-${i}-${c.k}`}
                    className="h-8 rounded-sm bg-input border-border text-xs"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => entry.items.length > 1 && onChange({ ...entry, items: entry.items.filter((_, j) => j !== i) })}
                className={`p-2 transition-colors ${entry.items.length > 1 ? "text-muted-foreground hover:text-red-400" : "text-muted-foreground/30 cursor-not-allowed"}`}
                data-testid={`${idPrefix}-remove-item-${i}`} aria-label="Remove item"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Section title="Packing">
        <Field label="Number of Boxes" k="boxes" type="number" {...{ entry, onChange, idPrefix }} />
        <Field label="Gross Weight" k="gross_weight" {...{ entry, onChange, idPrefix }} />
        <Field label="Net Weight" k="net_weight" {...{ entry, onChange, idPrefix }} />
      </Section>
      <Section title="Transport">
        <Field label="Vehicle Number" k="vehicle_number" {...{ entry, onChange, idPrefix }} />
        <Field label="LR Number" k="lr_number" {...{ entry, onChange, idPrefix }} />
        <Field label="Transporter Name" k="transporter_name" {...{ entry, onChange, idPrefix }} />
      </Section>
      <Section title="Tax" cols={5}>
        <Field label="CGST" k="cgst" type="number" {...{ entry, onChange, idPrefix }} />
        <Field label="SGST" k="sgst" type="number" {...{ entry, onChange, idPrefix }} />
        <Field label="IGST" k="igst" type="number" {...{ entry, onChange, idPrefix }} />
        <Field label="GST Total" k="gst_total" type="number" {...{ entry, onChange, idPrefix }} />
        <Field label="Invoice Total" k="invoice_total" type="number" {...{ entry, onChange, idPrefix }} />
      </Section>
      <Section title="Other">
        <Field label="E-Way Bill Number" k="eway_bill_number" {...{ entry, onChange, idPrefix }} />
        <Field label="IRN" k="irn" {...{ entry, onChange, idPrefix }} />
        <Field label="ACK Number" k="ack_number" {...{ entry, onChange, idPrefix }} />
        <Field label="Remarks" k="remarks" {...{ entry, onChange, idPrefix }} />
        <div>
          <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Status</label>
          <select
            value={entry.status || "pending"}
            onChange={(e) => onChange({ ...entry, status: e.target.value })}
            data-testid={`${idPrefix}-status`}
            className="h-9 w-full rounded-sm bg-input border border-border text-sm px-3 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </Section>
    </div>
  );
}
