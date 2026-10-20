import { useMemo, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { toast } from "sonner";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { pointInPolygon, areaSqKm, centroidOf, type LatLng } from "@/lib/leaflet";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ZonePolygonEditor, type ZoneShape, type MapPin } from "@/components/admin/zones/ZonePolygonEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Map as MapIcon,
  Plus,
  Save,
  Loader2,
  Trash2,
  Store,
  Bike,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

interface ZoneEconomics {
  deliveryBaseFee: number;
  deliveryPerKm: number;
  freeDeliveryUnderKm: number;
  freeDeliveryAbove: number;
  minOrderValue: number;
  platformFee: number;
  maxDeliveryRadiusKm: number;
}

interface Zone {
  id: string;
  marketId?: string;
  name?: string;
  colour?: string;
  polygon?: LatLng[];
  active?: boolean;
  priority?: number;
  areaSqKm?: number;
  economics?: Partial<ZoneEconomics>;
  codEnabled?: boolean;
  surgeMultiplier?: number;
}

interface Market {
  id: string;
  name?: string;
  city?: string;
  status?: string;
}

const DEFAULT_ECONOMICS: ZoneEconomics = {
  deliveryBaseFee: 25,
  deliveryPerKm: 7,
  freeDeliveryUnderKm: 3,
  freeDeliveryAbove: 0,
  minOrderValue: 0,
  platformFee: 0,
  maxDeliveryRadiusKm: 15,
};

// Distinct enough to tell apart at a glance when several overlap on the map.
const PALETTE = ["#0F6E6A", "#B45309", "#1D4ED8", "#7C3AED", "#BE123C", "#047857", "#C2410C"];

function emptyDraft(marketId: string): Zone {
  return {
    id: "",
    marketId,
    name: "",
    colour: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    polygon: [],
    active: true,
    priority: 0,
    economics: { ...DEFAULT_ECONOMICS },
    codEnabled: true,
    surgeMultiplier: 1,
  };
}

