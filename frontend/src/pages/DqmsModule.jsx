import { useCallback, useEffect, useMemo, useState } from "react";
import { Checks, Play, ArrowsClockwise, ShieldCheck, Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EMPTY = {
  part_number: "",
  part_name: "",
  process: "",
  machine: "",
  operator: "",
  inspector: "",
  shift: "",
  quantity: "",
  remarks: "",
  dimension_source: "manual",
  pdi_template: "",
  characteristics: [],
  stop_before_create: true,
};

const FIELD_MASTERS = {
  process: "processes",
  machine: "machines",
  operator: "operators",
  inspector: "inspectors",
  shift: "shifts",
};

const statusTone = {
  Queued: "border-sky-500/60 text-sky-400",
  Running: "border-amber-500/60 text-amber-400",
  "Ready for Review": "border-purple-500/60 text-purple-400",
  Completed: "border-emerald-500/60 text-emerald-400",
  Failed: "border-red-500/60 text-red-400",
};

export default function DqmsModule() {
  const [form, setForm] = useState(EMPTY);
  const [masters, setMasters] = useState({
    parts: [], processes: [], machines: [], operators: [], inspectors: [], shifts: [],
  });
  const [rows, setRows] = useState([]);
  const [workerOnline, setWorkerOnline] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [masterRes, batchRes, statusRes] = await Promise.all([
        api.get("/dqms/masters"),
        api.get("/dqms/batches", { params: { limit: 100 } }),
        api.get("/dqms/status"),
      ]);
      setMasters(masterRes.data);
      setRows(batchRes.data.items || []);
      setWorkerOnline(!!statusRes.data.worker_online);
    } catch {
      // Global API interceptor displays the error.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const selectedPart = useMemo(
    () => masters.parts.find((part) => part.code === form.part_number),
    [masters.parts, form.part_number],
  );

  const update = (key, value) => {
    if (key === "part_number") {
      const part = masters.parts.find((item) => item.code === value);
      setForm((old) => ({ ...old, part_number: value, part_name: part?.name || "" }));
      return;
    }
    setForm((old) => ({ ...old, [key]: value }));
  };

  const addCharacteristic = () => update("characteristics", [
    ...form.characteristics,
    { name: "", nominal: "", lower_limit: "", upper_limit: "", measured_value: "", unit: "mm" },
  ]);

  const updateCharacteristic = (index, key, value) => update(
    "characteristics",
    form.characteristics.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [key]: value } : item
    )),
  );

  const removeCharacteristic = (index) => update(
    "characteristics",
    form.characteristics.filter((_, itemIndex) => itemIndex !== index),
  );

  const submit = async () => {
    const required = ["part_number", "process", "machine", "operator", "inspector", "shift"];
    const missing = required.filter((key) => !String(form[key] || "").trim());
    if (missing.length) {
      toast.error(`Complete required fields: ${missing.join(", ")}`);
      return;
    }
    if (!workerOnline) {
      toast.error("The desktop worker is offline or does not yet have DQMS capability");
      return;
    }
    setBusy(true);
    try {
      await api.post("/dqms/batches", {
        ...form,
        quantity: form.quantity ? Number(form.quantity) : null,
        part_name: selectedPart?.name || form.part_name,
        characteristics: form.characteristics.map((item) => ({
          ...item,
          nominal: item.nominal === "" ? null : Number(item.nominal),
          lower_limit: Number(item.lower_limit),
          upper_limit: Number(item.upper_limit),
          measured_value: item.measured_value === "" ? null : Number(item.measured_value),
        })),
      });
      toast.success(form.stop_before_create
        ? "DQMS dry run queued — worker will stop before Create Batch"
        : "DQMS batch creation queued");
      setForm(EMPTY);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not queue DQMS batch");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl space-y-6" data-testid="dqms-page">
      <div>
        <div className="flex items-center gap-3">
          <Checks size={28} weight="duotone" className="text-primary" />
          <h1 className="text-2xl font-black uppercase tracking-tight">TMTL DQMS Automation</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Queue a DQMS batch for the single desktop worker. BlueStacks credentials remain on the office computer.
        </p>
      </div>

      <div className="border border-border rounded-sm bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-black uppercase tracking-wide text-sm">New DQMS Batch</h2>
          <Badge variant="outline" className={workerOnline
            ? "border-emerald-500/60 text-emerald-400"
            : "border-red-500/60 text-red-400"}>
            Worker {workerOnline ? "Online" : "Offline"}
          </Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="uppercase tracking-wider text-muted-foreground">Part *</span>
            <Input list="dqms-part-values" value={form.part_number}
                   onChange={(e) => update("part_number", e.target.value)}
                   placeholder="Select or enter a new part number" data-testid="dqms-part" />
            <datalist id="dqms-part-values">
              {masters.parts.map((part) => (
                <option key={part.code} value={part.code}>{part.name}</option>
              ))}
            </datalist>
          </label>
          <label className="space-y-1 text-xs">
            <span className="uppercase tracking-wider text-muted-foreground">Part name</span>
            <Input value={form.part_name} onChange={(e) => update("part_name", e.target.value)}
                   placeholder="Required for a new part" />
          </label>

          {Object.entries(FIELD_MASTERS).map(([field, masterKey]) => (
            <label className="space-y-1 text-xs" key={field}>
              <span className="uppercase tracking-wider text-muted-foreground">{field} *</span>
              <Input list={`dqms-${field}-values`} value={form[field]}
                     onChange={(e) => update(field, e.target.value)}
                     placeholder={`Enter or select ${field}`} data-testid={`dqms-${field}`} />
              <datalist id={`dqms-${field}-values`}>
                {(masters[masterKey] || []).map((value) => (
                  <option value={typeof value === "string" ? value : value.name} key={typeof value === "string" ? value : value.name} />
                ))}
              </datalist>
            </label>
          ))}

          <label className="space-y-1 text-xs">
            <span className="uppercase tracking-wider text-muted-foreground">Quantity</span>
            <Input type="number" min="1" value={form.quantity}
                   onChange={(e) => update("quantity", e.target.value)}
                   placeholder="Optional" data-testid="dqms-quantity" />
          </label>
          <label className="space-y-1 text-xs md:col-span-2">
            <span className="uppercase tracking-wider text-muted-foreground">Remarks</span>
            <Input value={form.remarks} onChange={(e) => update("remarks", e.target.value)}
                   placeholder="Optional operator note" data-testid="dqms-remarks" />
          </label>
        </div>

        <div className="border border-border rounded-sm p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wide">Dimensions & Tolerances</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Leave Value blank and the worker will use the midpoint of the allowed range.
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addCharacteristic} className="gap-1">
              <Plus size={14} /> Add dimension
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="uppercase tracking-wider text-muted-foreground">Dimension source</span>
              <select value={form.dimension_source}
                      onChange={(e) => update("dimension_source", e.target.value)}
                      className="w-full h-10 bg-input border border-border rounded-sm px-3">
                <option value="manual">Manual</option>
                <option value="pdi_template">PDI template</option>
              </select>
            </label>
            {form.dimension_source === "pdi_template" && (
              <label className="space-y-1 text-xs">
                <span className="uppercase tracking-wider text-muted-foreground">PDI template name/path *</span>
                <Input value={form.pdi_template}
                       onChange={(e) => update("pdi_template", e.target.value)}
                       placeholder="Template name or worker-local path" />
              </label>
            )}
          </div>
          {form.characteristics.map((item, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-7 items-end">
              {[
                ["name", "Dimension", "text"],
                ["nominal", "Nominal", "number"],
                ["lower_limit", "Minimum", "number"],
                ["upper_limit", "Maximum", "number"],
                ["measured_value", "Value", "number"],
                ["unit", "Unit", "text"],
              ].map(([key, label, type]) => (
                <label className="space-y-1 text-xs" key={key}>
                  <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
                  <Input type={type} step={type === "number" ? "any" : undefined}
                         value={item[key]}
                         onChange={(e) => updateCharacteristic(index, key, e.target.value)} />
                </label>
              ))}
              <Button type="button" variant="ghost" size="icon"
                      onClick={() => removeCharacteristic(index)} aria-label="Remove dimension">
                <Trash size={16} className="text-red-400" />
              </Button>
            </div>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox checked={form.stop_before_create}
                    onCheckedChange={(checked) => update("stop_before_create", !!checked)}
                    data-testid="dqms-stop-before-create" />
          <ShieldCheck size={17} className="text-purple-400" />
          Stop before final Create Batch action (recommended)
        </label>

        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy || !workerOnline}
                  className="gap-2 rounded-sm" data-testid="dqms-queue">
            <Play size={15} weight="fill" /> {busy ? "Queuing…" : "Queue DQMS Batch"}
          </Button>
          <Button variant="secondary" onClick={load} className="gap-2 rounded-sm">
            <ArrowsClockwise size={15} /> Refresh
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-sm overflow-x-auto">
        <Table data-testid="dqms-history">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              {["Created", "Part", "Process", "Machine", "Operator", "Inspector", "Shift", "Status", "Batch No.", "Message"].map((heading) => (
                <TableHead key={heading} className="text-[10px] uppercase tracking-wider whitespace-nowrap">{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length ? (
              <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                No DQMS jobs have been queued.
              </TableCell></TableRow>
            ) : rows.map((row) => (
              <TableRow key={row.id} className="border-border">
                <TableCell className="text-xs whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</TableCell>
                <TableCell className="text-xs font-mono whitespace-nowrap">{row.part_number}<br /><span className="font-sans text-muted-foreground">{row.part_name}</span></TableCell>
                <TableCell className="text-xs">{row.process}</TableCell>
                <TableCell className="text-xs">{row.machine}</TableCell>
                <TableCell className="text-xs">{row.operator}</TableCell>
                <TableCell className="text-xs">{row.inspector}</TableCell>
                <TableCell className="text-xs">{row.shift}</TableCell>
                <TableCell><Badge variant="outline" className={`text-[9px] whitespace-nowrap ${statusTone[row.status] || "border-border"}`}>{row.status}</Badge></TableCell>
                <TableCell className="text-xs font-mono">{row.batch_number || "—"}</TableCell>
                <TableCell className="text-xs max-w-[240px] truncate" title={row.error_message}>{row.error_message || row.result?.message || ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
