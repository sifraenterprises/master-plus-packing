import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Check, X, PencilSimple, Power } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import api, { apiError } from "@/lib/api";

export const PeopleMasterList = ({ title, icon: Icon, kind }) => {
  const [items, setItems] = useState([]);
  const [value, setValue] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");

  const load = () => api.get(`/pdi/masters/${kind}/manage`).then((r) => setItems(r.data)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!value.trim()) return;
    try {
      await api.post(`/pdi/masters/${kind}`, { name: value.trim() });
      toast.success(`${title.slice(0, -1)} added`);
      setValue("");
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  const saveEdit = async (id) => {
    try {
      await api.put(`/pdi/masters/${kind}/${id}`, { name: editName.trim() });
      toast.success("Renamed");
      setEditId(null);
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  const toggle = async (item) => {
    try {
      await api.put(`/pdi/masters/${kind}/${item.id}`, { active: !item.active });
      toast.success(item.active ? `"${item.name}" deactivated` : `"${item.name}" activated`);
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  return (
    <div className="border border-border bg-card rounded-sm p-4" data-testid={`masters-${kind}`}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-1.5">
        <Icon size={14} className="text-primary" /> {title} ({items.filter((i) => i.active).length} active / {items.length})
      </p>
      <div className="flex gap-2 mb-3">
        <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
               placeholder={`Add ${title.slice(0, -1).toLowerCase()}…`} data-testid={`masters-${kind}-input`}
               className="h-8 rounded-sm bg-input border-border text-xs" />
        <Button size="sm" onClick={add} data-testid={`masters-${kind}-add`} className="rounded-sm h-8 gap-1">
          <Plus size={13} /> Add
        </Button>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {items.map((item) => (
          <div key={item.id} className={`flex items-center justify-between border border-border rounded-sm px-2.5 py-1.5 bg-background text-xs ${!item.active ? "opacity-50" : ""}`}
               data-testid={`masters-${kind}-item`}>
            {editId === item.id ? (
              <div className="flex items-center gap-1.5 flex-1">
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                       onKeyDown={(e) => e.key === "Enter" && saveEdit(item.id)}
                       data-testid={`masters-${kind}-edit-input`}
                       className="h-6 rounded-sm bg-input border-border text-xs px-1.5" />
                <button onClick={() => saveEdit(item.id)} className="text-emerald-500" title="Save" data-testid={`masters-${kind}-edit-save`}><Check size={14} /></button>
                <button onClick={() => setEditId(null)} className="text-muted-foreground" title="Cancel"><X size={14} /></button>
              </div>
            ) : (
              <>
                <span className="truncate flex items-center gap-1.5">
                  {item.name}
                  {!item.active && <Badge variant="outline" className="rounded-sm text-[8px] uppercase">inactive</Badge>}
                </span>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button onClick={() => { setEditId(item.id); setEditName(item.name); }} title="Rename"
                          data-testid={`masters-${kind}-edit-${item.name}`}
                          className="text-muted-foreground hover:text-primary transition-colors"><PencilSimple size={13} /></button>
                  <button onClick={() => toggle(item)} title={item.active ? "Deactivate" : "Activate"}
                          data-testid={`masters-${kind}-toggle-${item.name}`}
                          className={`transition-colors ${item.active ? "text-emerald-500 hover:text-red-400" : "text-muted-foreground hover:text-emerald-500"}`}><Power size={13} /></button>
                </div>
              </>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">None configured.</p>}
      </div>
    </div>
  );
};
