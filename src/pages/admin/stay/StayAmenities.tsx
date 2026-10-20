import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import { useMemo, useState } from "react";
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  AMENITY_CATEGORIES,
  AMENITY_ICON_KEYS,
  DEFAULT_STAY_AMENITIES,
  listingHasAmenity,
  slugifyAmenityKey,
} from "@/lib/stayAmenities";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ColumnDef } from "@tanstack/react-table";
import {
  Car,
  Coffee,
  Dumbbell,
  Droplets,
  Flame,
  HeartPulse,
  Home,
  Laptop,
  Mountain,
  PawPrint,
  Plus,
  Shirt,
  Sparkles,
  Trash2,
  Tv,
  Utensils,
  Waves,
  Wifi,
  Wind,
} from "lucide-react";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { toast } from "sonner";

interface Amenity {
  id: string;
  key?: string;
  name?: string;
  category?: string;
  iconName?: string;
  sortOrder?: number;
  isActive?: boolean;
}

interface HotelRow {
  id: string;
  amenities?: unknown;
}

const ICON_MAP: Record<string, typeof Wifi> = {
  wifi: Wifi,
  wind: Wind,
  tv: Tv,
  laptop: Laptop,
  droplets: Droplets,
  shirt: Shirt,
  utensils: Utensils,
  coffee: Coffee,
  car: Car,
  waves: Waves,
  dumbbell: Dumbbell,
  "paw-print": PawPrint,
  home: Home,
  flame: Flame,
  mountain: Mountain,
  "heart-pulse": HeartPulse,
  "parking-circle": Car,
  sparkles: Sparkles,
};

function AmenityGlyph({ name, className }: { name?: string; className?: string }) {
  const Icon = ICON_MAP[(name || "wifi").toLowerCase()] ?? Wifi;
  return <Icon className={className ?? "h-4 w-4"} />;
}

