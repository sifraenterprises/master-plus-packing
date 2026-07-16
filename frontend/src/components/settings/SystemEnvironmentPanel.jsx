import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldWarning, Flask, Broadcast, Wrench, Prohibit, Play } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

const LIVE_PHRASE = "ACTIVATE LIVE MODE";
const MODE_META = {
  test: { label: "TEST MODE", desc: "Safe testing — external submission disabled", tone: "border-amber-500/50 text-amber-500", Icon: Flask },
  live: { label: "LIVE MODE", desc: "Production operations enabled", tone: "border-emerald-500/50 text-emerald-500", Icon: Broadcast },
  maintenance: { label: "MAINTENANCE", desc: "New portal automation blocked", tone: "border-sky-500/50 text-sky-500", Icon: Wrench },
};

export default function SystemEnvironmentPanel() {
  const [env, setEnv] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // {target} | {action:'stop'|'resume'}
  const [form, setForm] = useState({ reason: "", password: "", phrase: "", ack: false, overrideReason: "" });
  const [needsOverride, setNeedsOverride] = useState(false);

  const load = useCallback(() => {
    api.get("/admin/environment").then((r) => setEnv(r.data)).catch(() => {});
    api.get("/admin/environment/audit?limit=20").then((r) => setAudit(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const runReadiness = async () => {
    setBusy(true);
    try {
      const r = await api.get("/admin/environment/readiness");
      setReadiness(r.data);
      toast[r.data.ready ? "success" : "error"](r.data.ready
        ? `SYSTEM READY FOR LIVE MODE (${r.data.warnings} warning(s))`
        : `${r.data.critical_failures} critical check(s) FAILED`);
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  const openChange = (target) => {
    setForm({ reason: "", password: "", phrase: "", ack: false, overrideReason: "" });
    setNeedsOverride(false);
    setDialog({ target });
  };

  const submitChange = async (overrideWarnings = false) => {
    setBusy(true);
    try {
      const r = await api.put("/admin/environment", {
        mode: dialog.target, reason: form.reason, password: form.password,
        confirm_phrase: form.phrase, acknowledge: form.ack,
        override_warnings: overrideWarnings, override_reason: form.overrideReason,
      });
      setEnv(r.data);
      toast.success(`${MODE_META[r.data.mode].label} is now active`);
      setDialog(null);
      load();
      window.dispatchEvent(new Event("env-changed"));
    } catch (err) {
      const d = err?.response?.data?.detail;
      if (d?.code === "warnings") { setNeedsOverride(true); toast.warning("Readiness warnings — provide an override reason to proceed"); }
      else toast.error(apiError(err));
    } finally { setBusy(false); }
  };

  const stopResume = async () => {
    setBusy(true);
    try {
      const path = dialog.action === "stop" ? "emergency-stop" : "resume";
      const r = await api.post(`/admin/environment/${path}`, { reason: form.reason, password: form.password });
      setEnv(r.data);
      toast.success(dialog.action === "stop" ? "EMERGENCY STOP activated" : "Live automation resumed");
      setDialog(null);
      load();
      window.dispatchEvent(new Event("env-changed"));
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  if (!env) return null;
  const meta = MODE_META[env.mode];
  const liveReady = form.password && form.phrase === LIVE_PHRASE && form.ack && form.reason.trim();

  return (
    <div className="space-y-5" data-testid="system-environment-panel">
      <div className="border border-border bg-card rounded-sm p-4 space-y-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">System Environment</p>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className={`rounded-sm text-sm font-black px-3 py-1.5 gap-2 ${meta.tone}`} data-testid="env-current-mode">
            <meta.Icon size={16} weight="fill" /> {meta.label}
          </Badge>
          <span className="text-xs text-muted-foreground">{meta.desc}</span>
          {env.live_automation_stopped && (
            <Badge variant="outline" className="rounded-sm text-xs border-red-500/50 text-red-400 gap-1" data-testid="env-emergency-badge">
              <Prohibit size={12} weight="fill" /> EMERGENCY STOP ACTIVE
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Changed by <b>{env.changed_by || "—"}</b> · {(env.changed_at || "").slice(0, 16).replace("T", " ") || "never"} · reason: {env.reason || "—"} · v{env.version}
        </p>
        <div className="flex flex-wrap gap-2">
          {["test", "live", "maintenance"].map((m) => (
            <Button key={m} size="sm" variant={env.mode === m ? "default" : "secondary"} disabled={env.mode === m || busy}
                    onClick={() => openChange(m)} data-testid={`env-switch-${m}`} className="rounded-sm h-8 text-xs uppercase font-bold">
              {MODE_META[m].label}
            </Button>
          ))}
          <div className="flex-1" />
          {env.live_automation_stopped ? (
            <Button size="sm" variant="secondary" onClick={() => { setForm({ reason: "", password: "", phrase: "", ack: false, overrideReason: "" }); setDialog({ action: "resume" }); }}
                    data-testid="env-resume-btn" className="rounded-sm h-8 text-xs gap-1 text-emerald-500"><Play size={13} /> RESUME LIVE AUTOMATION</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => { setForm({ reason: "", password: "", phrase: "", ack: false, overrideReason: "" }); setDialog({ action: "stop" }); }}
                    data-testid="env-emergency-stop-btn" className="rounded-sm h-8 text-xs gap-1 text-red-400 border border-red-500/40"><Prohibit size={13} /> EMERGENCY STOP LIVE AUTOMATION</Button>
          )}
        </div>
      </div>

      <div className="border border-border bg-card rounded-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Live Readiness Check</p>
          <Button size="sm" onClick={runReadiness} disabled={busy} data-testid="env-readiness-btn" className="rounded-sm h-8 text-xs">
            {busy ? "Checking…" : "RUN FULL SYSTEM VALIDATION"}
          </Button>
        </div>
        {readiness && (
          <div className="space-y-1" data-testid="env-readiness-results">
            <p className={`text-xs font-bold ${readiness.ready ? "text-emerald-500" : "text-red-400"}`}>
              {readiness.ready ? "SYSTEM READY FOR LIVE MODE" : `${readiness.critical_failures} CRITICAL FAILURE(S) — LIVE activation blocked`}
              {readiness.warnings > 0 && ` · ${readiness.warnings} warning(s)`}
            </p>
            {readiness.checks.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] border border-border rounded-sm px-2.5 py-1">
                <span>{c.name}{c.detail ? ` — ${c.detail}` : ""}</span>
                <span className={`font-bold ${c.status === "PASS" ? "text-emerald-500" : c.status === "WARNING" ? "text-amber-500" : "text-red-400"}`}>{c.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border border-border bg-card rounded-sm p-4 space-y-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Environment Audit History</p>
        <div className="max-h-56 overflow-y-auto space-y-1" data-testid="env-audit-list">
          {audit.map((a, i) => (
            <div key={i} className="text-[11px] border border-border rounded-sm px-2.5 py-1.5 flex justify-between gap-2">
              <span className="truncate"><b>{a.action}</b> · {a.username} ({a.role}) · {a.reason || "—"}</span>
              <span className="text-muted-foreground shrink-0">{(a.created_at || "").slice(0, 16).replace("T", " ")}</span>
            </div>
          ))}
          {audit.length === 0 && <p className="text-[11px] text-muted-foreground">No environment actions yet.</p>}
        </div>
      </div>

      {dialog?.target && (
        <Dialog open onOpenChange={(v) => !v && setDialog(null)}>
          <DialogContent className="max-w-md rounded-sm" data-testid="env-change-dialog">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold flex items-center gap-2">
                {dialog.target === "live" && <ShieldWarning size={16} className="text-red-400" />}
                Switch to {MODE_META[dialog.target].label}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {dialog.target === "live" && (
                <div className="border border-red-500/40 bg-red-500/5 rounded-sm p-3 text-xs space-y-1" data-testid="env-live-warning">
                  <p className="font-bold text-red-400">Real transactions may be submitted to the TAFE portal.</p>
                  <p className="text-muted-foreground">Current mode: <b>{env.mode}</b> → New mode: <b>live</b> · Admin: <b>{env.changed_by || "admin"}</b> · {new Date().toLocaleString()}</p>
                </div>
              )}
              <div>
                <p className="text-[11px] text-muted-foreground mb-1">Reason (required)</p>
                <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                       data-testid="env-reason-input" className="h-8 rounded-sm bg-input border-border text-xs" placeholder="Why are you changing the mode?" />
              </div>
              {dialog.target === "live" && (
                <>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">Re-enter your admin password</p>
                    <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                           data-testid="env-password-input" className="h-8 rounded-sm bg-input border-border text-xs" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">Type: <span className="font-mono font-bold">{LIVE_PHRASE}</span></p>
                    <Input value={form.phrase} onChange={(e) => setForm({ ...form, phrase: e.target.value })}
                           data-testid="env-phrase-input" className="h-8 rounded-sm bg-input border-border text-xs font-mono" />
                  </div>
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <Checkbox checked={form.ack} onCheckedChange={(v) => setForm({ ...form, ack: !!v })} data-testid="env-ack-checkbox" className="rounded-sm mt-0.5" />
                    <span>I understand that LIVE mode can submit real data to the TAFE portal.</span>
                  </label>
                  {needsOverride && (
                    <div>
                      <p className="text-[11px] text-amber-500 mb-1">Readiness warnings present — override reason (required)</p>
                      <Input value={form.overrideReason} onChange={(e) => setForm({ ...form, overrideReason: e.target.value })}
                             data-testid="env-override-input" className="h-8 rounded-sm bg-input border-border text-xs" />
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDialog(null)} className="rounded-sm h-8 text-xs">Cancel</Button>
                <Button size="sm" onClick={() => submitChange(needsOverride)} data-testid="env-confirm-btn"
                        disabled={busy || !form.reason.trim() || (dialog.target === "live" && (!liveReady || (needsOverride && !form.overrideReason.trim())))}
                        className={`rounded-sm h-8 text-xs ${dialog.target === "live" ? "bg-red-500 hover:bg-red-600 text-white" : ""}`}>
                  {busy ? "Switching…" : `Activate ${MODE_META[dialog.target].label}`}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {dialog?.action && (
        <Dialog open onOpenChange={(v) => !v && setDialog(null)}>
          <DialogContent className="max-w-md rounded-sm" data-testid="env-stop-dialog">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold text-red-400">
                {dialog.action === "stop" ? "EMERGENCY STOP LIVE AUTOMATION" : "Resume Live Automation"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {dialog.action === "stop"
                  ? "Blocks all new live automation and pauses queued live jobs. Running jobs stop at the safest checkpoint. No records are deleted."
                  : "Live automation jobs will be allowed to start again."}
              </p>
              <Input placeholder="Reason (required)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                     data-testid="env-stop-reason" className="h-8 rounded-sm bg-input border-border text-xs" />
              <Input type="password" placeholder="Admin password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                     data-testid="env-stop-password" className="h-8 rounded-sm bg-input border-border text-xs" />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDialog(null)} className="rounded-sm h-8 text-xs">Cancel</Button>
                <Button size="sm" onClick={stopResume} disabled={busy || !form.reason.trim() || !form.password}
                        data-testid="env-stop-confirm" className="rounded-sm h-8 text-xs bg-red-500 hover:bg-red-600 text-white">
                  Confirm
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
