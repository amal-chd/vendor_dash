import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { ColumnDef } from "@tanstack/react-table";
import { Ban, CalendarX2, CheckCircle2, ChefHat, ImageIcon, IndianRupee, Layers, Utensils } from "lucide-react";
import { messAction, type MessKitchen } from "./messAdmin";
import { MessKitchenSheet } from "./MessKitchenSheet";
import { KitchenPhotos } from "@/components/mess/KitchenPhotos";
import { db } from "@/lib/firebase";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  area?: string;
  locality?: string;
  city?: string;
  vegOnly?: boolean;
  isBlocked?: boolean;
  feePerCustomerPerDayPaise?: number;
  onboarding?: { state?: string };
  logoUrl?: string;
  coverImage?: string;
  holidays?: string[];
  messSettings?: { acceptingSubscribers?: boolean; capacity?: Record<string, number>; skipCutoffHour?: number | null };
}

interface Sub {
  id: string;
  kitchenId?: string;
  status?: string;
}

const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;

/**
 * Every mess kitchen on the platform, and the one number Kada earns from them:
 * the per-customer-per-day fee. It is snapshotted onto each subscription at
 * purchase, so changing it here only affects subscriptions taken from now on.
 */
export default function MessKitchens() {
  const [photosFor, setPhotosFor] = useState<Kitchen | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [closeFor, setCloseFor] = useState<Kitchen | null>(null);
  const [closeDay, setCloseDay] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [closing, setClosing] = useState(false);

  const submitClosure = async (reopen: boolean, day = closeDay) => {
    if (!closeFor || !day) return;
    setClosing(true);
    try {
      const r = await messAction<{ affected: number }>(reopen ? "reopenDay" : "closeDay", {
        kitchenId: closeFor.id,
        day,
        reason: closeReason.trim(),
      });
      toast.success(`${reopen ? "Reopened" : "Closed"} ${day} — ${r.affected} subscriber plan(s) adjusted and notified.`);
      if (!reopen) setCloseDay("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the closure");
    } finally {
      setClosing(false);
    }
  };
  const kitchens = useLiveCollection<Kitchen>("mess_kitchens", { orderByField: "createdAt" });
  const subs = useLiveCollection<Sub>("mess_subscriptions", { limit: 1000 });

  const [feeFor, setFeeFor] = useState<Kitchen | null>(null);
  const [feeRupees, setFeeRupees] = useState("");
  const [saving, setSaving] = useState(false);

  const activeByKitchen = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of subs.rows) {
      if (s.status !== "active" || !s.kitchenId) continue;
      m.set(s.kitchenId, (m.get(s.kitchenId) ?? 0) + 1);
    }
    return m;
  }, [subs.rows]);

  const rows = kitchens.rows;
  const live = rows.filter((k) => k.onboarding?.state === "active");
  const blocked = rows.filter((k) => k.isBlocked === true);
  const dailyRevenue = live.reduce(
    (sum, k) => sum + ((k.feePerCustomerPerDayPaise ?? 300) / 100) * (activeByKitchen.get(k.id) ?? 0),
    0,
  );

  const saveFee = async () => {
    if (!feeFor) return;
    const rupees = Number(feeRupees);
    if (!Number.isFinite(rupees) || rupees < 0 || rupees > 100) {
      toast.error("Enter a fee between ₹0 and ₹100 per customer per day.");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "mess_kitchens", feeFor.id), {
        feePerCustomerPerDayPaise: Math.round(rupees * 100),
      });
      toast.success(
        `Fee set to ${inr(rupees)}/customer/day — applies to new subscriptions only.`,
      );
      setFeeFor(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the fee");
    } finally {
      setSaving(false);
    }
  };

  const toggleBlock = async (k: Kitchen) => {
    try {
      await updateDoc(doc(db, "mess_kitchens", k.id), { isBlocked: !k.isBlocked });
      toast.success(k.isBlocked ? "Kitchen unblocked" : "Kitchen blocked — no new subscriptions");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the kitchen");
    }
  };

  const columns: ColumnDef<Kitchen>[] = [
    {
      id: "name",
      header: "Kitchen",
      accessorFn: (k) => k.name || k.kitchenName || k.id,
      cell: ({ row }) => (
        <div className="min-w-0">
          <button className="font-medium truncate hover:underline text-left" onClick={() => setOpenId(row.original.id)}>
            {row.original.name || row.original.kitchenName || row.original.id}
          </button>
          <div className="text-[11px] text-muted-foreground truncate">
            {row.original.area || row.original.locality || row.original.city || "—"}
            {row.original.vegOnly ? " · Pure veg" : ""}
          </div>
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: ({ row }) => {
        const s = row.original.onboarding?.state ?? "unknown";
        return (
          <div className="flex flex-wrap gap-1">
            <Badge variant={s === "active" ? "default" : "outline"}>{s}</Badge>
            {row.original.isBlocked && <Badge variant="destructive">blocked</Badge>}
            {row.original.messSettings?.acceptingSubscribers === false && <Badge variant="outline">not accepting</Badge>}
            {(row.original.holidays ?? []).some((d) => d >= new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)) && (
              <Badge variant="outline">closure planned</Badge>
            )}
          </div>
        );
      },
    },
    {
      id: "rating",
      header: "Rating",
      cell: ({ row }) => {
        const k = row.original as Kitchen & { ratingAvg?: number; ratingCount?: number };
        return k.ratingCount ? (
          <span className={`tabular-nums ${(k.ratingAvg ?? 0) < 3.5 ? "text-rose-600" : ""}`}>
            {(k.ratingAvg ?? 0).toFixed(1)} ★ <span className="text-[11px] text-muted-foreground">({k.ratingCount})</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">new</span>
        );
      },
    },
    {
      id: "subs",
      header: "Active plans",
      cell: ({ row }) => <span className="tabular-nums">{activeByKitchen.get(row.original.id) ?? 0}</span>,
    },
    {
      id: "fee",
      header: "Kada fee / customer / day",
      cell: ({ row }) => {
        const p = row.original.feePerCustomerPerDayPaise;
        // An unset fee is no longer "Kada earns nothing" — subscriptions taken
        // from a kitchen without one snapshot the ₹3 default.
        return p == null ? (
          <span className="tabular-nums text-muted-foreground">
            {inr(3)} <span className="text-[11px]">(default)</span>
          </span>
        ) : (
          <span className="tabular-nums">{inr(p / 100)}</span>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex gap-1 justify-end">
          <Button size="sm" variant="outline" onClick={() => setPhotosFor(row.original)}>
            <ImageIcon className="w-3.5 h-3.5 mr-1" />
            Photos
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCloseFor(row.original)}>
            <CalendarX2 className="w-3.5 h-3.5 mr-1" />
            Closures
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/admin/mess?tab=plans&kitchenId=${row.original.id}`}>
              <Layers className="w-3.5 h-3.5 mr-1" />
              Plans
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setFeeFor(row.original);
              setFeeRupees(((row.original.feePerCustomerPerDayPaise ?? 300) / 100).toString());
            }}
          >
            <IndianRupee className="w-3.5 h-3.5 mr-1" />
            Fee
          </Button>
          <Button size="sm" variant={row.original.isBlocked ? "outline" : "ghost"} onClick={() => toggleBlock(row.original)}>
            {row.original.isBlocked ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Ban className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Mess kitchens"
        description="Home kitchens selling monthly meal plans. Kada earns a per-customer-per-day fee, deducted at settlement — never added to what the customer pays."
        icon={ChefHat}
        stats={[
          { label: "Kitchens", value: rows.length, icon: Utensils },
          { label: "Live", value: live.length, hint: "Taking subscriptions", tone: "text-emerald-600" },
          { label: "Blocked", value: blocked.length, tone: "text-rose-600" },
          { label: "Kada fee / day", value: inr(dailyRevenue), hint: "Active plans × each kitchen's fee", tone: "text-emerald-600" },
        ]}
      />
      <DataTable
        columns={columns}
        data={rows}
        searchKey="name"
        searchPlaceholder="Search kitchens…"
        exportFilename="mess-kitchens"
      />

      <MessKitchenSheet
        kitchen={(kitchens.rows.find((k) => k.id === openId) as unknown as MessKitchen) ?? null}
        onClose={() => setOpenId(null)}
      />

      <Dialog open={!!closeFor} onOpenChange={(o) => !o && setCloseFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Closures — {closeFor?.name || closeFor?.kitchenName}</DialogTitle>
            <DialogDescription>
              Closing a day adds it to the end of every affected subscriber&apos;s plan and notifies them. Settlement neither pays the
              kitchen nor charges Kada&apos;s fee for it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {(kitchens.rows.find((k) => k.id === closeFor?.id)?.holidays ?? [])
                .filter((d) => d >= new Date(Date.now() + 19_800_000).toISOString().slice(0, 10))
                .sort()
                .map((d) => (
                  <Button key={d} size="sm" variant="outline" disabled={closing} onClick={() => submitClosure(true, d)} title="Reopen">
                    {d} ✕
                  </Button>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Day</Label>
                <Input type="date" value={closeDay} onChange={(e) => setCloseDay(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Reason</Label>
                <Input value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Onam, gas shortage…" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" disabled={!closeDay || closing} onClick={() => submitClosure(false)}>
              {closing ? "Saving…" : "Close kitchen that day"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!photosFor} onOpenChange={(o) => !o && setPhotosFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Photos — {photosFor?.name || photosFor?.kitchenName}</DialogTitle>
            <DialogDescription>Logo and cover photo customers see on Kada Mess.</DialogDescription>
          </DialogHeader>
          {photosFor && (
            <KitchenPhotos
              asAdmin
              kitchenId={photosFor.id}
              logoUrl={photosFor.logoUrl}
              coverImage={photosFor.coverImage}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!feeFor} onOpenChange={(o) => !o && setFeeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kada fee — {feeFor?.name || feeFor?.kitchenName}</DialogTitle>
            <DialogDescription>
              Charged per subscriber per day served, taken out of the kitchen&apos;s settlement.
              Existing subscriptions keep the fee they were sold at.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="mess-fee">Rupees per customer per day</Label>
            <Input
              id="mess-fee"
              type="number"
              step="0.5"
              min="0"
              max="100"
              value={feeRupees}
              onChange={(e) => setFeeRupees(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeeFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveFee} disabled={saving}>
              {saving ? "Saving…" : "Save fee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
