import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  Download, Plus, Users, Map as MapIcon, 
  Sparkles, LayoutGrid, Info, Printer
} from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/lib/currency";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type TableStatus = "Available" | "Occupied" | "Ordering" | "Bill Requested";

interface Table {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  order: string;
  bill: string;
  time: string;
  restaurantId: string;
  floorX?: number;
  floorY?: number;
}

const statusConfig: Record<TableStatus, {
  dot: string;
  text: string;
  bg: string;
  border: string;
  glow: string
}> = {
  Available: {
    dot: "bg-success shadow-success/50",
    text: "text-success",
    bg: "bg-success/10",
    border: "border-success/30",
    glow: "shadow-[0_0_20px_rgba(34,197,94,0.3)]"
  },
  Occupied: {
    dot: "bg-primary shadow-primary/50",
    text: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/30",
    glow: "shadow-[0_0_20px_rgba(59,130,246,0.3)]"
  },
  Ordering: {
    dot: "bg-warning shadow-warning/50",
    text: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/30",
    glow: "shadow-[0_0_20px_rgba(234,179,8,0.3)]"
  },
  "Bill Requested": {
    dot: "bg-orange-500 shadow-orange-500/50",
    text: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    glow: "shadow-[0_0_20px_rgba(249,115,22,0.3)]"
  },
};

const transition = { duration: 0.4, ease: [0.2, 0, 0, 1] as const };

