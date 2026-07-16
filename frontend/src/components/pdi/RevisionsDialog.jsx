import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function RevisionsDialog({ template, onClose, onRestored }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [revisions, setRevisions] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (template) api.get(`/pdi/templates/${template.id}/revisions`).then((r) => setRevisions(r.data)).catch(() => {});
  }, [template]);

  if (!template) return null;

  const restore = async (rev) => {
    if (!window.confirm(`Restore revision ${rev} of "${template.part_name}"? It will be saved as a NEW revision — nothing is lost.`)) return;
    setBusy(true);
    try {
      const r = await api.post(`/pdi/templates/${template.id}/revisions/${rev}/restore`);
      toast.success(`Revision ${rev} restored as rev ${r.data.revision}`);
      onRestored?.();
      onClose();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg rounded-sm" data-testid="pdi-revisions-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">Revision History — {template.part_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
          {revisions.map((r) => (
            <div key={r.revision} className="border border-border rounded-sm px-3 py-2 flex items-center justify-between gap-2 bg-background" data-testid={`pdi-revision-${r.revision}`}>
              <div className="min-w-0">
                <p className="text-xs font-bold flex items-center gap-1.5">Rev {r.revision} {r.revision === (template.revision || 1) && <Badge variant="outline" className="rounded-sm text-[8px] border-primary/40 text-primary">CURRENT</Badge>}</p>
                <p className="text-[11px] text-muted-foreground truncate">{r.part_name} · {r.item_code} · {r.status}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">{(r.saved_at || "").slice(0, 16).replace("T", " ")}</p>
                  <p className="text-[10px] text-muted-foreground">by {r.saved_by}</p>
                </div>
                {isAdmin && r.revision !== (template.revision || 1) && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => restore(r.revision)}
                          data-testid={`pdi-revision-restore-${r.revision}`} className="rounded-sm h-7 text-[10px] gap-1">
                    <ClockCounterClockwise size={12} /> Restore
                  </Button>
                )}
              </div>
            </div>
          ))}
          {revisions.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No revisions recorded.</p>}
        </div>
        <p className="text-[10px] text-muted-foreground">Reports always stay linked to the revision used at generation time. Restoring an old revision creates a new revision — history is never lost.</p>
      </DialogContent>
    </Dialog>
  );
}
