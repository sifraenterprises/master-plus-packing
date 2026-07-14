import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts";

const ORANGE = "#F97316";
const GRID = "#333";
const AXIS = { fontSize: 10, fill: "#888" };
const TIP = { contentStyle: { background: "#18181b", border: "1px solid #333", borderRadius: 2, fontSize: 11 } };

const Panel = ({ title, children, testid }) => (
  <div className="border border-border bg-card rounded-sm p-4" data-testid={testid}>
    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">{title}</p>
    <div className="h-52">{children}</div>
  </div>
);

const HBar = ({ data, dataKey = "count" }) => (
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
      <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
      <XAxis type="number" tick={AXIS} stroke={GRID} allowDecimals={false} />
      <YAxis type="category" dataKey="name" tick={{ ...AXIS, width: 110 }} width={120} stroke={GRID}
             tickFormatter={(v) => (v.length > 18 ? v.slice(0, 17) + "…" : v)} />
      <Tooltip {...TIP} cursor={{ fill: "rgba(249,115,22,0.08)" }} />
      <Bar dataKey={dataKey} fill={ORANGE} radius={[0, 2, 2, 0]} barSize={14} />
    </BarChart>
  </ResponsiveContainer>
);

const Donut = ({ pct, label }) => (
  <div className="flex flex-col items-center justify-center h-full">
    <div className="relative w-32 h-32">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={[{ v: pct }, { v: 100 - pct }]} dataKey="v" innerRadius={44} outerRadius={58}
               startAngle={90} endAngle={-270} stroke="none">
            <Cell fill={pct >= 100 ? "#10b981" : ORANGE} />
            <Cell fill="#27272a" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-black font-mono">{pct}%</span>
      </div>
    </div>
    <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-1">{label}</p>
  </div>
);

export const ReportCharts = ({ charts }) => {
  if (!charts) return null;
  return (
    <div className="space-y-4 no-print" data-testid="report-charts">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Dispatches by Month" testid="chart-by-month">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.by_month}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={AXIS} stroke={GRID} />
              <YAxis tick={AXIS} stroke={GRID} allowDecimals={false} />
              <Tooltip {...TIP} cursor={{ fill: "rgba(249,115,22,0.08)" }} />
              <Bar dataKey="count" name="Dispatches" fill={ORANGE} radius={[2, 2, 0, 0]} barSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Boxes per Day (last 30 days)" testid="chart-boxes-day">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={charts.boxes_per_day}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={AXIS} stroke={GRID} tickFormatter={(v) => v?.slice(5)} />
              <YAxis tick={AXIS} stroke={GRID} allowDecimals={false} />
              <Tooltip {...TIP} />
              <Line type="monotone" dataKey="boxes" stroke={ORANGE} strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Dispatches by Customer" testid="chart-by-customer"><HBar data={charts.by_customer} /></Panel>
        <Panel title="Dispatches by Plant" testid="chart-by-plant"><HBar data={charts.by_plant} /></Panel>
        <Panel title="Dispatches by Transporter" testid="chart-by-transporter"><HBar data={charts.by_transporter} /></Panel>
        <div className="border border-border bg-card rounded-sm p-4" data-testid="chart-completion">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">Automation Completion</p>
          <div className="grid grid-cols-3 h-52">
            <Donut pct={charts.completion?.asn ?? 0} label="ASN" />
            <Donut pct={charts.completion?.eway ?? 0} label="E-Way Bill" />
            <Donut pct={charts.completion?.vendor_ack ?? 0} label="Vendor Ack" />
          </div>
        </div>
      </div>
    </div>
  );
};
