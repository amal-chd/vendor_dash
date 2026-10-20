import { cn } from "@/lib/utils";
import {
  Clock, Check, ChefHat, Bell, AlertCircle,
  Timer, Users, ArrowRight, CheckCircle2,
  Filter, MoreHorizontal, LayoutDashboard,
  Zap, Flame, PlayCircle
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FeatureGate } from "@/components/FeatureGate";
import { db } from "@/lib/firebase";
import { isAwaitingOnlinePayment, transitionOrder } from "@/lib/orderActions";
import { toast } from "sonner";
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy, Timestamp, limit } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";

type KitchenOrder = {
  id: string;
  table: string;
  orderNumber: string;
  timestamp: Timestamp | Date | null;
  elapsed: number;
  priority: 'normal' | 'high' | 'rush';
  items: { name: string; qty: number; done: boolean; station: string }[];
  status: "new" | "preparing" | "ready" | "completed" | "cancelled";
  customerName?: string;
};

const transition = { duration: 0.4, ease: [0.2, 0, 0, 1] as const };

const columns: { label: string; status: KitchenOrder["status"]; borderColor: string; dotColor: string; bgTint: string }[] = [
  { label: "New Orders", status: "new", borderColor: "border-blue-500", dotColor: "bg-blue-500", bgTint: "bg-blue-500/5 border-blue-500/20" },
  { label: "Cooking", status: "preparing", borderColor: "border-orange-500", dotColor: "bg-orange-500", bgTint: "bg-orange-500/5 border-orange-500/20" },
  { label: "Ready", status: "ready", borderColor: "border-emerald-500", dotColor: "bg-emerald-500", bgTint: "bg-emerald-500/5 border-emerald-500/20" },
];

