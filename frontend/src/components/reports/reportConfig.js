export const STATUS_BADGE = {
  Completed: "border-emerald-500/50 text-emerald-400 bg-emerald-500/10",
  Pending: "border-amber-500/50 text-amber-400 bg-amber-500/10",
  Failed: "border-red-500/50 text-red-400 bg-red-500/10",
};

export const EMPTY_FILTERS = {
  search: "", invoice: "", customer: "", vendor: "", plant: "", transporter: "", vehicle: "",
  packing_slip: "", asn: "", eway: "", po: "", part: "", description: "",
  inv_from: "", inv_to: "", dispatch_from: "", dispatch_to: "",
  packing_status: "", asn_status: "", eway_status: "", vendor_ack_status: "", pdi_status: "",
};

export const COLUMNS = [
  { k: "invoice_number", label: "Invoice Number", w: 130 },
  { k: "invoice_date", label: "Invoice Date", w: 105 },
  { k: "customer_name", label: "Customer", w: 170 },
  { k: "plant", label: "Plant", w: 150 },
  { k: "part_numbers", label: "Part Number", w: 140 },
  { k: "quantity", label: "Quantity", w: 80 },
  { k: "packing_status", label: "Packing Slip", w: 105, status: true },
  { k: "asn_status", label: "ASN", w: 95, status: true },
  { k: "eway_status", label: "E-Way Bill", w: 100, status: true },
  { k: "vendor_ack_status", label: "Vendor Ack", w: 105, status: true },
  { k: "pdi_status", label: "PDI", w: 90, status: true },
  { k: "dispatch_date", label: "Dispatch Date", w: 110 },
  { k: "transporter_name", label: "Transporter", w: 140, hidden: true },
  { k: "vehicle_number", label: "Vehicle", w: 110, hidden: true },
  { k: "po_number", label: "PO Number", w: 110, hidden: true },
  { k: "asn_no", label: "ASN Number", w: 120, hidden: true },
  { k: "eway_bill_number", label: "E-Way Bill No", w: 130, hidden: true },
  { k: "boxes", label: "Boxes", w: 70, hidden: true },
];

export const DEFAULT_VISIBLE = COLUMNS.filter((c) => !c.hidden).map((c) => c.k);

export function downloadBlob(data, filename) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
