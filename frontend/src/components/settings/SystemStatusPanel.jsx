import { useEffect, useState } from "react";
import { ArrowsClockwise, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";

const StatusDot = ({ ok }) => {
  const Icon = ok ? CheckCircle : WarningCircle;
  return <Icon size={16} weight="fill" className={ok ? "text-emerald-400" : "text-red-400"} />;
};

const Card = ({ title, ok, detail, children, testid }) => (
  <div className="border border-border bg-card rounded-sm p-4" data-testid={testid}>
    <div className="flex items-center justify-between mb-1.5">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      {ok !== undefined && <StatusDot ok={ok} />}
    </div>
    {detail && <p className="text-xs truncate">{detail}</p>}
    {children}
  </div>
);

const Meter = ({ percent }) => (
  <div className="h-1.5 bg-secondary rounded-sm mt-2 overflow-hidden">
    <div className={`h-full ${percent > 85 ? "bg-red-500" : percent > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
         style={{ width: `${Math.min(100, percent)}%` }} />
  </div>
);

export const SystemStatusPanel = () => {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/system/status");
      setS(data);
    } catch (err) { /* toast handled globally */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (!s) return <p className="text-sm text-muted-foreground py-6" data-testid="system-status-loading">Loading system status…</p>;

  return (
    <div className="space-y-4" data-testid="system-status-panel">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Version <span className="font-mono text-primary">v{s.version}</span> · uptime {s.uptime_hours}h ·
          automation mode <span className="font-mono uppercase text-primary">{s.automation.mode}</span>
        </p>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading} data-testid="system-status-refresh" className="rounded-sm h-8 gap-1">
          <ArrowsClockwise size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card title="Backend API" ok={s.api.ok} detail={s.api.detail} testid="status-api" />
        <Card title="MongoDB" ok={s.database.ok} detail={s.database.detail} testid="status-database">
          {s.database.ok && (
            <p className="text-[10px] text-muted-foreground mt-1 font-mono">
              {s.database.dispatches} dispatches · {s.database.asn_records} ASN · {s.database.eway_submissions} E-Way
            </p>
          )}
        </Card>
        <Card title="Playwright" ok={s.playwright.ok} detail={s.playwright.detail} testid="status-playwright" />
        <Card title="Gemini OCR" ok={s.gemini.ok} detail={s.gemini.detail} testid="status-gemini" />
        <Card title="Disk" ok={s.disk.percent < 85} detail={`${s.disk.used_gb} / ${s.disk.total_gb} GB (${s.disk.percent}%)`} testid="status-disk">
          <Meter percent={s.disk.percent} />
        </Card>
        <Card title="Memory" ok={s.memory.percent < 90} detail={`${s.memory.used_gb} / ${s.memory.total_gb} GB (${s.memory.percent}%)`} testid="status-memory">
          <Meter percent={s.memory.percent} />
        </Card>
        <Card title="CPU Load" ok={s.cpu.load_5m < s.cpu.cores} detail={`${s.cpu.load_1m} (1m) · ${s.cpu.load_5m} (5m) · ${s.cpu.cores} cores`} testid="status-cpu" />
        <Card title="Last Backup" ok={s.backup.ok} detail={s.backup.detail + (s.backup.age_hours != null ? ` · ${s.backup.age_hours}h ago` : "")} testid="status-backup" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="Automation Queues" testid="status-queues">
          <p className="text-xs font-mono">
            ASN: {s.automation.asn_queue.running ? `running (${s.automation.asn_queue.processed}/${s.automation.asn_queue.total})` : "idle"} ·
            E-Way: {s.automation.eway_queue.running ? "running" : "idle"} · headless {s.automation.headless}
          </p>
        </Card>
        <Card title="Recent Automation Failures" testid="status-failures">
          {s.recent_failures.length === 0 ? (
            <p className="text-xs text-emerald-400">No recent failures</p>
          ) : (
            <div className="space-y-1">
              {s.recent_failures.map((f, i) => (
                <p key={i} className="text-[10px] font-mono text-red-400 truncate">
                  {f.invoice_no || f.invoice_number}: {(f.error_message || f.error || "").slice(0, 70)}
                </p>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