function coordOf(raw: any): LatLng | null {
  const lat = Number(raw?.lat ?? raw?.latitude);
  const lng = Number(raw?.lng ?? raw?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

// ── Page ──────────────────────────────────────────────────────────────────

/**
 * Draw and configure the service areas the whole platform runs on.
 *
 * A zone decides three things that used to be one global number: whether a
 * customer can order at all, what delivery costs there, and which vendors and
 * riders belong to the area. Everything here writes through
 * `upsertServiceZone`, which validates the ring server-side — the client never
 * asserts a zone or a price.
 */
export default function ZoneManagerPage() {
  const { rows: zones, loading: zonesLoading } = useLiveCollection<Zone>("zones", {
    orderByField: "name",
    orderDir: "asc",
  });
  const { rows: markets } = useLiveCollection<Market>("markets");
  const { rows: vendors } = useLiveCollection<any>("restaurants", { limit: 1000 });
  const { rows: riders } = useLiveCollection<any>("delivery_users", { limit: 1000 });

  const [marketId, setMarketId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<Zone | null>(null);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  // Default to the first active city once markets arrive.
  useEffect(() => {
    if (marketId || !markets.length) return;
    const firstActive = markets.find((m) => m.status !== "paused") ?? markets[0];
    setMarketId(firstActive.id);
  }, [markets, marketId]);

  const cityZones = useMemo(
    () => zones.filter((z) => !marketId || z.marketId === marketId),
    [zones, marketId],
  );

  const selectZone = useCallback((zone: Zone) => {
    setSelectedId(zone.id);
    setDraft({
      ...zone,
      polygon: Array.isArray(zone.polygon) ? zone.polygon : [],
      economics: { ...DEFAULT_ECONOMICS, ...(zone.economics ?? {}) },
    });
  }, []);

  const startNew = useCallback(() => {
    setSelectedId("");
    setDraft(emptyDraft(marketId));
  }, [marketId]);

  // ── Live coverage preview ───────────────────────────────────────────────
  // Resolved in the browser with the same algorithm the server uses, so the
  // count updates as the boundary is dragged instead of after a save.
  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = [];
    for (const v of vendors) {
      const c = coordOf(v.location);
      if (c) out.push({ id: v.id, lat: c.lat, lng: c.lng, label: v.name || "Vendor", kind: "vendor" });
    }
    for (const r of riders) {
      const c = coordOf(r.baseLocation) ?? coordOf(r.location);
      if (c) out.push({ id: r.id, lat: c.lat, lng: c.lng, label: r.name || "Rider", kind: "rider" });
    }
    return out;
  }, [vendors, riders]);

  const inside = useMemo(() => {
    const poly = draft?.polygon ?? [];
    if (poly.length < 3) return { vendors: 0, riders: 0 };
    let v = 0;
    let r = 0;
    for (const p of pins) {
      if (!pointInPolygon({ lat: p.lat, lng: p.lng }, poly)) continue;
      if (p.kind === "vendor") v++;
      else r++;
    }
    return { vendors: v, riders: r };
  }, [pins, draft?.polygon]);

  const others = useMemo<ZoneShape[]>(
    () =>
      cityZones
        .filter((z) => z.id !== selectedId && Array.isArray(z.polygon) && z.polygon.length >= 3)
        .map((z) => ({
          id: z.id,
          name: z.name || "Zone",
          colour: z.colour || "#94A3B8",
          polygon: z.polygon as LatLng[],
          active: z.active !== false,
        })),
    [cityZones, selectedId],
  );

  // Unassigned vendors are the number that matters when opening a new city:
  // every one of them is invisible to customers until a zone covers them.
  const unassignedVendors = useMemo(
    () => vendors.filter((v) => coordOf(v.location) && !v.zoneId).length,
    [vendors],
  );
  const noLocationVendors = useMemo(
    () => vendors.filter((v) => !coordOf(v.location)).length,
    [vendors],
  );

  // ── Actions ─────────────────────────────────────────────────────────────
  const save = async () => {
    if (!draft) return;
    if (!draft.name?.trim()) return toast.error("Give the zone a name.");
    if (!draft.marketId) return toast.error("Choose a city for this zone.");
    if ((draft.polygon?.length ?? 0) < 3) return toast.error("Draw a boundary with at least 3 points.");

    setSaving(true);
    try {
      const res: any = await httpsCallable(functions, "upsertServiceZone")({
        id: draft.id || undefined,
        marketId: draft.marketId,
        name: draft.name.trim(),
        colour: draft.colour,
        polygon: draft.polygon,
        active: draft.active !== false,
        priority: Number(draft.priority) || 0,
        economics: draft.economics,
        codEnabled: draft.codEnabled !== false,
        surgeMultiplier: Number(draft.surgeMultiplier) || 1,
      });
      const id = res?.data?.id as string;
      setSelectedId(id);
      setDraft((d) => (d ? { ...d, id } : d));
      toast.success(
        draft.id ? "Zone updated" : "Zone created",
        { description: `${res?.data?.areaSqKm ?? 0} km² · ${inside.vendors} vendors inside` },
      );
    } catch (e: any) {
      toast.error(e?.message || "Could not save the zone.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    setSaving(true);
    try {
      await httpsCallable(functions, "deleteServiceZone")({ id: draft.id });
      toast.success("Zone deleted");
      setDraft(null);
      setSelectedId("");
    } catch (e: any) {
      toast.error(e?.message || "Could not delete the zone.");
    } finally {
      setSaving(false);
    }
  };

  const runBackfill = async (dryRun: boolean) => {
    setBackfilling(true);
    try {
      const res: any = await httpsCallable(functions, "backfillZones")({ dryRun });
      const s = res?.data?.summary ?? {};
      const changed = (s.restaurants?.changed ?? 0) + (s.delivery_users?.changed ?? 0);
      const unresolved = (s.restaurants?.unresolved ?? 0) + (s.delivery_users?.unresolved ?? 0);
      toast.success(dryRun ? "Scan complete" : "Zones reassigned", {
        description:
          `${changed} record${changed === 1 ? "" : "s"} would change` +
          (unresolved ? ` · ${unresolved} outside every zone` : ""),
      });
    } catch (e: any) {
      toast.error(e?.message || "Backfill failed.");
    } finally {
      setBackfilling(false);
    }
  };

  const setEcon = (key: keyof ZoneEconomics, value: string) =>
    setDraft((d) =>
      d ? { ...d, economics: { ...d.economics, [key]: Number(value) || 0 } } : d,
    );

  const liveArea = draft?.polygon && draft.polygon.length >= 3 ? areaSqKm(draft.polygon) : 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Service zones"
        icon={MapIcon}
        description="Draw the areas Kada actually serves. A zone decides serviceability, delivery pricing, and which vendors and riders belong to it."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={marketId} onValueChange={setMarketId}>
              <SelectTrigger className="h-9 w-[190px]">
                <SelectValue placeholder="Choose a city" />
              </SelectTrigger>
              <SelectContent>
                {markets.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.city || m.id}
                    {m.status === "paused" && " (paused)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9" disabled={backfilling} onClick={() => runBackfill(true)}>
              {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Scan assignments</span>
            </Button>
            <Button size="sm" className="h-9" onClick={startNew} disabled={!marketId}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> New zone
            </Button>
          </div>
        }
      />

      {!markets.length && !zonesLoading && (
        <Card className="border-amber-500/30 bg-amber-500/[0.04]">
          <CardContent className="flex items-start justify-between gap-3 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">No cities yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Zones live inside a city. Add one under Markets &amp; Cities first, then come back
                  and draw its service areas.
                </p>
              </div>
            </div>
            <Link to="/admin/markets">
              <Button size="sm" variant="outline" className="text-xs shrink-0">
                Set up Market / City →
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {(unassignedVendors > 0 || noLocationVendors > 0) && (
        <Card className="border-amber-500/30 bg-amber-500/[0.04]">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3.5 text-xs">
            <span className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Coverage gaps
            </span>
            {unassignedVendors > 0 && (
              <span className="text-muted-foreground">
                <b className="text-foreground tabular-nums">{unassignedVendors}</b> vendors have a
                location but sit outside every zone — customers cannot see them.
              </span>
            )}
            {noLocationVendors > 0 && (
              <span className="text-muted-foreground">
                <b className="text-foreground tabular-nums">{noLocationVendors}</b> vendors have not
                set a location at all.
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
        {/* ── Zone list ─────────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
            {cityZones.length} {cityZones.length === 1 ? "zone" : "zones"} in this city
          </p>

          {zonesLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[62px] rounded-xl border border-border bg-muted/30 animate-pulse" />
              ))}
            </div>
          )}

          {!zonesLoading && !cityZones.length && (
            <div className="rounded-xl border border-dashed border-border p-5 text-center">
              <MapIcon className="h-5 w-5 mx-auto text-muted-foreground/50" />
              <p className="mt-2 text-xs font-semibold">No zones drawn yet</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                Until a zone covers them, this city's vendors are invisible to customers.
              </p>
              <Button size="sm" variant="outline" className="mt-3 h-7 text-xs" onClick={startNew} disabled={!marketId}>
                Draw the first zone
              </Button>
            </div>
          )}

          {cityZones.map((z) => {
            const isSel = z.id === selectedId;
            return (
              <button
                key={z.id}
                type="button"
                onClick={() => selectZone(z)}
                className={cn(
                  "w-full text-left rounded-xl border p-3 transition-colors",
                  isSel
                    ? "border-foreground/40 bg-muted/50 ring-1 ring-foreground/10"
                    : "border-border hover:border-foreground/25 hover:bg-muted/25",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: z.colour || "#94A3B8" }}
                  />
                  <span className="text-sm font-bold truncate flex-1">{z.name || "Untitled"}</span>
                  {z.active === false ? (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/40 text-amber-600">
                      Paused
                    </Badge>
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  {(z.areaSqKm ?? 0).toFixed(1)} km² · {(z.polygon?.length ?? 0)} points
                  {(z.priority ?? 0) > 0 && ` · priority ${z.priority}`}
                </p>
              </button>
            );
          })}
        </div>

        {/* ── Editor ────────────────────────────────────────────────── */}
        {!draft ? (
          <div className="rounded-xl border border-dashed border-border grid place-items-center min-h-[460px] p-8 text-center">
            <div className="max-w-sm">
              <MapIcon className="h-7 w-7 mx-auto text-muted-foreground/40" />
              <p className="mt-3 text-sm font-bold">Pick a zone, or draw a new one</p>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                Every vendor, rider and order is matched to a zone by coordinates. Delivery fees,
                serviceability and area reporting all follow from the boundary you draw here.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ZonePolygonEditor
              draft={draft.polygon ?? []}
              onChange={(polygon) => setDraft((d) => (d ? { ...d, polygon } : d))}
              others={others}
              pins={pins}
              colour={draft.colour || "#0F6E6A"}
              centre={
                draft.polygon && draft.polygon.length ? centroidOf(draft.polygon) : undefined
              }
            />

            {/* Live coverage */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: Store, label: "Vendors inside", value: inside.vendors, tone: "text-amber-600" },
                { icon: Bike, label: "Riders based here", value: inside.riders, tone: "text-blue-600" },
                { icon: Circle, label: "Area", value: `${liveArea.toFixed(1)} km²`, tone: "text-foreground" },
                { icon: MapIcon, label: "Boundary points", value: draft.polygon?.length ?? 0, tone: "text-foreground" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-border bg-card px-3.5 py-3">
                  <div className="flex items-center gap-1.5">
                    <s.icon className={cn("h-3.5 w-3.5", s.tone)} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </p>
                  </div>
                  <p className="mt-1 text-xl font-black tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Settings */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Zone name</Label>
                  <Input
                    value={draft.name ?? ""}
                    placeholder="e.g. Fort Kochi"
                    onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">City</Label>
                  <Select
                    value={draft.marketId ?? ""}
                    onValueChange={(v) => setDraft((d) => (d ? { ...d, marketId: v } : d))}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {markets.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name || m.city || m.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Map colour</Label>
                  <div className="flex gap-1.5 pt-1.5">
                    {PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Use colour ${c}`}
                        onClick={() => setDraft((d) => (d ? { ...d, colour: c } : d))}
                        className={cn(
                          "h-6 w-6 rounded-full transition-transform",
                          draft.colour === c ? "ring-2 ring-offset-2 ring-foreground scale-110" : "hover:scale-110",
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="h-px bg-border" />

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Delivery pricing in this zone
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {(
                    [
                      ["deliveryBaseFee", "Base fee ₹"],
                      ["deliveryPerKm", "Per km ₹"],
                      ["freeDeliveryUnderKm", "Free under km"],
                      ["freeDeliveryAbove", "Free above ₹"],
                      ["minOrderValue", "Min order ₹"],
                      ["platformFee", "Platform fee ₹"],
                      ["maxDeliveryRadiusKm", "Max radius km"],
                    ] as Array<[keyof ZoneEconomics, string]>
                  ).map(([key, label]) => (
                    <div key={key} className="space-y-1.5">
                      <Label className="text-xs">{label}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={draft.economics?.[key] ?? DEFAULT_ECONOMICS[key]}
                        onChange={(e) => setEcon(key, e.target.value)}
                        className="h-9 tabular-nums"
                      />
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Overlap priority</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.priority ?? 0}
                      onChange={(e) =>
                        setDraft((d) => (d ? { ...d, priority: Number(e.target.value) || 0 } : d))
                      }
                      className="h-9 tabular-nums"
                    />
                  </div>
                </div>
                <p className="mt-2.5 text-[11px] text-muted-foreground leading-relaxed">
                  These replace the platform defaults for any address inside this boundary. Where
                  two zones overlap, the higher priority wins; equal priorities go to the smaller
                  zone.
                </p>
              </div>

              <div className="h-px bg-border" />

              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <Switch
                    checked={draft.active !== false}
                    onCheckedChange={(v) => setDraft((d) => (d ? { ...d, active: v } : d))}
                  />
                  <span className="text-sm font-medium">Serviceable</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <Switch
                    checked={draft.codEnabled !== false}
                    onCheckedChange={(v) => setDraft((d) => (d ? { ...d, codEnabled: v } : d))}
                  />
                  <span className="text-sm font-medium">Cash on delivery</span>
                </label>
                <div className="flex items-center gap-2.5">
                  <Label className="text-sm font-medium">Surge multiplier</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3}
                    step={0.1}
                    value={draft.surgeMultiplier ?? 1}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, surgeMultiplier: Number(e.target.value) || 1 } : d))
                    }
                    className="h-9 w-20 tabular-nums"
                  />
                </div>
              </div>

              {draft.active === false && (
                <p className="text-[11px] text-amber-600 font-medium">
                  Paused zones stop accepting new orders. Vendors and riders keep their assignment
                  so nothing has to be re-drawn when you switch it back on.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button onClick={save} disabled={saving} className="h-9">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                  {draft.id ? "Save zone" : "Create zone"}
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)} className="h-9">
                  Cancel
                </Button>
                {draft.id && (
                  <Button
                    variant="ghost"
                    onClick={remove}
                    disabled={saving}
                    className="h-9 ml-auto text-rose-600 hover:text-rose-600 hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                  </Button>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4 flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted-foreground flex-1 min-w-[220px] leading-relaxed">
                After redrawing boundaries, re-run assignment so vendors and riders land in the
                right zone. Manual pins are always left alone.
              </p>
              <Button variant="outline" size="sm" className="h-8" disabled={backfilling} onClick={() => runBackfill(true)}>
                Scan
              </Button>
              <Button size="sm" className="h-8" disabled={backfilling} onClick={() => runBackfill(false)}>
                {backfilling && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Reassign now
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
