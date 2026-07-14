import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FloppyDisk, Globe, CheckCircle, XCircle, Flask, ShieldCheck, ShieldWarning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

function ResultRow({ label, message, ok }) {
  return (
    <div className="flex items-start gap-2 text-xs font-mono">
      {ok
        ? <CheckCircle size={14} weight="fill" className="text-emerald-400 mt-0.5 shrink-0" />
        : <XCircle size={14} weight="fill" className="text-red-400 mt-0.5 shrink-0" />}
      <span className={`font-semibold ${ok ? "" : "text-red-400"}`}>{label}</span>
      <span className="text-muted-foreground">{message}</span>
    </div>
  );
}

export default function SelectorConfigTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [attemptLogin, setAttemptLogin] = useState(true);
  const [dryRunFill, setDryRunFill] = useState(true);
  const [results, setResults] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [status, setStatus] = useState(null);

  const refreshStatus = useCallback(() => {
    api.get("/eway/validation/status").then((r) => setStatus(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/eway/selectors").then((r) => setText(JSON.stringify(r.data, null, 2))).catch(() => {});
    refreshStatus();
  }, [refreshStatus]);

  const save = async () => {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast.error("Invalid JSON — fix syntax before saving");
      return;
    }
    setSaving(true);
    try {
      const r = await api.put("/eway/selectors", parsed);
      toast.success(r.data.changed ? "Selectors saved — re-run validations" : "Selectors saved (no changes)");
      refreshStatus();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    setValidating(true);
    setResults(null);
    try {
      const r = await api.post("/eway/portal/validate", { attempt_login: attemptLogin, dry_run_fill: dryRunFill });
      setResults(r.data);
      refreshStatus();
      r.data.all_ok
        ? toast.success("All portal checks passed")
        : toast.warning(`${r.data.passed}/${r.data.total} checks passed — failing selectors below`);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setValidating(false);
    }
  };

  const runTestValidation = async () => {
    setTesting(true);
    setTestResults(null);
    try {
      const r = await api.post("/eway/validation/test-run");
      setTestResults(r.data);
      refreshStatus();
      r.data.all_ok
        ? toast.success("TEST validation passed — all workflow stages verified")
        : toast.warning(`${r.data.passed}/${r.data.total} checks passed`);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setTesting(false);
    }
  };

  const pv = status?.portal_validation;
  const tv = status?.test_validation;

  return (
    <div className="space-y-6" data-testid="eway-selector-tab">
      <div className={`border rounded-sm p-4 flex items-start gap-3 ${status?.ready_for_live ? "border-emerald-500/40 bg-card" : "border-amber-500/40 bg-card"}`} data-testid="eway-readiness-banner">
        {status?.ready_for_live
          ? <ShieldCheck size={20} weight="duotone" className="text-emerald-400 shrink-0" />
          : <ShieldWarning size={20} weight="duotone" className="text-amber-400 shrink-0" />}
        <div className="text-xs">
          <p className="font-bold">
            {status?.ready_for_live
              ? "READY FOR LIVE — Admin may switch the E-Way Entry tab to LIVE mode."
              : "NOT READY FOR LIVE — complete both validations below. LIVE switch is blocked until they pass."}
          </p>
          <p className="mt-1 font-mono text-muted-foreground">
            1. Portal selector validation: {pv ? (pv.all_ok ? `PASSED (${pv.passed}/${pv.total})` : `INCOMPLETE — ${pv.passed}/${pv.total} passed${pv.failed_steps?.length ? ` — failing: ${pv.failed_steps.join(", ")}` : ""}`) : "not run yet"}
          </p>
          <p className="font-mono text-muted-foreground">
            2. TEST workflow validation: {tv ? (tv.all_ok ? `PASSED (${tv.passed}/${tv.total})` : `FAILED — ${tv.passed}/${tv.total} passed`) : "not run yet"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="border border-border bg-card rounded-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">portal_selectors.json</p>
            <Button size="sm" onClick={save} disabled={!isAdmin || saving} data-testid="eway-save-selectors" className="rounded-sm gap-1 h-8">
              <FloppyDisk size={14} weight="bold" /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            data-testid="eway-selectors-editor"
            className="w-full h-[480px] rounded-sm border border-border bg-background text-foreground font-mono text-[11px] p-3 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {!isAdmin && <p className="mt-2 text-[11px] text-amber-400">Read-only: Admin role required to modify selectors.</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">Saving changed selectors resets validation status — re-run both validations afterwards.</p>
        </div>

        <div className="space-y-6">
          <div className="border border-border bg-card rounded-sm p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-2">Step 1 — Live Portal Validation (Non-Destructive)</p>
            <p className="text-xs text-muted-foreground mb-3">
              Connects to the live TAFE portal and verifies login elements, navigation and every form selector. Never submits any form. Requires TAFE_PORTAL_URL / TAFE_USERNAME / TAFE_PASSWORD in backend .env.
            </p>
            <label className="flex items-center gap-2 text-xs mb-2">
              <input type="checkbox" checked={attemptLogin} onChange={(e) => setAttemptLogin(e.target.checked)} data-testid="eway-attempt-login" />
              Verify login + navigation + form selectors (required for LIVE readiness)
            </label>
            <label className="flex items-center gap-2 text-xs mb-3">
              <input type="checkbox" checked={dryRunFill} onChange={(e) => setDryRunFill(e.target.checked)} data-testid="eway-dry-run-fill" />
              Dry-run fill: enter sample data into the form and verify values (Submit is never clicked)
            </label>
            <Button size="sm" onClick={validate} disabled={!isAdmin || validating || testing} data-testid="eway-validate-portal" className="rounded-sm gap-1">
              <Globe size={14} /> {validating ? "Validating…" : "Validate Portal"}
            </Button>
            {results && (
              <div className="mt-4 space-y-1" data-testid="eway-validation-results">
                {results.results.map((r, i) => (
                  <ResultRow key={i} label={r.step} message={r.message} ok={r.status === "ok"} />
                ))}
              </div>
            )}
          </div>

          <div className="border border-border bg-card rounded-sm p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-2">Step 2 — TEST Mode Workflow Validation</p>
            <p className="text-xs text-muted-foreground mb-3">
              Runs a complete automation cycle on temporary sample records: login, navigation, form entry, submission, success detection, retry logic, failure screenshots, Master Dispatch sync and logging. Samples are removed afterwards.
            </p>
            <Button size="sm" variant="secondary" onClick={runTestValidation} disabled={!isAdmin || testing || validating} data-testid="eway-test-validation" className="rounded-sm gap-1">
              <Flask size={14} /> {testing ? "Running TEST validation…" : "Run TEST Validation"}
            </Button>
            {testResults && (
              <div className="mt-4 space-y-1" data-testid="eway-test-results">
                {testResults.checks.map((c, i) => (
                  <ResultRow key={i} label={c.check} message={c.detail} ok={c.status === "ok"} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
