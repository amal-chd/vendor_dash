import { confirmDialog, promptDialog } from "@/components/admin/core/asyncDialogs";
import { useState, useMemo } from "react";
import { runOp } from "@/lib/opFeedback";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  Clock,
  MapPin,
  Navigation,
  Phone,
  User,
  Users,
  CheckCircle,
  Search,
  XCircle,
  MoreVertical,
  Bike,
  Store,
  Flame,
  ExternalLink,
  RefreshCw,
  Zap,
  ShieldAlert,
  Send,
  SlidersHorizontal,
  ChevronRight,
  PackageCheck,
  CookingPot,
  ArrowRight,
  AlertTriangle,
  Bot,
  Megaphone,
  Map as MapIcon,
  Ban
} from "lucide-react";
import { doc, updateDoc, setDoc, serverTimestamp, addDoc, collection } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards, type StatItem } from "@/components/admin/StatCards";
import DispatchMap from "@/components/admin/DispatchMap";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { notificationService } from "@/services/notificationService";
import type { LiveOrder, RiderInfo, RestaurantInfo } from "@/types/admin";
import { EntityDrawer } from "@/components/admin/core/EntityDrawer";
import { isWalkInOrder } from "@/lib/orderChannels";

// Server-side assignment: validates the rider, claims the order atomically,
// writes the timeline event and notifies the customer, restaurant and rider.
// Frees the current rider and re-offers the order. Admin-capable, and it can
// force a handover even after pickup (rider accident, breakdown).
const reassignDelivery = httpsCallable<
  { orderId: string; reason?: string },
  { ok?: boolean; previousRiderId?: string; fromStage?: string }
>(functions, "reassignDelivery", { timeout: 20_000 });

// Corrects a stage the rider never tapped. Enforces the pickup gate, refuses a
// rewind, and refuses DELIVERED (that needs the OTP handoff).
const advanceStage = httpsCallable<{ orderId: string; stage: string }, { ok?: boolean; state?: string }>(
  functions,
  "advanceDeliveryStage",
  { timeout: 20_000 },
);

// Mirrors DeliveryState in functions/src/deliveryLifecycle.ts. "delivered" is
// absent on purpose: completion runs through the rider's OTP handoff.
const STAGE_CHAIN = ["assigned", "at_restaurant", "picked_up", "on_the_way", "arrived"] as const;
const STAGE_LABEL: Record<string, string> = {
  unassigned: "Unassigned",
  offered: "Finding a rider",
  assigned: "Rider assigned",
  at_restaurant: "At the restaurant",
  picked_up: "Picked up",
  on_the_way: "On the way",
  arrived: "At the customer",
  delivered: "Delivered",
};

const assignRider = httpsCallable<
  { orderId: string; riderId: string; reason?: string },
  { ok?: boolean; idempotent?: boolean; riderName?: string; previousRiderId?: string }
>(functions, "adminAssignRider", { timeout: 20_000 });

const getMinutesElapsed = (timeObj: any) => {
  if (!timeObj) return 0;
  const t = typeof timeObj.toDate === "function" ? timeObj.toDate() : new Date(timeObj);
  return Math.floor((Date.now() - t.getTime()) / 60000);
};

const formatINR = (val: number | undefined) => "₹" + (val || 0).toLocaleString("en-IN");

