import { PageSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { CustomerBrandLockup } from "@/components/admin/customer/CustomerBrandLockup";
import { toast } from "sonner";
import {
  Eye,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  MousePointerClick,
  Pencil,
  Plus,
  Store,
  Trash2,
  Save,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCards } from "@/components/admin/StatCards";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityDrawer } from "@/components/admin/core/EntityDrawer";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";

/**
 * Ads & Sponsorships — Swiggy/Zomato-style paid placements in the customer app.
 *
 * Two campaign types (collection: `platform_ads`):
 *  • `banner` — a hero carousel card on the customer home (image + copy;
 *    tapping runs a search or opens a restaurant).
 *  • `sponsored_restaurant` — boosts a partner restaurant to the top of the
 *    home grid with an "Ad" tag.
 *
 * The customer app bumps `impressions`/`clicks` counters (rules restrict app
 * writes to exactly those two fields), so CTR is visible right here.
 */

type AdType = "banner" | "tracking_banner" | "mess_banner" | "sponsored_restaurant";

/** Image + copy placements: the home carousel and the order-tracking slot. */
const bannerLike = (t: AdType) => t === "banner" || t === "tracking_banner" || t === "mess_banner";

interface PlatformAd {
  id: string;
  type?: AdType;
  title?: string;
  subtitle?: string;
  tag?: string;
  imageUrl?: string;
  restaurantId?: string;
  restaurantName?: string;
  searchQuery?: string;
  priority?: number;
  active?: boolean;
  endAt?: { toDate?: () => Date } | null;
  impressions?: number;
  clicks?: number;
}

interface TenantOption {
  id: string;
  name: string;
}

const asDate = (v: PlatformAd["endAt"]) => {
  if (!v) return null;
  try {
    return v.toDate ? v.toDate() : null;
  } catch {
    return null;
  }
};

const emptyForm = {
  type: "banner" as AdType,
  title: "",
  subtitle: "",
  tag: "SPONSORED",
  imageUrl: "",
  restaurantId: "",
  searchQuery: "",
  priority: 10,
  active: true,
  endAt: "",
};

