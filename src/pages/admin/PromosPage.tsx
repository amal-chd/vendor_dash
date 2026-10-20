import { PageSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  setDoc,
  deleteDoc,
  doc,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { CustomerBrandLockup } from "@/components/admin/customer/CustomerBrandLockup";
import { toast } from "sonner";
import { Loader2, Ticket, Plus, Pencil, Trash2, BadgePercent, Save } from "lucide-react";
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

interface Promo {
  id: string;
  code?: string;
  type?: "percent" | "flat";
  value?: number;
  maxOff?: number;
  minOrder?: number;
  description?: string;
  active?: boolean;
  expiresAt?: any;
}

const asDate = (v: any) => {
  if (!v) return null;
  try {
    return v.toDate ? v.toDate() : new Date(v);
  } catch {
    return null;
  }
};

const emptyForm = {
  code: "",
  type: "percent" as "percent" | "flat",
  value: 20,
  maxOff: 100,
  minOrder: 149,
  description: "",
  active: true,
  expiresAt: "",
};

export default function PromosPage() {
  const [rows, setRows] = useState<Promo[]>([]);
  const [searchParams] = useSearchParams();
  const searchSeed = (searchParams.get("search") ?? "").trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      searchSeed
        ? rows.filter(
            (p) =>
              (p.code ?? "").toLowerCase().includes(searchSeed) ||
              (p.description ?? "").toLowerCase().includes(searchSeed)
          )
        : rows,
    [rows, searchSeed]
  );
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  
  const [itemToDelete, setItemToDelete] = useState<Promo | null>(null);

  useEffect(() => {
    return listenCollection<Promo>(
      "promos",
      { orderByField: "createdAt", limit: 500 },
      (next) => {
        setRows(next);
        setLoading(false);
      },
      () => {
        toast.error("Failed to load coupons");
        setLoading(false);
      },
    );
  }, []);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setOpen(true);
  };

  const openEdit = (p: Promo) => {
    setEditingId(p.id);
    const exp = asDate(p.expiresAt);
    setForm({
      code: p.code || p.id,
      type: p.type || "percent",
      value: p.value ?? 20,
      maxOff: p.maxOff ?? 100,
      minOrder: p.minOrder ?? 0,
      description: p.description || "",
      active: p.active !== false,
      expiresAt: exp ? exp.toISOString().slice(0, 10) : "",
    });
    setOpen(true);
  };

  const save = async () => {
    const code = form.code.trim().toUpperCase();
    if (!code) return toast.error("Enter a coupon code");
    if (!form.value || form.value <= 0) return toast.error("Enter a valid value");
    setSaving(true);
    try {
      await setDoc(
        doc(db, "promos", code),
        {
          code,
          type: form.type,
          value: Number(form.value),
          maxOff: form.type === "percent" ? Number(form.maxOff) : Number(form.value),
          minOrder: Number(form.minOrder) || 0,
          description: form.description.trim(),
          active: form.active,
          expiresAt: form.expiresAt
            ? Timestamp.fromDate(new Date(`${form.expiresAt}T23:59:59`))
            : null,
          updatedAt: serverTimestamp(),
          ...(editingId ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      );
      toast.success(`Coupon ${code} saved`);
      setOpen(false);
    } catch (e: any) {
      console.error(e);
      toast.error("Save failed — admin only");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!itemToDelete) return;
    try {
      await deleteDoc(doc(db, "promos", itemToDelete.id));
      toast.success("Coupon deleted");
    } catch {
      toast.error("Delete failed");
    } finally {
      setItemToDelete(null);
    }
  };

  const toggleActive = async (p: Promo) => {
    try {
      await setDoc(doc(db, "promos", p.id), { active: !(p.active !== false) }, { merge: true });
    } catch {
      toast.error("Update failed");
    }
  };

  const discountLabel = (p: Promo) =>
    p.type === "flat"
      ? `₹${p.value} off`
      : `${p.value}% off${p.maxOff ? ` up to ₹${p.maxOff}` : ""}`;

  const activeCount = useMemo(() => rows.filter((r) => r.active !== false).length, [rows]);
  
  // Mutually exclusive: an expired coupon is not "active" even if its switch is on.
  const isExpired = (p: Promo) => {
    const d = asDate(p.expiresAt);
    return !!d && d.getTime() < Date.now();
  };
  const kpis = [
    { label: "Coupons", value: rows.length, icon: Ticket },
    { label: "Live", value: rows.filter((p) => p.active !== false && !isExpired(p)).length, hint: "Customers can apply now", tone: "text-emerald-600" },
    { label: "Switched off", value: rows.filter((p) => p.active === false && !isExpired(p)).length, hint: "Paused by an admin" },
    { label: "Expired", value: rows.filter(isExpired).length, hint: "Past their end date", tone: "text-rose-600" },
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
          title="Coupons & offers"
          subtitle="Codes customers apply at checkout in the Kada app."
        />
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> New Coupon
        </Button>
      </div>

      <StatCards items={kpis} />

      <Card className="rounded-2xl border-border/40 shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b border-border/40 pb-6">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Ticket className="h-4 w-4" /> Coupon Directory
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {visibleRows.length === 0 ? (
            <div className="p-16 text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">
              {searchSeed
                ? `No coupons match "${searchSeed}"`
                : "No coupons yet — create one to see it live in the app"}
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {visibleRows.map((p) => {
                const exp = asDate(p.expiresAt);
                const expired = exp && exp < new Date();
                return (
                  <div key={p.id} className="flex items-center gap-4 p-4 md:p-5">
                    <div className="h-11 w-11 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <BadgePercent className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black tracking-tight text-sm">{p.code || p.id}</span>
                        <Badge
                          variant="outline"
                          className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5"
                        >
                          {discountLabel(p)}
                        </Badge>
                        {p.active !== false && !expired ? (
                          <Badge className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                            Live
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 text-muted-foreground"
                          >
                            {expired ? "Expired" : "Paused"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground font-bold truncate mt-0.5">
                        {p.description || `Min order ₹${p.minOrder || 0}`}
                        {exp ? ` · expires ${exp.toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <Switch checked={p.active !== false} onCheckedChange={() => toggleActive(p)} />
                    <Button aria-label="Edit" variant="ghost" size="icon" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button aria-label="Delete"
                      variant="ghost"
                      size="icon"
                      onClick={() => setItemToDelete(p)}
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
        title={editingId ? "Edit Coupon" : "New Coupon"}
        icon={Ticket}
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} >
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? "Save changes" : "Create coupon"}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Code</Label>
              <Input
                value={form.code}
                disabled={!!editingId}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="KADA50"
                className="font-bold uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as "percent" | "flat" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percentage off</SelectItem>
                  <SelectItem value="flat">Flat ₹ off</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium">
                {form.type === "flat" ? "₹ Off" : "% Off"}
              </Label>
              <Input
                type="number"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Max ₹</Label>
              <Input
                type="number"
                value={form.maxOff}
                disabled={form.type === "flat"}
                onChange={(e) => setForm({ ...form, maxOff: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Min order ₹</Label>
              <Input
                type="number"
                value={form.minOrder}
                onChange={(e) => setForm({ ...form, minOrder: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="50% off up to ₹100 on orders over ₹149"
            />
          </div>
          <div className="grid grid-cols-2 gap-4 items-end">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Expires (optional)</Label>
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
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
        title="Delete Coupon"
        description={`Are you sure you want to delete coupon ${itemToDelete?.code || itemToDelete?.id}? This action cannot be undone.`}
        confirmLabel="Delete Coupon"
        onConfirm={confirmRemove}
      />
    </div>
  );
}

