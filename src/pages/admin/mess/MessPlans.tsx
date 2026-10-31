import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { ColumnDef } from "@tanstack/react-table";
import { Layers, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface Kitchen {
  id: string;
  name?: string;
  kitchenName?: string;
  onboarding?: { state?: string };
}

interface Plan {
  id: string;
  name?: string;
  pricePaise?: number;
  durationDays?: number;
  meals?: string[];
  vegOnly?: boolean;
  active?: boolean;
}

const MEALS = ["breakfast", "lunch", "dinner"] as const;
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * A kitchen's menu of plans, as the customer app reads them.
 *
 * The same bounds the rules and the subscribe callable enforce are applied
 * here (₹100–₹50,000, 1–31 days, at least one meal), so a plan saved from
 * admin can never be one that checkout would then refuse to sell.
 */
export default function MessPlans() {
  const [searchParams] = useSearchParams();
  const paramKid = searchParams.get("kitchenId");
  const kitchens = useLiveCollection<Kitchen>("mess_kitchens", { limit: 200 });
  const [kitchenId, setKitchenId] = useState<string>("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("30");
  const [meals, setMeals] = useState<string[]>(["lunch", "dinner"]);
  const [vegOnly, setVegOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const kitchenName = useMemo(() => {
    const k = kitchens.rows.find((x) => x.id === kitchenId);
    return k?.name || k?.kitchenName || "";
  }, [kitchens.rows, kitchenId]);

  // Pre-select kitchen from URL param or default to the first kitchen
  useEffect(() => {
    if (paramKid && kitchens.rows.some((x) => x.id === paramKid)) {
      setKitchenId(paramKid);
    } else if (!kitchenId && kitchens.rows.length) {
      setKitchenId(kitchens.rows[0].id);
    }
  }, [kitchens.rows, kitchenId, paramKid]);

  useEffect(() => {
    if (!kitchenId) return;
    setLoading(true);
    return onSnapshot(
      collection(db, "mess_kitchens", kitchenId, "plans"),
      (snap) => {
        setPlans(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Plan, "id">) })));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast.error("Couldn't load this kitchen's plans");
        setLoading(false);
      },
    );
  }, [kitchenId]);

  const startCreate = () => {
    setEditing(null);
    setName("");
    setPrice("");
    setDays("30");
    setMeals(["lunch", "dinner"]);
    setVegOnly(false);
    setOpen(true);
  };

  const startEdit = (p: Plan) => {
    setEditing(p);
    setName(p.name ?? "");
    setPrice(((p.pricePaise ?? 0) / 100).toString());
    setDays((p.durationDays ?? 30).toString());
    setMeals(p.meals ?? []);
    setVegOnly(p.vegOnly === true);
    setOpen(true);
  };

  const save = async () => {
    const rupees = Number(price);
    const duration = Number(days);
    if (!name.trim()) return toast.error("Give the plan a name.");
    if (!price.trim() || !Number.isFinite(rupees) || rupees < 0 || rupees > 50000) {
      return toast.error("Price must be between ₹0 and ₹50,000.");
    }
    if (!Number.isFinite(duration) || duration < 1 || duration > 31) {
      return toast.error("Duration must be between 1 and 31 days.");
    }
    if (meals.length === 0) return toast.error("Pick at least one meal.");

    setSaving(true);
    const payload = {
      name: name.trim().slice(0, 80),
      pricePaise: Math.round(rupees * 100),
      durationDays: Math.round(duration),
      meals,
      vegOnly,
      active: editing ? editing.active !== false : true,
    };
    try {
      if (editing) {
        await updateDoc(doc(db, "mess_kitchens", kitchenId, "plans", editing.id), payload);
        toast.success("Plan updated");
      } else {
        await addDoc(collection(db, "mess_kitchens", kitchenId, "plans"), payload);
        toast.success("Plan added");
      }
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the plan");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: Plan) => {
    try {
      await updateDoc(doc(db, "mess_kitchens", kitchenId, "plans", p.id), {
        active: p.active === false,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the plan");
    }
  };

  const remove = async (p: Plan) => {
    if (
      !(await confirmDialog({
        title: `Delete "${p.name}"?`,
        description: "New customers can't buy it. Running subscriptions keep the plan they were sold.",
        confirmLabel: "Delete plan",
        destructive: true,
      }))
    )
      return;
    try {
      await deleteDoc(doc(db, "mess_kitchens", kitchenId, "plans", p.id));
      toast.success("Plan deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the plan");
    }
  };

  const columns: ColumnDef<Plan>[] = [
    { accessorKey: "name", header: "Plan" },
    {
      id: "price",
      header: "Price",
      cell: ({ row }) => <span className="tabular-nums">{inr((row.original.pricePaise ?? 0) / 100)}</span>,
    },
    {
      id: "duration",
      header: "Days",
      cell: ({ row }) => <span className="tabular-nums">{row.original.durationDays ?? "—"}</span>,
    },
    {
      id: "perDay",
      header: "Per day",
      cell: ({ row }) => {
        const d = row.original.durationDays ?? 0;
        if (!d) return <span className="text-muted-foreground">—</span>;
        return <span className="tabular-nums">{inr((row.original.pricePaise ?? 0) / 100 / d)}</span>;
      },
    },
    {
      id: "meals",
      header: "Meals",
      cell: ({ row }) => (
        <div className="flex gap-1 flex-wrap">
          {(row.original.meals ?? []).map((m) => (
            <Badge key={m} variant="outline" className="capitalize">
              {m}
            </Badge>
          ))}
          {row.original.vegOnly && <Badge className="bg-emerald-600">veg</Badge>}
        </div>
      ),
    },
    {
      id: "active",
      header: "Live",
      cell: ({ row }) => (
        <Switch checked={row.original.active !== false} onCheckedChange={() => toggleActive(row.original)} />
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex gap-1 justify-end">
          <Button size="sm" variant="outline" onClick={() => startEdit(row.original)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => remove(row.original)}>
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Meal plans"
        description="What each kitchen sells. Prices here are exactly what the customer is charged at checkout."
        icon={Layers}
        actions={
          <div className="flex gap-2 items-center">
            <Select value={kitchenId} onValueChange={setKitchenId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Choose a kitchen" />
              </SelectTrigger>
              <SelectContent>
                {kitchens.rows.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name || k.kitchenName || k.id}
                    {k.onboarding?.state !== "active" ? " (not live)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={startCreate} disabled={!kitchenId}>
              <Plus className="w-4 h-4 mr-1" />
              Add plan
            </Button>
          </div>
        }
      />

      {!kitchens.rows.length ? (
        <p className="text-sm text-muted-foreground">No mess kitchens have signed up yet.</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading plans…</p>
      ) : (
        <DataTable columns={columns} data={plans} exportFilename={`mess-plans-${kitchenId}`} />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit plan" : "New plan"}</DialogTitle>
            <DialogDescription>
              For {kitchenName || "this kitchen"}. Customers pay this price up front.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Name</Label>
              <Input
                id="plan-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Monthly lunch + dinner"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-price">Price (₹)</Label>
                <Input id="plan-price" type="number" min="0" max="50000" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-days">Days</Label>
                <Input id="plan-days" type="number" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Meals</Label>
              <div className="flex gap-2">
                {MEALS.map((m) => {
                  const on = meals.includes(m);
                  return (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      className="capitalize"
                      onClick={() => setMeals(on ? meals.filter((x) => x !== m) : [...meals, m])}
                    >
                      {m}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch id="plan-veg" checked={vegOnly} onCheckedChange={setVegOnly} />
              <Label htmlFor="plan-veg">Pure veg</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
