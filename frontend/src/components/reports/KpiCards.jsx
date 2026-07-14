const CARDS = [
  { key: "today_dispatches", label: "Today's Dispatches", filter: (k) => ({ dispatch_from: k.today, dispatch_to: k.today }) },
  { key: "today_boxes", label: "Today's Boxes", filter: (k) => ({ dispatch_from: k.today, dispatch_to: k.today }) },
  { key: "month_dispatches", label: "This Month Dispatches", filter: (k) => ({ dispatch_from: `${k.today?.slice(0, 7)}-01`, dispatch_to: k.today }) },
  { key: "month_boxes", label: "This Month Boxes", filter: (k) => ({ dispatch_from: `${k.today?.slice(0, 7)}-01`, dispatch_to: k.today }) },
  { key: "pending_packing", label: "Pending Packing Slips", filter: () => ({ packing_status: "Pending" }), tone: "amber" },
  { key: "pending_asn", label: "Pending ASN", filter: () => ({ asn_status: "Pending" }), tone: "amber" },
  { key: "pending_eway", label: "Pending E-Way Bills", filter: () => ({ eway_status: "Pending" }), tone: "amber" },
  { key: "pending_vendor_ack", label: "Pending Vendor Ack", filter: () => ({ vendor_ack_status: "Pending" }), tone: "amber" },
  { key: "pending_dqms", label: "Pending DQMS", filter: () => ({ dqms_status: "Pending" }), tone: "amber" },
  { key: "completed_asn", label: "Completed ASN", filter: () => ({ asn_status: "Completed" }), tone: "green" },
  { key: "completed_eway", label: "Completed E-Way Bills", filter: () => ({ eway_status: "Completed" }), tone: "green" },
  { key: "completed_vendor_ack", label: "Completed Vendor Ack", filter: () => ({ vendor_ack_status: "Completed" }), tone: "green" },
  { key: "completed_dqms", label: "Completed DQMS", filter: () => ({ dqms_status: "Completed" }), tone: "green" },
];

const TONE = { amber: "text-amber-400", green: "text-emerald-400" };

export const KpiCards = ({ kpis, onApply }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-px bg-border border border-border rounded-sm overflow-hidden" data-testid="report-kpis">
    {CARDS.map((c) => (
      <button key={c.key} onClick={() => onApply(c.filter(kpis))} data-testid={`kpi-${c.key}`}
              className="bg-card p-3 text-left hover:bg-secondary/60 transition-colors cursor-pointer">
        <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground mb-1 leading-tight">{c.label}</p>
        <p className={`text-lg font-black font-mono ${TONE[c.tone] || ""}`}>{kpis[c.key] ?? "—"}</p>
      </button>
    ))}
  </div>
);
