import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Filter, ShoppingBag, Clock, User,
  ChevronRight, MoreVertical, CheckCircle2,
  XCircle, Printer, Download, ArrowUpRight,
  CreditCard, LayoutGrid, List, SlidersHorizontal,
  Utensils, Calendar, MapPin, Phone, Navigation, CalendarClock
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import {
  collection, query, where, orderBy, limit,
  onSnapshot, doc, getDoc, updateDoc, Timestamp, serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cancelTargetFor, isAwaitingOnlinePayment, transitionOrder } from "@/lib/orderActions";
import { useAuth } from "@/hooks/useAuth";
import { cn, getTaxLabel } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCurrency } from "@/lib/currency";
import { PageLoading } from "@/components/dashboard/PageLoading";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface OrderItem {
  name: string;
  qty: number;
  price: number;
  instructions?: string;
  variants?: any;
  notes?: string;
}

interface Order {
  id: string;
  orderNumber: string;
  customerName?: string;
  customerPhone?: string;
  table: string;
  total: number;
  status: string;
  type: 'dine-in' | 'takeaway' | 'delivery';
  paymentStatus: 'pending' | 'paid';
  paymentMethod?: string;
  timestamp: Timestamp | Date | null;
  items: OrderItem[];
  instructions?: string;
  subtotal?: number;
  tax?: number;
  discount?: number;
  taxLabel?: string;
  taxMethod?: 'inclusive' | 'exclusive' | string;
  taxPercentage?: number;
  deliveryAddressText?: string;
  deliveryAddress?: {
    line1?: string;
    area?: string;
    landmark?: string;
    pincode?: string;
    gps?: { lat: number; lng: number } | null;
    gpsLabel?: string;
  };
  riderId?: string;
  riderName?: string;
  riderPhone?: string;
  riderVehicle?: string;
  deliveryStatus?: string;
  assignedAt?: Timestamp | Date | null;
  scheduledFor?: Timestamp | Date | null;
  fulfillmentType?: 'now' | 'scheduled' | string;
}

const transition = { duration: 0.4, ease: [0.2, 0, 0, 1] as const };

const normalizeStatus = (status: string): string => {
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
      return 'new';
    case 'scheduled':
      return 'scheduled';
    default:
      return 'new';
  }
};

