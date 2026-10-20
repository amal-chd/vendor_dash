import { PageSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { promptDialog } from "@/components/admin/core/asyncDialogs";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  where,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { toast } from "sonner";
import { adminActionToast } from "@/lib/admin-ops";
import {
  Loader2,
  Users,
  Smartphone,
  MapPin,
  Wallet,
  Crown,
  Pencil,
  Ban,
  CheckCircle2,
} from "lucide-react";
import { DataTable, type BulkAction } from "@/components/admin/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards, type StatItem } from "@/components/admin/StatCards";
import { EntityDrawer } from "@/components/admin/core/EntityDrawer";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";

interface Consumer {
  id: string;
  name?: string;
  /** Locality captured at signup, and the zone the server resolved from it. */
  primaryArea?: string;
  primaryZoneName?: string;
  nearestZoneName?: string;
  /** Distance to that nearest zone (km), stamped by onCustomerProfileLocationChanged. */
  nearestZoneKm?: number | null;
  primaryPincode?: string;
  email?: string;
  phone?: string;
  photoUrl?: string;
  fcmTokens?: string[];
  walletBalance?: number;
  addresses?: any[];
  goldUntil?: any;
  createdAt?: any;
  accountStatus?: string;
  isBanned?: boolean;
  isDeleted?: boolean;
}

interface ConsumerOrder {
  id: string;
  orderNumber?: string;
  restaurantName?: string;
  status?: string;
  total?: number;
  timestamp?: any;
}

const asDate = (v: any) => {
  if (!v) return null;
  try {
    return v.toDate ? v.toDate() : new Date(v);
  } catch {
    return null;
  }
};

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

const isGoldMember = (c: { goldUntil?: any }) => {
  const until = asDate(c.goldUntil);
  return !!until && until.getTime() > Date.now();
};

/**
 * What to call a customer. Phone sign-ups often never enter a name — those
 * used to read "GUEST", which looks like an anonymous checkout rather than a
 * real account. Deleted accounts are labelled as such.
 */
const displayName = (c: Consumer) =>
  c.isDeleted ? "Deleted account" : (c.name || "").trim() || "No name yet";

/**
 * Profile photo with a fallback. Google profile URLs refuse requests that carry
 * a referrer from another site and expire when the user changes their photo,
 * which left a broken-image icon in the table.
 */
function ConsumerAvatar({ c, rounded = "rounded-2xl" }: { c: Consumer; rounded?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`h-10 w-10 ${rounded} overflow-hidden bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0`}>
      {c.photoUrl && !failed && !c.isDeleted ? (
        <img
          src={c.photoUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Users className="h-5 w-5 text-primary" />
      )}
    </div>
  );
}

/** "Outside zones · near X" only when X is actually near. */
const outsideZoneLabel = (c: Consumer): string | null => {
  if (!c.nearestZoneName) return null;
  const km = typeof c.nearestZoneKm === "number" ? c.nearestZoneKm : null;
  if (km === null) return "Outside service area";
  if (km > 50) return `Outside service area · ${km.toLocaleString("en-IN")} km from ${c.nearestZoneName}`;
  return `Outside zones · ${km} km from ${c.nearestZoneName}`;
};

export default function ConsumersPage() {
  const [rows, setRows] = useState<Consumer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Consumer | null>(null);
  const [orders, setOrders] = useState<ConsumerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Dialog States
  const [adjustWalletData, setAdjustWalletData] = useState<{ consumer: Consumer; amount: number } | null>(null);
  const [statusConfirmData, setStatusConfirmData] = useState<{ consumer: Consumer; nextStatus: string } | null>(null);
  const [bulkStatusData, setBulkStatusData] = useState<{ consumers: Consumer[]; nextStatus: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    return listenCollection<Consumer>(
      "customer_users",
      { orderByField: "createdAt", limit: 500 },
      (next) => {
        setRows(next);
        setLoading(false);
      },
      () => {
        toast.error("Failed to load customers");
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    if (!selected) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    setOrdersLoading(true);
    (async () => {
      try {
        let snap;
        try {
          snap = await getDocs(
            query(collection(db, "orders"), where("customerUid", "==", selected.id), orderBy("timestamp", "desc"), limit(50)),
          );
        } catch {
          snap = await getDocs(query(collection(db, "orders"), where("customerUid", "==", selected.id), limit(50)));
        }
        if (cancelled) return;
        setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ConsumerOrder[]);
      } catch (e) {
        console.error("Consumer orders load failed:", e);
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Where a customer is. Signup captures this now; older accounts fall back to
  // the first saved address so the directory isn't half empty.
  const areaOf = (c: Consumer): string => {
    const direct = (c.primaryArea || "").trim();
    if (direct) return direct;
    const addr = (c.addresses || []).find((a: any) => (a?.area || "").trim());
    return addr ? String(addr.area).trim() : "";
  };

  const [areaFilter, setAreaFilter] = useState<string>("all");

  const areas = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((c) => {
      const a = areaOf(c);
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (areaFilter === "all") return rows;
    if (areaFilter === "__none") return rows.filter((c) => !areaOf(c));
    return rows.filter((c) => areaOf(c) === areaFilter);
  }, [rows, areaFilter]);

  const totalSpent = useMemo(
    () => orders.reduce((s, o) => s + (Number(o.total) || 0), 0),
    [orders]
  );

  const stats = useMemo(
    () => ({
      total: rows.length,
      gold: rows.filter(isGoldMember).length,
      wallet: rows.reduce((s, c) => s + (Number(c.walletBalance) || 0), 0),
      withAddress: rows.filter((c) => (c.addresses || []).length > 0).length,
    }),
    [rows]
  );

  const kpis: StatItem[] = [
    {
      title: "Total customers",
      value: stats.total.toLocaleString("en-IN"),
      icon: Users,
    },
    {
      title: "Gold members",
      value: stats.gold.toLocaleString("en-IN"),
      tone: "text-amber-600",
      icon: Crown,
    },
    {
      title: "Wallet balance",
      value: inr(stats.wallet),
      tone: "text-sky-600",
      icon: Wallet,
    },
    {
      title: "With saved address",
      value: stats.withAddress.toLocaleString("en-IN"),
      tone: "text-emerald-600",
      icon: Smartphone,
    }
  ];

  const handleAdjustWalletPrompt = async (c: Consumer) => {
    const raw = await promptDialog({
      title: `Adjust ${c.name || "this customer"}'s wallet`,
      description: "Use a negative amount to deduct. You'll give a reason on the next step.",
      label: "Amount (₹)",
      inputMode: "decimal",
      placeholder: "e.g. 150 or -50",
      required: true,
      validate: (v) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? null : "Enter a non-zero amount."),
      confirmLabel: "Next",
    });
    if (raw == null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error("Enter a non-zero amount.");
      return;
    }
    setAdjustWalletData({ consumer: c, amount });
  };

  const confirmAdjustWallet = async (reason?: string) => {
    if (!adjustWalletData || !reason) return;
    setActionLoading(true);
    try {
      await adminActionToast(
        "adjustWallet",
        { uid: adjustWalletData.consumer.id, amount: adjustWalletData.amount, reason },
        `Wallet ${adjustWalletData.amount > 0 ? "credited" : "debited"} by ${inr(Math.abs(adjustWalletData.amount))}`,
      );
      setSelected((prev) =>
        prev && prev.id === adjustWalletData.consumer.id
          ? { ...prev, walletBalance: (Number(prev.walletBalance) || 0) + adjustWalletData.amount }
          : prev
      );
    } finally {
      setActionLoading(false);
      setAdjustWalletData(null);
    }
  };

  const confirmStatusChange = async (reason?: string) => {
    if (!statusConfirmData) return;
    setActionLoading(true);
    try {
      await adminActionToast(
        "setCustomerStatus",
        { uid: statusConfirmData.consumer.id, status: statusConfirmData.nextStatus, reason: reason || "Policy violation" },
        statusConfirmData.nextStatus === "banned" ? "Customer banned" : "Customer reinstated",
      );
      setSelected((prev) =>
        prev && prev.id === statusConfirmData.consumer.id
          ? { ...prev, isBanned: statusConfirmData.nextStatus === "banned", accountStatus: statusConfirmData.nextStatus }
          : prev
      );
    } finally {
      setActionLoading(false);
      setStatusConfirmData(null);
    }
  };

  const confirmBulkStatusChange = async (reason?: string) => {
    if (!bulkStatusData) return;
    setActionLoading(true);
    try {
      let successCount = 0;
      for (const consumer of bulkStatusData.consumers) {
        try {
          await adminActionToast(
            "setCustomerStatus",
            { uid: consumer.id, status: bulkStatusData.nextStatus, reason: reason || "Bulk action" },
            "",
          );
          successCount++;
        } catch (e) {
          console.error(`Failed to update status for ${consumer.id}`, e);
        }
      }
      toast.success(`Successfully updated ${successCount} customers to ${bulkStatusData.nextStatus}`);
    } finally {
      setActionLoading(false);
      setBulkStatusData(null);
    }
  };

  const bulkActions: BulkAction<Consumer>[] = [
    {
      label: "Bulk Ban",
      icon: Ban,
      destructive: true,
      onSelected: (selected: Consumer[]) => {
        setBulkStatusData({ consumers: selected, nextStatus: "banned" });
      }
    },
    {
      label: "Bulk Activate",
      icon: CheckCircle2,
      onSelected: (selected: Consumer[]) => {
        setBulkStatusData({ consumers: selected, nextStatus: "active" });
      }
    }
  ];

  const columns: ColumnDef<Consumer>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Customer",
        cell: ({ row }) => {
          const c = row.original;
          const joined = asDate(c.createdAt);
          return (
            <div className="flex gap-4 items-center">
              <ConsumerAvatar c={c} />
              <div>
                <p className="font-semibold text-foreground uppercase tracking-tight text-sm">
                  <Link
                    to={`/admin/customers/${c.id}`}
                    className={`hover:text-primary transition-colors ${c.isDeleted || !(c.name || "").trim() ? "text-muted-foreground" : ""}`}
                  >
                    {displayName(c)}
                  </Link>
                </p>
                {joined && (
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mt-0.5">
                    Joined {joined.toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "email",
        header: "Contact",
        cell: ({ row }) => {
          const c = row.original;
          if (c.isDeleted) {
            return <span className="text-[10px] text-muted-foreground font-bold">Removed on deletion</span>;
          }
          // Phone-only accounts lead with the phone instead of a lone "—".
          const primary = c.email || c.phone || "—";
          const secondary = c.email ? c.phone : "";
          return (
            <div className="text-xs">
              <p className="font-bold">{primary}</p>
              {secondary && <p className="text-[10px] text-muted-foreground font-bold">{secondary}</p>}
            </div>
          );
        },
      },
      {
        id: "location",
        header: "Location",
        cell: ({ row }) => {
          const c = row.original;
          const area = c.isDeleted ? "" : areaOf(c);
          const zone = c.isDeleted ? "" : (c.primaryZoneName || "").trim();
          if (!area && !zone) {
            return <span className="text-[10px] text-muted-foreground font-bold">—</span>;
          }
          return (
            <div className="text-xs">
              <p className="font-bold flex items-center gap-1">
                <MapPin className="h-3 w-3 text-muted-foreground" />
                {area || zone}
              </p>
              {zone ? (
                <p className="text-[10px] text-muted-foreground font-bold">{zone}</p>
              ) : outsideZoneLabel(c) ? (
                <p className="text-[10px] text-amber-600 font-bold">{outsideZoneLabel(c)}</p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "walletBalance",
        header: "Wallet",
        cell: ({ row }) => (
          <span className="flex items-center gap-1 text-xs font-black">
            <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
            {inr(row.original.walletBalance || 0)}
          </span>
        ),
      },
      {
        id: "membership",
        header: "Membership",
        cell: ({ row }) =>
          isGoldMember(row.original) ? (
            <Badge className="text-[9px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-600 border border-amber-500/30 rounded-lg">
              Gold
            </Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground font-bold">—</span>
          ),
      },
      {
        accessorKey: "fcmTokens",
        header: "Devices",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 text-xs font-black">
            <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
            {(row.original.fcmTokens || []).length}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const isBanned = row.original.isBanned || row.original.accountStatus === "banned";
          if (row.original.isDeleted) {
            return (
              <Badge variant="outline" className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground rounded-lg">
                Deleted
              </Badge>
            );
          }
          return isBanned ? (
            <Badge variant="destructive" className="text-[9px] font-semibold uppercase tracking-wide rounded-lg">
              Banned
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[9px] font-semibold uppercase tracking-wide text-emerald-600 border-emerald-500/30 bg-emerald-500/10 rounded-lg">
              Active
            </Badge>
          );
        }
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            className="font-semibold uppercase tracking-wide text-[10px]"
            onClick={() => setSelected(row.original)}
          >
            View
          </Button>
        ),
      },
    ],
    []
  );

  const renderMobileCard = (c: Consumer) => {
    const joined = asDate(c.createdAt);
    const isBanned = c.isBanned || c.accountStatus === "banned";
    return (
      <button
        onClick={() => setSelected(c)}
        className="w-full text-left bg-card rounded-xl border border-border/60 p-4 shadow-sm flex items-center gap-3"
      >
        <ConsumerAvatar c={c} rounded="rounded-xl" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
             <p className="font-bold text-sm uppercase tracking-tight truncate">{displayName(c)}</p>
             {isBanned && <Ban className="h-3 w-3 text-destructive" />}
          </div>
          <p className="text-[10px] text-muted-foreground truncate">{c.isDeleted ? "" : c.email || c.phone || ""}</p>
          {joined && (
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Joined {joined.toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {isGoldMember(c) && (
            <Badge className="text-[8px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-amber-500/15 text-amber-600 border border-amber-500/30">
              Gold
            </Badge>
          )}
          <Badge variant="outline" className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5">
            {inr(c.walletBalance || 0)}
          </Badge>
        </div>
      </button>
    );
  };

  if (loading) {
    return (
      <PageSkeleton />
    );
  }

  const selectedIsBanned = selected?.isBanned || selected?.accountStatus === "banned";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="App Customers"
        description={`${rows.length} Consumers`}
        icon={Users}
      />

      <StatCards items={kpis} />

      <Card className="rounded-2xl border-border/40 shadow-card overflow-hidden">
        <CardHeader className="bg-muted/30 border-b border-border/40 pb-6">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Users className="h-4 w-4" /> Customer Directory
          </CardTitle>
          {/* Group the directory by locality — the team works area by area. */}
          {areas.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-4">
              {[["all", rows.length] as [string, number], ...areas].map(([a, n]) => (
                <button
                  key={a}
                  onClick={() => setAreaFilter(a)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide border transition-colors ${
                    areaFilter === a
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border/60 hover:border-primary/40"
                  }`}
                >
                  {a === "all" ? "All areas" : a} · {n}
                </button>
              ))}
              {rows.some((c) => !areaOf(c)) && (
                <button
                  onClick={() => setAreaFilter("__none")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide border transition-colors ${
                    areaFilter === "__none"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border/60 hover:border-primary/40"
                  }`}
                >
                  No location · {rows.filter((c) => !areaOf(c)).length}
                </button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-16 text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">
              No customers yet
            </div>
          ) : (
            <DataTable 
              columns={columns} 
              data={visibleRows} 
              searchKey="name" 
              renderMobileCard={renderMobileCard} 
              exportFilename="customers" 
              savedViewsKey="customers" 
              bulkActions={bulkActions}
              getRowId={(row) => row.id}
            />
          )}
        </CardContent>
      </Card>

      <EntityDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        icon={Users}
        title={selected ? displayName(selected) : ""}
        subtitle={`${selected?.email || "—"} · ${selected?.phone || "no phone"}`}
        status={selected?.isDeleted ? "Deleted" : selectedIsBanned ? "Banned" : "Active"}
        statusTone={selectedIsBanned ? "destructive" : "success"}
        detailPath={selected ? `/admin/customers/${selected.id}` : undefined}
        metrics={[
          { label: "Wallet", value: inr(selected?.walletBalance || 0) },
          { label: "Orders", value: ordersLoading ? "…" : orders.length },
          { label: "Spent", value: ordersLoading ? "…" : inr(totalSpent) },
        ]}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] font-semibold uppercase tracking-wide"
              onClick={() => selected && handleAdjustWalletPrompt(selected)}
            >
              <Pencil className="h-3 w-3 mr-1" /> Adjust Wallet
            </Button>
            <Button
              variant={selectedIsBanned ? "default" : "destructive"}
              size="sm"
              className="text-[10px] font-semibold uppercase tracking-wide"
              onClick={() => selected && setStatusConfirmData({ consumer: selected, nextStatus: selectedIsBanned ? "active" : "banned" })}
            >
              {selectedIsBanned ? (
                <><CheckCircle2 className="h-3 w-3 mr-1" /> Unban</>
              ) : (
                <><Ban className="h-3 w-3 mr-1" /> Ban</>
              )}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {selected && isGoldMember(selected) && (
              <Badge className="text-[9px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-600 border border-amber-500/30 rounded-lg flex items-center gap-1">
                <Crown className="h-3 w-3" /> Gold ·{" "}
                {asDate(selected.goldUntil)?.toLocaleDateString()}
              </Badge>
            )}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Recent orders
            </p>
            <div className="space-y-2 pr-1">
              {ordersLoading ? (
                <div className="flex justify-center p-6">
                  <Loader2 className="h-5 w-5 animate-spin text-primary opacity-50" />
                </div>
              ) : orders.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center p-6 font-bold uppercase tracking-widest">
                  No orders yet
                </p>
              ) : (
                orders.map((o) => {
                  const d = asDate(o.timestamp);
                  return (
                    <div
                      key={o.id}
                      className="flex items-center justify-between rounded-xl border border-border/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">
                          {o.restaurantName || "Order"}{" "}
                          <span className="text-muted-foreground">#{o.orderNumber || o.id.slice(0, 5)}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {d ? d.toLocaleDateString() : ""} · {o.status || "—"}
                        </p>
                      </div>
                      <span className="text-xs font-black shrink-0">{inr(o.total || 0)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </EntityDrawer>

      <ConfirmationDialog
        open={!!adjustWalletData}
        onOpenChange={(open) => !open && setAdjustWalletData(null)}
        title="Adjust Wallet Balance"
        description={`Are you sure you want to ${adjustWalletData?.amount && adjustWalletData.amount > 0 ? "credit" : "debit"} ₹${Math.abs(adjustWalletData?.amount || 0)} for ${adjustWalletData?.consumer?.name || "this customer"}?`}
        requireReason={true}
        loading={actionLoading}
        onConfirm={confirmAdjustWallet}
      />

      <ConfirmationDialog
        open={!!statusConfirmData}
        onOpenChange={(open) => !open && setStatusConfirmData(null)}
        title={statusConfirmData?.nextStatus === "banned" ? "Ban Customer" : "Unban Customer"}
        description={`Are you sure you want to ${statusConfirmData?.nextStatus === "banned" ? "ban" : "unban"} ${statusConfirmData?.consumer?.name || "this customer"}?`}
        requireReason={statusConfirmData?.nextStatus === "banned"}
        variant={statusConfirmData?.nextStatus === "banned" ? "destructive" : "default"}
        loading={actionLoading}
        onConfirm={confirmStatusChange}
      />

      <ConfirmationDialog
        open={!!bulkStatusData}
        onOpenChange={(open) => !open && setBulkStatusData(null)}
        title={bulkStatusData?.nextStatus === "banned" ? `Ban ${bulkStatusData?.consumers.length} Customers` : `Unban ${bulkStatusData?.consumers.length} Customers`}
        description={`Are you sure you want to ${bulkStatusData?.nextStatus === "banned" ? "ban" : "unban"} the selected ${bulkStatusData?.consumers.length} customers?`}
        requireReason={bulkStatusData?.nextStatus === "banned"}
        variant={bulkStatusData?.nextStatus === "banned" ? "destructive" : "default"}
        loading={actionLoading}
        onConfirm={confirmBulkStatusChange}
      />
    </div>
  );
}