export default function LiveOperationsPage() {
  const { rows: orders, loading: ordersLoading } = useLiveCollection<LiveOrder>("orders", {
    limit: 500,
    orderByField: "createdAt",
    orderDir: "desc",
  });
  const { rows: riders } = useLiveCollection<RiderInfo>("delivery_users", {
    limit: 500,
  });
  const { rows: restaurants } = useLiveCollection<RestaurantInfo>("restaurants", {
    limit: 400,
  });
  const { rows: zones } = useLiveCollection<any>("demand_zones", {
    orderByField: "name",
    orderDir: "asc"
  });

  const { rows: configRows } = useLiveCollection<any>("config");
  const platformConfig = configRows.find(r => r.id === "platform") || {};
  const autoAssignEnabled = platformConfig.autoDispatchEnabled ?? true;

  const setAutoAssignEnabled = async (enabled: boolean) => {
    try {
      await updateDoc(doc(db, "config", "platform"), { autoDispatchEnabled: enabled });
      toast.success(enabled ? "Auto-Dispatch Enabled" : "Auto-Dispatch Paused");
    } catch (e: any) {
      // If document doesn't exist, create it
      if (e.code === "not-found") {
        await setDoc(doc(db, "config", "platform"), { autoDispatchEnabled: enabled }, { merge: true });
        toast.success(enabled ? "Auto-Dispatch Enabled" : "Auto-Dispatch Paused");
      } else {
        toast.error("Failed to update config");
      }
    }
  };

  const [activeTab, setActiveTab] = useState("unassigned");
  const [rightTab, setRightTab] = useState("exceptions");
  const [inspectingOrderId, setInspectingOrderId] = useState<string | null>(null);

  // Toolbar state
  const [selectedZone, setSelectedZone] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);

  const [assignRiderId, setAssignRiderId] = useState<string>("");
  const [isAssigning, setIsAssigning] = useState(false);

  const restaurantMap = useMemo(() => {
    const map = new Map<string, RestaurantInfo>();
    restaurants.forEach((r) => { if (r.id) map.set(r.id, r); });
    return map;
  }, [restaurants]);

  // Derived filtered data
  const filteredOrders = useMemo(() => {
    // Walk-in / QR counter tickets never need Kada dispatch — they were
    // showing up as "unassigned" deliveries nobody could assign.
    let result = orders.filter((o) => !isWalkInOrder(o)).filter((o) => {
      const s = (o.status || "").toLowerCase();
      const ds = (o.deliveryStatus || "").toLowerCase();
      return !["delivered", "cancelled", "canceled", "rejected", "failed"].includes(s) && ds !== "delivered";
    });

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(o => 
        (o.orderNumber || "").toLowerCase().includes(q) || 
        (o.id || "").toLowerCase().includes(q) ||
        (o.customerName || "").toLowerCase().includes(q) ||
        (o.restaurantName || "").toLowerCase().includes(q)
      );
    }

    if (selectedZone !== "all") {
      result = result.filter((o) => {
        const rest = o.restaurantId ? restaurantMap.get(o.restaurantId) : undefined;
        const zoneId = o.zoneId || rest?.zoneId;
        return zoneId === selectedZone;
      });
    }

    return result;
  }, [orders, searchQuery, selectedZone, restaurantMap]);

  const activeOrders = filteredOrders;

  const unassignedOrders = useMemo(() => activeOrders.filter((o) => {
    const ds = (o.deliveryStatus || "").toLowerCase();
    const hasRider = Boolean(o.riderId && o.riderId.trim().length > 0);
    return !hasRider && !["assigned", "out_for_delivery", "picked_up", "on_the_way", "dispatched", "at_restaurant"].includes(ds);
  }), [activeOrders]);

  const delayedOrders = useMemo(() => activeOrders.filter((o) => getMinutesElapsed(o.timestamp || o.createdAt) >= 35), [activeOrders]);

  const ridersOnline = useMemo(() => riders.filter((r) => r.isOnline), [riders]);
  const ridersOnDelivery = useMemo(() => ridersOnline.filter((r) => r.status === "on_delivery" || r.currentOrderId), [ridersOnline]);
  const ridersAvailable = useMemo(() => ridersOnline.filter((r) => r.status !== "on_delivery" && !r.currentOrderId), [ridersOnline]);

  const kitchenBottlenecks = useMemo(() => {
    const venueMap = new Map<string, { name: string; count: number; delayedCount: number }>();
    activeOrders.forEach((o) => {
      const rId = o.restaurantId || "unknown";
      const name = o.restaurantName || restaurantMap.get(rId)?.name || rId;
      const stat = venueMap.get(rId) ?? { name, count: 0, delayedCount: 0 };
      stat.count += 1;
      if (getMinutesElapsed(o.timestamp || o.createdAt) > 30) stat.delayedCount += 1;
      venueMap.set(rId, stat);
    });
    return Array.from(venueMap.entries())
      .map(([id, data]) => ({ id, ...data }))
      .filter((v) => v.count > 2)
      .sort((a, b) => b.delayedCount - a.delayedCount || b.count - a.count);
  }, [activeOrders, restaurantMap]);

  const kpis: StatItem[] = [
    { label: "Active orders", value: activeOrders.length, hint: "In the kitchen or on the road", icon: Activity, tone: "text-primary" },
    { label: "Unassigned", value: unassignedOrders.length, hint: "Waiting for a rider", icon: Zap, tone: "text-amber-600" },
    { label: "Running late", value: delayedOrders.length, hint: "Past the delivery SLA", icon: AlertCircle, tone: "text-rose-600" },
    { label: "Riders free", value: ridersAvailable.length, hint: "Online, no order", icon: Bike, tone: "text-emerald-600" },
    { label: "Riders busy", value: ridersOnDelivery.length, hint: "On a delivery", icon: Navigation, tone: "text-blue-600" },
  ];

  // Dispatch assigns a named rider. This was three blind writes from the
  // browser — order, rider, notification — with no transaction and none of the
  // checks the rider's own accept path makes. It could assign a suspended
  // rider, overwrite an order a rider had just accepted, leave the stale offer
  // behind for the re-offer cron, clear the currentOrderId of a rider already
  // carrying another delivery, write no timeline event, and never tell the
  // customer a rider was coming. adminAssignRider does all of it atomically.
  const handleAssignRider = async (order: LiveOrder, specificRiderId?: string) => {
    const targetRiderId = specificRiderId || assignRiderId;
    if (!targetRiderId) return toast.error("Select a rider first");

    if (!specificRiderId) setIsAssigning(true);

    try {
      const res = await assignRider({ orderId: order.id, riderId: targetRiderId });
      const riderName = res.data?.riderName || "Rider";
      toast.success(
        res.data?.idempotent
          ? `${riderName} already has order #${order.orderNumber || order.id.slice(-6)}.`
          : `Assigned ${riderName} to order #${order.orderNumber || order.id.slice(-6)}.`,
      );
      setAssignRiderId("");
    } catch (err: unknown) {
      // A refusal here is the server protecting a real invariant (rider not
      // approved, order already picked up by someone else) — show its words.
      const e = err as { code?: string; message?: string };
      const code = (e.code ?? "").replace(/^functions\//, "");
      toast.error(
        code === "failed-precondition" || code === "not-found" || code === "invalid-argument"
          ? e.message || "That assignment was refused."
          : "Couldn't reach Kada to confirm the assignment. Check the order before retrying.",
        { duration: 7000 },
      );
    } finally {
      setIsAssigning(false);
    }
  };

  // "Unassign" was a button with no onClick at all: it rendered, it looked
  // enabled, and clicking it did nothing. reassignDelivery has existed on the
  // server the whole time — it frees the rider, keeps any other delivery they
  // are carrying, records the handoff and re-offers the order.
  const handleUnassign = async (order: LiveOrder) => {
    const reason = await promptDialog({
      title: `Take order #${order.orderNumber || order.id.slice(-6)} off ${order.riderName || "this rider"}?`,
      description: "It will be re-offered to the fleet. The rider keeps any other delivery they are carrying.",
      label: "Reason (recorded on the order)",
      defaultValue: "Reassigned by Dispatch",
      confirmLabel: "Unassign rider",
      destructive: true,
    });
    if (reason === null) return;
    setIsAssigning(true);
    try {
      await reassignDelivery({ orderId: order.id, reason: reason.trim() });
      toast.success(`Order unassigned and re-offered to the fleet.`);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const code = (e.code ?? "").replace(/^functions\//, "");
      toast.error(
        code === "failed-precondition" || code === "not-found"
          ? e.message || "That reassignment was refused."
          : "Couldn't reach Kada to confirm the reassignment.",
        { duration: 7000 },
      );
    } finally {
      setIsAssigning(false);
    }
  };

  // Ops correcting a stage the rider never tapped — the one capability the old
  // (unreachable) DeliveriesPage had and this board did not. There it wrote
  // deliveryStatus straight onto the order and mapped "arrived" to
  // status:"completed", which terminated the order so the rider's OTP handoff
  // could never run. advanceDeliveryStage applies the real gates.
  const handleAdvanceStage = async (order: LiveOrder, stage: string) => {
    setIsAssigning(true);
    try {
      await advanceStage({ orderId: order.id, stage });
      toast.success(`Delivery moved to ${STAGE_LABEL[stage] ?? stage}.`);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const code = (e.code ?? "").replace(/^functions\//, "");
      toast.error(
        code === "failed-precondition" || code === "not-found" || code === "invalid-argument"
          ? e.message || "That stage change was refused."
          : "Couldn't reach Kada to confirm the change.",
        { duration: 8000 },
      );
    } finally {
      setIsAssigning(false);
    }
  };

  const handleExpediteOrder = async (order: LiveOrder) => {
    try {
      await updateDoc(doc(db, "orders", order.id), { isExpedited: true, expeditedAt: serverTimestamp() });
      // The flag marks the order on this dispatch board (amber rail + badge).
      // It does not reach the kitchen or rider apps, so don't imply that it did.
      toast.success(`Order #${order.orderNumber || order.id.slice(-6)} flagged urgent on the dispatch board`);
    } catch (err: unknown) {
      toast.error(`Failed to expedite: ${(err as Error).message}`);
    }
  };

  const selectedOrder = inspectingOrderId ? orders.find(o => o.id === inspectingOrderId) : null;

  const OrderListCard = ({ order, unassignedView = false }: { order: LiveOrder, unassignedView?: boolean }) => {
    const mins = getMinutesElapsed(order.timestamp || order.createdAt);
    const isDelayed = mins >= 35;
    return (
      <div 
        onClick={() => setInspectingOrderId(order.id)}
        className={cn(
          "p-3.5 rounded-xl border border-border/50 bg-card hover:border-primary/40 cursor-pointer transition-all hover:shadow-sm space-y-2.5 relative overflow-hidden group",
          isDelayed && "border-rose-500/30 bg-rose-500/5",
          order.isExpedited && "border-amber-500/30 bg-amber-500/5"
        )}
      >
        {isDelayed && <div className="absolute top-0 left-0 w-1 h-full bg-rose-500" />}
        {order.isExpedited && <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />}

        <div className="flex items-start justify-between">
          <div>
            <div className="font-bold flex items-center gap-2">
              #{order.orderNumber || order.id.slice(-6)}
              {isDelayed && <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4 rounded">Breached</Badge>}
              {order.isExpedited && <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 rounded border-amber-500 text-amber-600 bg-amber-500/10"><Flame className="w-2.5 h-2.5 mr-0.5" /> Expedited</Badge>}
            </div>
            <p className="text-[10px] text-muted-foreground uppercase font-medium mt-0.5 tracking-wider">{order.deliveryStatus || order.status || "Placed"}</p>
          </div>
          <div className={cn("text-xs font-semibold flex items-center gap-1.5 px-2 py-1 rounded-md", isDelayed ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : "bg-muted text-foreground")}>
            <Clock className="w-3.5 h-3.5" /> {mins}m
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-[11px] pt-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-foreground line-clamp-1 flex-1 pr-2">
              <Store className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="font-semibold">{order.restaurantName || "Partner Restaurant"}</span>
            </div>
            <span className="text-muted-foreground font-medium shrink-0">{formatINR(order.total)}</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-muted-foreground line-clamp-1 flex-1 pr-2">
              <User className="w-3.5 h-3.5 shrink-0" />
              <span>{order.customerName || "Customer"}</span>
            </div>
            <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        <div className="pt-2 border-t border-border/50 flex items-center justify-between">
          {order.riderName ? (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
              <Bike className="w-3.5 h-3.5 shrink-0" /> {order.riderName}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
              <Zap className="w-3.5 h-3.5 shrink-0" /> Waiting for Rider
            </div>
          )}

          {unassignedView && !order.riderName && (
            <Button size="sm" variant="secondary" className="h-6 text-[10px] px-2 bg-primary/10 hover:bg-primary/20 text-primary" onClick={(e) => {
              e.stopPropagation();
              setInspectingOrderId(order.id);
            }}>
              Assign <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-65px)] bg-background">
      {/* ── Page Header & KPIs (Fixed Top) ─────────────────────────────────── */}
      <div className="shrink-0 space-y-4 pb-4 border-b border-border/60">
        <div className="flex items-center justify-between">
          <AdminPageHeader
            title="Live Dispatch"
            description="Real-time command center for active marketplace operations and delivery fleet."
            badge="Live Sync"
          />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/60 bg-card shadow-sm">
              <Bot className={cn("w-4 h-4", autoAssignEnabled ? "text-emerald-500" : "text-muted-foreground")} />
              <Label htmlFor="auto-assign" className="text-xs font-semibold cursor-pointer">Auto-Dispatch</Label>
              <Switch id="auto-assign" checked={autoAssignEnabled} onCheckedChange={setAutoAssignEnabled} className="ml-2 scale-75 origin-right" />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2"
              onClick={() => setBroadcastOpen((open) => !open)}
            >
              <Megaphone className="w-3.5 h-3.5 text-primary" />
              Broadcast to Fleet
            </Button>
          </div>
        </div>

        {broadcastOpen && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const title = broadcastTitle.trim();
              const body = broadcastBody.trim();
              if (!title || !body) {
                toast.error("Title and message are required");
                return;
              }
              setBroadcasting(true);
              try {
                const res = await notificationService.sendBroadcast({
                  title,
                  body,
                  audience: "riders",
                  type: "ops",
                  urgent: true,
                });
                toast.success(`Sent to ${res.recipients} riders (${res.pushed} push)`);
                setBroadcastTitle("");
                setBroadcastBody("");
                setBroadcastOpen(false);
              } catch (err: unknown) {
                toast.error(err instanceof Error ? err.message : "Broadcast failed");
              } finally {
                setBroadcasting(false);
              }
            }}
          >
            <Input
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="Title"
              className="h-9 w-48 text-xs"
            />
            <Input
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value)}
              placeholder="Message to online riders"
              className="h-9 min-w-[240px] flex-1 text-xs"
            />
            <Button type="submit" size="sm" className="h-9" disabled={broadcasting}>
              {broadcasting ? "Sending…" : "Send"}
            </Button>
          </form>
        )}
        <div className="flex gap-4 items-center">
          <div className="flex-1">
            <StatCards items={kpis} />
          </div>
        </div>
      </div>

      {/* ── Secondary Toolbar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 py-3 border-b border-border/60 shrink-0 bg-muted/20 px-1">
        <div className="relative w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Search orders, riders, venues..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs bg-background"
          />
        </div>
        <Select value={selectedZone} onValueChange={setSelectedZone}>
          <SelectTrigger className="w-[200px] h-9 text-xs bg-background">
            <MapIcon className="w-3.5 h-3.5 text-muted-foreground mr-2" />
            <SelectValue placeholder="All Zones" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Zones</SelectItem>
            {zones.map(z => (
              <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* A refresh button here was theatre: this page is driven by live
            onSnapshot listeners, so the data is already current and the click
            only toasted "Refreshed data". The live indicator says what the
            button pretended to do. */}
        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </div>

      {/* ── Main Operations Workspace (Fills remaining height) ───────────── */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-0">

        {/* Left Column: Queues (3 cols) */}
        <div className="col-span-3 flex flex-col h-full border-r border-border/60 pr-4 pt-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="w-full bg-muted/50 p-1 mb-3">
              <TabsTrigger value="unassigned" className="flex-1 text-[11px] relative">
                Unassigned {unassignedOrders.length > 0 && <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
              </TabsTrigger>
              <TabsTrigger value="active" className="flex-1 text-[11px]">In-Flight</TabsTrigger>
              <TabsTrigger value="breached" className="flex-1 text-[11px] relative">
                Breached {delayedOrders.length > 0 && <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-rose-500" />}
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto pr-2 pb-6 space-y-3 custom-scrollbar">
              <TabsContent value="unassigned" className="m-0 space-y-3 border-none outline-none">
                {unassignedOrders.length === 0 ? (
                   <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
                     <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                       <CheckCircle className="w-6 h-6 text-emerald-500" />
                     </div>
                     <p className="text-xs text-muted-foreground font-medium">Zero unassigned orders.<br/>The fleet is keeping up perfectly!</p>
                   </div>
                ) : (
                   unassignedOrders.map(o => <OrderListCard key={o.id} order={o} unassignedView={true} />)
                )}
              </TabsContent>

              <TabsContent value="active" className="m-0 space-y-3 border-none outline-none">
                {activeOrders.length === 0 ? (
                   <p className="text-xs text-muted-foreground text-center p-8 font-medium">No active orders</p>
                ) : (
                   activeOrders.map(o => <OrderListCard key={o.id} order={o} />)
                )}
              </TabsContent>

              <TabsContent value="breached" className="m-0 space-y-3 border-none outline-none">
                {delayedOrders.length === 0 ? (
                   <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
                     <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                       <CheckCircle className="w-6 h-6 text-emerald-500" />
                     </div>
                     <p className="text-xs text-muted-foreground font-medium">No SLA breaches!<br/>Operations are smooth.</p>
                   </div>
                ) : (
                   delayedOrders.map(o => <OrderListCard key={o.id} order={o} />)
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Center Column: Dispatch Map (6 cols) */}
        <div className="col-span-6 h-full p-4 flex flex-col relative isolate z-0">
          <DispatchMap />
        </div>

        {/* Right Column: Insights & Alerts (3 cols) */}
        <div className="col-span-3 flex flex-col h-full pl-4 border-l border-border/60 pt-4">
          <Tabs value={rightTab} onValueChange={setRightTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="w-full bg-muted/50 p-1 mb-3">
              <TabsTrigger value="exceptions" className="flex-1 text-[11px] relative">Exceptions</TabsTrigger>
              <TabsTrigger value="fleet" className="flex-1 text-[11px]">Fleet ({ridersOnline.length})</TabsTrigger>
              <TabsTrigger value="kitchens" className="flex-1 text-[11px]">Kitchens</TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto pr-2 pb-6 space-y-4 custom-scrollbar">

              <TabsContent value="exceptions" className="m-0 space-y-4 border-none outline-none">
                {/* SLA Breaches Quick Summary */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <ShieldAlert className="w-3 h-3" /> Critical Attention Needed
                  </h4>
                  {delayedOrders.length === 0 ? (
                    <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      <span className="text-xs font-medium text-emerald-700">No critical SLA breaches</span>
                    </div>
                  ) : (
                    delayedOrders.map(o => (
                      <div key={o.id} className="p-3 bg-rose-500/5 border border-rose-500/20 rounded-xl space-y-2 cursor-pointer hover:bg-rose-500/10 transition-colors" onClick={() => setInspectingOrderId(o.id)}>
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-xs text-rose-700">Order #{o.orderNumber || o.id.slice(-6)}</span>
                          <span className="text-[10px] font-bold text-rose-700">{getMinutesElapsed(o.timestamp || o.createdAt)} mins elapsed</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground truncate flex-1">{o.restaurantName}</span>
                          {o.riderName ? (
                            <span className="text-emerald-600 font-medium whitespace-nowrap ml-2">{o.riderName}</span>
                          ) : (
                            <span className="text-rose-600 font-bold whitespace-nowrap ml-2">Unassigned</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="fleet" className="m-0 space-y-3 border-none outline-none">
                <div className="space-y-1 mb-4">
                  <div className="flex justify-between text-[10px] font-medium text-muted-foreground px-1">
                    <span>Available</span>
                    <span>{ridersAvailable.length}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-medium text-muted-foreground px-1">
                    <span>On Delivery</span>
                    <span>{ridersOnDelivery.length}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  {ridersOnline.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center p-4">No riders online</p>
                  ) : (
                    ridersOnline.map(r => (
                      <div key={r.id} className="p-3 border border-border/50 rounded-xl bg-card hover:border-primary/30 transition-colors group cursor-pointer flex justify-between items-center">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="relative shrink-0">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs uppercase">
                              {(r.name || "R").substring(0,2)}
                            </div>
                            <div className={cn(
                              "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
                              r.status === "on_delivery" || r.currentOrderId ? "bg-blue-500" : "bg-emerald-500"
                            )} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-xs truncate text-foreground">{r.name || "Delivery Partner"}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{r.phone}</p>
                          </div>
                        </div>
                        {r.phone ? (
                          <Button aria-label="Call"
                            asChild
                            variant="ghost"
                            size="icon"
                            className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          >
                            <a href={`tel:${r.phone}`} aria-label={`Call ${r.name || "this rider"}`}>
                              <Phone className="w-3.5 h-3.5 text-primary" />
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="kitchens" className="m-0 space-y-3 border-none outline-none">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <CookingPot className="w-3 h-3" /> Queue Load Metrics
                </h4>
                {kitchenBottlenecks.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground p-2">No significant bottlenecks detected.</p>
                ) : (
                  kitchenBottlenecks.map(venue => (
                    <div key={venue.id} className="p-3.5 rounded-xl border border-border/50 bg-card">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-semibold text-xs leading-tight text-foreground">{venue.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{venue.count} total active orders</p>
                        </div>
                        {venue.delayedCount > 0 && <Badge variant="destructive" className="text-[9px]">{venue.delayedCount} Delayed</Badge>}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[9px] font-medium text-muted-foreground">
                          <span>Kitchen Capacity</span>
                          <span>{Math.min(100, Math.round((venue.count / 15) * 100))}%</span>
                        </div>
                        <Progress value={Math.min(100, (venue.count / 15) * 100)} className={cn("h-1.5", venue.count >= 10 ? "bg-rose-100 [&>div]:bg-rose-500 dark:bg-rose-500/15" : "bg-amber-100 [&>div]:bg-amber-500 dark:bg-amber-500/15")} />
                      </div>

                      <div className="pt-3 mt-3 border-t border-border/50 flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] text-rose-600 hover:bg-rose-50 border-rose-200"
                          onClick={async () => {
                            // acceptingOrders is enforced in pricing/foodLoader,
                            // so this genuinely stops new orders reaching the
                            // kitchen. It takes the shop off the marketplace, so
                            // confirm first.
                            if (
                              !(await confirmDialog({
                                title: `Stop new orders reaching ${venue.name}?`,
                                description: `Their ${venue.count} active order(s) are unaffected, and new orders can be switched back on from the vendor page.`,
                                confirmLabel: "Pause new orders",
                                destructive: true,
                              }))
                            ) {
                              return;
                            }
                            runOp(
                              () =>
                                updateDoc(doc(db, "restaurants", venue.id), {
                                  acceptingOrders: false,
                                  pausedAt: serverTimestamp(),
                                  pausedBy: "dispatch",
                                }),
                              `${venue.name} is no longer taking new orders`,
                              { failure: `Couldn't pause ${venue.name}` },
                            );
                          }}
                        >
                          <Ban className="w-3 h-3 mr-1.5" /> Pause Orders
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>

            </div>
          </Tabs>
        </div>
      </div>

      {/* ── Order Inspection Drawer ────────────────────────────────────────── */}
      <EntityDrawer
        open={!!selectedOrder}
        onOpenChange={(open) => !open && setInspectingOrderId(null)}
        title={`Order #${selectedOrder?.orderNumber || selectedOrder?.id.slice(-6)}`}
        subtitle="Live Dispatch Override"
        icon={PackageCheck}
        status={selectedOrder?.status}
        statusTone={selectedOrder?.status === "pending" ? "warning" : "neutral"}
        detailPath={selectedOrder ? `/admin/orders/${selectedOrder.id}` : undefined}
        metrics={[
          { label: "Elapsed Time", value: `${getMinutesElapsed(selectedOrder?.timestamp || selectedOrder?.createdAt)} mins` },
          { label: "Amount", value: formatINR(selectedOrder?.total) },
          { label: "Restaurant", value: selectedOrder?.restaurantName || "Partner" },
        ]}
        actions={
          selectedOrder && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-amber-600 border-amber-600/30 hover:bg-amber-500/10" onClick={() => handleExpediteOrder(selectedOrder)}>
                <Flame className="w-4 h-4 mr-1.5" /> Flag Priority
              </Button>
            </div>
          )
        }
      >
        {selectedOrder && (
          <div className="space-y-6 pb-8">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Navigation className="w-4 h-4 text-primary" /> Route Information</h4>
              <div className="p-4 bg-muted/30 rounded-xl space-y-3 text-sm border border-border/60">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                    <Store className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-foreground truncate block">{selectedOrder.restaurantName}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">Pickup Location</p>
                  </div>
                  {/* The phone is on the restaurant document, not the order —
                      nothing ever stamps restaurantPhone onto an order, so
                      reading it there would render a button that never appears. */}
                  {restaurantMap.get(selectedOrder.restaurantId || "")?.phone ? (
                    <Button aria-label="Call" asChild variant="ghost" size="icon" className="w-8 h-8">
                      <a
                        href={`tel:${restaurantMap.get(selectedOrder.restaurantId || "")?.phone}`}
                        aria-label="Call the restaurant"
                      >
                        <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                      </a>
                    </Button>
                  ) : null}
                </div>

                <div className="pl-4 border-l-2 border-border h-4 ml-4 my-1" />

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-foreground truncate block">{selectedOrder.customerName}</span>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{selectedOrder.deliveryAddressText}</p>
                  </div>
                  {selectedOrder.customerPhone ? (
                    <Button aria-label="Call" asChild variant="ghost" size="icon" className="w-8 h-8">
                      <a href={`tel:${selectedOrder.customerPhone}`} aria-label="Call the customer">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Bike className="w-4 h-4 text-emerald-500" /> Fleet Assignment</h4>
              <div className="p-4 bg-muted/30 rounded-xl border border-border/60 space-y-4">
                {selectedOrder.riderName ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 font-bold">
                        {selectedOrder.riderName.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{selectedOrder.riderName}</p>
                        <p className="text-xs text-muted-foreground font-medium mt-0.5">{selectedOrder.riderPhone}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20">Assigned</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] px-2 text-rose-600 border-rose-200 hover:bg-rose-50"
                        disabled={isAssigning}
                        onClick={() => handleUnassign(selectedOrder)}
                      >
                        Unassign
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                        <Zap className="w-5 h-5 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Waiting for Dispatch</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">Auto-assign is searching for nearby riders. You can override and dispatch manually below.</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Select value={assignRiderId} onValueChange={setAssignRiderId}>
                        <SelectTrigger className="flex-1 text-xs h-9 bg-background">
                          <SelectValue placeholder="Choose an available rider..." />
                        </SelectTrigger>
                        <SelectContent>
                          {ridersAvailable.length === 0 && <SelectItem value="none" disabled>No riders available</SelectItem>}
                          {ridersAvailable.map(r => (
                            <SelectItem key={r.id} value={r.id}>{r.name || "Rider"} ({r.phone})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="h-9 shrink-0 shadow-sm" disabled={!assignRiderId || isAssigning} onClick={() => handleAssignRider(selectedOrder)}>
                        {isAssigning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <><Send className="w-3.5 h-3.5 mr-2" /> Dispatch</>}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Stage correction. Only forward moves are offered, because the
                server refuses a rewind: "un-picking-up" food the rider is
                carrying desynchronises their app from this board. To take an
                order off a rider, use Unassign above. */}
            {selectedOrder.riderId && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-sky-500" /> Delivery Stage
                </h4>
                <div className="p-4 bg-muted/30 rounded-xl border border-border/60 space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Currently{" "}
                    <span className="font-semibold text-foreground">
                      {STAGE_LABEL[(selectedOrder.deliveryStatus || "assigned").toLowerCase()] ??
                        selectedOrder.deliveryStatus}
                    </span>
                    . Use this only to catch up with what has already happened — the rider's app is
                    the source of truth. Handoff is completed by the rider with the customer's OTP.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {STAGE_CHAIN.slice(
                      STAGE_CHAIN.indexOf(
                        (selectedOrder.deliveryStatus || "assigned").toLowerCase() as typeof STAGE_CHAIN[number],
                      ) + 1,
                    ).map((stage) => (
                      <Button
                        key={stage}
                        size="sm"
                        variant="outline"
                        className="h-8 text-[11px]"
                        disabled={isAssigning}
                        onClick={() => handleAdvanceStage(selectedOrder, stage)}
                      >
                        {STAGE_LABEL[stage]}
                      </Button>
                    ))}
                    {STAGE_CHAIN.indexOf(
                      (selectedOrder.deliveryStatus || "assigned").toLowerCase() as typeof STAGE_CHAIN[number],
                    ) >= STAGE_CHAIN.length - 1 && (
                      <span className="text-[11px] text-muted-foreground">
                        At the customer — the rider completes the handoff.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><PackageCheck className="w-4 h-4 text-muted-foreground" /> Order Contents</h4>
              <div className="border border-border/60 rounded-xl divide-y divide-border/50 bg-background overflow-hidden">
                {selectedOrder.items?.map((item, idx) => (
                  <div key={idx} className="p-3.5 text-sm flex justify-between items-center hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                        {item.qty || item.quantity || 1}x
                      </div>
                      <span className="font-medium">{item.name}</span>
                    </div>
                    <span className="text-muted-foreground font-semibold">{formatINR(item.price)}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </EntityDrawer>
    </div>
  );
}
