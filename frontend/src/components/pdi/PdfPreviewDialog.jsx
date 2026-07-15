import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DownloadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

export default function PdfPreviewDialog({ open, onClose, title, pdfUrl, downloadName }) {
  const [blobUrl, setBlobUrl] = useState("");

  useEffect(() => {
    let revoke = "";
    if (open && pdfUrl) {
      api.get(pdfUrl, { responseType: "blob" })
        .then((r) => {
          revoke = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
          setBlobUrl(revoke);
        })
        .catch((err) => toast.error(apiError(err)));
    }
    return () => { if (revoke) URL.revokeObjectURL(revoke); setBlobUrl(""); };
  }, [open, pdfUrl]);

  const download = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = downloadName || "pdi_report.pdf";
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl rounded-sm" data-testid="pdi-preview-dialog">
        <DialogHeader className="flex-row items-center justify-between space-y-0 pr-8">
          <DialogTitle className="text-sm font-bold">{title || "PDF Preview"}</DialogTitle>
          <Button size="sm" onClick={download} className="rounded-sm gap-1.5" data-testid="pdi-preview-download">
            <DownloadSimple size={14} /> Download
          </Button>
        </DialogHeader>
        {blobUrl ? (
          <iframe src={blobUrl} title="PDI PDF" className="w-full h-[70vh] border border-border rounded-sm bg-white" data-testid="pdi-preview-frame" />
        ) : (
          <div className="h-[70vh] flex items-center justify-center text-sm text-muted-foreground">Loading PDF…</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
