import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Upload,
  Loader2,
  X,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Trash2,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { httpsCallable } from "firebase/functions";
import { addDoc, collection, serverTimestamp, writeBatch, doc } from "firebase/firestore";

import { db, functions } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";

type ParsedItem = {
  name: string;
  price: number;
  category: string;
  isVeg: boolean;
  desc?: string;
  spiceLevel?: "none" | "mild" | "medium" | "hot" | "extra-hot";
  variants?: { name: string; price: number }[];
  // UI-only — user can untick rows to skip them
  include?: boolean;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
}

// Removed GEMINI_MODEL and PROMPT (moved to backend)

// Token-efficient image compression — Gemini bills per 768x768 tile, so
// resize to ~1024px on the longest edge and re-encode at JPEG 0.72. For a
// printed menu page this is more than enough OCR resolution.
async function compressImage(file: File, maxDim = 1280, quality = 0.72): Promise<{ blob: Blob; mime: string }> {
  // Only compress raster images — PDFs and tiny files pass through unchanged.
  if (!file.type.startsWith("image/")) return { blob: file, mime: file.type };
  if (file.size < 200 * 1024) return { blob: file, mime: file.type };

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: file, mime: file.type };
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b || file), "image/jpeg", quality),
  );
  return { blob, mime: "image/jpeg" };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function AiMenuImportDialog({ open, onOpenChange, restaurantId }: Props) {
  const { symbol } = useCurrency();
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPrompt("");
      setItems([]);
      setError(null);
      setParsing(false);
      setImporting(false);
    }
  }, [open]);

  const includedCount = useMemo(
    () => items.filter((i) => i.include !== false).length,
    [items],
  );

  const pickFile = () => inputRef.current?.click();

  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    setError(null);
    setItems([]);
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const extractJsonArray = (raw: string): any[] => {
    // Strip code fences if present
    let text = raw.trim();
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    // Best-effort: find the first [ and last ]
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    return JSON.parse(text);
  };

  const handleAnalyze = async () => {
    if (!file && !prompt.trim()) return;
    
    setParsing(true);
    setError(null);
    setItems([]);
    try {
      let base64 = "";
      let mime = "";
      if (file) {
        const compressed = await compressImage(file);
        base64 = await blobToBase64(compressed.blob);
        mime = compressed.mime || file.type || "application/pdf";
      }

      const generateMenu = httpsCallable(functions, "generateMenuFromPromptOrImage");
      const result = await generateMenu({ prompt, base64Image: base64, mimeType: mime });
      
      const arr = (result.data as any)?.result || [];

      const cleaned: ParsedItem[] = (arr || [])
        .filter((x) => x && typeof x.name === "string" && x.name.trim())
        .map((x) => ({
          name: String(x.name).trim().slice(0, 120),
          price: Number(x.price) || 0,
          category: String(x.category || "Main Course").trim(),
          isVeg: x.isVeg === true,
          desc: x.desc ? String(x.desc).slice(0, 400) : undefined,
          spiceLevel: x.spiceLevel || undefined,
          variants: Array.isArray(x.variants)
            ? x.variants
                .map((v: any) => ({
                  name: String(v?.name || "").trim(),
                  price: Number(v?.price) || 0,
                }))
                .filter((v: any) => v.name)
            : undefined,
          include: true,
        }));

      if (cleaned.length === 0) {
        setError("Couldn't find any menu items. Try a clearer prompt or photo.");
      } else {
        setItems(cleaned);
        toast.success(`Found ${cleaned.length} dish${cleaned.length === 1 ? "" : "es"}`);
      }
    } catch (e: any) {
      console.error("AI menu generation failed:", e);
      setError(e?.message || "Failed to generate menu. Please try again.");
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    const toImport = items.filter((i) => i.include !== false);
    if (toImport.length === 0) {
      toast.error("Nothing selected to import");
      return;
    }
    setImporting(true);
    try {
      // Firestore batches cap at 500 writes; chunk just in case.
      const CHUNK = 400;
      for (let i = 0; i < toImport.length; i += CHUNK) {
        const slice = toImport.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const it of slice) {
          const ref = doc(collection(db, "menu"));
          batch.set(ref, {
            restaurantId,
            name: it.name,
            price: it.price,
            category: it.category,
            isVeg: it.isVeg,
            desc: it.desc || "",
            spiceLevel: it.spiceLevel || "none",
            variants: it.variants || [],
            addons: (it as any).addons || [],
            isAvailable: true,
            isRecommended: false,
            channels: { dineIn: true, qr: true, swiggy: false, zomato: false },
            gstRate: 5,
            tags: [],
            allergens: [],
            createdAt: serverTimestamp(),
            timestamp: serverTimestamp(),
            updatedAt: serverTimestamp(),
            source: "ai-import",
          });
        }
        await batch.commit();
      }
      toast.success(
        `Imported ${toImport.length} dish${toImport.length === 1 ? "" : "es"} to your menu`,
      );
      onOpenChange(false);
    } catch (e: any) {
      console.error("Bulk import failed:", e);
      toast.error(e?.message || "Bulk import failed");
    } finally {
      setImporting(false);
    }
  };

  const toggleInclude = (idx: number) =>
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, include: !(it.include !== false) ? true : false } : it)),
    );

  const updateItem = (idx: number, patch: Partial<ParsedItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[820px] rounded-[2rem] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center shadow-lg">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-black tracking-tight">
                AI Menu Import
              </DialogTitle>
              <DialogDescription className="text-xs font-bold text-muted-foreground">
                Upload your menu as a PDF or image — Gemini reads it and pre-fills every dish.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Missing API key warning removed */}

        {/* Step 1: upload */}
        {items.length === 0 && (
          <div className="pt-4 space-y-3">
            <Input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
            />
            <div
              onClick={pickFile}
              onDrop={handleDrop}
              onDragOver={onDragOver}
              className={cn(
                "rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-8 text-center",
                file ? "border-primary/60 bg-primary/5" : "border-border/60 bg-muted/30 hover:bg-muted/50",
              )}
            >
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <p className="text-sm font-black">{file.name}</p>
                  <p className="text-xs text-muted-foreground font-bold">
                    {(file.size / 1024).toFixed(0)} KB · {file.type || "file"}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl font-bold text-destructive mt-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                  >
                    Choose another
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-black">Drop your menu here</p>
                  <p className="text-xs text-muted-foreground font-bold">
                    PDF · JPG · PNG · WEBP — up to ~20 MB
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-muted-foreground ml-1 uppercase tracking-wider">
                Or describe the menu
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Generate a premium South Indian breakfast menu with dosa, idli, and vada variants."
                className="w-full min-h-[80px] p-4 text-sm font-medium rounded-2xl border border-border/60 bg-muted/30 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs font-bold text-destructive flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl font-bold flex-1"
                onClick={() => onOpenChange(false)}
                disabled={parsing}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-xl font-black uppercase tracking-widest flex-1 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 text-white shadow-md shadow-fuchsia-500/20"
                onClick={handleAnalyze}
                disabled={(!file && !prompt.trim()) || parsing}
              >
                {parsing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Reading menu…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Analyze with AI
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: review */}
        {items.length > 0 && (
          <div className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-black">
                  Found {items.length} dish{items.length === 1 ? "" : "es"}
                </p>
                <p className="text-xs text-muted-foreground font-bold">
                  Untick rows to skip them. Edit name/price/category inline.
                </p>
              </div>
              <Badge className="bg-primary/10 text-primary border-primary/20 font-black uppercase tracking-widest">
                {includedCount} selected
              </Badge>
            </div>

            <div className="rounded-2xl border border-border/40 overflow-hidden max-h-[420px] overflow-y-auto">
              <div className="hidden md:grid grid-cols-[40px_2fr_120px_1.2fr_72px_40px] gap-2 px-3 py-2 border-b border-border/40 bg-muted/30 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                <span></span>
                <span>Dish</span>
                <span>Price ({symbol})</span>
                <span>Category</span>
                <span>Type</span>
                <span></span>
              </div>
              <div className="divide-y divide-border/40">
                {items.map((it, idx) => {
                  const included = it.include !== false;
                  return (
                    <div
                      key={idx}
                      className={cn(
                        "grid grid-cols-[40px_1fr_auto] md:grid-cols-[40px_2fr_120px_1.2fr_72px_40px] gap-2 px-3 py-2 items-center",
                        !included && "opacity-50",
                      )}
                    >
                      <button
                        onClick={() => toggleInclude(idx)}
                        className="h-6 w-6 rounded-md bg-card border border-border/60 flex items-center justify-center hover:border-primary"
                        title={included ? "Skip" : "Include"}
                      >
                        {included ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : (
                          <div className="h-4 w-4" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <Input
                          value={it.name}
                          onChange={(e) => updateItem(idx, { name: e.target.value })}
                          className="h-8 text-sm font-bold rounded-md"
                        />
                        {it.desc && (
                          <p className="text-[10px] text-muted-foreground font-medium mt-1 line-clamp-1">
                            {it.desc}
                          </p>
                        )}
                      </div>
                      <Input
                        type="number"
                        min="0"
                        value={it.price}
                        onChange={(e) =>
                          updateItem(idx, { price: Number(e.target.value) || 0 })
                        }
                        className="hidden md:block h-8 text-sm font-bold rounded-md"
                      />
                      <Input
                        value={it.category}
                        onChange={(e) => updateItem(idx, { category: e.target.value })}
                        className="hidden md:block h-8 text-xs font-bold rounded-md"
                      />
                      <div className="hidden md:flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={it.isVeg ? "default" : "outline"}
                          className="h-7 w-9 p-0 rounded-md font-black text-[10px]"
                          onClick={() => updateItem(idx, { isVeg: true })}
                          title="Veg"
                        >
                          V
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={!it.isVeg ? "destructive" : "outline"}
                          className="h-7 w-9 p-0 rounded-md font-black text-[10px]"
                          onClick={() => updateItem(idx, { isVeg: false })}
                          title="Non-veg"
                        >
                          N
                        </Button>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-md text-destructive col-start-3 md:col-start-auto"
                        onClick={() => removeItem(idx)}
                        title="Remove from import"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl font-bold"
                onClick={() => setItems([])}
                disabled={importing}
              >
                ← Start over
              </Button>
              <div className="flex-1" />
              <Button
                type="button"
                variant="outline"
                className="rounded-xl font-bold"
                onClick={() => onOpenChange(false)}
                disabled={importing}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-xl font-black uppercase tracking-widest"
                onClick={handleImport}
                disabled={importing || includedCount === 0}
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Importing
                  </>
                ) : (
                  <>
                    Import {includedCount} dishes <ChevronRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