export default function AdsPage() {
  const [rows, setRows] = useState<PlatformAd[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [searchParams] = useSearchParams();
  const searchSeed = (searchParams.get("search") ?? "").trim().toLowerCase();
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  
  const [itemToDelete, setItemToDelete] = useState<PlatformAd | null>(null);

  useEffect(() => {
    return listenCollection<PlatformAd>(
      "platform_ads",
      { orderByField: "createdAt", limit: 400 },
      (next) => {
        setRows(next);
        setLoading(false);
      },
      () => {
        toast.error("Failed to load ads");
        setLoading(false);
      },
    );
  }, []);

  // Restaurants for the sponsored-placement picker (one-shot).
  useEffect(() => {
    getDocs(query(collection(db, "restaurants"), limit(500)))
      .then((snap) => {
        const list = snap.docs
          .filter((d) => !d.data().isDeleted)
          .map((d) => ({ id: d.id, name: (d.data().name as string) || "Unnamed" }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setTenants(list);
      })
      .catch((err) => console.error("Tenant list load failed:", err));
  }, []);

  const visibleRows = useMemo(
    () =>
      searchSeed
        ? rows.filter((a) =>
            [a.title, a.subtitle, a.tag, a.restaurantName, a.searchQuery]
              .map((s) => (s ?? "").toLowerCase())
              .some((s) => s.includes(searchSeed))
          )
        : rows,
    [rows, searchSeed]
  );

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.active !== false).length;
    const impressions = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
    const clicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
    return { active, impressions, clicks };
  }, [rows]);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setOpen(true);
  };

  const openEdit = (a: PlatformAd) => {
    setEditingId(a.id);
    const end = asDate(a.endAt);
    setForm({
      type: a.type || "banner",
      title: a.title || "",
      subtitle: a.subtitle || "",
      tag: a.tag || "SPONSORED",
      imageUrl: a.imageUrl || "",
      restaurantId: a.restaurantId || "",
      searchQuery: a.searchQuery || "",
      priority: a.priority ?? 10,
      active: a.active !== false,
      endAt: end ? end.toISOString().slice(0, 10) : "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (bannerLike(form.type)) {
      if (!form.title.trim()) return toast.error("Enter a banner title");
      if (!form.imageUrl.trim()) return toast.error("Enter a banner image URL");
    } else if (!form.restaurantId) {
      return toast.error("Pick the restaurant to sponsor");
    }
    setSaving(true);
    try {
      const tenant = tenants.find((t) => t.id === form.restaurantId);
      const payload = {
        type: form.type,
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        tag: form.tag.trim().toUpperCase() || "SPONSORED",
        imageUrl: form.imageUrl.trim(),
        restaurantId: form.type === "sponsored_restaurant" || form.restaurantId ? form.restaurantId : "",
        restaurantName: tenant?.name ?? "",
        searchQuery: form.searchQuery.trim(),
        priority: Number(form.priority) || 0,
        active: form.active,
        endAt: form.endAt ? Timestamp.fromDate(new Date(`${form.endAt}T23:59:59`)) : null,
        updatedAt: serverTimestamp(),
      };
      if (editingId) {
        await setDoc(doc(db, "platform_ads", editingId), payload, { merge: true });
      } else {
        await addDoc(collection(db, "platform_ads"), {
          ...payload,
          impressions: 0,
          clicks: 0,
          createdAt: serverTimestamp(),
        });
      }
      toast.success("Campaign saved — live in the customer app");
      setOpen(false);
    } catch (e) {
      console.error(e);
      toast.error("Save failed — admin only");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!itemToDelete) return;
    try {
      await deleteDoc(doc(db, "platform_ads", itemToDelete.id));
      toast.success("Campaign deleted");
    } catch {
      toast.error("Delete failed");
    } finally {
      setItemToDelete(null);
    }
  };

  const toggleActive = async (a: PlatformAd) => {
    try {
      await setDoc(
        doc(db, "platform_ads", a.id),
        { active: !(a.active !== false), updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch {
      toast.error("Update failed");
    }
  };

  const ctr = (a: PlatformAd) => {
    const imp = a.impressions ?? 0;
    if (imp === 0) return "—";
    return `${(((a.clicks ?? 0) / imp) * 100).toFixed(1)}%`;
  };

  const kpis = [
    { label: "Campaigns", value: rows.length },
    { label: "Live now", value: stats.active, hint: "Serving in the app", tone: "text-emerald-600" },
    { label: "Impressions", value: stats.impressions.toLocaleString("en-IN"), tone: "text-indigo-600" },
    {
      label: "Clicks",
      value: stats.clicks.toLocaleString("en-IN"),
      tone: "text-fuchsia-600",
      hint: stats.impressions > 0 ? `${((stats.clicks / stats.impressions) * 100).toFixed(1)}% click-through` : "No impressions yet",
    },
  ];

  if (loading) {
    return (
      <PageSkeleton />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <CustomerBrandLockup
          title="Ads & sponsorships"
          subtitle="Sponsored placements vendors run in the customer app."
        />
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> New Campaign
        </Button>
      </div>

      <StatCards items={kpis} />

      <Card className="rounded-2xl border-border/40 shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b border-border/40 pb-6">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Megaphone className="h-4 w-4" /> Campaign Directory
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {visibleRows.length === 0 ? (
            <div className="p-16 text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">
              {searchSeed
                ? `No campaigns match "${searchSeed}"`
                : "No ad campaigns yet — create one to see it in the customer app"}
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {visibleRows.map((a) => {
                const end = asDate(a.endAt);
                const ended = end && end < new Date();
                const isBanner = bannerLike(a.type || "banner");
                return (
                  <div key={a.id} className="flex items-center gap-4 p-4 md:p-5">
                    {isBanner && a.imageUrl ? (
                      <img
                        src={a.imageUrl}
                        alt=""
                        className="h-11 w-16 rounded-xl object-cover border border-border/40 shrink-0"
                      />
                    ) : (
                      <div className="h-11 w-11 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        {isBanner ? (
                          <ImageIcon className="h-5 w-5 text-primary" />
                        ) : (
                          <Store className="h-5 w-5 text-primary" />
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black tracking-tight text-sm">
                          {isBanner ? a.title || "Untitled banner" : a.restaurantName || "Restaurant"}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5"
                        >
                          {a.type === "tracking_banner" ? "Order Tracking" : a.type === "mess_banner" ? "Mess Banner" : isBanner ? "Home Banner" : "Sponsored Listing"}
                        </Badge>
                        {a.active !== false && !ended ? (
                          <Badge className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                            Live
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 text-muted-foreground"
                          >
                            {ended ? "Ended" : "Paused"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground font-bold truncate mt-0.5 flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" /> {(a.impressions ?? 0).toLocaleString("en-IN")}
                        </span>
                        <span className="flex items-center gap-1">
                          <MousePointerClick className="h-3 w-3" /> {(a.clicks ?? 0).toLocaleString("en-IN")}
                        </span>
                        <span>CTR {ctr(a)}</span>
                        <span>· priority {a.priority ?? 0}</span>
                        {end ? <span>· ends {end.toLocaleDateString()}</span> : null}
                      </p>
                    </div>
                    <Switch checked={a.active !== false} onCheckedChange={() => toggleActive(a)} />
                    <Button aria-label="Edit" variant="ghost" size="icon" onClick={() => openEdit(a)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button aria-label="Delete"
                      variant="ghost"
                      size="icon"
                      onClick={() => setItemToDelete(a)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <EntityDrawer
        open={open}
        onOpenChange={setOpen}
        title={editingId ? "Edit Campaign" : "New Campaign"}
        icon={Megaphone}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? "Save changes" : "Launch campaign"}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Placement</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm({ ...form, type: v as AdType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="banner">Home banner (hero carousel)</SelectItem>
                <SelectItem value="mess_banner">Mess banner (top of the Mess tab)</SelectItem>
                <SelectItem value="tracking_banner">
                  Order tracking (shown while the order is on its way)
                </SelectItem>
                <SelectItem value="sponsored_restaurant">
                  Sponsored restaurant (boosted listing)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {bannerLike(form.type) ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Title</Label>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Flat 50% OFF"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Tag</Label>
                  <Input
                    value={form.tag}
                    onChange={(e) => setForm({ ...form, tag: e.target.value.toUpperCase() })}
                    placeholder="SPONSORED"
                    className="uppercase"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Subtitle</Label>
                <Input
                  value={form.subtitle}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                  placeholder="Gourmet burgers and meals in minutes"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Image URL</Label>
                <Input
                  value={form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  placeholder="https://…"
                />
                {form.imageUrl && (
                  <img
                    src={form.imageUrl}
                    alt="Banner preview"
                    className="mt-2 h-32 w-full rounded-xl object-cover border border-border/40"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">
                    Tap runs search (optional)
                  </Label>
                  <Input
                    value={form.searchQuery}
                    onChange={(e) => setForm({ ...form, searchQuery: e.target.value })}
                    placeholder="biryani"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">
                    …or opens restaurant
                  </Label>
                  <Select
                    value={form.restaurantId || "none"}
                    onValueChange={(v) =>
                      setForm({ ...form, restaurantId: v === "none" ? "" : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {tenants.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Restaurant</Label>
              <Select
                value={form.restaurantId || undefined}
                onValueChange={(v) => setForm({ ...form, restaurantId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a partner restaurant" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground font-medium pt-1">
                Boosted to the top of the customer home grid with an "Ad" tag.
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Priority</Label>
              <Input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Ends (optional)</Label>
              <Input
                type="date"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between p-3 border border-border/50 rounded-xl">
              <Label className="text-xs font-medium">Active</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
            </div>
          </div>
        </div>
      </EntityDrawer>
      
      <ConfirmationDialog
        open={!!itemToDelete}
        onOpenChange={(open) => !open && setItemToDelete(null)}
        title="Delete Campaign"
        description={`Are you sure you want to delete campaign "${itemToDelete?.title || itemToDelete?.restaurantName || itemToDelete?.id}"? This action cannot be undone.`}
        confirmLabel="Delete Campaign"
        onConfirm={confirmRemove}
      />
    </div>
  );
}
