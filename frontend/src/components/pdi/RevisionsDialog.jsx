import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";

export default function RevisionsDialog({ template, onClose }) {
  const [revisions, setRevisions] = useState([]);

  useEffect(() => {
    if (template) api.get(`/pdi/templates/${template.id}/revisions`).then((r) => setRevisions(r.data)).catch(() => {});
  }, [template]);

  if (!template) return null;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg rounded-sm" data-testid="pdi-revisions-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">Revision History — {template.part_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
          {revisions.map((r) => (
            <div key={r.revision} className="border border-border rounded-sm px-3 py-2 flex items-center justify-between bg-background" data-testid={`pdi-revision-${r.revision}`}>
              <div>
                <p className="text-xs font-bold">Rev {r.revision} {r.revision === (template.revision || 1) && <Badge variant="outline" className="rounded-sm text-[8px] ml-1 border-primary/40 text-primary">CURRENT</Badge>}</p>
                <p className="text-[11px] text-muted-foreground">{r.part_name} · {r.item_code} · {r.status}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">{(r.saved_at || "").slice(0, 16).replace("T", " ")}</p>
                <p className="text-[10px] text-muted-foreground">by {r.saved_by}</p>
              </div>
            </div>
          ))}
          {revisions.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No revisions recorded.</p>}
        </div>
        <p className="text-[10px] text-muted-foreground">Reports always stay linked to the revision used at generation time. Regenerating uses the original revision.</p>
      </DialogContent>
    </Dialog>
  );
}
