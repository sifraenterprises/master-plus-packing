import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

function PdfFrame({ url, post = false, testId }) {
  const [blobUrl, setBlobUrl] = useState("");
  useEffect(() => {
    let revoke = "";
    const req = post ? api.post(url, {}, { responseType: "blob" }) : api.get(url, { responseType: "blob" });
    req.then((r) => {
      revoke = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      setBlobUrl(revoke);
    }).catch((err) => toast.error(apiError(err)));
    return () => revoke && URL.revokeObjectURL(revoke);
  }, [url, post]);
  return blobUrl
    ? <iframe src={blobUrl} title="pdf" className="w-full h-[62vh] border border-border rounded-sm bg-white" data-testid={testId} />
    : <div className="h-[62vh] flex items-center justify-center text-sm text-muted-foreground">Loading PDF…</div>;
}

export default function TemplatePreviewDialog({ template, onClose }) {
  if (!template) return null;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl rounded-sm max-h-[88vh] overflow-y-auto" data-testid="pdi-template-preview">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">
            {template.part_name} · {template.item_code} · rev {template.revision || 1}
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="original">
          <TabsList className="rounded-sm">
            <TabsTrigger value="original" className="rounded-sm text-xs" data-testid="pdi-preview-tab-original">Original PDF</TabsTrigger>
            <TabsTrigger value="data" className="rounded-sm text-xs" data-testid="pdi-preview-tab-data">Extracted Data</TabsTrigger>
            <TabsTrigger value="sample" className="rounded-sm text-xs" data-testid="pdi-preview-tab-sample">Live Sample PDI</TabsTrigger>
          </TabsList>
          <TabsContent value="original" className="mt-3">
            <PdfFrame url={`/pdi/templates/${template.id}/source.pdf`} testId="pdi-preview-original-frame" />
          </TabsContent>
          <TabsContent value="data" className="mt-3">
            <div className="grid grid-cols-3 gap-2 text-xs mb-3">
              {[["Part Name", template.part_name], ["Item Code", template.item_code], ["Drg No", template.drg_no],
                ["Customer", template.customer || "—"], ["Plant", template.plant || "—"],
                ["Mapped Parts", (template.mapped_parts || []).join(", ") || "—"],
                ["Status", template.status], ["Revision", template.revision || 1], ["Pages", template.pages || 1]].map(([k, v]) => (
                <div key={k} className="border border-border rounded-sm px-2.5 py-1.5 bg-background">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{k}</p>
                  <p className="font-semibold truncate">{String(v)}</p>
                </div>
              ))}
            </div>
            <div className="border border-border rounded-sm overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[9px] uppercase tracking-widest text-muted-foreground">
                    {["Sr", "Specified Dimension", "Method", "Freq", "Nominal", "Tol −", "Tol +", "Type", "Pg"].map((h) => (
                      <th key={h} className="text-left px-2 py-1.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody data-testid="pdi-preview-rows">
                  {(template.rows || []).map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-2 py-1">{r.sr}</td>
                      <td className="px-2 py-1">{r.specified_dimension}</td>
                      <td className="px-2 py-1">{r.method}</td>
                      <td className="px-2 py-1">{r.freq}</td>
                      <td className="px-2 py-1">{r.nominal ?? "—"}</td>
                      <td className="px-2 py-1">{r.tol_low ?? "—"}</td>
                      <td className="px-2 py-1">{r.tol_high ?? "—"}</td>
                      <td className="px-2 py-1">{r.value_type}</td>
                      <td className="px-2 py-1">{r.page || 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
          <TabsContent value="sample" className="mt-3">
            <PdfFrame url={`/pdi/templates/${template.id}/preview`} post testId="pdi-preview-sample-frame" />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