export default function OrdersPage() {
  const { user, activeRestaurantId } = useAuth();
  const { format, symbol, locale } = useCurrency();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<string>("new");
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [initialLoading, setInitialLoading] = useState(true);
  const [restaurant, setRestaurant] = useState<{
    name?: string;
    address?: string;
    phone?: string;
    enableTax?: boolean;
    taxPercentage?: number;
    taxId?: string;
    logoUrl?: string;
    taxLabel?: string;
    taxMethod?: 'inclusive' | 'exclusive' | string;
    countryCode?: string;
  } | null>(null);

  useEffect(() => {
    if (!user) {
      setRestaurant({ name: "Your Restaurant", address: "", phone: "" });
      setOrders([]);
      return;
    }
    const fetchRestaurant = async () => {
      try {
        const docRef = doc(db, "restaurants", activeRestaurantId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setRestaurant(docSnap.data());
        }
      } catch (e) {
        console.error("Error fetching restaurant:", e);
      }
    };
    fetchRestaurant();
  }, [user, activeRestaurantId]);

  useEffect(() => {
    if (!user) return;

    const parseTimestamp = (value: any) => {
      if (!value) return new Date();
      if (value instanceof Timestamp) return value.toDate();
      if (value instanceof Date) return value;
      if (typeof value === "string") return new Date(value);
      if (value.seconds) return new Date(value.seconds * 1000);
      return new Date();
    };

    const sevenDaysAgo = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", activeRestaurantId),
      where("timestamp", ">=", sevenDaysAgo),
      orderBy("timestamp", "desc"),
      limit(500),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      // Unpaid online orders aren't real until the payment lands.
      const ordersData = snapshot.docs.filter((d) => !isAwaitingOnlinePayment(d.data())).map(doc => {
        const data = doc.data();
        const rawItems = Array.isArray(data.items) ? data.items : [];
        const normalizedItems: OrderItem[] = rawItems.map((item: any) => {
          if (item && typeof item === "object") {
            const qty = Number(item.qty ?? item.quantity ?? 1) || 1;
            return {
              name: String(item.name ?? "Item"),
              qty,
              price: Number(item.price ?? 0) || 0,
              instructions: item.instructions ?? item.notes ?? undefined,
              variants: item.variants,
              notes: item.notes
            };
          }
          return { name: String(item ?? "Item"), qty: 1, price: 0 };
        });

        // Never show "paid" without a recorded payment: a missing status used
        // to render as paid (e.g. every web POS KOT ticket).
        const paymentStatus = data.paymentStatus ?? "pending";
        const total = Number(data.total ?? data.totalAmount ?? 0) || 0;
        const rawStatus = String(data.status ?? "new");
        const status = normalizeStatus(rawStatus);
        const table = data.table ?? data.tableLabel ?? "Takeaway";
        const typeRaw = (data.type ?? data.channel ?? "dine-in").toString().toLowerCase();
        const type: Order["type"] = typeRaw === "delivery" ? "delivery" : typeRaw === "takeaway" || typeRaw === "pickup" ? "takeaway" : "dine-in";

        return {
          id: doc.id,
          ...data,
          total,
          status,
          table,
          type,
          items: normalizedItems,
          paymentStatus,
          timestamp: parseTimestamp(data.timestamp),
          deliveryAddressText: data.deliveryAddressText,
          deliveryAddress: data.deliveryAddress,
          riderId: data.riderId,
          riderName: data.riderName,
          riderPhone: data.riderPhone,
          riderVehicle: data.riderVehicle,
          deliveryStatus: data.deliveryStatus,
          assignedAt: data.assignedAt ? parseTimestamp(data.assignedAt) : null,
        } as Order;
      });

      ordersData.sort((a, b) => {
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return (b.timestamp as Date).getTime() - (a.timestamp as Date).getTime();
      });

      setOrders(ordersData);
      setInitialLoading(false);
    }, (err) => {
      console.error("Orders sync failed:", err);
      setOrders([]);
      setInitialLoading(false);
    });

    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", activeRestaurantId),
      where("status", "==", "new"),
      orderBy("timestamp", "desc")
    );

    let isInitialLoad = true;
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (isInitialLoad) {
        isInitialLoad = false;
        return;
      }
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const newOrder = change.doc.data() as Order;
          const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
          audio.play().catch(e => console.warn("Audio play failed:", e));
          toast.success("New Order Received!", {
            description: `Order #${newOrder.orderNumber} from ${newOrder.customerName || 'Guest'}`,
            action: {
              label: "View",
              onClick: () => setSelectedOrder({ id: change.doc.id, ...newOrder } as Order)
            },
            duration: 8000,
          });
        }
      });
    }, (err) => console.error("[OrdersPage] q listener failed", err));

    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    let to = newStatus;
    let reason: string | undefined;
    if (newStatus === "cancelled") {
      const current = orders.find((o) => o.id === orderId)?.status;
      to = cancelTargetFor(current);
      // The reason is shown to the customer and kept on the audit trail.
      const entered = window.prompt(
        to === "rejected" ? "Why are you rejecting this order?" : "Why are you cancelling this order?",
      );
      if (entered === null) return;
      reason = entered.trim();
      if (reason.length < 3) {
        toast.error("Please give a short reason (at least 3 characters). Nothing was changed.");
        return;
      }
    }

    if (orderId.startsWith("demo_")) {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: to } : o)));
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: to });
      }
      toast.success("Order status updated");
      return;
    }

    // Save previous state for graceful rollback if server refuses or fails
    const previousOrders = orders;
    const previousSelectedOrder = selectedOrder;

    // OPTIMISTIC UPDATE: Instantly reflect the change in the UI (0ms latency)
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: to } : o)));
    if (selectedOrder && selectedOrder.id === orderId) {
      setSelectedOrder({ ...selectedOrder, status: to });
    }

    // Fast direct Firestore write so other devices / screens / KDS see it instantly without lag
    updateDoc(doc(db, "orders", orderId), {
      status: to,
      updatedAt: serverTimestamp(),
      ...(to === "preparing" ? { acceptedAt: serverTimestamp() } : {}),
    }).catch(() => {});

    try {
      const result = await transitionOrder(orderId, to, {
        reason,
        restaurantId: activeRestaurantId || undefined,
      });
      if (result.ok) {
        toast.success(result.message);
      } else {
        // Rollback
        setOrders(previousOrders);
        setSelectedOrder(previousSelectedOrder);
        toast.error(result.message);
      }
    } catch (error) {
      // Rollback
      setOrders(previousOrders);
      setSelectedOrder(previousSelectedOrder);
      console.error("Error updating order:", error);
      toast.error("Couldn't update this order. Check its status, then try again.");
    }
  };

  const printReceipt = (order: Order) => {
    const printWindow = window.open('', '', 'width=450,height=800');
    if (!printWindow) return;

    const shopName = restaurant?.name || "KADA RESTAURANT";
    const shopAddress = restaurant?.address || "Premium Dining Experience";
    const shopPhone = restaurant?.phone || "+91 XXXXXXXXXX";
    const shopLogo = restaurant?.logoUrl || "/logo.png";
    const taxId = restaurant?.taxId || "";

    const taxLabel = order.taxLabel || restaurant?.taxLabel || getTaxLabel(restaurant?.countryCode);
    const isInclusive = order.taxMethod === "inclusive" || (order.taxMethod === undefined && restaurant?.taxMethod === "inclusive");
    const taxPct = typeof order.taxPercentage === "number" ? order.taxPercentage : (restaurant?.taxPercentage ?? 5);

    const savedSubtotal = typeof order.subtotal === "number" ? order.subtotal : null;
    const savedTax = typeof order.tax === "number" ? order.tax : null;
    const savedDiscount = typeof order.discount === "number" ? order.discount : 0;

    const subtotal = savedSubtotal !== null ? savedSubtotal : (isInclusive ? order.total - (savedTax || 0) : order.items.reduce((sum, item) => sum + (item.price * item.qty), 0));
    const tax = savedTax !== null ? savedTax : (restaurant?.enableTax ? (isInclusive ? order.total - subtotal : order.total - subtotal) : 0);
    const discount = savedDiscount;

    const itemsHtml = order.items.map((item: OrderItem) => `
      <tr class="item-row">
        <td class="qty-col">
          <div class="qty-capsule">${item.qty}</div>
        </td>
        <td class="desc">
          <div class="name">${item.name}</div>
          ${item.instructions ? `<div class="notes">${item.instructions}</div>` : ''}
          <div class="unit-price">${format(item.price)} / unit</div>
        </td>
        <td class="price">${format(item.price * item.qty)}</td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt - ${order.orderNumber}</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: 'Inter', sans-serif; 
            background: #fff; 
            color: #1a1a1a; 
            padding: 30px; 
            max-width: 400px; 
            margin: auto;
            line-height: 1.4;
          }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { 
            width: 70px; 
            height: 70px; 
            object-fit: cover; 
            border-radius: 100%; 
            margin-bottom: 15px;
            border: 2px solid #f0f0f0;
          }
          .brand-name { 
            font-family: 'Outfit', sans-serif; 
            font-size: 26px; 
            font-weight: 900; 
            letter-spacing: -0.5px; 
            text-transform: uppercase;
            margin-bottom: 4px;
            color: #000;
          }
          .brand-tagline { 
            font-size: 9px; 
            font-weight: 800; 
            color: #999; 
            text-transform: uppercase; 
            letter-spacing: 3px;
          }
          
          .shop-details { margin: 20px 0; font-size: 11px; color: #555; font-weight: 600; }
          .shop-details p { margin-bottom: 3px; }
          
          .bill-info { 
            display: flex; 
            justify-content: space-between; 
            padding: 15px 0; 
            border-top: 1.5px solid #000; 
            border-bottom: 1.5px solid #f0f0f0;
            margin-bottom: 25px;
          }
          .info-block h4 { font-size: 8px; font-weight: 900; color: #bbb; text-transform: uppercase; margin-bottom: 4px; }
          .info-block p { font-size: 12px; font-weight: 800; color: #000; }
          
          table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
          th { text-align: left; font-size: 9px; font-weight: 900; color: #aaa; text-transform: uppercase; padding-bottom: 12px; border-bottom: 2px solid #000; }
          .item-row td { padding: 15px 0; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
          .qty-col { width: 50px; }
          .qty-capsule { 
            display: inline-flex; 
            align-items: center; 
            justify-content: center; 
            background: #000; 
            color: #fff; 
            font-size: 11px; 
            font-weight: 900; 
            padding: 4px 10px; 
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          }
          .name { font-weight: 800; font-size: 14px; text-transform: uppercase; margin-bottom: 4px; letter-spacing: -0.2px; }
          .notes { font-size: 10px; color: #999; font-style: italic; margin-bottom: 4px; }
          .unit-price { font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; }
          .price { text-align: right; font-weight: 900; font-size: 15px; color: #000; font-family: 'Outfit', sans-serif; }
          
          .summary { margin-top: 10px; }
          .summary-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; color: #444; font-weight: 600; }
          .summary-row.total { 
            margin-top: 15px; 
            padding: 15px 0; 
            border-top: 2.5px solid #000; 
            border-bottom: 1px solid #000;
            color: #000; 
            font-size: 22px; 
            font-weight: 900; 
            font-family: 'Outfit', sans-serif;
          }
          .tax-id { font-size: 9px; color: #999; font-weight: 700; margin-top: 8px; }
          
          .footer { text-align: center; margin-top: 50px; padding-top: 30px; border-top: 1px dashed #ddd; }
          .thanks { font-family: 'Outfit', sans-serif; font-weight: 900; font-size: 18px; margin-bottom: 6px; text-transform: uppercase; }
          .visit-again { font-size: 10px; color: #999; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 20px; }
          
          .powered { font-size: 8px; color: #ddd; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; }
          
          @media print {
            body { padding: 15px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="${shopLogo}" class="logo" onerror="this.style.display='none'">
          <h1 class="brand-name">${shopName}</h1>
          <p class="brand-tagline">Excellence in Hospitality</p>
          
          <div class="shop-details">
            <p>${shopAddress}</p>
            <p>Phone: ${shopPhone}</p>
            ${taxId ? `<p class="tax-id">GSTIN: ${taxId}</p>` : ''}
          </div>
        </div>
        
        <div class="bill-info">
          <div class="info-block">
            <h4>Order Number</h4>
            <p>#${order.orderNumber || 'GENERIC'}</p>
          </div>
          <div class="info-block">
            <h4>Table/Mode</h4>
            <p>${order.table || 'Takeaway'}</p>
          </div>
          <div class="info-block" style="text-align: right;">
            <h4>Date</h4>
            <p>${new Date(order.timestamp instanceof Timestamp ? order.timestamp.toDate() : order.timestamp || new Date()).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Qty</th>
              <th>Item / Description</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="summary">
          <div class="summary-row">
            <span>Subtotal</span>
            <span>${format(subtotal)}</span>
          </div>
          ${restaurant?.enableTax ? `
          <div class="summary-row">
            <span>${taxLabel} (${taxPct}%${isInclusive ? ' Incl.' : ''})</span>
            <span>${format(tax)}</span>
          </div>
          ` : ''}
          ${discount > 0 ? `
          <div class="summary-row" style="color: #10B981;">
            <span>Discount</span>
            <span>-${format(discount)}</span>
          </div>
          ` : ''}
          <div class="summary-row total">
            <span>Total Amount</span>
            <span>${format(order.total)}</span>
          </div>
        </div>

        <div class="footer">
          <h2 class="thanks">Thank You!</h2>
          <p class="visit-again">Hope to serve you again</p>
          <p class="powered">Powered by Kada Dine</p>
          <p style="font-size: 8px; color: #eee; margin-top: 15px;">${new Date().toLocaleTimeString(locale)}</p>
        </div>

        <script>
          window.onload = function() { 
            setTimeout(() => {
              window.print(); 
              window.close();
            }, 600);
          }
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const printThermalKOT = async (order: Order) => {
    try {
      if (!(navigator as any).bluetooth) {
        toast.error("Web Bluetooth API is not supported in this browser. Try Chrome.");
        return;
      }
      
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          { services: ['000018f0-0000-1000-8000-00805f9b34fb'] } // Standard ESC/POS Service
        ],
        optionalServices: ['e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000180a-0000-1000-8000-00805f9b34fb']
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error("Could not connect to GATT server.");

      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

      const encoder = new TextEncoder();
      const commands = [
        '\x1B\x40', // Init
        '\x1B\x61\x01', // Center
        '\x1B\x45\x01', // Bold
        'KADA DINE - KOT\n',
        '\x1B\x45\x00', // Normal
        `Order #${order.orderNumber}\n`,
        `Type: ${order.type.toUpperCase()}\n`,
        '--------------------------------\n',
        '\x1B\x61\x00', // Left align
      ];

      order.items.forEach(item => {
        commands.push(`${item.qty}x ${item.name}\n`);
        if (item.variants) {
           Object.values(item.variants).forEach((v: any) => commands.push(`   - ${v}\n`));
        }
        if (item.notes) commands.push(`   * ${item.notes}\n`);
      });

      commands.push('--------------------------------\n');
      commands.push('\n\n\n'); // Line feeds
      commands.push('\x1D\x56\x41\x00'); // Cut

      const data = encoder.encode(commands.join(''));
      const CHUNK_SIZE = 512;
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        await characteristic.writeValue(data.slice(i, i + CHUNK_SIZE));
      }

      toast.success("Printed to Thermal Printer!");
    } catch (error) {
      console.error("Bluetooth print error:", error);
      toast.error(`Bluetooth Error: ${error instanceof Error ? error.message : "Printer not found"}`);
    }
  };

  const filteredOrders = useMemo(() => orders.filter(order => {
    const matchesSearch =
      order.orderNumber?.toLowerCase().includes(search.toLowerCase()) ||
      order.customerName?.toLowerCase().includes(search.toLowerCase()) ||
      order.table?.toLowerCase().includes(search.toLowerCase());

    const matchesFilter = filter === "all" || order.status?.toLowerCase() === filter;

    return matchesSearch && matchesFilter;
  }), [orders, search, filter]);

  const formatTime = (ts: Timestamp | Date | null) => {
    if (!ts) return '';
    const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'new': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'preparing': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      case 'completed': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'cancelled': return 'bg-destructive/10 text-destructive border-destructive/20';
      default: return 'bg-muted text-muted-foreground border-border/40';
    }
  };

  if (initialLoading) return <PageLoading stats={4} chart={false} rows={8} />;

  return (
    <div className="space-y-6 lg:space-y-8 pb-20 lg:pb-10">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mt-2">
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
            Live <span className="text-primary">Ledger</span>
          </h1>
          <p className="text-sm text-muted-foreground font-medium flex items-center gap-2">
            <ShoppingBag className="w-4 h-4" /> Track transactions and fulfillment
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative w-full sm:w-80 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Search Order #, Name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 h-11 bg-card border-border/40 rounded-xl font-medium text-sm shadow-sm focus:ring-1 focus:ring-primary focus-visible:ring-offset-0"
            />
          </div>
          <div className="flex items-center gap-1 bg-muted p-1 rounded-xl border border-border/40 shadow-sm w-full sm:w-auto shrink-0">
            <Button
              size="sm"
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              onClick={() => setViewMode('list')}
              className="flex-1 sm:flex-none rounded-lg font-semibold text-xs h-9 px-4"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              onClick={() => setViewMode('grid')}
              className="flex-1 sm:flex-none rounded-lg font-semibold text-xs h-9 px-4"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Analytics Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 sm:gap-6">
        {[
          { label: "New", count: orders.filter(o => o.status === 'new').length, icon: ShoppingBag, color: "text-blue-500", bg: "bg-blue-50", darkBg: "dark:bg-blue-500/10", border: "border-blue-500/20" },
          { label: "Scheduled", count: orders.filter(o => o.status === 'scheduled').length, icon: CalendarClock, color: "text-purple-500", bg: "bg-purple-50", darkBg: "dark:bg-purple-500/10", border: "border-purple-500/20" },
          { label: "Cooking", count: orders.filter(o => o.status === 'preparing').length, icon: Clock, color: "text-orange-500", bg: "bg-orange-50", darkBg: "dark:bg-orange-500/10", border: "border-orange-500/20" },
          { label: "Completed", count: orders.filter(o => o.status === 'completed').length, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-50", darkBg: "dark:bg-emerald-500/10", border: "border-emerald-500/20" },
          { label: "Cancelled", count: orders.filter(o => o.status === 'cancelled').length, icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", darkBg: "dark:bg-destructive/10", border: "border-destructive/20" },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            className={cn("bg-card rounded-2xl p-5 sm:p-6 border transition-all group hover:scale-[1.02] shadow-sm", item.border)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...transition, delay: i * 0.1 }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className={cn("text-xs font-bold uppercase tracking-wider", item.color)}>{item.label}</span>
              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", item.bg, item.darkBg, item.color)}>
                <item.icon className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-bold text-foreground tracking-tight leading-none">{item.count}</div>
          </motion.div>
        ))}
      </div>

      {/* Main List Section */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
          {['new', 'scheduled', 'preparing', 'completed', 'cancelled'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border whitespace-nowrap",
                filter === f
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card text-muted-foreground border-border/40 hover:border-primary/50"
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className={cn(viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" : "space-y-3")}>
          <AnimatePresence mode="popLayout">
            {filteredOrders.map((order, i) => (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ ...transition, delay: i * 0.03 }}
                onClick={() => setSelectedOrder(order)}
                className={cn(
                  "group relative bg-card border rounded-2xl transition-all cursor-pointer overflow-hidden shadow-sm",
                  selectedOrder?.id === order.id ? "ring-2 ring-primary border-primary z-10" : "border-border/40 hover:border-primary/40",
                  viewMode === 'list' ? "p-4 sm:p-5" : "flex flex-col h-full"
                )}
              >
                {viewMode === 'list' ? (
                  <div className="flex items-center gap-4">
                    <div className="w-auto min-w-[3rem] px-2 h-12 rounded-xl bg-muted border border-border/20 flex flex-col items-center justify-center shrink-0 group-hover:bg-primary/5 transition-colors">
                      <span className="opacity-60 text-[10px] font-bold text-muted-foreground leading-none">#</span>
                      <span className="text-sm font-bold text-foreground shrink-0 whitespace-nowrap">{order.orderNumber}</span>
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-base sm:text-lg font-bold text-foreground truncate">{order.customerName || order.table}</h4>
                        <span className="text-sm sm:text-base font-bold text-primary whitespace-nowrap">{format(order.total)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-muted-foreground">
                        <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {formatTime(order.timestamp)}</div>
                        <div className="flex items-center gap-1.5"><ShoppingBag className="w-3.5 h-3.5" /> {order.items?.reduce((s, i) => s + (i.qty || 0), 0) || 0} items</div>
                        {order.status === 'scheduled' && order.scheduledFor && (
                          <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-bold bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 rounded-md">
                            <CalendarClock className="w-3.5 h-3.5" />
                            {formatTime(order.scheduledFor)}
                          </div>
                        )}
                      </div>
                      {order.type === "delivery" && (order.deliveryAddressText || order.deliveryAddress?.line1) && (
                        <div className="flex items-center gap-1.5 text-xs font-medium text-primary/80 mt-2 truncate max-w-sm bg-primary/5 px-2.5 py-1 rounded-md w-fit">
                          <MapPin className="w-3.5 h-3.5" />
                          <span className="truncate">{order.deliveryAddressText || [order.deliveryAddress?.line1, order.deliveryAddress?.area, order.deliveryAddress?.landmark, order.deliveryAddress?.pincode].filter(Boolean).join(", ")}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge className={cn("rounded-lg h-7 px-3 font-bold uppercase text-[10px] tracking-wider border shadow-sm whitespace-nowrap", getStatusColor(order.status))}>
                        {order.status}
                      </Badge>
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="p-5 flex-1 space-y-5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="w-auto px-2 min-w-[2.5rem] h-10 rounded-lg bg-muted border border-border/20 flex items-center justify-center font-bold text-sm shrink-0 whitespace-nowrap">#{order.orderNumber}</div>
                        <Badge className={cn("rounded-lg h-7 px-3 font-bold uppercase text-[10px] tracking-wider border", getStatusColor(order.status))}>
                          {order.status}
                        </Badge>
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-foreground tracking-tight truncate">{order.customerName || order.table}</h4>
                        <div className="flex items-center gap-3 mt-0.5">
                          <p className="text-lg font-bold text-primary tracking-tight">{format(order.total)}</p>
                          {order.status === 'scheduled' && order.scheduledFor && (
                            <div className="flex items-center gap-1.5 text-[11px] text-purple-600 dark:text-purple-400 font-bold bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 rounded-md">
                              <CalendarClock className="w-3 h-3" />
                              {formatTime(order.scheduledFor)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2 pt-3 border-t border-border/10">
                        {order.items?.slice(0, 3).map((item, idx) => (
                          <div key={idx} className="flex items-start gap-2.5">
                            <span className="bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded text-[10px] min-w-[24px] text-center border border-primary/20">{item.qty}×</span>
                            <span className="text-foreground font-medium text-sm leading-tight pt-0.5">{item.name}</span>
                          </div>
                        ))}
                        {order.items?.length > 3 && (
                          <p className="text-xs font-semibold text-muted-foreground pt-1">+ {order.items.length - 3} more items</p>
                        )}
                      </div>
                    </div>
                    <div className="p-4 bg-muted/30 border-t border-border/10 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" /> {formatTime(order.timestamp)}
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {filteredOrders.length === 0 && (
            <div className="py-24 text-center space-y-3 col-span-full opacity-60">
              <ShoppingBag className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">No Orders Found</h3>
            </div>
          )}
        </div>
      </div>

      {/* Dialog: Selected Order Digital Receipt Pop up */}
      <Dialog open={selectedOrder !== null} onOpenChange={(open) => { if (!open) setSelectedOrder(null); }}>
        {selectedOrder && (
          <DialogContent className="rounded-[28px] max-w-lg p-0 border-border/40 shadow-2xl bg-card overflow-hidden">
            {/* Header Section */}
            <div className="bg-muted/30 px-6 py-5 border-b border-border/40 flex items-start justify-between relative shrink-0">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <DialogTitle className="text-2xl font-black tracking-tight text-foreground">
                    #{selectedOrder.orderNumber}
                  </DialogTitle>
                  <Badge className={cn("rounded-md h-6 px-2 text-[10px] font-bold uppercase tracking-wider shadow-sm", getStatusColor(selectedOrder.status))}>
                    {selectedOrder.status}
                  </Badge>
                </div>
                <DialogDescription className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> {formatTime(selectedOrder.timestamp)}
                </DialogDescription>
              </div>
            </div>

            {/* Body Section */}
            <div className="p-6 overflow-y-auto max-h-[60vh] hide-scrollbar space-y-8">
              
              {/* Customer Info */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-foreground tracking-tight">
                    {selectedOrder.customerName || selectedOrder.table}
                  </h3>
                  <Badge className={cn(
                    "rounded-md h-6 px-2.5 text-[10px] font-bold uppercase tracking-wider shadow-sm",
                    selectedOrder.paymentStatus === 'paid' ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" : "bg-orange-500/10 text-orange-600 border border-orange-500/20"
                  )}>
                    {selectedOrder.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                  </Badge>
                </div>

                {(selectedOrder.customerPhone || selectedOrder.deliveryAddressText || selectedOrder.deliveryAddress) && (
                  <div className="bg-muted/30 rounded-2xl p-4 border border-border/40 space-y-3">
                    {selectedOrder.customerPhone && (
                      <div className="flex items-center gap-3 text-sm font-medium text-foreground">
                        <div className="w-8 h-8 rounded-full bg-background flex items-center justify-center border border-border/50 shadow-sm shrink-0">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        {selectedOrder.customerPhone}
                      </div>
                    )}
                    {(selectedOrder.deliveryAddressText || selectedOrder.deliveryAddress) && (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-start gap-3 text-sm font-medium text-foreground">
                          <div className="w-8 h-8 rounded-full bg-background flex items-center justify-center border border-border/50 shadow-sm shrink-0">
                            <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 pt-1.5 leading-relaxed">
                            {selectedOrder.deliveryAddressText || [selectedOrder.deliveryAddress?.line1, selectedOrder.deliveryAddress?.area, selectedOrder.deliveryAddress?.landmark, selectedOrder.deliveryAddress?.pincode].filter(Boolean).join(", ")}
                          </div>
                        </div>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="ml-11 h-8 gap-1.5 text-xs font-bold rounded-lg border-primary/20 text-primary hover:bg-primary/10 w-fit"
                          onClick={() => {
                            const lat = selectedOrder.deliveryAddress?.gps?.lat;
                            const lng = selectedOrder.deliveryAddress?.gps?.lng;
                            if (lat && lng) {
                              window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
                            } else {
                              const query = encodeURIComponent(selectedOrder.deliveryAddressText || [selectedOrder.deliveryAddress?.line1, selectedOrder.deliveryAddress?.area, selectedOrder.deliveryAddress?.landmark, selectedOrder.deliveryAddress?.pincode].filter(Boolean).join(", "));
                              window.open(`https://www.google.com/maps/dir/?api=1&destination=${query}`, '_blank');
                            }
                          }}
                        >
                          <Navigation className="w-3.5 h-3.5" /> Get Directions
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Rider Details (Delivery Only) */}
                {selectedOrder.type === 'delivery' && (
                  <div className="bg-primary/5 rounded-2xl p-4 border border-primary/20 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-primary">Delivery Coordination</h4>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-foreground">Delivery Status</span>
                      <Badge variant="outline" className="uppercase font-bold tracking-wider text-[10px] bg-card">
                        {selectedOrder.deliveryStatus?.replace(/_/g, ' ') || 'Unassigned'}
                      </Badge>
                    </div>
                    {selectedOrder.riderName && (
                      <div className="pt-2 border-t border-primary/10 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium text-muted-foreground">Rider Name</span>
                          <span className="font-bold text-foreground">{selectedOrder.riderName}</span>
                        </div>
                        {selectedOrder.riderPhone && (
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-muted-foreground">Phone</span>
                            <a href={`tel:${selectedOrder.riderPhone}`} className="font-bold text-primary hover:underline">
                              {selectedOrder.riderPhone}
                            </a>
                          </div>
                        )}
                        {selectedOrder.riderVehicle && (
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-muted-foreground">Vehicle</span>
                            <span className="font-semibold text-foreground">{selectedOrder.riderVehicle}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Order Items */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Order Items</h4>
                <div className="space-y-4">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="flex gap-4 group">
                      <div className="w-8 h-8 rounded-lg bg-muted border border-border/50 flex items-center justify-center font-bold text-xs shrink-0 text-foreground shadow-sm">
                        {item.qty}x
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-sm text-foreground">{item.name}</p>
                            <p className="text-[11px] font-medium text-muted-foreground mt-0.5">{format(item.price)} each</p>
                          </div>
                          <span className="font-bold text-sm text-foreground whitespace-nowrap">{format(item.price * item.qty)}</span>
                        </div>
                        {item.instructions && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-1.5 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-md inline-block">
                            Note: {item.instructions}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Receipt Summary */}
              {(() => {
                const taxLabel = selectedOrder.taxLabel || restaurant?.taxLabel || getTaxLabel(restaurant?.countryCode);
                const isInclusive = selectedOrder.taxMethod === "inclusive" || (selectedOrder.taxMethod === undefined && restaurant?.taxMethod === "inclusive");
                const taxPct = typeof selectedOrder.taxPercentage === "number" ? selectedOrder.taxPercentage : (restaurant?.taxPercentage ?? 5);

                const savedSubtotal = typeof selectedOrder.subtotal === "number" ? selectedOrder.subtotal : null;
                const savedTax = typeof selectedOrder.tax === "number" ? selectedOrder.tax : null;
                const savedDiscount = typeof selectedOrder.discount === "number" ? selectedOrder.discount : 0;

                const subtotalVal = savedSubtotal !== null ? savedSubtotal : (isInclusive ? selectedOrder.total - (savedTax || 0) : selectedOrder.items.reduce((sum, item) => sum + (item.price * item.qty), 0));
                const taxVal = savedTax !== null ? savedTax : (restaurant?.enableTax ? (isInclusive ? selectedOrder.total - subtotalVal : selectedOrder.total - subtotalVal) : 0);
                const discountVal = savedDiscount;

                return (
                  <div className="bg-muted/30 rounded-2xl p-5 border border-border/40 space-y-3 relative overflow-hidden">
                    <div className="flex justify-between text-sm font-medium text-muted-foreground pt-1">
                      <span>Subtotal</span>
                      <span className="text-foreground">{format(subtotalVal)}</span>
                    </div>
                    {restaurant?.enableTax && (
                      <div className="flex justify-between text-sm font-medium text-muted-foreground">
                        <span>{taxLabel} ({taxPct}%{isInclusive ? ' Incl.' : ''})</span>
                        <span className="text-foreground">{format(taxVal)}</span>
                      </div>
                    )}
                    {discountVal > 0 && (
                      <div className="flex justify-between text-sm font-medium text-emerald-600">
                        <span>Discount</span>
                        <span>-{format(discountVal)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-end pt-3 mt-1 border-t border-border/40">
                      <span className="text-sm font-bold text-foreground">Total Amount</span>
                      <span className="text-2xl font-black text-primary tracking-tight">{format(selectedOrder.total)}</span>
                    </div>
                  </div>
                );
              })()}

            </div>

            {/* Sticky Actions Footer */}
            <div className="p-5 bg-background/80 backdrop-blur-md border-t border-border/40 shrink-0 space-y-3 z-10">
              {selectedOrder.status === 'new' && (
                <Button onClick={() => updateOrderStatus(selectedOrder.id, 'preparing')} className="w-full h-11 rounded-xl font-bold text-sm bg-orange-500 hover:bg-orange-600 text-white shadow-sm gap-2 transition-transform active:scale-[0.98]">
                  Start Preparing Order <ChevronRight className="w-4 h-4" />
                </Button>
              )}
              {selectedOrder.status === 'preparing' && (
                <Button onClick={() => updateOrderStatus(selectedOrder.id, 'completed')} className="w-full h-11 rounded-xl font-bold text-sm bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm gap-2 transition-transform active:scale-[0.98]">
                  Mark as Completed <CheckCircle2 className="w-4 h-4" />
                </Button>
              )}
              
              <div className="pt-6 mt-8 border-t border-border/40 flex items-center justify-between">
                <Button variant="outline" className="h-11 rounded-xl font-semibold text-sm border-border/50 hover:bg-muted/50 gap-2 transition-colors" onClick={() => printReceipt(selectedOrder)}>
                  <Printer className="w-4 h-4" /> Print Bill
                </Button>
                <Button variant="outline" className="h-11 rounded-xl font-semibold text-sm border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 gap-2 transition-colors" onClick={() => printThermalKOT(selectedOrder)}>
                  <Printer className="w-4 h-4" /> Bluetooth KOT
                </Button>
                <Button variant="outline" className="h-11 rounded-xl font-semibold text-sm border-destructive/20 text-destructive hover:bg-destructive/10 gap-2 transition-colors" onClick={() => updateOrderStatus(selectedOrder.id, 'cancelled')}>
                  <XCircle className="w-4 h-4" /> Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