export default function KitchenPage() {
  const { user, restaurantId , activeRestaurantId } = useAuth();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [tableNames, setTableNames] = useState<Record<string, string>>({});
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<KitchenOrder["status"]>("new");

  const normalizeStatus = (status: string): KitchenOrder["status"] => {
    const value = status?.toLowerCase() || '';
    switch (value) {
      case 'preparing':
      case 'cooking':
      case 'in_progress':
      case 'inprogress':
      case 'accepted':
        return 'preparing';
      case 'ready':
      case 'prepared':
        return 'ready';
      case 'completed':
      case 'delivered':
      case 'done':
        return 'completed';
      case 'cancelled':
      case 'canceled':
      case 'void':
        return 'cancelled';
      case 'new':
      case 'neworder':
      case 'new_order':
      case 'pending':
      case 'placed':
      case 'created':
      default:
        return 'new';
    }
  };

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "tables"),
      where("restaurantId", "==", activeRestaurantId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const mapping: Record<string, string> = {};
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        mapping[doc.id] = data.name || data.label || doc.id;
      });
      setTableNames(mapping);
    }, (err) => console.error("[KitchenPage] q listener failed", err));
    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }

    const parseTimestamp = (value: any) => {
      if (!value) return new Date();
      if (value instanceof Timestamp) return value.toDate();
      if (value instanceof Date) return value;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    };

    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", activeRestaurantId),
      limit(200)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      // Unpaid online orders aren't real until the payment lands.
      let ordersData = snapshot.docs.filter((d) => !isAwaitingOnlinePayment(d.data())).map(doc => {
        const data = doc.data();
        const timestamp = parseTimestamp(data.timestamp);
        const elapsed = Math.floor((new Date().getTime() - timestamp.getTime()) / 60000);
        const rawStatus = (data.status ?? "new").toString();
        const status = normalizeStatus(rawStatus);

        return {
          id: doc.id,
          ...data,
          elapsed,
          priority: data.priority || (elapsed > 10 ? 'rush' : elapsed > 5 ? 'high' : 'normal'),
          status,
          table: tableNames[data.table] ?? data.table ?? data.tableLabel ?? "Takeaway",
          customerName: data.customerName ?? data.customer ?? "Guest",
          items: (data.items || []).map((item: { name: string; qty?: number; quantity?: number; done?: boolean; station?: string }) => ({
            ...item,
            name: item.name ?? "Item",
            qty: Number(item.qty ?? item.quantity ?? 1) || 1,
            done: !!item.done,
            station: item.station || 'General'
          }))
        } as KitchenOrder;
      });

      // Filter out completed/cancelled, and sort descending by timestamp client side to be earliest first
      ordersData = ordersData.filter(o => o.status === "new" || o.status === "preparing" || o.status === "ready");
      ordersData.sort((a, b) => {
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime();
      });

      const next = ordersData;
      setOrders(next);
      if (next.length > 0 && !selectedOrderId) setSelectedOrderId(next[0].id);
      setLoading(false);
    }, (err) => {
      console.error("Kitchen sync failed:", err);
      setOrders([]);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, selectedOrderId, tableNames, activeRestaurantId]);

  const toggleItem = async (orderId: string, itemIdx: number) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const updatedItems = order.items.map((item, index) =>
      index === itemIdx ? { ...item, done: !item.done } : item
    );

    try {
      if (orderId.startsWith("demo_")) {
        setOrders((prev) =>
          prev.map((o) => {
            if (o.id === orderId) {
              return { ...o, items: updatedItems, status: o.status === "new" ? "preparing" : o.status };
            }
            return o;
          }),
        );
        return;
      }

      // Optimistically update the item checked state and status locally
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== orderId) return o;
          return {
            ...o,
            items: updatedItems,
            status: o.status === "new" ? "preparing" : o.status,
          };
        }),
      );

      // Item progress is a plain field write; starting the order is a status
      // change and goes through the server like every other transition.
      await updateDoc(doc(db, "orders", orderId), { items: updatedItems });
      if (order.status === "new") {
        const result = await transitionOrder(orderId, "preparing", {
          restaurantId: activeRestaurantId || undefined,
        });
        if (!result.ok) toast.error(result.message);
      }
    } catch (error) {
      console.error("Error updating item:", error);
      toast.error("Couldn't save that item. Check your connection and try again.");
    }
  };

  const moveStatus = async (orderId: string, newStatus: KitchenOrder["status"]) => {
    // Save previous state for rollback
    const previousOrders = orders;

    // OPTIMISTIC UPDATE: Instantly move the ticket in KDS (0ms perceived latency)
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));

    try {
      if (orderId.startsWith("demo_")) {
        return;
      }
      // Server-validated: a stale screen can no longer reopen a cancelled
      // order, and a refusal is shown instead of only logged to the console.
      const result = await transitionOrder(orderId, newStatus, {
        restaurantId: activeRestaurantId || undefined,
      });
      if (!result.ok) {
        // Rollback
        setOrders(previousOrders);
        toast.error(result.message);
      }
    } catch (error) {
      // Rollback
      setOrders(previousOrders);
      console.error("Error updating status:", error);
      toast.error("Couldn't update this order. Check its status, then try again.");
    }
  };

  const avgWaitTime = useMemo(() =>
    orders.length > 0
      ? Math.round(orders.reduce((acc, o) => acc + o.elapsed, 0) / orders.length)
      : 0,
    [orders]
  );

  const printKOT = (order: KitchenOrder) => {
    const printWindow = window.open('', '', 'width=450,height=800');
    if (!printWindow) return;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>KOT #${order.orderNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: monospace; font-size: 14px; padding: 16px; max-width: 320px; }
          h2 { font-size: 20px; font-weight: bold; text-align: center; margin-bottom: 4px; border: 2px solid #000; padding: 4px; display: inline-block; }
          .center { text-align: center; margin-bottom: 8px; }
          .meta { font-size: 12px; margin-bottom: 12px; }
          hr { border: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; text-align: left; margin-bottom: 12px; border-collapse: collapse; }
          th, td { padding: 6px 0; vertical-align: top; }
          th { font-size: 12px; text-transform: uppercase; border-bottom: 1px solid #000; }
          td.qty { font-weight: bold; font-size: 16px; text-align: center; width: 40px; }
          .footer { text-align: center; font-size: 10px; margin-top: 12px; }
          @media print { @page { margin: 4mm; } }
        </style>
      </head>
      <body>
        <div class="center">
          <h2>KOT</h2>
        </div>
        <div class="meta">
          <div><strong>Order:</strong> #${order.orderNumber}</div>
          <div><strong>Table:</strong> ${order.table}</div>
          <div><strong>Guest:</strong> ${order.customerName || 'Guest'}</div>
          <div><strong>Time:</strong> ${new Date().toLocaleTimeString()}</div>
        </div>
        <hr/>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align:center">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${order.items.map(item => `
              <tr>
                <td style="padding-right: 8px;">${item.name}</td>
                <td class="qty">${item.qty}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <hr/>
        <div class="footer">Printed at ${new Date().toLocaleString()}</div>
        <script>
          window.onload = () => {
            setTimeout(() => {
              window.print();
            }, 400);
          }
        </script>
      </body>
      </html>
    `;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) || null,
    [orders, selectedOrderId],
  );

  return (
    <div className="space-y-6 lg:space-y-8 pb-20 lg:pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mt-2">
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
            Kitchen <span className="text-primary">KDS</span>
          </h1>
          <p className="text-sm text-muted-foreground font-medium flex items-center gap-2">
            <ChefHat className="w-4 h-4" /> Managing live flow
          </p>
        </div>
      </div>

      <FeatureGate capability="predictive_kds">
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          
          {/* Mobile Status Tabs */}
          <div className="lg:hidden flex w-full border-b border-border/20 bg-background/80 backdrop-blur-md sticky top-0 z-20 -mx-4 px-4 overflow-x-auto hide-scrollbar">
            {columns.map((column) => (
              <button
                key={column.status}
                onClick={() => setActiveTab(column.status)}
                className={cn(
                  "flex-1 min-w-[100px] py-4 text-xs font-semibold uppercase tracking-wider transition-all relative flex flex-col items-center gap-2",
                  activeTab === column.status ? "text-primary" : "text-muted-foreground/60"
                )}
              >
                <div className="flex items-center gap-2">
                  {column.label}
                  <span className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm",
                    activeTab === column.status ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}>
                    {orders.filter(o => o.status === column.status).length}
                  </span>
                </div>
                {activeTab === column.status && (
                  <motion.div layoutId="kitchenTab" className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t-full" />
                )}
              </button>
            ))}
          </div>

          {/* KDS Pipeline */}
          <div className="w-full lg:col-span-9 grid grid-cols-1 lg:grid-cols-3 gap-6 lg:min-h-[70vh]">
            {columns.map((column) => {
              const columnOrders = orders.filter((o) => o.status === column.status);
              const isVisible = activeTab === column.status;

              return (
                <div key={column.status} className={cn(
                  "flex flex-col gap-4 lg:flex rounded-2xl p-4 lg:p-6 border transition-colors bg-card shadow-sm",
                  isVisible ? "flex" : "hidden lg:flex"
                )}>
                  <div className="hidden lg:flex items-center justify-between pb-4 border-b border-border/20 mb-2">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-2.5 h-2.5 rounded-full", column.dotColor)} />
                      <h2 className="text-lg font-bold text-foreground">{column.label}</h2>
                    </div>
                    <Badge variant="secondary" className="rounded-lg h-7 px-3 font-semibold text-xs">{columnOrders.length}</Badge>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto hide-scrollbar pb-10">
                    <AnimatePresence mode="popLayout">
                      {columnOrders.map((order, i) => (
                        <motion.div
                          key={order.id}
                          layout
                          initial={{ opacity: 0, y: 10, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ ...transition, delay: i * 0.05 }}
                          onClick={() => setSelectedOrderId(order.id)}
                          className={cn(
                            "group bg-card rounded-xl border-2 transition-all cursor-pointer p-4 sm:p-5 relative shadow-sm",
                            selectedOrderId === order.id ? `ring-2 ring-primary border-primary` : "border-border/40 hover:border-primary/40",
                            order.priority === 'rush' && "bg-destructive/5 border-destructive/20"
                          )}
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "h-10 px-3 rounded-lg flex items-center justify-center font-bold text-sm border",
                                column.status === 'new' ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : 
                                column.status === 'preparing' ? "bg-orange-500/10 text-orange-500 border-orange-500/20" :
                                "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              )}>
                                #{order.orderNumber}
                              </div>
                              <div>
                                <p className="text-base font-bold text-foreground truncate max-w-[120px] sm:max-w-[160px]">{order.customerName || order.table}</p>
                                <p className="text-xs font-medium text-muted-foreground mt-0.5">{order.table} • {order.items.reduce((s, i) => s + i.qty, 0)} Items</p>
                              </div>
                            </div>
                            <div className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-bold text-xs shadow-sm",
                              order.elapsed > 15 ? "bg-destructive/10 text-destructive border-destructive/30 animate-pulse" : "bg-muted text-foreground border-border/40"
                            )}>
                              <Clock className="w-3.5 h-3.5" /> {order.elapsed}m
                            </div>
                          </div>

                          <div className="space-y-3 pt-4 border-t border-border/10">
                            {order.items.map((item, idx) => (
                              <div key={idx} className="flex items-start gap-3 group/item">
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleItem(order.id, idx); }}
                                  className={cn(
                                    "w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all shrink-0 mt-0.5",
                                    item.done ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border hover:border-primary hover:bg-primary/5"
                                  )}
                                >
                                  {item.done && <Check className="w-4 h-4" />}
                                </button>
                                <div className="flex-1 min-w-0 flex items-start gap-2.5">
                                   <span className={cn(
                                     "font-bold text-xs px-2 py-0.5 rounded-md shrink-0 border",
                                     item.done ? "bg-muted text-muted-foreground border-transparent" : "bg-primary/10 text-primary border-primary/20"
                                   )}>{item.qty}×</span>
                                   <p className={cn(
                                      "text-sm font-semibold transition-all break-words leading-tight", 
                                      item.done ? "line-through text-muted-foreground opacity-60" : "text-foreground"
                                   )}>
                                     {item.name}
                                   </p>
                                </div>
                              </div>
                            ))}
                          </div>

                          {order.priority === 'rush' && (
                            <div className="mt-4 pt-3 border-t border-destructive/20 flex items-center gap-1.5 text-xs font-bold text-destructive uppercase tracking-wider">
                              <Zap className="w-3.5 h-3.5 fill-destructive" /> Urgent Priority
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {columnOrders.length === 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="h-full min-h-[200px] flex flex-col items-center justify-center text-center border-2 border-dashed border-border/40 rounded-xl bg-muted/20"
                      >
                        <ChefHat className="w-10 h-10 mb-3 text-muted-foreground/50" />
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Lane Clear</p>
                      </motion.div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Panel */}
          <div className="lg:col-span-3 space-y-6 lg:sticky lg:top-8 w-full">
            <Card className="rounded-2xl border-border/40 shadow-sm bg-card overflow-hidden">
              <CardHeader className="p-6 pb-4 border-b border-border/20">
                <CardTitle className="text-lg font-bold">Order Action</CardTitle>
                <CardDescription className="text-sm">Manage Selected Order</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="bg-muted p-5 rounded-xl border border-border/40 shadow-sm">
                  <p className="text-xs font-semibold text-muted-foreground mb-3">Selected Ticket</p>
                  {selectedOrder ? (
                    <>
                      <p className="text-3xl font-bold text-foreground mb-1">#{selectedOrder.orderNumber}</p>
                      <p className="text-sm font-medium text-primary">For {selectedOrder.table}</p>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground py-2">Select a ticket to begin</p>
                  )}
                </div>

                <div className="space-y-3">
                  {selectedOrder?.status === 'new' && (
                    <Button
                      className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm shadow-sm gap-2"
                      onClick={() => moveStatus(selectedOrder.id, 'preparing')}
                    >
                      Start Cooking <Flame className="w-4 h-4" />
                    </Button>
                  )}
                  {selectedOrder?.status === 'preparing' && (
                    <Button
                      className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm shadow-sm gap-2"
                      onClick={() => moveStatus(selectedOrder.id, 'ready')}
                    >
                      Mark as Ready <CheckCircle2 className="w-4 h-4" />
                    </Button>
                  )}
                  {selectedOrder?.status === 'ready' && (
                    <Button
                      className="w-full h-12 rounded-xl bg-foreground text-background hover:bg-foreground/90 font-bold text-sm shadow-sm gap-2"
                      onClick={() => moveStatus(selectedOrder.id, 'completed')}
                    >
                      Finish & Archive <PlayCircle className="w-4 h-4" />
                    </Button>
                  )}
                  {!selectedOrder && (
                     <Button disabled className="w-full h-12 rounded-xl font-bold text-sm bg-muted text-muted-foreground">
                        Awaiting Selection
                     </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-6 border-t border-border/20">
                  <Button variant="outline" disabled={!selectedOrder} onClick={() => selectedOrder && printKOT(selectedOrder)} className="rounded-xl h-11 font-semibold text-xs border-border/40 hover:bg-muted">Reprint</Button>
                  <Button variant="outline" disabled={!selectedOrder} className="rounded-xl h-11 font-semibold text-xs border-destructive/30 text-destructive hover:bg-destructive/10">Cancel</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </FeatureGate>
    </div>
  );
}
