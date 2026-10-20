import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { doc, onSnapshot, collection, query, where, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ShoppingBag,
  User,
  Store,
  Bike,
  CreditCard,
  MapPin,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  Entity360Header,
  Entity360Layout,
  Section,
  Fact,
  Timeline,
  StatusBadge,
  type Tone,
  type TimelineEvent,
} from "@/components/admin/entity360";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { adminActionToast } from "@/lib/admin-ops";
import { LoadingSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useAdminScope } from "@/hooks/useAdminScope";
import { ZoneBadge } from "@/components/admin/zones/ZoneScopeBar";
import { FoodWaterfall, RuleVersions, type FoodSnapshot } from "./pricing/PricingWaterfall";
import { ItemisedRefundDialog } from "./pricing/ItemisedRefundDialog";
import { BillTable, type AdminBillRow } from "@/components/admin/BillTable";

const inr = (n?: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;
const toDate = (ts: unknown): Date | null => {
  const v = ts as { toDate?: () => Date } | undefined;
  try {
    return v?.toDate?.() ?? null;
  } catch {
    return null;
  }
};

function statusTone(status?: string): Tone {
  const s = (status || "").toLowerCase();
  if (["delivered", "completed"].includes(s)) return "success";
  if (["cancelled", "canceled", "rejected", "failed"].includes(s)) return "danger";
  if (["out_for_delivery", "on_the_way", "picked_up", "ready"].includes(s)) return "info";
  if (["preparing", "accepted", "assigned"].includes(s)) return "warning";
  return "neutral";
}

const humanizeAction = (a?: string) =>
  (a || "Admin action")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

interface OrderDoc {
  orderNumber?: string;
  restaurantId?: string;
  restaurantName?: string;
  customerUid?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddressText?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  discount?: number;
  deliveryFee?: number;
  platformFee?: number;
  donation?: number;
  status?: string;
  type?: string;
  channel?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  timestamp?: unknown;
  items?: Array<{ name?: string; qty?: number; quantity?: number; price?: number }>;
  instructions?: string;
  riderId?: string;
  riderName?: string;
  riderPhone?: string;
  cancelReason?: string;
  cancelledBy?: string;
  cancelledAt?: unknown;
  /** Immutable price snapshot written by placeFoodOrder (pricing engine orders). */
  pricing?: FoodSnapshot;
  pricingCheck?: { ok?: boolean; source?: string };
  razorpayPaymentId?: string;
  refundStatus?: string;
  refundedLineQty?: Record<string, number>;
  refundedCharges?: string[];
  refundedTip?: boolean;
  refundedDonation?: boolean;
  /** The customer's bill as shown at checkout (functions/src/pricing/bill.ts). */
  bill?: { rows: AdminBillRow[]; totalPaise: number; savingsPaise: number } | null;
}

/** orders/{id}/finance/pricing — the money split, kept off the customer-readable order. */
interface OrderFinance {
  settlement?: FoodSnapshot["settlement"];
  vendorBill?: { rows: AdminBillRow[]; payoutPaise: number; memos?: AdminBillRow[] } | null;
}

interface AdminLog {
  id: string;
  action?: string;
  description?: string;
  timestamp?: unknown;
  actor?: string;
}

export default function Order360() {
  const { id = "" } = useParams();
  const { can } = usePermissions();
  const { zones = [] } = useAdminScope();
  const [order, setOrder] = useState<OrderDoc | null | undefined>(undefined);
  const [restaurant, setRestaurant] = useState<any>(null);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [finance, setFinance] = useState<OrderFinance | null>(null);

  const [refunding, setRefunding] = useState(false);

  useEffect(() => {
    if (!id) return;
    const unsubOrder = onSnapshot(
      doc(db, "orders", id),
      (snap) => setOrder(snap.exists() ? (snap.data() as OrderDoc) : null),
      () => setOrder(null),
    );
    const unsubLogs = onSnapshot(
      query(collection(db, "admin_logs"), where("orderId", "==", id), limit(100)),
      (snap) => setLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminLog, "id">) }))),
      () => setLogs([]),
    );
    const unsubFinance = onSnapshot(
      doc(db, "orders", id, "finance", "pricing"),
      (snap) => setFinance(snap.exists() ? (snap.data() as OrderFinance) : null),
      () => setFinance(null),
    );
    return () => {
      unsubOrder();
      unsubLogs();
      unsubFinance();
    };
  }, [id]);

  useEffect(() => {
    const restId = order?.restaurantId;
    if (!restId) {
      setRestaurant(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, "restaurants", restId),
      (snap) => setRestaurant(snap.exists() ? snap.data() : null),
      () => setRestaurant(null),
    );
    return () => unsub();
  }, [order?.restaurantId]);

  const effectiveRestaurantName = useMemo(() => {
    if (order?.restaurantName && order.restaurantName.trim() && order.restaurantName !== "Partner Restaurant" && order.restaurantName !== "Restaurant") {
      return order.restaurantName;
    }
    return restaurant?.name || restaurant?.restaurantName || order?.restaurantName || "Partner Restaurant";
  }, [order?.restaurantName, restaurant]);

  const effectiveZoneId = (order as any)?.zoneId || restaurant?.zoneId || null;
  const effectiveZoneName = useMemo(() => {
    if ((order as any)?.zoneName) return (order as any).zoneName;
    if (restaurant?.zoneName) return restaurant.zoneName;
    if (effectiveZoneId) {
      const z = zones.find((item) => item.id === effectiveZoneId);
      if (z?.name) return z.name;
    }
    return null;
  }, [order, restaurant, effectiveZoneId, zones]);

  const handleRefund = async (reason?: string) => {
    setRefunding(true);
    await adminActionToast(
      "refundOrder",
      { orderId: id, amount: order?.total, reason },
      "Order refunded successfully"
    );
    setRefunding(false);
  };

  const timeline = useMemo<TimelineEvent[]>(() => {
    if (!order) return [];
    const events: TimelineEvent[] = [];
    const placed = toDate(order.timestamp);
    if (placed) events.push({ time: placed, title: "Order placed", detail: order.paymentMethod ? `Payment: ${order.paymentMethod}` : undefined, tone: "info" });
    if (order.cancelledAt) {
      events.push({
        time: toDate(order.cancelledAt),
        title: "Order cancelled",
        detail: [order.cancelReason, order.cancelledBy && `by ${order.cancelledBy}`].filter(Boolean).join(" · ") || undefined,
        tone: "danger",
      });
    }
    for (const l of logs) {
      events.push({ time: toDate(l.timestamp), title: humanizeAction(l.action), detail: l.description, admin: true, tone: "admin" });
    }
    return events;
  }, [order, logs]);

  if (order === undefined) {
    return <LoadingSkeleton />;
  }
  if (order === null) {
    return (
      <div className="max-w-md mx-auto text-center py-24">
        <ShoppingBag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="text-lg font-semibold">Order not found</h2>
        <p className="text-sm text-muted-foreground mt-1">No order exists with id <code>{id}</code>.</p>
        <Link to="/admin/orders" className="text-sm text-primary hover:underline mt-3 inline-block">← Back to Orders</Link>
      </div>
    );
  }

  const items = order.items ?? [];
  const itemCount = items.reduce((s, it) => s + Number(it.qty ?? it.quantity ?? 1), 0);
  const fulfilment = order.type || order.channel || "—";

  return (
    <div className="space-y-6">
      <Entity360Header
        backTo="/admin/orders"
        backLabel="Orders"
        icon={ShoppingBag}
        title={`Order #${order.orderNumber || id.slice(-6)}`}
        subtitle={<span className="capitalize">{fulfilment} · {effectiveRestaurantName}</span>}
        status={order.status?.toUpperCase()}
        statusTone={statusTone(order.status)}
        metrics={[
          { label: "Order total", value: inr(order.total) },
          { label: "Items", value: itemCount },
          { label: "Payment", value: order.paymentStatus || "—", tone: order.paymentStatus === "paid" ? "success" : order.paymentStatus === "failed" ? "danger" : "neutral" },
          { label: "Method", value: (order.paymentMethod || "—").toUpperCase() },
          { label: "Delivery fee", value: inr(order.deliveryFee) },
          { label: "Placed", value: toDate(order.timestamp)?.toLocaleDateString("en-IN") ?? "—" },
        ]}
        actions={
          <>
            {can("refund") && order.paymentStatus !== "refunded" && (
              <ConfirmationDialog
                title={`Refund ${inr(order.total)}?`}
                description={`Refund ${inr(order.total)} to ${order.customerName || "the customer"} for order ${order.orderNumber ? `#${order.orderNumber}` : id.slice(-6)}. This cannot be undone.`}
                consequences={[
                  `${inr(order.total)} is returned to the customer's original payment method / wallet`,
                  "The order is marked refunded",
                  "This is recorded in the audit log",
                ]}
                requireReason
                reasonLabel="Reason for refund"
                confirmText={refunding ? "Refunding…" : "Refund order"}
                isDanger
                loading={refunding}
                onConfirm={handleRefund}
                trigger={<Button variant="destructive" size="sm" disabled={refunding}>{refunding ? "Refunding…" : "Refund Order"}</Button>}
              />
            )}
            {can("refund") && typeof order.pricing?.engineVersion === "string" && order.paymentStatus === "paid" && order.refundStatus !== "refunded" && (
              <ItemisedRefundDialog orderId={id} order={order as OrderDoc & { pricing: FoodSnapshot }} />
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!order.customerPhone}
              onClick={() => order.customerPhone && (window.location.href = `tel:${order.customerPhone}`)}
            >
              Contact Customer
            </Button>
            {order.restaurantId && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/admin/vendors/${order.restaurantId}`}>View Vendor</Link>
              </Button>
            )}
            <Button variant="outline" size="sm" asChild><Link to={`/admin/deliveries?order=${id}`}>View in Dispatch</Link></Button>
          </>
        }
      />

      <Entity360Layout
        main={
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="payment">Payment</TabsTrigger>
              <TabsTrigger value="money">Money breakdown</TabsTrigger>
              <TabsTrigger value="support">Support</TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview" className="space-y-6">
              <Section title={`Items (${items.length})`}>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No line items recorded.</p>
                ) : (
                  <ul className="divide-y divide-border/40">
                    {items.map((it, i) => (
                      <li key={i} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-foreground">
                          <span className="font-medium tabular-nums text-muted-foreground mr-2">{it.qty ?? it.quantity ?? 1}×</span>
                          {it.name || "Item"}
                        </span>
                        <span className="font-medium tabular-nums">{inr((Number(it.price) || 0) * Number(it.qty ?? it.quantity ?? 1))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Payment summary">
                <div className="space-y-0">
                  <Fact label="Subtotal">{inr(order.subtotal)}</Fact>
                  {Number(order.discount) > 0 && <Fact label="Discount">– {inr(order.discount)}</Fact>}
                  {Number(order.tax) > 0 && <Fact label="Tax">{inr(order.tax)}</Fact>}
                  <Fact label="Delivery fee">{inr(order.deliveryFee)}</Fact>
                  {Number(order.platformFee) > 0 && <Fact label="Platform fee">{inr(order.platformFee)}</Fact>}
                  {Number(order.donation) > 0 && <Fact label="Kada Cares donation">{inr(order.donation)}</Fact>}
                  <div className="flex items-center justify-between pt-3 mt-1">
                    <span className="text-sm font-semibold">Total</span>
                    <span className="text-base font-bold tabular-nums">{inr(order.total)}</span>
                  </div>
                </div>
              </Section>
            </TabsContent>

            <TabsContent value="timeline" className="space-y-6">
              <Section title="Timeline">
                <Timeline events={timeline} />
              </Section>
            </TabsContent>

            <TabsContent value="payment" className="space-y-6">
              <Section title="Payment Details">
                <Fact label="Payment Method">{(order.paymentMethod || "—").toUpperCase()}</Fact>
                <Fact label="Payment Status"><StatusBadge label={(order.paymentStatus || "—").toUpperCase()} tone={order.paymentStatus === "paid" ? "success" : order.paymentStatus === "failed" ? "danger" : "neutral"} /></Fact>
                <Fact label="Gateway Reference">{order.razorpayPaymentId || "—"}</Fact>
                <Fact label="Refund History">{"None"}</Fact>
              </Section>
            </TabsContent>

            <TabsContent value="money" className="space-y-6">
              {typeof order.pricing?.engineVersion === "string" ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Frozen when the order was placed (engine {order.pricing.engineVersion}). Later pricing rule changes never alter it.
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {order.bill && (
                      <BillTable
                        title="Customer's bill"
                        rows={order.bill.rows}
                        totalLabel={order.paymentStatus === "paid" ? "Customer paid" : "Customer to pay"}
                        totalPaise={order.bill.totalPaise}
                        footnote={order.bill.savingsPaise > 0 ? `Saved ₹${(order.bill.savingsPaise / 100).toFixed(2)} with offers and free fees.` : undefined}
                      />
                    )}
                    {finance?.vendorBill && (
                      <BillTable
                        title="Restaurant payout"
                        rows={finance.vendorBill.rows}
                        memos={finance.vendorBill.memos ?? []}
                        totalLabel="Payout for this order"
                        totalPaise={finance.vendorBill.payoutPaise}
                      />
                    )}
                  </div>
                  <FoodWaterfall
                    quote={
                      // Newer orders keep the split in finance/pricing, not on the order.
                      order.pricing.settlement || !finance?.settlement
                        ? order.pricing
                        : { ...order.pricing, settlement: finance.settlement }
                    }
                  />
                  <RuleVersions versions={order.pricing.ruleVersions} />
                </>
              ) : (
                <Section title="Money breakdown">
                  <p className="text-sm text-muted-foreground">
                    This order was placed before the pricing engine, so it has no price snapshot. The payment summary shows what the app recorded
                    {order.pricingCheck?.ok ? "; the server re-checked that total before taking payment." : "."}
                  </p>
                </Section>
              )}
            </TabsContent>

            <TabsContent value="support" className="space-y-6">
              <Section title="Support Tickets">
                <p className="text-sm text-muted-foreground">No active support tickets for this order.</p>
              </Section>
            </TabsContent>
          </Tabs>
        }
        rail={
          <>
            <Section title="Related">
              <div className="space-y-3">
                <RelatedRow icon={User} label="Customer" value={order.customerName || "Guest"} sub={order.customerPhone} to={order.customerUid ? `/admin/customers/${order.customerUid}` : undefined} />
                <RelatedRow icon={Store} label="Vendor" value={effectiveRestaurantName} sub={effectiveZoneName ? `Zone: ${effectiveZoneName}` : undefined} to={order.restaurantId ? `/admin/vendors/${order.restaurantId}` : undefined} />
                <RelatedRow icon={Bike} label="Rider" value={order.riderName || "Unassigned"} sub={order.riderPhone} to={order.riderId ? `/admin/delivery/${order.riderId}` : "/admin/orders?tab=live"} />
              </div>
            </Section>

            <Section title="Fulfilment">
              <Fact label="Type"><span className="capitalize">{fulfilment}</span></Fact>
              <Fact label="Zone"><ZoneBadge zoneId={effectiveZoneId} zoneName={effectiveZoneName} /></Fact>
              <Fact label="Status"><StatusBadge label={order.status?.toUpperCase() || "—"} tone={statusTone(order.status)} /></Fact>
              {order.deliveryAddressText && (
                <div className="flex items-start gap-2 pt-2 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{order.deliveryAddressText}</span>
                </div>
              )}
              {order.instructions && <p className="text-xs text-muted-foreground mt-2 italic">“{order.instructions}”</p>}
            </Section>

            <Section title="Payment">
              <Fact label="Method"><span className="uppercase">{order.paymentMethod || "—"}</span></Fact>
              <Fact label="Status"><StatusBadge label={(order.paymentStatus || "—").toUpperCase()} tone={order.paymentStatus === "paid" ? "success" : order.paymentStatus === "failed" ? "danger" : "neutral"} /></Fact>
              <Fact label="Charged"><CreditCard className="h-3.5 w-3.5 inline mr-1 text-muted-foreground" />{inr(order.total)}</Fact>
            </Section>
          </>
        }
      />
    </div>
  );
}

function RelatedRow({ icon: Icon, label, value, sub, to }: { icon: typeof User; label: string; value: string; sub?: string; to?: string }) {
  const body = (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground truncate">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground truncate">{sub}</p>}
      </div>
      {to && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-lg -mx-1 px-1 py-1 hover:bg-muted/40 transition-colors">
      {body}
    </Link>
  ) : (
    <div className="px-1 py-1">{body}</div>
  );
}
