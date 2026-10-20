import { PageSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { confirmDialog, promptDialog } from "@/components/admin/core/asyncDialogs";
import { useEffect, useState, useMemo } from "react";
import {
  collection,
  doc,
  updateDoc,
  Timestamp,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { listenCollection, useLiveCollection } from "@/hooks/useLiveCollection";
import { useAdminScope } from "@/hooks/useAdminScope";
import { ZoneBadge } from "@/components/admin/zones/ZoneScopeBar";
import { toast } from "sonner";
import { adminActionToast } from "@/lib/admin-ops";
import { EntityDrawer } from "@/components/admin/core/EntityDrawer";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import {
  Loader2,
  ShoppingBag,
  Radio,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Bike,
  Utensils,
  Store,
  Clock,
  MapPin,
  Phone,
  User,
  MoreVertical,
  Printer,
  Copy,
  RefreshCw,
  SlidersHorizontal,
  DollarSign,
  ArrowUpRight,
  ShieldAlert,
  Calendar,
  FileText,
  QrCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/admin/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchParams, Link } from "react-router-dom";
import { writeAudit } from "@/lib/audit";
import { transitionOrder, cancelTargetFor } from "@/lib/orderActions";
import { isWalkInOrder } from "@/lib/orderChannels";

// ─── Interfaces & Helpers ──────────────────────────────────────────────────

interface OrderItem {
  name: string;
  qty: number;
  price: number;
  instructions?: string;
  variants?: any;
  notes?: string;
}

interface PlatformOrder {
  id: string;
  /** Parent brand for outlet orders — used to find the vendor when restaurantId is an outlet. */
  parentId?: string;
  /** Zone stamped at creation, from the delivery point. Frozen — a boundary
   *  redrawn later never rewrites a past order's area. */
  zoneId?: string | null;
  zoneName?: string | null;
  marketId?: string | null;
  orderNumber?: string;
  orderSource?: string;
  source?: string;
  channel?: string;
  restaurantId?: string;
  restaurantName?: string;
  customerName?: string;
  customerPhone?: string;
  customerUid?: string;
  userId?: string;
  customerId?: string;
  deliveryAddressText?: string;
  deliveryAddress?: {
    line1?: string;
    area?: string;
    landmark?: string;
    pincode?: string;
  };
  table?: string;
  tableLabel?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  discount?: number;
  deliveryFee?: number;
  status?: string;
  type?: "dine-in" | "takeaway" | "delivery" | string;
  orderType?: string;
  paymentStatus?: "pending" | "paid" | string;
  paymentMethod?: string;
  timestamp?: any;
  items?: OrderItem[];
  instructions?: string;
  riderId?: string;
  riderName?: string;
  riderPhone?: string;
  deliveryStatus?: string;
  cancelledBy?: string;
  cancelReason?: string;
  cancelledAt?: any;
}

export type OrderCategory = "the_kada" | "qr_order" | "walk_in" | "pickup";

export function getOrderCategory(o?: PlatformOrder | null): OrderCategory {
  if (!o) return "the_kada";

  const src = (o.orderSource || o.source || "").toString().toLowerCase().trim();
  const type = (o.type || o.orderType || o.channel || "").toString().toLowerCase().trim();
  const num = (o.orderNumber || "").toString().toUpperCase().trim();
  const table = (o.table || "").toString().toLowerCase().trim();
  const tableLabel = (o.tableLabel || "").toString().toLowerCase().trim();

  // 1. QR Order: scanned QR code at dine-in table
  if (
    src === "qr_menu" ||
    src === "qr" ||
    num.startsWith("QR-") ||
    table.includes("qr") ||
    tableLabel.includes("qr")
  ) {
    return "qr_order";
  }

  // 2. Pickup / Takeaway
  if (
    type === "takeaway" ||
    type === "pickup" ||
    src === "takeaway" ||
    src === "pickup" ||
    num.startsWith("TAK-") ||
    table === "takeaway" ||
    table === "pickup"
  ) {
    return "pickup";
  }

  // 3. Walk In: POS dine-in or direct counter ticket
  if (
    src === "pos" ||
    (isWalkInOrder(o) && type !== "delivery" && src !== "delivery_app" && src !== "web_app" && src !== "web_delivery")
  ) {
    return "walk_in";
  }

  // 4. The Kada: Platform online marketplace / delivery orders
  return "the_kada";
}

export const ORDER_CATEGORIES = [
  { id: "the_kada", label: "The Kada", icon: Store, badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  { id: "qr_order", label: "QR Order", icon: QrCode, badgeClass: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  { id: "walk_in", label: "Walk In", icon: Utensils, badgeClass: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  { id: "pickup", label: "Pickup", icon: ShoppingBag, badgeClass: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  { id: "all", label: "All", icon: Filter, badgeClass: "bg-muted text-muted-foreground border-border/40" },
] as const;

export const ORDER_CATEGORY_META: Record<OrderCategory, { label: string; icon: any; badgeClass: string }> = {
  the_kada: { label: "The Kada", icon: Store, badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  qr_order: { label: "QR Order", icon: QrCode, badgeClass: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  walk_in: { label: "Walk In", icon: Utensils, badgeClass: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  pickup: { label: "Pickup", icon: ShoppingBag, badgeClass: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
};

const inr = (n?: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

const normalizeStatus = (status?: string): string => {
  const value = (status || "").toLowerCase();
  switch (value) {
    case "preparing":
    case "cooking":
    case "in_progress":
    case "inprogress":
    case "accepted":
      return "preparing";
    case "ready":
    case "prepared":
      return "ready";
    case "completed":
    case "delivered":
    case "done":
      return "completed";
    case "cancelled":
    case "canceled":
    case "void":
      return "cancelled";
    case "new":
    case "placed":
    case "pending":
    case "created":
      return "new";
    default:
      return "new";
  }
};

const statusLabelMap: Record<string, string> = {
  new: "New / Placed",
  preparing: "Preparing",
  ready: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

const statusBadgeClasses: Record<string, string> = {
  new: "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 animate-pulse",
  preparing: "bg-blue-500/15 border-blue-500/30 text-blue-600",
  ready: "bg-amber-500/15 border-amber-500/30 text-amber-600 font-black",
  completed: "bg-emerald-600/15 border-emerald-600/30 text-emerald-700",
  cancelled: "bg-rose-500/15 border-rose-500/30 text-rose-600",
};

const LIVE_STATUSES = new Set(["new", "preparing", "ready"]);

// ─── Main Component ────────────────────────────────────────────────────────

export default function PlatformOrdersPage() {
  const { can } = usePermissions();
  const [orders, setOrders] = useState<PlatformOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  // `?status=cancelled` etc. lets the dashboard's order cards land on the slice.
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const st = searchParams.get("status");
    return st && ["live", "completed", "cancelled", "refunded"].includes(st) ? st : "all";
  });
  // Category pill filter: The Kada (default), QR Order, Walk In, Pickup, All
  const [categoryFilter, setCategoryFilter] = useState<string>(() => {
    const cat = searchParams.get("category") || searchParams.get("channel");
    return cat && ["the_kada", "qr_order", "walk_in", "pickup", "all"].includes(cat) ? cat : "the_kada";
  });
  const [selectedOrder, setSelectedOrder] = useState<PlatformOrder | null>(null);
  const [drawerOrder, setDrawerOrder] = useState<PlatformOrder | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    return listenCollection<PlatformOrder>(
      "orders",
      { orderByField: "timestamp", limit: 400 },
      (list) => {
        setOrders(list);
        setLoading(false);
        const searchVal = searchParams.get("search");
        if (searchVal && !selectedOrder) {
          const match = list.find(
            (o) =>
              o.id === searchVal ||
              o.orderNumber?.toLowerCase() === searchVal.toLowerCase() ||
              `#${o.orderNumber}`.toLowerCase() === searchVal.toLowerCase()
          );
          if (match) setSelectedOrder(match);
        }
      },
      () => {
        toast.error("Failed to load platform orders");
        setLoading(false);
      },
    );
  }, [searchParams]);

  const { matches: inScope, isAll: allAreas, zones = [] } = useAdminScope();
  const { rows: restaurants = [] } = useLiveCollection<any>("restaurants", { limit: 1000 });

  const zoneMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const z of zones) {
      if (z.id) map.set(z.id, z);
    }
    return map;
  }, [zones]);

  const restaurantMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of restaurants) {
      if (r.id) map.set(r.id, r);
      if (r.ownerId) map.set(r.ownerId, r);
      if (r.ownerUid) map.set(r.ownerUid, r);
      if (r.uid) map.set(r.uid, r);
      if (r.vendorId) map.set(r.vendorId, r);
    }
    return map;
  }, [restaurants]);

  const enrichedOrders = useMemo(() => {
    return orders.map((o) => {
      const r =
        (o.restaurantId ? restaurantMap.get(o.restaurantId) : undefined) ||
        (o.parentId ? restaurantMap.get(o.parentId) : undefined);
      const restaurantName =
        o.restaurantName &&
        o.restaurantName.trim() &&
        o.restaurantName !== "Partner Restaurant" &&
        o.restaurantName !== "Restaurant"
          ? o.restaurantName
          : r?.name || r?.restaurantName || r?.displayName || o.restaurantName || "Partner Restaurant";
      const zoneId = o.zoneId || r?.zoneId || null;
      const zoneName =
        o.zoneName ||
        r?.zoneName ||
        (zoneId ? zoneMap.get(zoneId)?.name : null) ||
        null;
      const marketId =
        o.marketId ||
        r?.marketId ||
        (zoneId ? zoneMap.get(zoneId)?.marketId : null) ||
        null;
      return {
        ...o,
        restaurantName,
        zoneId,
        zoneName,
        marketId,
      };
    });
  }, [orders, restaurantMap, zoneMap]);

  // Console-wide city/zone scope. The KPI strip reads the same scoped list, so
  // a zone-filtered view never shows platform-wide GMV next to zone orders.
  const scopedOrders = useMemo(
    () => (allAreas ? enrichedOrders : enrichedOrders.filter(inScope)),
    [enrichedOrders, inScope, allAreas],
  );

  // Counts across categories for real-time pill badges
  const categoryCounts = useMemo(() => {
    let theKada = 0;
    let qrOrder = 0;
    let walkIn = 0;
    let pickup = 0;

    for (const o of scopedOrders) {
      const cat = getOrderCategory(o);
      if (cat === "the_kada") theKada++;
      else if (cat === "qr_order") qrOrder++;
      else if (cat === "walk_in") walkIn++;
      else if (cat === "pickup") pickup++;
    }

    return {
      all: scopedOrders.length,
      the_kada: theKada,
      qr_order: qrOrder,
      walk_in: walkIn,
      pickup: pickup,
    };
  }, [scopedOrders]);

  const filteredOrders = useMemo(() => {
    return scopedOrders.filter((o) => {
      // 1. Category pill filter: The Kada, QR Order, Walk In, Pickup, or All
      if (categoryFilter !== "all") {
        const cat = getOrderCategory(o);
        if (cat !== categoryFilter) return false;
      }

      // 2. Status filter
      const norm = normalizeStatus(o.status);
      if (statusFilter === "live" && !LIVE_STATUSES.has(norm) && o.deliveryStatus !== "on_the_way") {
        return false;
      }
      if (statusFilter === "refunded") {
        if (o.paymentStatus !== "refunded" && !o.cancelReason?.toLowerCase().includes("refund")) return false;
      } else if (statusFilter !== "all" && statusFilter !== "live" && norm !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [scopedOrders, categoryFilter, statusFilter]);

  // Summary KPIs across loaded orders
  const stats = useMemo(() => {
    let live = 0;
    let liveDelivery = 0;
    let completed = 0;
    let cancelled = 0;
    let refunded = 0;
    let orderValue = 0;

    for (const o of scopedOrders) {
      const norm = normalizeStatus(o.status);
      const isLive = LIVE_STATUSES.has(norm) || o.deliveryStatus === "on_the_way" || o.deliveryStatus === "picked_up";
      if (isLive) {
        live++;
        if ((o.type || "").toLowerCase() === "delivery") liveDelivery++;
      }
      if (norm === "completed") completed++;
      if (norm === "cancelled") cancelled++;
      else orderValue += Number(o.total || 0);
      // Same rule as the Refunded filter tab below.
      if (o.paymentStatus === "refunded" || o.cancelReason?.toLowerCase().includes("refund")) refunded++;
    }

    return { total: scopedOrders.length, live, liveDelivery, completed, cancelled, refunded, orderValue };
  }, [scopedOrders]);

  // Bulk transitions, reported honestly. The old bulk actions used
  // Promise.all(...).then(() => toast.success(`${n} orders`)) — one rejection
  // failed the whole chain and reported "Failed to update some orders" with no
  // indication of which, while a resolved chain claimed every order moved even
  // if the server had refused some. Each order is now reported by outcome.
  const runBulkTransition = async (
    rows: PlatformOrder[],
    target: (row: PlatformOrder) => string,
    verb: string,
    reason?: string,
  ) => {
    const results = await Promise.all(
      rows.map(async (r) => ({
        row: r,
        res: await transitionOrder(r.id, target(r), reason ? { reason } : {}),
      })),
    );
    const applied = results.filter((x) => x.res.ok);
    const refused = results.filter((x) => !x.res.ok);
    if (applied.length) toast.success(`${applied.length} order(s) ${verb}.`);
    if (refused.length) {
      const sample = refused[0];
      toast.error(
        refused.length === 1
          ? `#${sample.row.orderNumber || sample.row.id.slice(-6)}: ${sample.res.message}`
          : `${refused.length} order(s) were not ${verb}. First: #${
              sample.row.orderNumber || sample.row.id.slice(-6)
            } — ${sample.res.message}`,
        { duration: 8000 },
      );
    }
  };

  // Admin status override. This used to write `status` straight onto the order
  // document, which accepted any value in any direction: completed → preparing,
  // reopening an order the customer had cancelled, or marking a delivery order
  // "completed" (while fabricating deliveryStatus:"arrived") so the rider's
  // completeDelivery could never run and the handoff was never verified.
  // It now goes through vendorTransitionOrder like every other status change —
  // which accepts a platform admin as an actor, validates the move, is
  // idempotent across devices, and attributes the event to the admin.
  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    setUpdating(true);
    const before = orders.find((o) => o.id === orderId)?.status;
    try {
      const result = await transitionOrder(orderId, newStatus);
      if (!result.ok) {
        // A refusal is the server telling us this move is illegal for this
        // order — show it instead of claiming the override worked.
        toast.error(result.message);
        return;
      }
      await writeAudit({
        action: "ORDER_STATUS_OVERRIDE",
        entity: "order",
        entityId: orderId,
        description: `Order #${selectedOrder?.orderNumber || orderId} status overridden to ${newStatus}`,
        before: { status: before },
        after: { status: newStatus },
      });
      toast.success(result.message);
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus });
      }
    } finally {
      setUpdating(false);
    }
  };

  // Handle Admin Cancellation & Refund
  const handleAdminCancel = async () => {
    if (!selectedOrder) return;
    if (!cancelReason.trim()) {
      toast.error("Please provide an administrative cancellation reason");
      return;
    }
    setUpdating(true);
    try {
      await adminActionToast(
        "refundOrder",
        {
          orderId: selectedOrder.id,
          reason: cancelReason.trim(),
          method: "wallet",
        },
        "Order cancelled and refunded to wallet",
      );
      setSelectedOrder({
        ...selectedOrder,
        status: "cancelled",
        cancelledBy: "platform_admin",
        cancelReason: cancelReason.trim(),
      });
      setCancelModalOpen(false);
      setCancelReason("");
    } catch (err) {
      console.error("Error cancelling order:", err);
      toast.error("Failed to cancel order");
    } finally {
      setUpdating(false);
    }
  };

  // Refund the order currently open in the inspection drawer (money action —
  // confirmed with amount + reason, server-verified + audited via refundOrder).
  const handleDrawerRefund = async (reason?: string) => {
    if (!drawerOrder) return;
    setUpdating(true);
    try {
      await adminActionToast(
        "refundOrder",
        { orderId: drawerOrder.id, amount: drawerOrder.total, reason, method: "wallet" },
        `Refunded ${inr(drawerOrder.total)} to ${drawerOrder.customerName || "the customer"}`,
      );
      setDrawerOrder(null);
    } finally {
      setUpdating(false);
    }
  };

  // Table columns definition
  const columns: ColumnDef<PlatformOrder>[] = useMemo(
    () => [
      {
        accessorKey: "orderNumber",
        header: "Order & Time",
        cell: ({ row }) => {
          const d = row.original;
          const num = d.orderNumber || d.id.slice(-6);
          const timeText = d.timestamp
            ? typeof d.timestamp.toDate === "function"
              ? d.timestamp.toDate().toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Just now"
            : "—";
          const cat = getOrderCategory(d);
          const catMeta = ORDER_CATEGORY_META[cat];
          const CatIcon = catMeta.icon;

          return (
            <div className="flex items-center gap-2.5">
              <div className={cn(
                "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 border",
                catMeta.badgeClass
              )}>
                <CatIcon className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <Link to={`/admin/orders/${d.id}`} className="block whitespace-nowrap text-sm font-bold uppercase tracking-tight text-foreground transition-colors hover:text-primary">#{num}</Link>
                  <Badge variant="outline" className={cn("text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0", catMeta.badgeClass)}>
                    {catMeta.label}
                  </Badge>
                </div>
                <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold uppercase text-muted-foreground">
                  <Clock className="h-2.5 w-2.5" /> {timeText} • {d.type || "takeaway"}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "restaurantName",
        header: "Restaurant",
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="max-w-[180px]">
              <span className="font-bold text-xs truncate block text-foreground">
                {d.restaurantName || "Partner Restaurant"}
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                ID: {(d.restaurantId || "—").slice(0, 8)}
              </span>
            </div>
          );
        },
      },
      {
        id: "zone",
        header: "Zone",
        cell: ({ row }) => (
          <ZoneBadge zoneId={row.original.zoneId} zoneName={row.original.zoneName} />
        ),
      },
      {
        accessorKey: "customerName",
        header: "Customer / Target",
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="max-w-[200px]">
              <span className="font-bold text-xs truncate block">
                {d.customerName || "Customer"} {d.table ? `• Table #${d.table}` : ""}
              </span>
              <span className="text-[10px] text-muted-foreground truncate block">
                {d.customerPhone || d.deliveryAddressText || "Direct order"}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "riderName",
        header: "Dispatch / Rider",
        cell: ({ row }) => {
          const d = row.original;
          if ((d.type || "").toLowerCase() !== "delivery") {
            return <span className="text-[10px] font-bold text-muted-foreground/60 uppercase">N/A</span>;
          }
          return d.riderName ? (
            <div>
              <span className="font-bold text-xs block text-sky-600">{d.riderName}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest block font-semibold">
                {d.deliveryStatus ? d.deliveryStatus.replace(/_/g, " ") : "Assigned"}
              </span>
            </div>
          ) : (
            <Badge variant="outline" className="bg-amber-500/10 border-amber-500/20 text-amber-600 text-[9px] font-semibold uppercase tracking-wide">
              Unassigned
            </Badge>
          );
        },
      },
      {
        accessorKey: "total",
        header: "Financials",
        cell: ({ row }) => {
          const d = row.original;
          const isPaid = (d.paymentStatus || "").toLowerCase() === "paid";
          return (
            <div>
              <span className="font-black text-xs block">{inr(d.total)}</span>
              <span className={cn(
                "mt-0.5 inline-block whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                isPaid ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-amber-500/10 border-amber-500/20 text-amber-600"
              )}>
                {(d.paymentMethod || "COD").toUpperCase()} • {isPaid ? "PAID" : "PENDING"}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Stage",
        cell: ({ row }) => {
          const norm = normalizeStatus(row.original.status);
          return (
            <Badge variant="outline" className={cn("rounded-lg font-semibold uppercase text-[9px] tracking-wide px-2.5 py-1", statusBadgeClasses[norm] || statusBadgeClasses.new)}>
              {statusLabelMap[norm] || row.original.status || "NEW"}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl text-xs font-bold gap-1 px-2.5 bg-card hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all"
                onClick={() => setSelectedOrder(d)}
              >
                <Eye className="h-3.5 w-3.5" /> View
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label="More actions" variant="ghost" size="icon" className="h-8 w-8 rounded-xl">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 rounded-2xl p-1.5 shadow-xl border-border/60">
                  <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1">
                    Super Admin Actions
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="rounded-xl text-xs font-semibold gap-2 cursor-pointer"
                    onClick={() => setSelectedOrder(d)}
                  >
                    <Eye className="h-3.5 w-3.5 text-primary" /> Inspect Order Drawer
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="rounded-xl text-xs font-semibold gap-2 cursor-pointer"
                    onClick={() => {
                      navigator.clipboard.writeText(d.id);
                      toast.success("Order ID copied to clipboard");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy Order ID ({d.id.slice(-6)})
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1">
                    Force Stage Transition
                  </DropdownMenuLabel>
                  {normalizeStatus(d.status) !== "preparing" && (
                    <DropdownMenuItem
                      className="rounded-xl text-xs font-semibold gap-2 cursor-pointer text-blue-600"
                      onClick={() => handleUpdateStatus(d.id, "preparing")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Mark Preparing
                    </DropdownMenuItem>
                  )}
                  {normalizeStatus(d.status) !== "ready" && (
                    <DropdownMenuItem
                      className="rounded-xl text-xs font-semibold gap-2 cursor-pointer text-amber-600"
                      onClick={() => handleUpdateStatus(d.id, "ready")}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Mark Ready
                    </DropdownMenuItem>
                  )}
                  {normalizeStatus(d.status) !== "completed" && (
                    <DropdownMenuItem
                      className="rounded-xl text-xs font-semibold gap-2 cursor-pointer text-emerald-600"
                      onClick={() => handleUpdateStatus(d.id, "completed")}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Mark Completed / Delivered
                    </DropdownMenuItem>
                  )}
                  {normalizeStatus(d.status) !== "cancelled" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="rounded-xl text-xs font-bold gap-2 cursor-pointer text-rose-600 focus:bg-rose-500/10 focus:text-rose-600"
                        onClick={() => {
                          setSelectedOrder(d);
                          setCancelModalOpen(true);
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Cancel & Refund Order
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    []
  );

  // Mobile card view helper
  const renderMobileCard = (d: PlatformOrder) => {
    const num = d.orderNumber || d.id.slice(-6);
    const norm = normalizeStatus(d.status);
    const isPaid = (d.paymentStatus || "").toLowerCase() === "paid";
    const cat = getOrderCategory(d);
    const catMeta = ORDER_CATEGORY_META[cat];
    return (
      <div
        className="bg-card rounded-2xl border border-border/60 p-4 shadow-sm space-y-3 cursor-pointer hover:border-primary/40 transition-all"
        onClick={() => setSelectedOrder(d)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm uppercase tracking-tight">#{num}</span>
            <Badge variant="outline" className={cn("text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5", catMeta.badgeClass)}>
              {catMeta.label}
            </Badge>
            <Badge variant="outline" className={cn("text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5", statusBadgeClasses[norm])}>
              {statusLabelMap[norm] || d.status}
            </Badge>
          </div>
          <span className="font-black text-sm text-primary">{inr(d.total)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs bg-muted/30 p-2.5 rounded-xl">
          <div>
            <span className="block text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Restaurant</span>
            <span className="font-bold truncate block text-foreground">{d.restaurantName || "Partner"}</span>
          </div>
          <div>
            <span className="block text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Customer</span>
            <span className="font-bold truncate block text-foreground">{d.customerName || "Customer"}</span>
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase pt-1 border-t border-border/40">
          <span>{(d.type || "Takeaway").toUpperCase()} • {(d.paymentMethod || "COD").toUpperCase()}</span>
          <span className={isPaid ? "text-emerald-600" : "text-amber-600"}>{isPaid ? "PAID" : "PENDING"}</span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <PageSkeleton kpis={5} />
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="All orders"
        description={`Every order, live. Figures cover the ${stats.total.toLocaleString("en-IN")} most recent orders loaded.`}
        icon={ShoppingBag}
      />

      <StatCards
        items={[
          {
            label: "Active now",
            value: stats.live,
            hint: `${stats.liveDelivery} delivery · ${stats.live - stats.liveDelivery} pickup or dine-in`,
            icon: Radio,
            tone: "text-emerald-600",
            onClick: () => setStatusFilter(statusFilter === "live" ? "all" : "live"),
            active: statusFilter === "live",
          },
          {
            label: "Completed",
            value: stats.completed,
            hint: stats.total ? `${Math.round((stats.completed / stats.total) * 100)}% of loaded orders` : undefined,
            icon: CheckCircle2,
            tone: "text-sky-600",
            onClick: () => setStatusFilter(statusFilter === "completed" ? "all" : "completed"),
            active: statusFilter === "completed",
          },
          {
            label: "Cancelled",
            value: stats.cancelled,
            hint: stats.total ? `${((stats.cancelled / stats.total) * 100).toFixed(1)}% cancellation rate` : undefined,
            icon: XCircle,
            tone: "text-rose-600",
            onClick: () => setStatusFilter(statusFilter === "cancelled" ? "all" : "cancelled"),
            active: statusFilter === "cancelled",
          },
          {
            label: "Refunded",
            value: stats.refunded,
            hint: "Payment returned to customer",
            icon: RefreshCw,
            tone: "text-fuchsia-600",
            onClick: () => setStatusFilter(statusFilter === "refunded" ? "all" : "refunded"),
            active: statusFilter === "refunded",
          },
          {
            label: "Order value",
            value: inr(stats.orderValue),
            hint: "Excludes cancelled orders",
            icon: DollarSign,
          },
        ]}
      />

      {/* Filter Bar & Category Pills */}
      <Card className="rounded-2xl border-border/40 shadow-sm overflow-hidden">
        <div className="p-4 md:p-6 bg-muted/20 border-b border-border/40 flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
          {/* Category Tabs: The Kada (default), QR Order, Walk In, Pickup, All */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
            {ORDER_CATEGORIES.map((tab) => {
              const Icon = tab.icon;
              const isSelected = categoryFilter === tab.id;
              const count = categoryCounts[tab.id as keyof typeof categoryCounts] ?? 0;
              return (
                <Button
                  key={tab.id}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "rounded-full text-xs font-semibold px-3.5 h-8 shrink-0 transition-all gap-1.5",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-background/80 hover:bg-muted text-muted-foreground"
                  )}
                  onClick={() => setCategoryFilter(tab.id)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      "px-1.5 py-0.2 rounded-full text-[10px] font-bold leading-none",
                      isSelected
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {count}
                  </span>
                </Button>
              );
            })}
          </div>

          {/* Status Filter Dropdown & Quick Reset */}
          <div className="flex items-center gap-2 shrink-0">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-40 rounded-full text-xs font-semibold bg-background">
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs font-medium">All Statuses</SelectItem>
                <SelectItem value="live" className="text-xs font-medium">🟢 Active / Live</SelectItem>
                <SelectItem value="completed" className="text-xs font-medium">✓ Completed</SelectItem>
                <SelectItem value="cancelled" className="text-xs font-medium">✕ Cancelled</SelectItem>
                <SelectItem value="refunded" className="text-xs font-medium">↩ Refunded</SelectItem>
              </SelectContent>
            </Select>

            {(categoryFilter !== "the_kada" || statusFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground rounded-full"
                onClick={() => {
                  setCategoryFilter("the_kada");
                  setStatusFilter("all");
                }}
                title="Reset to The Kada"
              >
                Reset
              </Button>
            )}
          </div>
        </div>

        <CardContent className="p-4 md:p-6 pt-4 md:pt-5">
          {filteredOrders.length === 0 ? (
            <div className="p-20 text-center space-y-3">
              <ShoppingBag className="h-12 w-12 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                No orders matching selected criteria
              </p>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-xs font-bold"
                onClick={() => {
                  setCategoryFilter("the_kada");
                  setStatusFilter("all");
                }}
              >
                Reset Filters
              </Button>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredOrders}
              searchKey="orderNumber"
              searchPlaceholder="Search order #, restaurant, customer..."
              renderMobileCard={renderMobileCard}
              exportFilename="platform-orders"
              savedViewsKey="platform-orders"
              onRowClick={(row) => setDrawerOrder(row)}
              bulkActions={[
                {
                  label: "Mark Prepared",
                  icon: CheckCircle2,
                  onSelected: async (rows) => {
                    const valid = rows.filter((r) => r.status === "accepted" || r.status === "preparing");
                    if (valid.length === 0) return toast.error("No valid orders selected to mark prepared.");
                    if (
                      !(await confirmDialog({
                        title: `Mark ${valid.length} order${valid.length === 1 ? "" : "s"} ready?`,
                        description: "Customers and riders are told the food is ready for pickup.",
                        confirmLabel: "Mark ready",
                      }))
                    )
                      return;
                    await runBulkTransition(valid, () => "ready", "marked ready");
                  }
                },
                {
                  label: "Cancel Selected",
                  destructive: true,
                  icon: XCircle,
                  onSelected: async (rows) => {
                    // This used to write status:"cancelled" directly, so a
                    // customer who had already paid was cancelled and never
                    // refunded — in bulk. vendorTransitionOrder refunds a paid
                    // order as part of the cancellation.
                    const reason = await promptDialog({
                      title: `Cancel ${rows.length} order${rows.length === 1 ? "" : "s"}?`,
                      description: "Paid orders are refunded. The customer sees the reason below.",
                      label: "Reason shown to the customer",
                      defaultValue: "Cancelled by Kada operations",
                      multiline: true,
                      validate: (v) => (v.trim().length >= 3 ? null : "At least 3 characters — the customer sees it."),
                      required: true,
                      confirmLabel: "Cancel orders",
                      cancelLabel: "Keep orders",
                      destructive: true,
                    });
                    if (reason === null) return;
                    await runBulkTransition(
                      rows,
                      (r) => cancelTargetFor(r.status),
                      "cancelled",
                      reason.trim(),
                    );
                  }
                }
              ]}
              // Preset filters are quick jumps to secondary states not on the
              // primary status axis above ("All / Active / Completed / …") —
              // never duplicate an existing tab. Removed the redundant "All".
              presetViews={[
                { id: "cancelled", label: "Cancelled", filter: "cancelled" },
                { id: "failed", label: "Payment failed", filter: "failed" },
                { id: "scheduled", label: "Scheduled", filter: "scheduled" },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Order Detail & Super Admin Intervention Modal ──────────────── */}
      <Dialog open={!!selectedOrder} onOpenChange={(o) => !o && setSelectedOrder(null)}>
        <DialogContent className="max-w-3xl rounded-2xl p-0 overflow-hidden border-border/60 shadow-2xl max-h-[90vh] flex flex-col">
          {selectedOrder && (
            <>
              {/* Modal Header */}
              <div className="bg-muted/40 p-6 border-b border-border/40 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl font-semibold uppercase tracking-tight">
                      #{selectedOrder.orderNumber || selectedOrder.id.slice(-6)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-lg font-semibold uppercase text-[10px] tracking-wide px-3 py-1",
                        statusBadgeClasses[normalizeStatus(selectedOrder.status)] || statusBadgeClasses.new
                      )}
                    >
                      {statusLabelMap[normalizeStatus(selectedOrder.status)] || selectedOrder.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-semibold mt-1 flex items-center gap-2">
                    <span>{selectedOrder.restaurantName || "Partner Restaurant"}</span> •{" "}
                    <Badge variant="outline" className={cn("text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0", ORDER_CATEGORY_META[getOrderCategory(selectedOrder)].badgeClass)}>
                      {ORDER_CATEGORY_META[getOrderCategory(selectedOrder)].label}
                    </Badge> •{" "}
                    <span>{(selectedOrder.type || "takeaway").toUpperCase()}</span> •{" "}
                    <span>
                      {selectedOrder.timestamp && typeof selectedOrder.timestamp.toDate === "function"
                        ? selectedOrder.timestamp.toDate().toLocaleString("en-IN")
                        : "Recent"}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs font-bold h-9 bg-background"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedOrder.id);
                      toast.success("Order ID copied");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> ID
                  </Button>
                </div>
              </div>

              {/* Modal Body Scrollable */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1">
                {/* Cancellation Banner if cancelled */}
                {normalizeStatus(selectedOrder.status) === "cancelled" && (
                  <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 p-4 flex items-start gap-3">
                    <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-xs uppercase tracking-wider text-rose-600">
                        Order Cancelled ({selectedOrder.cancelledBy || "System/User"})
                      </h4>
                      <p className="text-xs text-rose-700/90 font-semibold mt-0.5">
                        Reason: {selectedOrder.cancelReason || "No explanation recorded."}
                      </p>
                    </div>
                  </div>
                )}

                {/* Customer & Delivery / Table Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-card rounded-2xl border border-border/60 p-4 space-y-2.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-primary" /> Customer Information
                    </h4>
                    <div>
                      <p className="font-bold text-sm text-foreground">{selectedOrder.customerName || "Customer"}</p>
                      {selectedOrder.customerPhone && (
                        <p className="text-xs text-muted-foreground font-medium flex items-center gap-1 mt-0.5">
                          <Phone className="h-3 w-3" /> {selectedOrder.customerPhone}
                        </p>
                      )}
                      {selectedOrder.table && (
                        <Badge className="mt-2 bg-purple-500/10 text-purple-600 border-purple-500/20 font-bold text-[10px]">
                          Table #{selectedOrder.table}
                        </Badge>
                      )}
                      {selectedOrder.deliveryAddressText && (
                        <p className="text-xs text-muted-foreground font-medium flex items-start gap-1 mt-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" /> {selectedOrder.deliveryAddressText}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="bg-card rounded-2xl border border-border/60 p-4 space-y-2.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Bike className="h-3.5 w-3.5 text-sky-500" /> Dispatch & Restaurant
                    </h4>
                    <div>
                      <p className="font-bold text-sm text-foreground">{selectedOrder.restaurantName || "Partner Restaurant"}</p>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mt-0.5">
                        Rest. ID: {selectedOrder.restaurantId || "—"}
                      </p>
                      <div className="mt-1.5">
                        <ZoneBadge zoneId={selectedOrder.zoneId} zoneName={selectedOrder.zoneName} />
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-border/40 flex items-center justify-between">
                        <span className="text-xs font-bold text-muted-foreground">Assigned Rider:</span>
                        {selectedOrder.riderName ? (
                          <span className="text-xs font-black text-sky-600">
                            {selectedOrder.riderName} ({selectedOrder.riderPhone || ""})
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-amber-600 uppercase">Unassigned</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Order Items Table */}
                <div className="bg-card rounded-2xl border border-border/60 overflow-hidden">
                  <div className="bg-muted/30 px-4 py-3 border-b border-border/40 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Ordered Items ({(selectedOrder.items || []).length})
                    </span>
                    <span className="text-xs font-bold text-muted-foreground">
                      {selectedOrder.instructions ? `Note: ${selectedOrder.instructions}` : ""}
                    </span>
                  </div>
                  <div className="divide-y divide-border/40">
                    {(selectedOrder.items || []).map((item, idx) => (
                      <div key={idx} className="p-4 flex items-center justify-between text-xs">
                        <div className="flex items-start gap-3">
                          <Badge variant="outline" className="font-black bg-primary/10 text-primary border-primary/20 shrink-0">
                            {item.qty}x
                          </Badge>
                          <div>
                            <p className="font-bold text-foreground text-sm">{item.name}</p>
                            {item.instructions && (
                              <p className="text-[11px] text-muted-foreground italic mt-0.5">Note: {item.instructions}</p>
                            )}
                          </div>
                        </div>
                        <span className="font-black text-sm text-foreground">
                          {inr((item.price || 0) * (item.qty || 1))}
                        </span>
                      </div>
                    ))}
                    {(selectedOrder.items || []).length === 0 && (
                      <div className="p-8 text-center text-xs text-muted-foreground font-semibold">
                        No item breakdown recorded for this order.
                      </div>
                    )}
                  </div>
                  {/* Financial Summary Breakdown */}
                  <div className="bg-muted/20 p-4 border-t border-border/40 space-y-1.5 text-xs">
                    <div className="flex justify-between font-semibold text-muted-foreground">
                      <span>Subtotal</span>
                      <span>{inr(selectedOrder.subtotal ?? selectedOrder.total)}</span>
                    </div>
                    {typeof selectedOrder.tax === "number" && selectedOrder.tax > 0 && (
                      <div className="flex justify-between font-semibold text-muted-foreground">
                        <span>Taxes & GST</span>
                        <span>{inr(selectedOrder.tax)}</span>
                      </div>
                    )}
                    {typeof selectedOrder.deliveryFee === "number" && selectedOrder.deliveryFee > 0 && (
                      <div className="flex justify-between font-semibold text-muted-foreground">
                        <span>Delivery Fee</span>
                        <span>{inr(selectedOrder.deliveryFee)}</span>
                      </div>
                    )}
                    {typeof selectedOrder.discount === "number" && selectedOrder.discount > 0 && (
                      <div className="flex justify-between font-semibold text-emerald-600">
                        <span>Discount / Promo</span>
                        <span>-{inr(selectedOrder.discount)}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-border/40 flex justify-between items-center text-base font-black text-foreground">
                      <span>Total Paid / Payable</span>
                      <span className="text-primary">{inr(selectedOrder.total)}</span>
                    </div>
                  </div>
                </div>

                {/* Super Admin Control / Intervention Panel */}
                <div className="bg-gradient-to-br from-primary/5 via-card to-background rounded-2xl border-2 border-primary/20 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4" /> Super Admin Authority Override
                    </h4>
                    <Badge className="bg-primary text-primary-foreground font-bold text-[10px] uppercase">
                      Admin Privilege
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-medium">
                    Use these controls to manually correct order states, override restaurant/rider dispatch, or execute administrative cancellations.
                  </p>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updating || normalizeStatus(selectedOrder.status) === "preparing"}
                      className="rounded-xl text-xs font-bold bg-background border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
                      onClick={() => handleUpdateStatus(selectedOrder.id, "preparing")}
                    >
                      Set Preparing
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updating || normalizeStatus(selectedOrder.status) === "ready"}
                      className="rounded-xl text-xs font-bold bg-background border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                      onClick={() => handleUpdateStatus(selectedOrder.id, "ready")}
                    >
                      Set Ready
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updating || normalizeStatus(selectedOrder.status) === "completed"}
                      className="rounded-xl text-xs font-bold bg-background border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                      onClick={() => handleUpdateStatus(selectedOrder.id, "completed")}
                    >
                      Set Completed
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updating || normalizeStatus(selectedOrder.status) === "cancelled"}
                      className="rounded-xl text-xs font-bold bg-background border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
                      onClick={() => setCancelModalOpen(true)}
                    >
                      Cancel & Refund
                    </Button>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <DialogFooter className="bg-muted/30 p-4 border-t border-border/40 flex items-center justify-between sm:justify-between">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Payment Method: {(selectedOrder.paymentMethod || "COD").toUpperCase()} • Status:{" "}
                  <span className="font-extrabold text-foreground">{selectedOrder.paymentStatus || "Pending"}</span>
                </span>
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-xl font-bold px-6"
                  onClick={() => setSelectedOrder(null)}
                >
                  Close Drawer
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Admin Cancellation Confirmation Modal ────────────────────── */}
      <Dialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6 border-border/60 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold uppercase tracking-tight flex items-center gap-2 text-rose-600">
              <ShieldAlert className="h-6 w-6" /> Administrative Cancellation
            </DialogTitle>
            <DialogDescription className="text-xs font-medium text-muted-foreground pt-1">
              You are about to force-cancel order #{selectedOrder?.orderNumber || selectedOrder?.id.slice(-6)}. This action will immediately notify the customer and partner restaurant.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <label className="text-xs font-bold text-foreground block">
                Select or enter cancellation reason (Required)
              </label>
              <Select onValueChange={(val) => setCancelReason(val)}>
                <SelectTrigger className="w-full rounded-xl text-xs font-semibold">
                  <SelectValue placeholder="Choose standard reason..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl text-xs">
                  <SelectItem value="Customer requested cancellation via support">Customer requested cancellation via support</SelectItem>
                  <SelectItem value="Partner restaurant closed or unresponsive">Partner restaurant closed or unresponsive</SelectItem>
                  <SelectItem value="No delivery riders available in radius">No delivery riders available in radius</SelectItem>
                  <SelectItem value="Food quality or preparation issue reported">Food quality or preparation issue reported</SelectItem>
                  <SelectItem value="Fraud prevention / suspicious transaction">Fraud prevention / suspicious transaction</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Or type custom reason..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="rounded-xl text-xs font-medium mt-2"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl font-bold text-xs"
              onClick={() => {
                setCancelModalOpen(false);
                setCancelReason("");
              }}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={updating || !cancelReason.trim()}
              className="rounded-xl font-bold text-xs px-5 bg-rose-600 hover:bg-rose-700"
              onClick={handleAdminCancel}
            >
              {updating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EntityDrawer
        open={!!drawerOrder}
        onOpenChange={(o) => !o && setDrawerOrder(null)}
        title={`Order #${drawerOrder?.orderNumber || drawerOrder?.id?.slice(-6)}`}
        icon={ShoppingBag}
        subtitle={`${drawerOrder?.restaurantName || "Partner"} • ${(drawerOrder?.type || "takeaway").toUpperCase()}`}
        status={statusLabelMap[normalizeStatus(drawerOrder?.status)] || drawerOrder?.status}
        statusTone={
          normalizeStatus(drawerOrder?.status) === "completed" ? "success" : 
          normalizeStatus(drawerOrder?.status) === "cancelled" ? "danger" : 
          normalizeStatus(drawerOrder?.status) === "preparing" ? "info" : 
          normalizeStatus(drawerOrder?.status) === "ready" ? "warning" : "neutral"
        }
        detailPath={drawerOrder ? `/admin/orders/${drawerOrder.id}` : undefined}
        metrics={[
          { label: "Total Amount", value: inr(drawerOrder?.total) },
          { label: "Payment", value: drawerOrder?.paymentStatus === "paid" ? "Paid" : "Pending", tone: drawerOrder?.paymentStatus === "paid" ? "success" : "warning" },
          { label: "Customer", value: drawerOrder?.customerName || "Guest" },
        ]}
        actions={
          <>
            {can("refund") && drawerOrder?.paymentStatus === "paid" && (
              <ConfirmationDialog
                trigger={<Button variant="outline" size="sm" className="text-amber-600 border-amber-600/30 hover:bg-amber-600/10">Refund</Button>}
                title={`Refund ${inr(drawerOrder?.total)}?`}
                description={`Refund ${inr(drawerOrder?.total)} to ${drawerOrder?.customerName || "the customer"} for order #${drawerOrder?.orderNumber || drawerOrder?.id?.slice(-6)}. This cannot be undone.`}
                consequences={[
                  `${inr(drawerOrder?.total)} is returned to the customer's wallet`,
                  "The order is marked refunded",
                  "Recorded in the audit log",
                ]}
                requireReason
                reasonLabel="Reason for refund"
                confirmText="Refund order"
                isDanger
                loading={updating}
                onConfirm={handleDrawerRefund}
              />
            )}
            <Button variant="outline" size="sm" className="text-rose-600 border-rose-600/30 hover:bg-rose-600/10" onClick={() => {
              if (drawerOrder) {
                setSelectedOrder(drawerOrder);
                setCancelModalOpen(true);
                setDrawerOrder(null);
              }
            }}>Cancel</Button>
          </>
        }
      >
        {drawerOrder && (
          <div className="space-y-6">
            <div>
              <h4 className="text-sm font-semibold mb-3">Order Details</h4>
              <div className="grid grid-cols-2 gap-4 bg-muted/30 p-4 rounded-xl border border-border/40">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-1">Customer</p>
                  <p className="font-medium text-sm">{drawerOrder.customerName || "Guest"}</p>
                  {drawerOrder.customerPhone && <p className="text-xs text-muted-foreground">{drawerOrder.customerPhone}</p>}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-1">Vendor</p>
                  <p className="font-medium text-sm">{drawerOrder.restaurantName || "Partner Restaurant"}</p>
                  <div className="mt-1">
                    <ZoneBadge zoneId={drawerOrder.zoneId} zoneName={drawerOrder.zoneName} />
                  </div>
                </div>
                <div className="col-span-2 pt-2 border-t border-border/40 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Order Channel</span>
                  <Badge variant="outline" className={cn("text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5", ORDER_CATEGORY_META[getOrderCategory(drawerOrder)].badgeClass)}>
                    {ORDER_CATEGORY_META[getOrderCategory(drawerOrder)].label}
                  </Badge>
                </div>
                {drawerOrder.type === "delivery" && (
                  <div className="col-span-2 pt-2 border-t border-border/40">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-1">Delivery Address</p>
                    <p className="text-xs">{drawerOrder.deliveryAddressText || "No address provided"}</p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3">Recent Timeline</h4>
              <div className="bg-card border border-border/40 rounded-xl p-4 shadow-sm">
                <ol className="relative ml-2 border-l border-border/60 space-y-4">
                  <li className="relative pl-4">
                    <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-primary ring-4 ring-card" />
                    <p className="text-sm font-medium">Order Placed</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{drawerOrder.timestamp ? "Just now" : "Unknown"}</p>
                  </li>
                  {normalizeStatus(drawerOrder.status) !== "new" && (
                    <li className="relative pl-4">
                      <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-blue-500 ring-4 ring-card" />
                      <p className="text-sm font-medium">Preparing</p>
                    </li>
                  )}
                  {(normalizeStatus(drawerOrder.status) === "ready" || normalizeStatus(drawerOrder.status) === "completed") && (
                    <li className="relative pl-4">
                      <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-4 ring-card" />
                      <p className="text-sm font-medium">Ready</p>
                    </li>
                  )}
                </ol>
              </div>
            </div>
          </div>
        )}
      </EntityDrawer>
    </div>
  );
}
