import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lightning, FileCsv } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api, { apiError } from "@/lib/api";
import { downloadBlob } from "./reportConfig";

const GROUP_LABEL = { customer: "Customer Dispatch", plant: "Plant Dispatch", transporter: "Transporter Dispatch", month: "Monthly Dispatch Summary" };

export const QuickReports = ({ onApply }) => {
  const navigate = useNavigate();
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [group, setGroup] = useState(null);
  const [groupSearch, setGroupSearch] = useState("");

  const openGroup = async (by) => {
    try {
      const { data } = await api.get("/reports/group", { params: { by } });
      setGroup(data);
      setGroupSearch("");
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const groupCsv = () => {
    const rows = [["Name", "Dispatches", "Boxes", "Value"], ...group.rows.map((r) => [r.name, r.dispatches, r.boxes, r.value])];
    downloadBlob(new Blob(["\ufeff" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")],
      { type: "text/csv" }), `${group.by}_dispatch_summary.csv`);
  };

  const PRESETS = [
    { label: "Daily Dispatch Summary", action: () => setDateOpen(true) },
    { label: "Invoice Register", action: () => onApply({}, { by: "invoice_number", dir: "asc" }) },
    { label: "Pending Packing", action: () => onApply({ packing_status: "Pending" }) },
    { label: "Pending ASN", action: () => onApply({ asn_status: "Pending" }) },
    { label: "Pending E-Way Bills", action: () => onApply({ eway_status: "Pending" }) },
    { label: "Pending Vendor Acknowledgement", action: () => onApply({ vendor_ack_status: "Pending" }) },
    { label: "Customer Dispatch", action: () => openGroup("customer") },
    { label: "Plant Dispatch", action: () => openGroup("plant") },
    { label: "Transporter Dispatch", action: () => openGroup("transporter") },
    { label: "Monthly Dispatch Summary", action: () => openGroup("month") },
  ];

  const filtered = group ? group.rows.filter((r) => r.name.toLowerCase().includes(groupSearch.toLowerCase())) : [];

  return (
    <div className="border border-border bg-card rounded-sm p-3" data-testid="quick-reports">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2 flex items-center gap-1.5">
        <Lightning size={13} className="text-primary" /> Quick Reports
      </p>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={p.action} data-testid={`quick-${p.label.toLowerCase().replace(/ /g, "-")}`}
                  className="text-[11px] px-2.5 py-1.5 border border-border rounded-sm bg-secondary/60 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors">
            {p.label}
          </button>
        ))}
      </div>

      <Dialog open={dateOpen} onOpenChange={setDateOpen}>
        <DialogContent className="max-w-xs bg-card border-border" data-testid="daily-summary-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">Daily Dispatch Summary</DialogTitle>
            <DialogDescription>Select the dispatch date to generate the printable register.</DialogDescription>
          </DialogHeader>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="daily-summary-date" className="rounded-sm bg-input border-border" />
          <Button onClick={() => date && navigate(`/portal/master-dispatch/daily-report?date=${date}`)} data-testid="daily-summary-go" className="rounded-sm">
            Generate Report
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!group} onOpenChange={(o) => !o && setGroup(null)}>
        <DialogContent className="max-w-xl bg-card border-border" data-testid="group-report-dialog">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">{GROUP_LABEL[group?.by] || ""}</DialogTitle>
            <DialogDescription>
              {group?.totals.dispatches} dispatches · {group?.totals.boxes} boxes · ₹{group?.totals.value?.toLocaleString("en-IN")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input placeholder="Search…" value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} data-testid="group-search" className="h-8 rounded-sm bg-input border-border text-xs" />
            <Button variant="secondary" size="sm" onClick={groupCsv} data-testid="group-export-csv" className="rounded-sm h-8 gap-1"><FileCsv size={13} /> CSV</Button>
          </div>
          <div className="border border-border rounded-sm max-h-[45vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-secondary sticky top-0">
                  {["Name", "Dispatches", "Boxes", "Value (₹)"].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.name} className="border-t border-border">
                    <td className="px-3 py-1.5 max-w-[220px] truncate">{r.name}</td>
                    <td className="px-3 py-1.5 font-mono">{r.dispatches}</td>
                    <td className="px-3 py-1.5 font-mono">{r.boxes}</td>
                    <td className="px-3 py-1.5 font-mono">{r.value?.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
