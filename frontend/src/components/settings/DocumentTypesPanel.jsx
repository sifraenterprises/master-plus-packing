import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Files } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import api, { apiError } from "@/lib/api";

export const DocumentTypesPanel = () => {
  const [types, setTypes] = useState([]);
  const [label, setLabel] = useState("");

  const load = () => api.get("/documents/types").then((r) => setTypes(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!label.trim()) return;
    try {
      await api.post("/documents/types", { key: label.trim().toUpperCase().replace(/\s+/g, "_"), label: label.trim() });
      toast.success("Document type added");
      setLabel("");
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  const update = async (t, field, value) => {
    try {
      await api.put(`/documents/types/${t.key}`, { [field]: value });
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  return (
    <div className="border border-border bg-card rounded-sm p-4" data-testid="document-types-panel">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1 flex items-center gap-1.5">
        <Files size={14} className="text-primary" /> Dispatch Document Types
      </p>
      <p className="text-[11px] text-muted-foreground mb-3">
        Data-driven document config: ASN automation blocks dispatches missing any document marked "Required for ASN". New types need zero code changes.
      </p>
      <div className="flex gap-2 mb-3">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
               placeholder="Add document type (e.g. Material Test Certificate)…" data-testid="doc-types-input"
               className="h-8 rounded-sm bg-input border-border text-xs" />
        <Button size="sm" onClick={add} data-testid="doc-types-add" className="rounded-sm h-8 gap-1"><Plus size={13} /> Add</Button>
      </div>
      <div className="space-y-1">
        {types.map((t) => (
          <div key={t.key} className={`flex items-center justify-between border border-border rounded-sm px-2.5 py-1.5 bg-background text-xs ${!t.active ? "opacity-50" : ""}`}
               data-testid={`doc-type-${t.key}`}>
            <span className="flex items-center gap-1.5">
              {t.label} <Badge variant="outline" className="rounded-sm text-[8px] font-mono">{t.key}</Badge>
            </span>
            <div className="flex items-center gap-4 shrink-0 ml-2">
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                Required for ASN
                <Switch checked={t.required_for_asn} onCheckedChange={(v) => update(t, "required_for_asn", v)}
                        data-testid={`doc-type-required-${t.key}`} className="scale-75" />
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                Active
                <Switch checked={t.active} onCheckedChange={(v) => update(t, "active", v)}
                        data-testid={`doc-type-active-${t.key}`} className="scale-75" />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
