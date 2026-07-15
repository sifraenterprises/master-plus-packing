import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash, Factory, Truck, UserCircle, SealCheck } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api, { apiError } from "@/lib/api";
import { PeopleMasterList } from "./PeopleMasterList";
import { DocumentTypesPanel } from "./DocumentTypesPanel";

const MasterList = ({ title, icon: Icon, endpoint, testKey }) => {
  const [items, setItems] = useState([]);
  const [value, setValue] = useState("");

  const load = () => api.get(endpoint).then((r) => setItems(r.data)).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const add = async () => {
    if (!value.trim()) return;
    try {
      await api.post(endpoint, { name: value.trim() });
      toast.success(`${title.slice(0, -1)} added`);
      setValue("");
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const remove = async (name) => {
    try {
      await api.delete(`${endpoint}/${encodeURIComponent(name)}`);
      toast.success(`Removed "${name}"`);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div className="border border-border bg-card rounded-sm p-4" data-testid={`masters-${testKey}`}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-1.5">
        <Icon size={14} className="text-primary" /> {title} ({items.length})
      </p>
      <div className="flex gap-2 mb-3">
        <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
               placeholder={`Add ${title.slice(0, -1).toLowerCase()}…`} data-testid={`masters-${testKey}-input`}
               className="h-8 rounded-sm bg-input border-border text-xs" />
        <Button size="sm" onClick={add} data-testid={`masters-${testKey}-add`} className="rounded-sm h-8 gap-1">
          <Plus size={13} /> Add
        </Button>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {items.map((name) => (
          <div key={name} className="flex items-center justify-between border border-border rounded-sm px-2.5 py-1.5 bg-background text-xs" data-testid={`masters-${testKey}-item`}>
            <span className="truncate">{name}</span>
            <button onClick={() => remove(name)} className="text-muted-foreground hover:text-red-400 transition-colors shrink-0 ml-2"
                    data-testid={`masters-${testKey}-delete-${name}`} title="Remove">
              <Trash size={13} />
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">None configured.</p>}
      </div>
    </div>
  );
};

export const MastersPanel = () => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground">
      These master lists feed the dropdowns across Master Dispatch, ASN, E-Way Bill, Vendor Acknowledgement and AI PDI Generator modules.
    </p>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <MasterList title="Plants" icon={Factory} endpoint="/master-dispatch/plants" testKey="plants" />
      <MasterList title="Transporters" icon={Truck} endpoint="/master-dispatch/transporters" testKey="transporters" />
      <PeopleMasterList title="PDI Inspectors" icon={UserCircle} kind="inspectors" />
      <PeopleMasterList title="PDI Approvers" icon={SealCheck} kind="approvers" />
    </div>
    <DocumentTypesPanel />
  </div>
);