export default function TablesPage() {
  const { user, activeRestaurantId } = useAuth();
  const { format } = useCurrency();
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [loading, setLoading] = useState(true);
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const floorRef = useRef<HTMLDivElement>(null);

  // Form State
  const [newTableName, setNewTableName] = useState("");
  const [newTableSeats, setNewTableSeats] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [floorPlanOpen, setFloorPlanOpen] = useState(false);

  const [dragId, setDragId] = useState<string | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const [floorDraft, setFloorDraft] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "tables"),
      where("restaurantId", "==", activeRestaurantId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tablesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Table[];

      setTables(tablesData);
      setFloorDraft((prev) => {
        const next: Record<string, { x: number; y: number }> = { ...prev };
        tablesData.forEach((t, idx) => {
          const existing = next[t.id];
          const x = typeof (t as any).floorX === "number" ? (t as any).floorX : (existing?.x ?? 40 + (idx % 5) * 140);
          const y = typeof (t as any).floorY === "number" ? (t as any).floorY : (existing?.y ?? 40 + Math.floor(idx / 5) * 120);
          if (dragId && t.id === dragId) return;
          next[t.id] = { x, y };
        });
        return next;
      });
      if (tablesData.length > 0 && !selectedTable) {
        setSelectedTable(tablesData[0]);
      }
      setLoading(false);
    }, (err) => console.error("[TablesPage] q listener failed", err));

    return () => unsubscribe();
  }, [user, activeRestaurantId, dragId, selectedTable]);

  const handleAddTable = async () => {
    if (!newTableName || !newTableSeats) {
      toast.error("Please fill all fields");
      return;
    }

    if (!user) {
      toast.error("You must be logged in to add a table");
      return;
    }

    setIsAdding(true);
    try {
      const seats = parseInt(newTableSeats) || 0;
      const idx = tables.length;
      const floorX = 40 + (idx % 5) * 140;
      const floorY = 40 + Math.floor(idx / 5) * 120;
      const docRef = await addDoc(collection(db, "tables"), {
        name: newTableName,
        seats,
        status: "Available",
        order: "-",
        bill: "-",
        time: "-",
        restaurantId: activeRestaurantId,
        timestamp: serverTimestamp(),
        floorX,
        floorY,
      });
      setNewTableName("");
      setNewTableSeats("");
      setSelectedTable({
        id: docRef.id,
        name: newTableName,
        seats,
        status: "Available",
        order: "-",
        bill: "-",
        time: "-",
        restaurantId: activeRestaurantId,
        floorX,
        floorY,
      });
      setAddDialogOpen(false);
      toast.success("Table added");
    } catch (error) {
      toast.error("Failed to add table");
      console.error(error);
    } finally {
      setIsAdding(false);
    }
  };

  const onFloorPointerDown = (e: React.PointerEvent, tableId: string) => {
    const container = floorRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const current = floorDraft[tableId] ?? { x: 0, y: 0 };
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    dragOffset.current = { dx: px - current.x, dy: py - current.y };
    setDragId(tableId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onFloorPointerMove = (e: React.PointerEvent) => {
    if (!dragId) return;
    const container = floorRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const offset = dragOffset.current;
    if (!offset) return;

    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const rawX = px - offset.dx;
    const rawY = py - offset.dy;
    const maxX = Math.max(0, rect.width - 120);
    const maxY = Math.max(0, rect.height - 90);

    const x = Math.round(Math.min(Math.max(rawX, 0), maxX) / 10) * 10;
    const y = Math.round(Math.min(Math.max(rawY, 0), maxY) / 10) * 10;

    setFloorDraft((prev) => ({ ...prev, [dragId]: { x, y } }));
  };

  const onFloorPointerUp = async () => {
    if (!dragId || !user) {
      setDragId(null);
      dragOffset.current = null;
      return;
    }
    const id = dragId;
    setDragId(null);
    const pos = floorDraft[id];
    dragOffset.current = null;
    if (!pos) return;

    try {
      await updateDoc(doc(db, "tables", id), {
        floorX: pos.x,
        floorY: pos.y,
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to save floor plan");
    }
  };

  const downloadQR = () => {
    if (!selectedTable) return;
    const svgEl = qrContainerRef.current?.querySelector("svg");
    if (!svgEl) {
      toast.error("QR not ready yet. Please try again.");
      return;
    }

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 1200;
    canvas.height = 1600;

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#000000";
      ctx.font = "bold 80px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("SCAN TO ORDER", canvas.width / 2, 200);

      ctx.font = "500 40px sans-serif";
      ctx.fillStyle = "#666666";
      ctx.fillText(`Kada Digital Menu • ${selectedTable.name}`, canvas.width / 2, 300);

      const qrSize = 800;
      const qrX = (canvas.width - qrSize) / 2;
      ctx.drawImage(img, qrX, 400, qrSize, qrSize);

      ctx.fillStyle = "#000000";
      ctx.font = "bold 40px sans-serif";
      ctx.fillText("Powered by Kada Dine", canvas.width / 2, 1450);

      const pngFile = canvas.toDataURL("image/png");
      const downloadLink = document.createElement("a");
      downloadLink.download = `Premium-QR-${selectedTable.name.replace(/ /g, "-")}.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
      toast.success("QR Code ready");
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;
  };

  const printQR = () => {
    if (!selectedTable) return;
    const svgEl = qrContainerRef.current?.querySelector("svg");
    if (!svgEl) {
      toast.error("QR not ready yet. Please try again.");
      return;
    }
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const printWindow = window.open('', '', 'width=800,height=1000');
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print QR - ${selectedTable.name}</title>
        <style>
          @page { size: portrait; margin: 10mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; margin: 0; }
          .container { text-align: center; border: 4px solid #000; padding: 60px 40px; border-radius: 32px; width: 100%; max-width: 600px; box-sizing: border-box; }
          h1 { font-size: 56px; margin: 0 0 16px 0; letter-spacing: -1px; font-weight: 900; text-transform: uppercase; }
          p.subtitle { font-size: 28px; color: #555; margin: 0 0 48px 0; font-weight: 600; }
          .qr-wrapper { margin: 0 auto 48px auto; width: 400px; height: 400px; }
          .qr-wrapper svg { width: 100%; height: 100%; }
          .footer { font-size: 24px; font-weight: 800; color: #000; text-transform: uppercase; letter-spacing: 2px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>SCAN TO ORDER</h1>
          <p class="subtitle">Kada Digital Menu &bull; ${selectedTable.name}</p>
          <div class="qr-wrapper">${svgData}</div>
          <div class="footer">Powered by Kada Dine</div>
        </div>
        <script>
          window.onload = () => {
            setTimeout(() => {
              window.print();
            }, 500);
          }
        </script>
      </body>
      </html>
    `;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="space-y-6 lg:space-y-8 pb-20 lg:pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-2">
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
            Table <span className="text-primary">Manager</span>
          </h1>
          <p className="text-sm text-muted-foreground font-medium flex items-center gap-2">
            <LayoutGrid className="w-4 h-4" /> Live restaurant floor
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          <Button
            variant="outline"
            className="w-full sm:w-auto rounded-xl font-semibold h-11 px-6 border-border/40 hover:bg-muted/50"
            onClick={() => setFloorPlanOpen(true)}
          >
            <MapIcon className="w-4 h-4 mr-2" /> Floor Editor
          </Button>
          <Button
            className="w-full sm:w-auto rounded-xl font-semibold h-11 px-6 shadow-sm bg-primary text-primary-foreground"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" /> Add Table
          </Button>
        </div>
      </div>

      {/* Analytics Mini-Grill */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {(["Available", "Occupied", "Ordering", "Bill Requested"] as TableStatus[]).map((status, i) => {
          const config = statusConfig[status];
          return (
            <motion.div
              key={status}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={cn(
                "p-5 sm:p-6 rounded-2xl border transition-all relative overflow-hidden group hover:scale-[1.02] shadow-sm",
                config.bg, config.border
              )}
            >
              <div className="flex justify-between items-start mb-4">
                <p className={cn("text-xs font-semibold uppercase tracking-wider", config.text)}>{status}</p>
                <div className={cn(
                   "w-2.5 h-2.5 rounded-full flex shrink-0 animate-pulse", 
                   config.dot
                )} />
              </div>
              <p className="text-3xl font-bold text-foreground">
                {tables.filter((table) => table.status === status).length}
              </p>
              <div className="mt-1 text-xs font-medium text-muted-foreground">Tables</div>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Left Column: Floor Grid */}
        <div className="xl:col-span-8 space-y-6">
          <Card className="rounded-2xl border border-border/40 shadow-sm bg-card overflow-hidden min-h-[500px]">
            <CardHeader className="p-6 border-b border-border/20 flex flex-row items-center justify-between space-y-0 bg-background/50 backdrop-blur-md sticky top-0 z-10">
              <div className="space-y-1">
                <CardTitle className="text-xl font-bold tracking-tight">Active Floor</CardTitle>
                <CardDescription className="text-sm">Live table status monitoring</CardDescription>
              </div>
              <div className="flex gap-2">

              </div>
            </CardHeader>
            <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {tables.map((table, index) => {
                const config = statusConfig[table.status];
                const active = selectedTable?.id === table.id;
                return (
                  <motion.div
                    key={table.id}
                    onClick={() => setSelectedTable(table)}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.05 }}
                    className={cn(
                      "p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group shadow-sm",
                      active ? "ring-2 ring-primary bg-card border-transparent shadow-md scale-[1.02]" : "bg-card hover:bg-muted/30 border-border/40 hover:border-primary/40"
                    )}
                  >
                    <div className="flex items-center justify-between mb-6">
                      <div className="w-10 h-10 rounded-xl bg-muted border border-border/40 flex items-center justify-center font-bold text-sm shadow-sm">
                        {index + 1 < 10 ? `0${index + 1}` : index + 1}
                      </div>
                      <Badge className={cn("rounded-lg h-7 px-3 text-[10px] font-bold uppercase tracking-wider border shadow-sm transition-colors", config.bg, config.border, config.text)}>
                        {table.status}
                      </Badge>
                    </div>

                    <div className="space-y-1.5 relative z-10">
                      <h4 className="text-xl font-bold text-foreground tracking-tight">{table.name}</h4>
                      <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {table.seats} Seats Max</p>
                    </div>

                    <div className="mt-6 pt-5 border-t border-border/10 grid grid-cols-2 gap-3 relative z-10">
                      <div className="space-y-1">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Current Bill</p>
                        <p className="text-base font-bold text-primary">{table.bill === "-" || table.bill == null ? "—" : format(Number(table.bill) || 0)}</p>
                      </div>
                      <div className="space-y-1 text-right">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Time Seated</p>
                        <p className="text-sm font-bold text-foreground mt-0.5">{table.time}</p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              {tables.length === 0 && !loading && (
                 <div className="col-span-full py-16 text-center flex flex-col items-center justify-center opacity-70">
                    <LayoutGrid className="w-12 h-12 mb-3 text-muted-foreground" />
                    <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">No Tables Found</p>
                 </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: QR Studio & Editor */}
        <div className="xl:col-span-4 space-y-6 lg:sticky lg:top-8 w-full">
          <Card className="rounded-2xl border border-border/40 shadow-sm bg-card overflow-hidden relative group">
            <CardHeader className="p-6 border-b border-border/10 relative z-10 bg-muted/20">
              <CardTitle className="text-lg font-bold tracking-tight">QR Studio</CardTitle>
              <CardDescription className="text-xs font-medium text-muted-foreground mt-1">Print dynamic table menus</CardDescription>
            </CardHeader>

            <CardContent className="px-6 py-8 space-y-6 relative z-10 bg-card">
              <div className="bg-white p-6 rounded-2xl shadow-sm flex flex-col items-center border border-border/20">
                <div
                  ref={qrContainerRef}
                  className="p-4 bg-white rounded-xl border border-black/10 transition-all cursor-default scale-110 mb-5 shadow-sm"
                >
                  <QRCodeSVG
                    value={`${window.location.origin}/menu?restaurantId=${activeRestaurantId}&table=${selectedTable?.id}`}
                    size={200}
                    level="H"
                    includeMargin={true}
                    imageSettings={{
                      src: "/logo.png",
                      x: undefined,
                      y: undefined,
                      height: 32,
                      width: 32,
                      excavate: true,
                    }}
                  />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-base font-bold text-black tracking-tight">{selectedTable?.name || 'Select a Table'}</p>
                  <p className="text-[10px] text-black/60 font-semibold uppercase tracking-widest">Scan to view menu</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Button disabled={!selectedTable} onClick={printQR} className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 shadow-sm gap-2 transition-all">
                  <Printer className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
                  Print
                </Button>
                <Button disabled={!selectedTable} onClick={downloadQR} variant="outline" className="w-full h-12 rounded-xl border-border/40 font-semibold text-sm hover:bg-muted shadow-sm gap-2 transition-all">
                  <Download className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
                  Save Image
                </Button>
              </div>

              <div className="pt-2 flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-muted/30">
                <div className="w-10 h-10 rounded-lg bg-background border flex items-center justify-center shrink-0">
                  <Info className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                  Print these high-res assets and place them on your tables to enable self-serve digital ordering.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="rounded-2xl max-w-md p-6 border-border/40 shadow-xl bg-card">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl font-bold">Add Table</DialogTitle>
            <DialogDescription className="text-sm font-medium text-muted-foreground">
              Create a new table and generate its QR code.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground ml-1">Table Name / ID</div>
              <Input
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder="E.g., Table 12"
                className="h-11 rounded-xl font-medium bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground ml-1">Max Seating Capacity</div>
              <Input
                value={newTableSeats}
                onChange={(e) => setNewTableSeats(e.target.value)}
                placeholder="4"
                type="number"
                min={1}
                className="h-11 rounded-xl font-medium bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-5 border-t border-border/10">
            <Button
              variant="outline"
              className="rounded-xl font-semibold text-xs h-10 px-5 border-border/40"
              onClick={() => setAddDialogOpen(false)}
              disabled={isAdding}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl font-semibold text-xs h-10 px-6 bg-primary text-primary-foreground shadow-sm"
              onClick={handleAddTable}
              disabled={isAdding}
            >
              {isAdding ? "Adding..." : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={floorPlanOpen} onOpenChange={setFloorPlanOpen}>
        <DialogContent className="rounded-2xl max-w-5xl p-6 sm:p-8 border-border/40 shadow-2xl bg-card">
          <DialogHeader className="mb-6 border-b border-border/10 pb-4">
            <DialogTitle className="text-xl font-bold">Layout Editor</DialogTitle>
            <DialogDescription className="text-sm font-medium text-muted-foreground">
              Drag tables to arrange your layout. Changes save instantly.
            </DialogDescription>
          </DialogHeader>

          <div
            ref={floorRef}
            onPointerMove={onFloorPointerMove}
            onPointerUp={onFloorPointerUp}
            onPointerCancel={onFloorPointerUp}
            className="relative w-full h-[600px] rounded-2xl border border-border/40 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] [background-size:20px_20px] overflow-hidden bg-background"
          >
            {tables.map((t) => {
              const pos = floorDraft[t.id] ?? { x: 40, y: 40 };
              const config = statusConfig[t.status];
              const isDragging = dragId === t.id;
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => onFloorPointerDown(e, t.id)}
                  onClick={() => setSelectedTable(t)}
                  className={cn(
                    "absolute select-none touch-none rounded-xl border-2 px-4 py-3 bg-card/90 backdrop-blur-md cursor-grab active:cursor-grabbing transition-colors",
                    isDragging ? "ring-2 ring-primary border-transparent shadow-lg scale-105 z-50" : "border-border/40 hover:border-primary/50 shadow-sm",
                  )}
                  style={{
                    transform: `translate(${pos.x}px, ${pos.y}px)`,
                    width: 140,
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-foreground truncate">{t.name}</div>
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider opacity-80 mt-0.5">{t.seats} seats</div>
                    </div>
                    <div className={cn("w-2.5 h-2.5 rounded-full shrink-0 shadow-sm", config.dot.split(' ')[0])} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 mt-6 flex-wrap">
            <div className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
               <MapIcon className="w-4 h-4" /> Tables automatically snap to the invisible grid
            </div>
            <Button
              variant="outline"
              className="rounded-xl font-semibold text-xs h-11 px-6 border-border/40 hover:bg-muted"
              onClick={() => setFloorPlanOpen(false)}
            >
              Done Editing
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