export default function StayAmenities() {
  const { rows, loading, error } = useLiveCollection<Amenity>("stay_amenities", {
    orderByField: "sortOrder",
    orderDir: "asc",
  });
  const { rows: hotels } = useLiveCollection<HotelRow>("hotels", { limit: 500 });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [draft, setDraft] = useState<Partial<Amenity>>({
    isActive: true,
    category: "Essentials",
    iconName: "wifi",
    sortOrder: 10,
  });

  const usageByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const hotel of hotels) {
      for (const row of rows) {
        const token = row.key || row.id;
        if (listingHasAmenity(hotel.amenities, token) || listingHasAmenity(hotel.amenities, row.name || "")) {
          map.set(row.id, (map.get(row.id) || 0) + 1);
        }
      }
    }
    return map;
  }, [hotels, rows]);

  const filtered = useMemo(() => {
    if (categoryFilter === "all") return rows;
    return rows.filter((r) => (r.category || "Features") === categoryFilter);
  }, [rows, categoryFilter]);

  const categories = useMemo(() => {
    const set = new Set<string>([...AMENITY_CATEGORIES]);
    for (const r of rows) if (r.category) set.add(r.category);
    return [...set];
  }, [rows]);

  const activeCount = rows.filter((r) => r.isActive !== false).length;

  const openNew = () => {
    const maxSort = rows.reduce((m, r) => Math.max(m, Number(r.sortOrder) || 0), 0);
    setDraft({
      isActive: true,
      category: "Essentials",
      iconName: "wifi",
      sortOrder: maxSort + 10,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft.name?.trim()) {
      toast.error("Name is required");
      return;
    }
    const key = (draft.key || slugifyAmenityKey(draft.name)).trim() || slugifyAmenityKey(draft.name);
    if (!key) {
      toast.error("Could not build a key from that name");
      return;
    }
    const clash = rows.find((r) => r.id !== draft.id && (r.key === key || r.id === key));
    if (clash) {
      toast.error(`Key “${key}” is already used by ${clash.name}`);
      return;
    }
    const id = draft.id || key;
    const payload = {
      key,
      name: draft.name.trim(),
      category: draft.category || "Essentials",
      iconName: (draft.iconName || "wifi").toLowerCase(),
      sortOrder: Number(draft.sortOrder) || 0,
      isActive: draft.isActive !== false,
      updatedAt: serverTimestamp(),
    };
    setSaving(true);
    try {
      if (draft.id) await updateDoc(doc(db, "stay_amenities", draft.id), payload);
      else await setDoc(doc(db, "stay_amenities", id), { ...payload, createdAt: serverTimestamp() });
      toast.success("Amenity saved — hosts and guest filters pick this up live");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed — check you are signed in as admin");
    } finally {
      setSaving(false);
    }
  };

  const seedCatalog = async () => {
    setSeeding(true);
    try {
      const existing = new Map(rows.map((r) => [r.id, r]));
      const batch = writeBatch(db);
      for (const item of DEFAULT_STAY_AMENITIES) {
        const prev = existing.get(item.key);
        const payload: Record<string, unknown> = {
          key: item.key,
          name: item.name,
          category: item.category,
          iconName: item.iconName,
          sortOrder: item.sortOrder,
          isActive: prev?.isActive !== false,
          updatedAt: serverTimestamp(),
        };
        if (!prev) payload.createdAt = serverTimestamp();
        batch.set(doc(db, "stay_amenities", item.key), payload, { merge: true });
      }
      await batch.commit();
      toast.success(`Catalog ready — ${DEFAULT_STAY_AMENITIES.length} amenities hosts can select`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Seed failed — admin access required");
    } finally {
      setSeeding(false);
    }
  };

  const columns: ColumnDef<Amenity>[] = useMemo(
    () => [
      {
        accessorKey: "sortOrder",
        header: "#",
        cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{row.original.sortOrder ?? "—"}</span>,
      },
      {
        accessorKey: "name",
        header: "Amenity",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
              <AmenityGlyph name={row.original.iconName} />
            </span>
            <div>
              <div className="font-medium">{row.original.name || row.original.key}</div>
              <div className="text-xs text-muted-foreground font-mono">{row.original.key || row.original.id}</div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => <Badge variant="outline">{row.original.category || "—"}</Badge>,
      },
      {
        id: "listings",
        header: "Listings",
        cell: ({ row }) => usageByKey.get(row.original.id) || 0,
      },
      {
        accessorKey: "isActive",
        header: "Guest-facing",
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive !== false}
            onCheckedChange={async (v) => {
              try {
                await updateDoc(doc(db, "stay_amenities", row.original.id), {
                  isActive: v,
                  updatedAt: serverTimestamp(),
                });
                toast.success(v ? "Shown to hosts & guests" : "Hidden from new listings");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Update failed");
              }
            }}
          />
        ),
      },
      {
        id: "a",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(row.original);
                setOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-rose-500"
              aria-label={`Remove ${row.original.name}`}
              onClick={async () => {
                const used = usageByKey.get(row.original.id) || 0;
                if (
                  !(await confirmDialog({
                    title: `Remove ${row.original.name}?`,
                    description: used
                      ? `${used} listing(s) already selected it. They keep it, but hosts and guests can no longer pick it.`
                      : "Hosts and guests can no longer pick it.",
                    confirmLabel: "Remove",
                    destructive: true,
                  }))
                ) {
                  return;
                }
                try {
                  await deleteDoc(doc(db, "stay_amenities", row.original.id));
                  toast.success("Removed from catalog");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Delete failed");
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [usageByKey],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Amenities"
        description="What hosts tick on a listing and what guests filter by. Add, hide or reorder; seed the standard set if the list is empty."
        icon={Wifi}
        stats={[
          { label: "In catalog", value: rows.length, loading },
          { label: "Active", value: activeCount, hint: "Shown to hosts and guests", tone: "text-emerald-600", loading },
          { label: "Hidden", value: rows.length - activeCount, loading },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" disabled={seeding} onClick={seedCatalog}>
              {seeding ? "Seeding…" : rows.length ? "Sync standard set" : "Seed standard set"}
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" /> Add amenity
            </Button>
          </div>
        }
      />
      {error && (
        <p className="text-sm text-rose-600">Could not load catalog: {error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={categoryFilter === "all" ? "default" : "outline"} onClick={() => setCategoryFilter("all")}>
          All
        </Button>
        {categories.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={categoryFilter === c ? "default" : "outline"}
            onClick={() => setCategoryFilter(c)}
          >
            {c}
          </Button>
        ))}
      </div>
      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center space-y-3">
          <p className="font-medium">No amenities yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Hosts currently fall back to a built-in list. Seed the standard catalog so admin, host, and guest apps share one source of truth.
          </p>
          <Button onClick={seedCatalog} disabled={seeding}>
            Seed standard set
          </Button>
        </div>
      )}
      <DataTable columns={columns} data={filtered} searchPlaceholder="Search amenities…" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit amenity" : "New amenity"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Display name</Label>
              <Input
                value={draft.name || ""}
                onChange={(e) => {
                  const name = e.target.value;
                  setDraft({
                    ...draft,
                    name,
                    key: draft.id ? draft.key : slugifyAmenityKey(name),
                  });
                }}
                placeholder="e.g. Free parking"
              />
            </div>
            <div>
              <Label>Stable key (saved on listings)</Label>
              <Input
                value={draft.key || ""}
                disabled={!!draft.id}
                className="font-mono text-sm"
                onChange={(e) => setDraft({ ...draft, key: slugifyAmenityKey(e.target.value) || e.target.value })}
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select
                value={categories.includes(draft.category || "") ? draft.category : "_custom"}
                onValueChange={(v) => setDraft({ ...draft, category: v === "_custom" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                  <SelectItem value="_custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
              {!categories.includes(draft.category || "") && (
                <Input
                  className="mt-2"
                  placeholder="Custom category"
                  value={draft.category || ""}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                />
              )}
            </div>
            <div>
              <Label>Sort order</Label>
              <Input
                type="number"
                value={draft.sortOrder ?? 0}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Icon</Label>
              <div className="mt-2 grid grid-cols-6 gap-2">
                {AMENITY_ICON_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDraft({ ...draft, iconName: k })}
                    className={`flex h-10 items-center justify-center rounded-md border ${
                      (draft.iconName || "wifi") === k ? "border-primary bg-primary/10" : "border-border"
                    }`}
                    title={k}
                  >
                    <AmenityGlyph name={k} />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>Active (hosts & guest filters)</Label>
              <Switch checked={draft.isActive !== false} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
