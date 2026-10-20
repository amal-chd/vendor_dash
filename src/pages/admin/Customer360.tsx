import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { doc, onSnapshot, collection, query, where, limit, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { User, Mail, Phone, Wallet, Crown, Gift, Loader2, ChevronRight, CheckCircle, XCircle, Clock, Bell, ShieldBan } from "lucide-react";
import { Entity360Header, Entity360Layout, Section, Fact, StatusBadge, Timeline, type TimelineEvent } from "@/components/admin/entity360";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { adminActionToast } from "@/lib/admin-ops";
import { runOp } from "@/lib/opFeedback";
import { promptDialog } from "@/components/admin/core/asyncDialogs";

const inr = (n?: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;
const toDate = (ts: unknown): Date | null => {
  try {
    return (ts as { toDate?: () => Date } | undefined)?.toDate?.() ?? null;
  } catch {
    return null;
  }
};
const isDone = (s?: string) => ["delivered", "completed"].includes((s || "").toLowerCase());
const isCancelled = (s?: string) => ["cancelled", "canceled", "rejected"].includes((s || "").toLowerCase());

interface Customer {
  name?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  city?: string;
  walletBalance?: number;
  goldUntil?: unknown;
  isGold?: boolean;
  loyaltyPoints?: number;
  referralCount?: number;
  referralEarnings?: number;
  createdAt?: unknown;
  /** Written by setCustomerStatus — "active" | "banned". */
  accountStatus?: string;
  isBanned?: boolean;
}
interface OrderRow {
  id: string;
  orderNumber?: string;
  total?: number;
  status?: string;
  restaurantName?: string;
  timestamp?: unknown;
}
interface WalletTx {
  id: string;
  amount: number;
  type: string;
  timestamp: unknown;
  description?: string;
}

export default function Customer360() {
  const { id = "" } = useParams();
  const [c, setC] = useState<Customer | null | undefined>(undefined);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([]);
  const [suspendOpen, setSuspendOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const u1 = onSnapshot(doc(db, "customer_users", id), (s) => setC(s.exists() ? (s.data() as Customer) : null), () => setC(null));
    const u2 = onSnapshot(
      query(collection(db, "orders"), where("customerUid", "==", id), limit(100)),
      (s) => setOrders(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderRow, "id">) }))),
      () => setOrders([]),
    );
    const u3 = onSnapshot(
      query(collection(db, `customer_users/${id}/wallet_transactions`), limit(50)),
      (s) => setWalletTxs(s.docs.map((d) => ({ id: d.id, ...d.data() } as WalletTx))),
      () => setWalletTxs([]),
    );
    return () => { u1(); u2(); u3(); };
  }, [id]);

  const stats = useMemo(() => {
    const done = orders.filter((o) => isDone(o.status));
    const gmv = done.reduce((s, o) => s + Number(o.total || 0), 0);
    const cancelled = orders.filter((o) => isCancelled(o.status)).length;
    return {
      gmv,
      orders: orders.length,
      aov: done.length ? gmv / done.length : 0,
      cancelRate: orders.length ? (cancelled / orders.length) * 100 : 0,
    };
  }, [orders]);

  if (c === undefined) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading customer…</div>;
  if (c === null) return <div className="text-center py-24">Customer not found</div>;

  const goldUntil = toDate(c.goldUntil);
  const isGold = c.isGold || (goldUntil ? goldUntil > new Date() : false);
  const name = c.name || c.displayName || "Customer";

  const isBanned = c.isBanned === true || c.accountStatus === "banned";

  // These three used to prompt, then toast "Wallet adjusted" / "Notification
  // sent" / "Account suspended" without doing anything. They now run the same
  // server actions the Customers directory uses.
  const handleAdjustWallet = async () => {
    const raw = await promptDialog({
      title: `Adjust ${name}'s wallet`,
      description: `Current balance ${inr(c.walletBalance)}. Use a negative amount to deduct.`,
      label: "Amount (₹)",
      inputMode: "decimal",
      placeholder: "e.g. 150 or -50",
      required: true,
      validate: (v) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? null : "Enter a non-zero amount."),
      confirmLabel: "Next",
    });
    if (raw === null) return;
    const amount = Number(raw);
    const reason = await promptDialog({
      title: `${amount > 0 ? "Credit" : "Deduct"} ${inr(Math.abs(amount))} — reason`,
      description: "Recorded in the audit log and shown on the customer's wallet history.",
      placeholder: "e.g. Goodwill credit for a late order",
      multiline: true,
      required: true,
      confirmLabel: amount > 0 ? "Credit wallet" : "Deduct from wallet",
      destructive: amount < 0,
    });
    if (reason === null) return;
    try {
      await adminActionToast(
        "adjustWallet",
        { uid: id, amount, reason },
        `Wallet ${amount > 0 ? "credited" : "debited"} by ${inr(Math.abs(amount))}`,
      );
    } catch {
      /* adminActionToast already showed the server's reason */
    }
  };

  const handleNotify = async () => {
    const body = await promptDialog({
      title: `Message ${name}`,
      description: "Appears in the notification bell in their Kada app.",
      label: "Message",
      multiline: true,
      required: true,
      confirmLabel: "Send",
    });
    if (body === null) return;
    await runOp(
      () =>
        addDoc(collection(db, "customer_users", id, "notifications"), {
          title: "Message from Kada",
          body,
          type: "admin",
          read: false,
          timestamp: serverTimestamp(),
        }),
      "Notification sent to their app",
    );
  };

  const handleSuspend = async (reason?: string) => {
    try {
      await adminActionToast(
        "setCustomerStatus",
        { uid: id, status: isBanned ? "active" : "banned", reason: reason ?? "" },
        isBanned ? "Customer reinstated" : "Customer suspended",
      );
      setSuspendOpen(false);
    } catch {
      /* adminActionToast already showed the server's reason; keep the dialog open */
    }
  };

  const activityEvents: TimelineEvent[] = [
    { id: '1', title: 'Account created', timestamp: toDate(c.createdAt) || new Date(0), icon: User, tone: 'neutral' },
    ...orders.map(o => ({
      id: o.id,
      title: `Order ${o.orderNumber || o.id.slice(-6)} ${o.status || ""}`,
      description: `${o.restaurantName || "Vendor"} - ${inr(o.total)}`,
      timestamp: toDate(o.timestamp) || new Date(0),
      icon: isDone(o.status) ? CheckCircle : isCancelled(o.status) ? XCircle : Clock,
      tone: isDone(o.status) ? 'success' as const : isCancelled(o.status) ? 'danger' as const : 'info' as const,
    }))
  ].sort((a, b) => (b.timestamp as Date).getTime() - (a.timestamp as Date).getTime()).slice(0, 20) as TimelineEvent[];

  return (
    <div className="space-y-6">
      <Entity360Header
        backTo="/admin/customers"
        backLabel="Customers"
        icon={User}
        title={name}
        subtitle={[c.email, c.phone].filter(Boolean).join(" · ") || undefined}
        status={isBanned ? "SUSPENDED" : isGold ? "GOLD" : "ACTIVE"}
        statusTone={isBanned ? "danger" : isGold ? "warning" : "success"}
        metrics={[
          { label: "Total Orders", value: stats.orders },
          { label: "Lifetime GMV", value: inr(stats.gmv) },
          { label: "Avg Order Value", value: inr(stats.aov) },
          { label: "Cancellation Rate", value: `${stats.cancelRate.toFixed(1)}%`, tone: stats.cancelRate > 20 ? "danger" : stats.cancelRate > 10 ? "warning" : "success" },
          { label: "Wallet Balance", value: inr(c.walletBalance) },
          { label: "Loyalty Points", value: c.loyaltyPoints ?? 0 },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleAdjustWallet}><Wallet className="w-4 h-4 mr-2" /> Adjust wallet</Button>
        <Button variant="outline" size="sm" onClick={handleNotify}><Bell className="w-4 h-4 mr-2" /> Send notification</Button>
        <Button variant={isBanned ? "outline" : "destructive"} size="sm" onClick={() => setSuspendOpen(true)}>
          <ShieldBan className="w-4 h-4 mr-2" /> {isBanned ? "Reinstate account" : "Suspend account"}
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Entity360Layout
            main={
              <div className="space-y-6">
                <Section title="Customer Profile">
                  <div className="grid grid-cols-2 gap-4">
                    <Fact label="Name">{name}</Fact>
                    <Fact label="Email">{c.email || "—"}</Fact>
                    <Fact label="Phone">{c.phone || "—"}</Fact>
                    <Fact label="City">{c.city || "—"}</Fact>
                    <Fact label="Joined Date">{toDate(c.createdAt)?.toLocaleDateString("en-IN") ?? "—"}</Fact>
                    <Fact label="Account Status"><StatusBadge label={isBanned ? "Suspended" : "Active"} tone={isBanned ? "danger" : "success"} /></Fact>
                  </div>
                </Section>
                <Section title="Loyalty & Wallet">
                  <div className="grid grid-cols-2 gap-4">
                    <Fact label="Wallet Balance">{inr(c.walletBalance)}</Fact>
                    <Fact label="Loyalty Tier">{isGold ? "Gold" : "Standard"}</Fact>
                    <Fact label="Loyalty Points">{c.loyaltyPoints ?? 0}</Fact>
                    {goldUntil && <Fact label="Gold Expiry">{goldUntil.toLocaleDateString("en-IN")}</Fact>}
                  </div>
                </Section>
              </div>
            }
            rail={
              <Section title="Referrals">
                <Fact label="Referred"><Gift className="h-3.5 w-3.5 inline mr-1 text-primary" />{c.referralCount ?? 0} friends</Fact>
                <Fact label="Earned">{inr(c.referralEarnings)}</Fact>
                <Link to="/admin/customers?tab=referrals" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">Referrals ledger <ChevronRight className="h-3 w-3" /></Link>
              </Section>
            }
          />
        </TabsContent>

        <TabsContent value="orders">
          <Section title="Recent Orders">
            {orders.length === 0 ? <p className="text-sm text-muted-foreground">No orders found.</p> : (
              <div className="border rounded-md">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Order #</th>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Vendor</th>
                      <th className="px-4 py-2 font-medium">Total</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.sort((a,b) => (toDate(b.timestamp)?.getTime() ?? 0) - (toDate(a.timestamp)?.getTime() ?? 0)).map(o => (
                      <tr key={o.id} className="hover:bg-muted/50">
                        <td className="px-4 py-2"><Link to={`/admin/orders/${o.id}`} className="text-primary hover:underline">#{o.orderNumber || o.id.slice(-6)}</Link></td>
                        <td className="px-4 py-2">{toDate(o.timestamp)?.toLocaleDateString("en-IN") ?? "—"}</td>
                        <td className="px-4 py-2">{o.restaurantName || "—"}</td>
                        <td className="px-4 py-2">{inr(o.total)}</td>
                        <td className="px-4 py-2"><StatusBadge label={(o.status || "—").toUpperCase()} tone={isDone(o.status) ? "success" : isCancelled(o.status) ? "danger" : "info"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="financial">
          <Section title="Wallet Transactions">
             {walletTxs.length === 0 ? <p className="text-sm text-muted-foreground">No transactions.</p> : (
               <div className="border rounded-md">
                 <table className="w-full text-sm text-left">
                   <thead className="bg-muted text-muted-foreground">
                     <tr>
                       <th className="px-4 py-2 font-medium">Date</th>
                       <th className="px-4 py-2 font-medium">Type</th>
                       <th className="px-4 py-2 font-medium">Amount</th>
                       <th className="px-4 py-2 font-medium">Description</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y">
                     {walletTxs.sort((a,b) => (toDate(b.timestamp)?.getTime() ?? 0) - (toDate(a.timestamp)?.getTime() ?? 0)).map(t => (
                       <tr key={t.id}>
                         <td className="px-4 py-2">{toDate(t.timestamp)?.toLocaleDateString("en-IN") ?? "—"}</td>
                         <td className="px-4 py-2">{t.type}</td>
                         <td className={`px-4 py-2 ${t.amount < 0 ? "text-danger" : "text-success"}`}>{t.amount > 0 ? "+" : ""}{inr(t.amount)}</td>
                         <td className="px-4 py-2">{t.description || "—"}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             )}
          </Section>
        </TabsContent>

        <TabsContent value="activity">
          <Section title="Activity Timeline">
            <Timeline events={activityEvents} />
          </Section>
        </TabsContent>
      </Tabs>

      <ConfirmationDialog
        isOpen={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        onConfirm={handleSuspend}
        title={isBanned ? `Reinstate ${name}?` : `Suspend ${name}?`}
        description={isBanned ? "They can sign in and order again." : "They can't place orders until reinstated."}
        requireReason
        reasonLabel="Reason (kept in the audit log)"
        confirmText={isBanned ? "Reinstate" : "Suspend"}
        isDanger={!isBanned}
      />
    </div>
  );
}
