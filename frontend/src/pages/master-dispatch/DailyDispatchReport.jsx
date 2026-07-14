import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Printer, FilePdf, FileXls, ClipboardText } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api, { apiError } from "@/lib/api";

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { background: #fff !important; overflow: visible !important; }
  body * { visibility: hidden !important; }
  #daily-report-area, #daily-report-area * { visibility: visible !important; }
  #daily-report-area { position: absolute !important; left: 0; top: 0; width: 100%; margin: 0 !important; border: none !important; box-shadow: none !important; }
  #daily-report-area table { width: 100% !important; }
  #daily-report-area thead { display: table-header-group; }
  #daily-report-area tr { page-break-inside: avoid; }
}`;

export default function DailyDispatchReport() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [customer, setCustomer] = useState("");
  const [company, setCompany] = useState("");
  const [options, setOptions] = useState({ customers: [], companies: [] });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/master-dispatch/daily-report/options").then((r) => setOptions(r.data)).catch(() => {});
  }, []);

  const params = () => {
    const p = { date };
    if (customer) p.customer = customer;
    if (company) p.company = company;
    return p;
  };

  const generate = async () => {
    if (!date) return toast.error("Dispatch Date is required");
    setLoading(true);
    try {
      const { data } = await api.get("/master-dispatch/daily-report", { params: params() });
      setReport(data);
      if (data.rows.length === 0) toast.info("No dispatches found for the selected date");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  const exportFile = async (type) => {
    try {
      const res = await api.get(`/master-dispatch/daily-report/${type}`, { params: params(), responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daily_dispatch_${date}.${type === "pdf" ? "pdf" : "xlsx"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  return (
    <div className="max-w-4xl space-y-6" data-testid="daily-report-page">
      <style>{PRINT_CSS}</style>
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Master Dispatch</p>
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
          <ClipboardText size={32} weight="duotone" className="text-primary" /> Daily Dispatch Report
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Register-style daily summary of invoices and boxes dispatched — print-ready (A4 portrait).
        </p>
      </div>

      <div className="border border-border rounded-sm bg-card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Dispatch Date *</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="daily-report-date"
                 className="h-9 w-44 rounded-sm bg-input border-border" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Customer (optional)</label>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)} data-testid="daily-report-customer"
                  className="h-9 w-56 rounded-sm bg-input border border-border text-sm px-2 focus:outline-none">
            <option value="">All Customers</option>
            {options.customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground block mb-1">Company / Plant (optional)</label>
          <select value={company} onChange={(e) => setCompany(e.target.value)} data-testid="daily-report-company"
                  className="h-9 w-56 rounded-sm bg-input border border-border text-sm px-2 focus:outline-none">
            <option value="">All Companies</option>
            {options.companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Button onClick={generate} disabled={loading} data-testid="daily-report-generate" className="rounded-sm h-9">
          {loading ? "Generating…" : "Generate Report"}
        </Button>
      </div>

      {report && (
        <>
          <div className="flex flex-wrap gap-2" data-testid="daily-report-actions">
            <Button variant="secondary" onClick={() => window.print()} data-testid="daily-report-print" className="rounded-sm gap-1">
              <Printer size={14} /> Print
            </Button>
            <Button variant="secondary" onClick={() => exportFile("pdf")} data-testid="daily-report-export-pdf" className="rounded-sm gap-1">
              <FilePdf size={14} /> Export PDF
            </Button>
            <Button variant="secondary" onClick={() => exportFile("excel")} data-testid="daily-report-export-excel" className="rounded-sm gap-1">
              <FileXls size={14} /> Export Excel
            </Button>
            <span className="text-xs text-muted-foreground self-center ml-2" data-testid="daily-report-count">
              {report.rows.length} invoice(s) · {report.total_boxes} box(es)
            </span>
          </div>

          <div id="daily-report-area" data-testid="daily-report-area"
               className="bg-white text-black border border-border rounded-sm p-8 mx-auto w-full"
               style={{ fontFamily: "Arial, Calibri, sans-serif", fontSize: "11pt", maxWidth: "210mm" }}>
            <table className="w-full border-collapse" style={{ border: "1.5px solid #000" }}>
              <thead>
                <tr>
                  <th colSpan={4} style={{ border: "1px solid #000", padding: "8px", fontSize: "15pt", fontWeight: 800, textAlign: "center", letterSpacing: "0.05em" }}>
                    GREWAL ENGINEERING WORKS
                  </th>
                </tr>
                <tr>
                  <th colSpan={4} style={{ border: "1px solid #000", padding: "6px", fontSize: "12pt", fontWeight: 700, textAlign: "center" }}>
                    DAILY DISPATCH SUMMARY
                  </th>
                </tr>
                <tr>
                  <th colSpan={4} style={{ border: "1px solid #000", padding: "5px 10px", fontWeight: 700, textAlign: "right" }} data-testid="daily-report-date-display">
                    DATE :- {report.date_display}
                  </th>
                </tr>
                <tr>
                  <th style={{ border: "1px solid #000", padding: "5px", width: "15%", textAlign: "center" }}>SR.NO.</th>
                  <th style={{ border: "1px solid #000", padding: "5px", width: "50%", textAlign: "center" }}>INVOICE NUMBER</th>
                  <th style={{ border: "1px solid #000", padding: "5px", width: "17%", textAlign: "center" }}>QTY</th>
                  <th style={{ border: "1px solid #000", padding: "5px", width: "18%", textAlign: "center" }}>UNIT</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ border: "1px solid #000", padding: "14px", textAlign: "center" }} data-testid="daily-report-empty">
                      No dispatches on {report.date_display}
                    </td>
                  </tr>
                ) : (
                  report.rows.map((r) => (
                    <tr key={r.sr} data-testid={`daily-report-row-${r.sr}`}>
                      <td style={{ border: "1px solid #000", padding: "4px", textAlign: "center" }}>{r.sr}</td>
                      <td style={{ border: "1px solid #000", padding: "4px", textAlign: "center" }}>{r.invoice_number}</td>
                      <td style={{ border: "1px solid #000", padding: "4px 10px", textAlign: "right" }}>{r.qty}</td>
                      <td style={{ border: "1px solid #000", padding: "4px", textAlign: "center" }}>{r.unit}</td>
                    </tr>
                  ))
                )}
                <tr>
                  <td style={{ border: "1px solid #000", padding: "6px" }} />
                  <td style={{ border: "1px solid #000", padding: "6px 10px", textAlign: "right", fontWeight: 800 }}>Total :-</td>
                  <td style={{ border: "1px solid #000", padding: "6px 10px", textAlign: "right", fontWeight: 800 }} data-testid="daily-report-total">
                    {report.total_boxes}
                  </td>
                  <td style={{ border: "1px solid #000", padding: "6px", textAlign: "center", fontWeight: 800 }}>BOX</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
