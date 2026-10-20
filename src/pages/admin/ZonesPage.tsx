import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { adminActionToast } from "@/lib/admin-ops";
import {
  Flame,
  Plus,
  Trash2,
  Activity,
  Zap,
  Trophy,
  Settings2
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/admin/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DemandMap } from "@/components/admin/delivery/DemandMap";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";

export default function ZonesPage() {
  const { rows, loading } = useLiveCollection<any>("demand_zones", { orderByField: "name", orderDir: "asc" });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>({});
  
  // Surge override + daily quest are edited in Platform Settings; shown here
  // read-only so this page reflects what riders and customers actually get.
  const [deliveryCfg, setDeliveryCfg] = useState({ surgeActive: false, surgeFee: 0, questTotal: 0, questTop: 0 });

  // Surge approval state
  const [surgeZone, setSurgeZone] = useState<any>(null);

  useEffect(() => {
    return onSnapshot(doc(db, "settings", "delivery"), (snap) => {
      const d = snap.data() ?? {};
      const tiers = Array.isArray(d.questTiers) ? (d.questTiers as { trips: number; bonus: number }[]) : [];
      setDeliveryCfg({
        surgeActive: d.surgeActive === true,
        surgeFee: Number(d.surgeFee) || 0,
        questTotal: tiers.reduce((sum, t) => sum + (Number(t.bonus) || 0), 0) || Number(d.questBonus) || 0,
        questTop: tiers.length ? Math.max(...tiers.map((t) => Number(t.trips) || 0)) : Number(d.questTarget) || 0,
      });
    }, (err) => {
      console.error("ZonesPage: settings listener error:", err);
    });
  }, []);

  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      { accessorKey: "name", header: "Zone Name", cell: ({ row }) => <span className="font-semibold">{row.original.name}</span> },
      {
        accessorKey: "demand",
        header: "Demand Level",
        cell: ({ row }) => {
          const d = row.original.demand || "normal";
          const color = d === "extreme" ? "text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30" : d === "high" ? "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30" : "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30";
          return <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${color}`}>{d}</span>;
        },
      },
      {
        accessorKey: "surgeMultiplier",
        header: "Current Surge",
        cell: ({ row }) => {
          const s = row.original.surgeMultiplier || 1;
          return <span className={`font-mono ${s > 1 ? "text-rose-600 font-bold" : "text-muted-foreground"}`}>{s.toFixed(1)}×</span>;
        },
      },
      {
        id: "activeOrders",
        header: "Active Orders",
        cell: ({ row }) => <span className="text-muted-foreground font-medium">{row.original.activeOrders || 0}</span>,
      },
      {
        id: "availableRiders",
        header: "Available Riders",
        cell: ({ row }) => <span className="text-muted-foreground font-medium">{row.original.availableRiders || 0}</span>,
      },
      {
        id: "demandSupply",
        header: "Demand/Supply",
        cell: ({ row }) => {
          const ratio = ((row.original.activeOrders || 0) / Math.max(row.original.availableRiders || 1, 1)).toFixed(1);
          return <span className="font-semibold text-amber-600">{ratio}x</span>;
        }
      },
      {
        id: "recommendedSurge",
        header: "Recommended",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-bold text-emerald-600">1.5×</span>
            <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 uppercase tracking-wider" onClick={() => setSurgeZone(row.original)}>
              Apply
            </Button>
          </div>
        ),
      },
      { accessorKey: "radiusKm", header: "Radius km" },
      {
        accessorKey: "active",
        header: "Live",
        cell: ({ row }) => (
          <Switch
            checked={row.original.active !== false}
            onCheckedChange={(v) => adminActionToast("upsertZone", { ...row.original, id: row.original.id, active: v }, v ? "Zone live" : "Zone paused")}
          />
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setDraft(row.original); setOpen(true); }}>
              Edit
            </Button>
            <Button aria-label="Delete" size="icon" variant="ghost" className="text-rose-500" onClick={() => adminActionToast("deleteZone", { id: row.original.id }, "Zone removed")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Demand Zones & Surge Control"
        description="Monitor live marketplace demand, trigger dynamic pricing (surge), and manage daily driver incentives. The Rider App reads these zones to render its live heatmap. The Customer App calculates checkout delivery fees using the active surgeMultiplier of their geofenced zone."
        icon={Flame}
        stats={[
          { label: "Zones", value: loading ? "—" : String(rows.length) },
          { label: "Surging", value: String(rows.filter((z) => Number(z.surgeMultiplier) > 1).length) },
          { label: "Daily quest", value: `up to ₹${deliveryCfg.questTotal}` },
        ]}
        actions={
          <Button onClick={() => { setDraft({ surgeMultiplier: 1, radiusKm: 2, demand: "high", active: true }); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add zone
          </Button>
        }
      />

      <StatCards
        cards={[
          { title: "Total Zones", value: String(rows.length), trend: { value: 0, label: "from last month" }, icon: Flame },
          { title: "High Demand Zones", value: String(rows.filter(z => z.demand === "high" || z.demand === "extreme").length), trend: { value: 2, label: "new today" }, icon: Activity },
          { title: "Available Riders", value: String(rows.reduce((sum, r) => sum + (r.availableRiders || 0), 0)), trend: { value: 12, label: "online now" }, icon: Zap }
        ]}
      />

      {/* Live Map */}
      <DemandMap />

      {/* Surge + quest live state. The old cards here showed a made-up
          "rain via weather API" rule and multipliers the server never applied. */}
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="pt-6 flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div className="space-y-1 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <Settings2 className="h-4 w-4 text-primary" />
              {deliveryCfg.surgeActive
                ? `Manual surge override on: +₹${deliveryCfg.surgeFee} per order (scaled by a zone's multiplier)`
                : "Automatic peak-hour surge: lunch +₹15, dinner +₹20, late night +₹25 (scaled by a zone's multiplier)"}
            </p>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Trophy className="h-4 w-4 text-amber-500" />
              Daily rider quest: up to ₹{deliveryCfg.questTotal} at {deliveryCfg.questTop} trips
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/settings?tab=platform">Edit in Platform Settings</Link>
          </Button>
        </CardContent>
      </Card>

      <DataTable columns={columns} data={rows} searchPlaceholder="Search zones…" exportFilename="demand-zones" />
      
      {/* Zone Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{draft.id ? "Edit zone" : "New zone"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-1.5">
              {[
                { name: "Edachira", lat: 10.0278, lng: 76.3639 },
                { name: "Kakkanad", lat: 10.0159, lng: 76.3419 },
                { name: "Infopark", lat: 10.0116, lng: 76.3632 },
                { name: "Vyttila", lat: 9.9667, lng: 76.3167 },
                { name: "Palarivattom", lat: 10.0041, lng: 76.3125 },
                { name: "Edappally", lat: 10.0261, lng: 76.3125 },
                { name: "Aluva", lat: 10.1076, lng: 76.3516 },
                { name: "Fort Kochi", lat: 9.9633, lng: 76.2381 },
                { name: "Marine Drive", lat: 9.9793, lng: 76.2754 },
                { name: "Kalamassery", lat: 10.0461, lng: 76.3195 },
                { name: "Thripunithura", lat: 9.9486, lng: 76.3456 },
              ].map((p) => (
                <Button key={p.name} type="button" size="sm" variant="outline" onClick={() => setDraft((d: any) => ({ ...d, name: p.name, lat: p.lat, lng: p.lng, radiusKm: d.radiusKm ?? 2 }))}>
                  {p.name}
                </Button>
              ))}
            </div>
            <div><Label>Name</Label><Input value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Lat</Label><Input type="number" value={draft.lat ?? ""} onChange={(e) => setDraft({ ...draft, lat: Number(e.target.value) })} /></div>
              <div><Label>Lng</Label><Input type="number" value={draft.lng ?? ""} onChange={(e) => setDraft({ ...draft, lng: Number(e.target.value) })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Radius km</Label><Input type="number" value={draft.radiusKm ?? 2} onChange={(e) => setDraft({ ...draft, radiusKm: Number(e.target.value) })} /></div>
              <div><Label>Surge ×</Label><Input type="number" step="0.1" value={draft.surgeMultiplier ?? 1} onChange={(e) => setDraft({ ...draft, surgeMultiplier: Number(e.target.value) })} /></div>
            </div>
            <div className="flex gap-1">
              {[1, 1.2, 1.5, 2].map((x) => (
                <Button key={x} type="button" size="sm" variant={draft.surgeMultiplier === x ? "default" : "outline"} onClick={() => setDraft({ ...draft, surgeMultiplier: x, demand: x > 1.4 ? "high" : x > 1 ? "normal" : "low" })}>
                  {x}×
                </Button>
              ))}
            </div>
            <div>
              <Label>Demand</Label>
              <Select value={draft.demand || "normal"} onValueChange={(v) => setDraft({ ...draft, demand: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="extreme">Extreme</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={draft.active !== false} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /></div>
          </div>
          <DialogFooter>
            <Button onClick={() => adminActionToast("upsertZone", { ...draft, id: draft.id }, "Zone live on rider heatmap").then(() => setOpen(false))}>Publish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Surge Approval Confirmation */}
      {surgeZone && (
        <ConfirmationDialog
          open={!!surgeZone}
          onOpenChange={(v) => !v && setSurgeZone(null)}
          title={`Apply 1.5x Surge to ${surgeZone.name}?`}
          description={`Demand/Supply ratio is critically high. This will immediately increase pricing parameters.`}
          consequences={[
            "Delivery fee for customers increases by 1.5x",
            "Rider payout multiplier increases to 1.5x",
            "Applies to all new orders originating in this zone",
            "Surge stays active until manually disabled or demand drops"
          ]}
          requireReason={true}
          reasonLabel="Reason for override"
          confirmLabel="Authorize Surge"
          variant="destructive"
          onConfirm={async (reason) => {
            await adminActionToast("upsertZone", { ...surgeZone, surgeMultiplier: 1.5, overrideReason: reason }, `Surge enabled for ${surgeZone.name}`);
            setSurgeZone(null);
          }}
        />
      )}
    </div>
  );
}
