import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Shield,
  AlertTriangle,
  UserX,
  AlertCircle,
  Ban,
  Tag,
  Search,
  ArrowRight,
  Eye,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Sliders,
  Flame,
  Plus,
  RefreshCw,
  MoreVertical,
  SlidersHorizontal,
  Lock,
  Unlock,
  DollarSign,
  TrendingDown,
  Activity,
  FileSpreadsheet,
  Download,
  Phone,
  Store,
  Bike,
} from "lucide-react";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards, type StatItem } from "@/components/admin/StatCards";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { adminAction } from "@/lib/admin-ops";
import { cn } from "@/lib/utils";
import { isWalkInOrder } from "@/lib/orderChannels";

// ── Types ───────────────────────────────────────────────────────────────────

interface LiveOrder {
  id: string;
  orderSource?: string;
  userId?: string;
  customerId?: string;
  signals?: string[];
  orderId?: string;
  orderNumber?: string;
  customerUid?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  restaurantId?: string;
  restaurantName?: string;
  total?: number;
  discount?: number;
  promoCode?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  status?: string;
  timestamp?: unknown;
  createdAt?: unknown;
  riskScore?: number;
  isFlaggedForFraud?: boolean;
}

interface BlockedEntity {
  id: string;
  name?: string;
  type: "customer" | "vendor" | "rider" | "device";
  identifier: string; // phone, email, or device hash
  reason: string;
  blockedBy?: string;
  createdAt?: unknown;
}

interface InvestigationCase {
  id: string;
  caseNumber: string;
  title: string;
  type: "Payment Fraud" | "Promo Abuse" | "Account Takeover" | "Fake Reviews" | "Chargeback Dispute";
  targetName: string;
  targetId: string;
  targetType: "customer" | "vendor" | "rider";
  status: "in_progress" | "pending_review" | "resolved" | "dismissed";
  priority: "critical" | "high" | "medium" | "low";
  assignedTo?: string;
  notes?: string;
  createdAt?: unknown;
}

