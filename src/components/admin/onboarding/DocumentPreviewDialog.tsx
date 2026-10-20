import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText, Download, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { useState } from "react";

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  url?: string;
  metadata?: Record<string, any>;
}

export function DocumentPreviewDialog({
  open,
  onOpenChange,
  title,
  url,
  metadata,
}: DocumentPreviewDialogProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  if (!url) return null;

  const isPdf = url.toLowerCase().includes(".pdf") || url.toLowerCase().includes("pdf");

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 2.5));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleReset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border/60 shrink-0 bg-muted/20">
          <div className="flex items-center justify-between pr-6">
            <div>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                {title}
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                KYC and verification document preview
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1.5">
              {!isPdf && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={handleZoomOut}
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={handleZoomIn}
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={handleRotate}
                    title="Rotate"
                  >
                    <RotateCw className="w-4 h-4" />
                  </Button>
                </>
              )}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-background hover:bg-muted text-xs font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open Original
              </a>
            </div>
          </div>
        </DialogHeader>

        {/* Document Body */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/40 min-h-[400px]">
          {isPdf ? (
            <iframe
              src={`${url}#toolbar=0`}
              title={title}
              className="w-full h-[65vh] rounded-lg border border-border bg-card"
            />
          ) : (
            <div className="overflow-auto max-h-[65vh] flex items-center justify-center">
              <img
                src={url}
                alt={title}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transition: "transform 0.15s ease",
                }}
                className="max-h-[60vh] object-contain rounded-lg shadow-md border border-border bg-card"
              />
            </div>
          )}
        </div>

        {/* Metadata Footer if any */}
        {metadata && Object.keys(metadata).length > 0 && (
          <div className="px-5 py-3 border-t border-border/60 bg-background shrink-0 flex flex-wrap gap-4 text-xs">
            {Object.entries(metadata).map(([k, v]) => (
              <div key={k}>
                <span className="text-muted-foreground uppercase text-[10px] tracking-wide mr-1.5">
                  {k}:
                </span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