const formatINR = (n?: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

const toDate = (ts: unknown): Date | null => {
  if (!ts) return null;
  try {
    const t = ts as { toDate?: () => Date };
    if (typeof t.toDate === "function") return t.toDate();
    if (typeof ts === "number") return new Date(ts);
    if (typeof ts === "string") return new Date(ts);
    return null;
  } catch {
    return null;
  }
};

export default function RiskCenterPage() {
  const { user } = useAuth();
  const adminIdentity = user?.email || "trust_console";

  // ── Live Firestore Collections ────────────────────────────────────────────
  const { rows: allOrders, loading: ordersLoading } = useLiveCollection<LiveOrder>("orders", {
    orderByField: "timestamp",
    orderDir: "desc",
    limit: 600,
  });

  // Walk-in counter tickets are the restaurant's own in-store sales. They have
  // no Kada account behind them, so they can't be scored, blocked or chased —
  // listing them here only buried the real marketplace signals.
  const orders = useMemo(() => allOrders.filter((o) => !isWalkInOrder(o)), [allOrders]);

  const { rows: blockedEntities, loading: blockedLoading } = useLiveCollection<BlockedEntity>(
    "blocked_entities",
    { limit: 300 },
  );

  const { rows: investigations, loading: casesLoading } = useLiveCollection<InvestigationCase>(
    "risk_investigations",
    { orderByField: "createdAt", orderDir: "desc", limit: 200 },
  );

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("orders");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [selectedOrderForInspect, setSelectedOrderForInspect] = useState<LiveOrder | null>(null);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [isNewCaseModalOpen, setIsNewCaseModalOpen] = useState(false);

  // Block Modal Form
  const [blockForm, setBlockForm] = useState<{
    name: string;
    type: "customer" | "vendor" | "rider" | "device";
    identifier: string;
    reason: string;
  }>({
    name: "",
    type: "customer",
    identifier: "",
    reason: "Repeated payment fraud & promo abuse",
  });

  // Investigation Modal Form
  const [caseForm, setCaseForm] = useState<{
    title: string;
    type: "Payment Fraud" | "Promo Abuse" | "Account Takeover" | "Fake Reviews" | "Chargeback Dispute";
    targetName: string;
    targetId: string;
    targetType: "customer" | "vendor" | "rider";
    priority: "critical" | "high" | "medium" | "low";
    assignedTo: string;
    notes: string;
  }>({
    title: "Suspicious High-Value Order Velocity",
    type: "Payment Fraud",
    targetName: "",
    targetId: "",
    targetType: "customer",
    priority: "high",
    assignedTo: "Trust & Safety Admin",
    notes: "",
  });

  // ── Algorithmic Live Risk & Fraud Detection Engine ────────────────────────
  const suspiciousOrders = useMemo(() => {
    return orders
      .map((order) => {
        const signals: string[] = [];
        let score = 15; // Base normal score

        const total = Number(order.total || 0);
        const discount = Number(order.discount || 0);
        const pStatus = (order.paymentStatus || "").toLowerCase();
        const oStatus = (order.status || "").toLowerCase();

        // Signal 1: Extremely high order total (> ₹3,500)
        if (total >= 5000) {
          score += 40;
          signals.push("High Value Spike (>₹5k)");
        } else if (total >= 3000) {
          score += 25;
          signals.push("Elevated Order Value");
        }

        // Signal 2: Heavy discount percentage (> 50%)
        if (total > 0 && discount / (total + discount) > 0.5) {
          score += 30;
          signals.push("Unusual Discount (>50%)");
        }

        // Signal 3: Failed or rejected payment status
        if (pStatus === "failed" || oStatus === "rejected") {
          score += 35;
          signals.push("Payment Auth Failure");
        }

        // Signal 4: Promo code usage
        if (order.promoCode && order.promoCode.toLowerCase().includes("free")) {
          score += 15;
          signals.push("High-Risk Promo Tag");
        }

        // Cap score at 99
        score = Math.min(99, score);

        return {
          ...order,
          riskScore: score,
          signals,
        };
      })
      .filter((o) => o.riskScore >= 45 || o.signals.length > 0)
      .sort((a, b) => b.riskScore - a.riskScore);
  }, [orders]);

  // ── Promo Abuse Analysis ──────────────────────────────────────────────────
  const promoAbuseMetrics = useMemo(() => {
    const promoMap = new Map<
      string,
      { promoCode: string; uses: number; totalDiscount: number; users: Set<string> }
    >();

    orders.forEach((o) => {
      if (!o.promoCode) return;
      const code = o.promoCode.trim().toUpperCase();
      const stat = promoMap.get(code) ?? {
        promoCode: code,
        uses: 0,
        totalDiscount: 0,
        users: new Set<string>(),
      };
      stat.uses += 1;
      stat.totalDiscount += Number(o.discount || 0);
      if (o.customerUid || o.customerPhone) {
        stat.users.add(o.customerUid || o.customerPhone || "unknown");
      }
      promoMap.set(code, stat);
    });

    return Array.from(promoMap.values())
      .map((p) => ({
        ...p,
        userCount: p.users.size,
        abuseRatio: p.uses > 0 ? (p.uses / Math.max(1, p.users.size)).toFixed(1) : "1.0",
      }))
      .sort((a, b) => b.totalDiscount - a.totalDiscount);
  }, [orders]);

  // ── KPI Stats ─────────────────────────────────────────────────────────────
  const kpis: StatItem[] = useMemo(() => {
    const highRiskCount = suspiciousOrders.filter((o) => o.riskScore >= 70).length;
    const activeInvestigationsCount = investigations.filter((i) => i.status === "in_progress").length;
    const blockedCount = blockedEntities.length;
    const totalPromoLeakage = promoAbuseMetrics.reduce((sum, p) => sum + p.totalDiscount, 0);

    return [
      {
        title: "High-risk orders",
        value: highRiskCount,
        hint: "Risk score 70+",
        icon: AlertTriangle,
        tone: "text-rose-600",
        loading: ordersLoading,
      },
      {
        title: "Open investigations",
        value: activeInvestigationsCount,
        hint: "Cases in progress",
        icon: Shield,
        tone: "text-blue-600",
        loading: casesLoading,
      },
      {
        title: "Blocked accounts",
        value: blockedCount,
        hint: "Customers, devices, payment ids",
        icon: UserX,
        tone: "text-rose-600",
        loading: blockedLoading,
      },
      {
        // Every coupon discount on the loaded orders — abuse is judged per code below.
        title: "Promo discounts",
        value: formatINR(totalPromoLeakage),
        hint: "All coupon discounts, loaded orders",
        icon: Tag,
        tone: "text-purple-600",
      },
    ];
  }, [
    ordersLoading,
    casesLoading,
    blockedLoading,
    suspiciousOrders,
    investigations,
    blockedEntities,
    promoAbuseMetrics,
  ]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleCancelAndRefundFraudOrder = async (order: LiveOrder) => {
    // Was writing status:"cancelled" directly — the customer never got their
    // money back. Route through refundOrder so the wallet/original-method
    // refund actually happens (and the callable auto-cancels on a full refund
    // per the partial-vs-full fix). Then stamp the fraud flag.
    try {
      await adminAction("refundOrder", {
        orderId: order.id,
        method: "original",
        reason: "Cancelled by Platform Trust & Safety (High Fraud Risk)",
      });
      try {
        await updateDoc(doc(db, "orders", order.id), {
          isFlaggedForFraud: true,
          flaggedByAdmin: adminIdentity,
          flaggedAt: serverTimestamp(),
        });
      } catch (flagErr) {
        console.warn("[RiskCenter] refund succeeded but fraud-flag write failed", flagErr);
      }
      toast.success(`Order #${order.orderNumber || order.id.slice(-6)} refunded & marked high-risk`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Refund failed";
      // Some refunds >₹5000 queue for maker-checker — surface that honestly.
      if (msg.toLowerCase().includes("approval") || msg.toLowerCase().includes("pending")) {
        toast.info(`Refund queued for a second admin's approval. Order not yet cancelled.`);
      } else {
        toast.error(`Refund failed: ${msg}`);
      }
    }
  };

  const handleCreateBlockEntity = async () => {
    if (!blockForm.identifier.trim() || !blockForm.name.trim()) {
      toast.error("Please enter a name and identifier (phone/email)");
      return;
    }

    try {
      await addDoc(collection(db, "blocked_entities"), {
        name: blockForm.name.trim(),
        type: blockForm.type,
        identifier: blockForm.identifier.trim(),
        reason: blockForm.reason.trim(),
        blockedBy: adminIdentity,
        createdAt: serverTimestamp(),
      });

      toast.success(`Blocked entity "${blockForm.name}"`);
      setIsBlockModalOpen(false);
      setBlockForm({
        name: "",
        type: "customer",
        identifier: "",
        reason: "Repeated payment fraud & promo abuse",
      });
    } catch (err: unknown) {
      toast.error(`Block failed: ${(err as Error).message}`);
    }
  };

  const handleUnblockEntity = async (id: string, name: string) => {
    try {
      await deleteDoc(doc(db, "blocked_entities", id));
      toast.success(`Unblocked "${name}"`);
    } catch (err: unknown) {
      toast.error(`Unblock failed: ${(err as Error).message}`);
    }
  };

  const handleCreateInvestigationCase = async () => {
    if (!caseForm.title.trim() || !caseForm.targetName.trim()) {
      toast.error("Please complete the investigation title and target name");
      return;
    }

    const caseNumber = `INV-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      await addDoc(collection(db, "risk_investigations"), {
        caseNumber,
        title: caseForm.title.trim(),
        type: caseForm.type,
        targetName: caseForm.targetName.trim(),
        targetId: caseForm.targetId.trim() || "—",
        targetType: caseForm.targetType,
        priority: caseForm.priority,
        status: "in_progress",
        assignedTo: caseForm.assignedTo || adminIdentity,
        createdBy: adminIdentity,
        notes: caseForm.notes?.trim() || "",
        createdAt: serverTimestamp(),
      });

      toast.success(`Case #${caseNumber} created!`);
      setIsNewCaseModalOpen(false);
      setCaseForm({
        title: "Suspicious High-Value Order Velocity",
        type: "Payment Fraud",
        targetName: "",
        targetId: "",
        targetType: "customer",
        priority: "high",
        assignedTo: "Trust & Safety Admin",
        notes: "",
      });
    } catch (err: unknown) {
      toast.error(`Case creation failed: ${(err as Error).message}`);
    }
  };

  const handleUpdateCaseStatus = async (caseId: string, status: InvestigationCase["status"]) => {
    try {
      await updateDoc(doc(db, "risk_investigations", caseId), {
        status,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Case status updated to ${status.replace("_", " ")}`);
    } catch (err: unknown) {
      toast.error(`Update failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="Trust, Safety & Fraud Prevention"
        description="Automated risk anomaly detection, promo abuse prevention, and fraud investigation management."
        badge="Safety Core Active"
      />

      {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
      <StatCards items={kpis} />

      {/* ── Main Navigation Tabs ────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 max-w-xl h-auto p-1 bg-muted/60">
          <TabsTrigger value="orders" className="text-xs py-2">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
            Risk Radar ({suspiciousOrders.length})
          </TabsTrigger>
          <TabsTrigger value="cases" className="text-xs py-2">
            <Shield className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
            Investigations ({investigations.length})
          </TabsTrigger>
          <TabsTrigger value="promos" className="text-xs py-2">
            <Tag className="w-3.5 h-3.5 mr-1.5 text-purple-500" />
            Promo Abuse ({promoAbuseMetrics.length})
          </TabsTrigger>
          <TabsTrigger value="blocked" className="text-xs py-2">
            <Ban className="w-3.5 h-3.5 mr-1.5 text-rose-500" />
            Blacklist ({blockedEntities.length})
          </TabsTrigger>
        </TabsList>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 1: LIVE RISK RADAR & SUSPICIOUS ORDERS
        ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="orders" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-500" />
                  Live Flagged Orders & Anomaly Signals
                </CardTitle>
                <CardDescription>
                  Orders flagged in real time for elevated transaction value, payment failures, or promo stacking.
                </CardDescription>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setIsNewCaseModalOpen(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Open Investigation
              </Button>
            </CardHeader>

            <CardContent>
              {suspiciousOrders.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border/60">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                  <p className="text-sm font-medium">All live orders are within normal safety parameters.</p>
                  <p className="text-xs text-muted-foreground mt-1">Zero fraud anomalies detected.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-muted-foreground bg-muted/30">
                        <th className="p-3 font-semibold">Order</th>
                        <th className="p-3 font-semibold">Customer</th>
                        <th className="p-3 font-semibold">Risk Score</th>
                        <th className="p-3 font-semibold">Fraud Signals</th>
                        <th className="p-3 font-semibold">Amount</th>
                        <th className="p-3 font-semibold">Status</th>
                        <th className="p-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {suspiciousOrders.map((order) => {
                        const isCritical = order.riskScore >= 75;
                        return (
                          <tr
                            key={order.id}
                            className={cn(
                              "hover:bg-muted/30 transition-colors",
                              isCritical && "bg-rose-500/5 hover:bg-rose-500/10",
                            )}
                          >
                            <td className="p-3 font-mono font-bold text-foreground">
                              #{order.orderNumber || order.orderId || order.id.slice(-6)}
                            </td>
                            <td className="p-3">
                              <p className="font-semibold text-foreground">
                                {order.customerName || "Customer"}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {order.customerPhone || "No phone"}
                              </p>
                            </td>
                            <td className="p-3">
                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded-full font-bold text-[11px]",
                                  order.riskScore >= 75
                                    ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                                    : "bg-amber-500/10 text-amber-600 border border-amber-500/20",
                                )}
                              >
                                {order.riskScore}/100
                              </span>
                            </td>
                            <td className="p-3">
                              <div className="flex gap-1 flex-wrap">
                                {order.signals.map((sig, idx) => (
                                  <span
                                    key={idx}
                                    className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-foreground font-medium"
                                  >
                                    {sig}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-3 font-bold text-foreground">
                              {formatINR(order.total)}
                            </td>
                            <td className="p-3">
                              <Badge
                                variant={order.status === "cancelled" ? "destructive" : "secondary"}
                                className="text-[10px] capitalize"
                              >
                                {order.status || "Pending"}
                              </Badge>
                            </td>
                            <td className="p-3 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button aria-label="More actions" variant="ghost" size="icon" className="h-7 w-7">
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48 text-xs">
                                  <DropdownMenuItem
                                    onClick={() => setSelectedOrderForInspect(order)}
                                  >
                                    <Eye className="w-3.5 h-3.5 mr-2" />
                                    Inspect Risk Signals
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setCaseForm({
                                        title: `Investigation: Order #${order.orderNumber || order.id.slice(-6)}`,
                                        type: "Payment Fraud",
                                        targetName: order.customerName || "Customer",
                                        targetId: order.customerUid || order.customerPhone || order.id,
                                        targetType: "customer",
                                        priority: order.riskScore >= 75 ? "critical" : "high",
                                        assignedTo: "Trust & Safety Admin",
                                        notes: `Signals: ${order.signals.join(", ")}. Total: ${formatINR(order.total)}.`,
                                      });
                                      setIsNewCaseModalOpen(true);
                                    }}
                                  >
                                    <Shield className="w-3.5 h-3.5 mr-2 text-blue-500" />
                                    Open Case
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-rose-600 focus:text-rose-600"
                                    onClick={() => handleCancelAndRefundFraudOrder(order)}
                                  >
                                    <XCircle className="w-3.5 h-3.5 mr-2" />
                                    Cancel & Refund Order
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-rose-600 focus:text-rose-600"
                                    onClick={() => {
                                      setBlockForm({
                                        name: order.customerName || "Customer",
                                        type: "customer",
                                        identifier: order.customerPhone || order.customerUid || "Unknown",
                                        reason: `Flagged for order #${order.orderNumber || order.id.slice(-6)} fraud score ${order.riskScore}`,
                                      });
                                      setIsBlockModalOpen(true);
                                    }}
                                  >
                                    <Ban className="w-3.5 h-3.5 mr-2" />
                                    Blacklist Customer
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 2: INVESTIGATION CASES MANAGEMENT
        ═════════════════════════════════════════════ */}
        <TabsContent value="cases" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-500" />
                  Trust & Safety Investigation Ledger
                </CardTitle>
                <CardDescription>
                  Active fraud cases, chargeback inquiries, account takeover reviews, and partner audits.
                </CardDescription>
              </div>

              <Button
                variant="default"
                size="sm"
                className="text-xs"
                onClick={() => setIsNewCaseModalOpen(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Log New Case
              </Button>
            </CardHeader>

            <CardContent>
              {investigations.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border/60">
                  <Shield className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                  <p className="text-sm font-medium">No open investigation cases.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-muted-foreground bg-muted/30">
                        <th className="p-3 font-semibold">Case ID</th>
                        <th className="p-3 font-semibold">Title & Category</th>
                        <th className="p-3 font-semibold">Subject Entity</th>
                        <th className="p-3 font-semibold">Priority</th>
                        <th className="p-3 font-semibold">Status</th>
                        <th className="p-3 font-semibold">Assigned To</th>
                        <th className="p-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {investigations.map((c) => (
                        <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-mono font-bold text-foreground">
                            {c.caseNumber || c.id.slice(-6)}
                          </td>
                          <td className="p-3">
                            <p className="font-semibold text-foreground">{c.title}</p>
                            <span className="text-[10px] text-muted-foreground">{c.type}</span>
                          </td>
                          <td className="p-3">
                            <p className="font-semibold text-foreground">{c.targetName}</p>
                            <Badge variant="outline" className="text-[9px] capitalize mt-0.5">
                              {c.targetType}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={
                                c.priority === "critical"
                                  ? "destructive"
                                  : c.priority === "high"
                                  ? "default"
                                  : "secondary"
                              }
                              className="text-[10px] capitalize"
                            >
                              {c.priority}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={c.status === "resolved" ? "default" : "outline"}
                              className="text-[10px] capitalize"
                            >
                              {c.status.replace("_", " ")}
                            </Badge>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {c.assignedTo || "Unassigned"}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {c.status !== "resolved" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-emerald-600"
                                  onClick={() => handleUpdateCaseStatus(c.id, "resolved")}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Resolve
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs text-muted-foreground"
                                  onClick={() => handleUpdateCaseStatus(c.id, "in_progress")}
                                >
                                  Re-Open
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 3: PROMO & COUPON ABUSE MONITOR
        ═════════════════════════════════════════════ */}
        <TabsContent value="promos" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="w-4 h-4 text-purple-500" />
                Voucher & Promo Code Consumption Analytics
              </CardTitle>
              <CardDescription>
                Tracks discount utilization velocity, multi-account promo stacking, and margin impact.
              </CardDescription>
            </CardHeader>

            <CardContent>
              {promoAbuseMetrics.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  No promotional discounts used in recent orders.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-muted-foreground bg-muted/30">
                        <th className="p-3 font-semibold">Promo Code</th>
                        <th className="p-3 font-semibold text-right">Total Uses</th>
                        <th className="p-3 font-semibold text-right">Unique Users</th>
                        <th className="p-3 font-semibold text-right">Abuse Ratio</th>
                        <th className="p-3 font-semibold text-right">Discount Impact (₹)</th>
                        <th className="p-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {promoAbuseMetrics.map((p) => {
                        const isHighAbuse = Number(p.abuseRatio) >= 3.0;
                        return (
                          <tr key={p.promoCode} className="hover:bg-muted/30 transition-colors">
                            <td className="p-3 font-mono font-bold text-foreground">
                              {p.promoCode}
                            </td>
                            <td className="p-3 text-right font-medium">{p.uses}</td>
                            <td className="p-3 text-right text-muted-foreground">{p.userCount}</td>
                            <td className="p-3 text-right">
                              <span
                                className={cn(
                                  "font-bold",
                                  isHighAbuse ? "text-rose-500" : "text-emerald-500",
                                )}
                              >
                                {p.abuseRatio}x / user
                              </span>
                            </td>
                            <td className="p-3 text-right font-bold text-primary">
                              {formatINR(p.totalDiscount)}
                            </td>
                            <td className="p-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => {
                                  toast.info(`Promo ${p.promoCode} flagged for audit.`);
                                }}
                              >
                                Audit Code
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 4: BLACKLIST & BLOCKED ENTITY REGISTRY
        ═════════════════════════════════════════════ */}
        <TabsContent value="blocked" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Ban className="w-4 h-4 text-rose-500" />
                  Platform Blacklist & Restricted Entities
                </CardTitle>
                <CardDescription>
                  Registry of banned phone numbers, devices, and suspended restaurant/rider accounts.
                </CardDescription>
              </div>

              <Button
                variant="destructive"
                size="sm"
                className="text-xs"
                onClick={() => setIsBlockModalOpen(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add to Blacklist
              </Button>
            </CardHeader>

            <CardContent>
              {blockedEntities.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border/60">
                  <Unlock className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                  <p className="text-sm font-medium">Blacklist is currently empty.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-muted-foreground bg-muted/30">
                        <th className="p-3 font-semibold">Entity Name</th>
                        <th className="p-3 font-semibold">Type</th>
                        <th className="p-3 font-semibold">Identifier (Phone / Email / ID)</th>
                        <th className="p-3 font-semibold">Blacklist Reason</th>
                        <th className="p-3 font-semibold text-right">Date Blocked</th>
                        <th className="p-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {blockedEntities.map((ent) => (
                        <tr key={ent.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-semibold text-foreground">{ent.name}</td>
                          <td className="p-3">
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {ent.type}
                            </Badge>
                          </td>
                          <td className="p-3 font-mono text-muted-foreground">{ent.identifier}</td>
                          <td className="p-3 text-rose-600 font-medium">{ent.reason}</td>
                          <td className="p-3 text-right text-muted-foreground">
                            {toDate(ent.createdAt)?.toLocaleDateString("en-IN") || "Active"}
                          </td>
                          <td className="p-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-muted-foreground hover:text-emerald-600"
                              onClick={() => handleUnblockEntity(ent.id, ent.name || ent.identifier)}
                            >
                              <Unlock className="w-3 h-3 mr-1" />
                              Unblock
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═════════════════════════════════════════════════════════════════════
          MODAL 1: BLOCK / BLACKLIST ENTITY
      ═════════════════════════════════════════════ */}
      <Dialog open={isBlockModalOpen} onOpenChange={setIsBlockModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="w-4 h-4 text-rose-500" />
              Blacklist Entity from Platform
            </DialogTitle>
            <DialogDescription>
              Restricts access across the customer app, vendor portal, and delivery fleet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Entity Name *</Label>
                <Input
                  value={blockForm.name}
                  onChange={(e) => setBlockForm({ ...blockForm, name: e.target.value })}
                  placeholder="e.g. Rahul Sharma"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Entity Type</Label>
                <Select
                  value={blockForm.type}
                  onValueChange={(val: "customer" | "vendor" | "rider" | "device") =>
                    setBlockForm({ ...blockForm, type: val })
                  }
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer (Diner)</SelectItem>
                    <SelectItem value="rider">Delivery Rider</SelectItem>
                    <SelectItem value="vendor">Restaurant Partner</SelectItem>
                    <SelectItem value="device">Device / IP Hash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Identifier (Phone / Email / ID) *</Label>
              <Input
                value={blockForm.identifier}
                onChange={(e) => setBlockForm({ ...blockForm, identifier: e.target.value })}
                placeholder="+91 98765 43210 or user@email.com"
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Blacklist Reason</Label>
              <Textarea
                value={blockForm.reason}
                onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })}
                placeholder="Reason for blocking..."
                className="text-xs min-h-[60px]"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsBlockModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCreateBlockEntity}
            >
              Confirm Blacklist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════════
          MODAL 2: CREATE INVESTIGATION CASE
      ═════════════════════════════════════════════ */}
      <Dialog open={isNewCaseModalOpen} onOpenChange={setIsNewCaseModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-500" />
              Open Trust & Safety Investigation Case
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Case Title *</Label>
              <Input
                value={caseForm.title}
                onChange={(e) => setCaseForm({ ...caseForm, title: e.target.value })}
                placeholder="e.g. Repeated chargeback disputes from user"
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Investigation Type</Label>
                <Select
                  value={caseForm.type}
                  onValueChange={(val: any) => setCaseForm({ ...caseForm, type: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Payment Fraud">Payment Fraud</SelectItem>
                    <SelectItem value="Promo Abuse">Promo Abuse</SelectItem>
                    <SelectItem value="Account Takeover">Account Takeover</SelectItem>
                    <SelectItem value="Fake Reviews">Fake Reviews</SelectItem>
                    <SelectItem value="Chargeback Dispute">Chargeback Dispute</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Priority</Label>
                <Select
                  value={caseForm.priority}
                  onValueChange={(val: any) => setCaseForm({ ...caseForm, priority: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical (Immediate)</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Target Entity Name *</Label>
                <Input
                  value={caseForm.targetName}
                  onChange={(e) => setCaseForm({ ...caseForm, targetName: e.target.value })}
                  placeholder="e.g. John Doe or Restaurant X"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Target Entity Type</Label>
                <Select
                  value={caseForm.targetType}
                  onValueChange={(val: any) => setCaseForm({ ...caseForm, targetType: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="vendor">Restaurant Partner</SelectItem>
                    <SelectItem value="rider">Delivery Rider</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Case Notes & Evidence</Label>
              <Textarea
                value={caseForm.notes}
                onChange={(e) => setCaseForm({ ...caseForm, notes: e.target.value })}
                placeholder="Document observed anomalies, timestamps, or payment gateway dispute refs..."
                className="text-xs min-h-[70px]"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsNewCaseModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateInvestigationCase}>
              Create Investigation Case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════════
          MODAL 3: INSPECT ORDER SIGNALS
      ═════════════════════════════════════════════ */}
      <Dialog
        open={!!selectedOrderForInspect}
        onOpenChange={(open) => !open && setSelectedOrderForInspect(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              Risk Diagnostic: Order #
              {selectedOrderForInspect?.orderNumber || selectedOrderForInspect?.id.slice(-6)}
            </DialogTitle>
          </DialogHeader>

          {selectedOrderForInspect && (
            <div className="space-y-4 py-2 text-xs">
              <div className="p-3 bg-muted/40 rounded-lg space-y-1">
                <p>
                  <strong>Customer:</strong> {selectedOrderForInspect.customerName || "Guest"}
                </p>
                <p>
                  <strong>Phone:</strong> {selectedOrderForInspect.customerPhone || "No phone"}
                </p>
                <p>
                  <strong>Restaurant:</strong>{" "}
                  {selectedOrderForInspect.restaurantName || "Partner Venue"}
                </p>
                <p>
                  <strong>Order Total:</strong> {formatINR(selectedOrderForInspect.total)}
                </p>
              </div>

              <div className="space-y-1">
                <span className="font-semibold text-foreground">Triggered Risk Signals:</span>
                <div className="flex gap-1.5 flex-wrap pt-1">
                  {(selectedOrderForInspect.signals || []).map((sig: string, idx: number) => (
                    <Badge key={idx} variant="destructive" className="text-[10px]">
                      {sig}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedOrderForInspect(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
