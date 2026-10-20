import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { doc, onSnapshot, collection, query, where, limit, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isOnlineOrder } from "@/lib/orderChannels";
import {
  Store,
  Mail,
  Phone,
  MapPin,
  Loader2,
  Wallet,
  ChevronRight,
  CheckCircle,
  Percent,
  ShieldBan,
  ShieldCheck,
  MessageSquare,
  KeyRound,
  LogIn,
  Edit,
  Clock,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { Entity360Header, Entity360Layout, Section, Fact, StatusBadge, type Tone } from "@/components/admin/entity360";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { toast } from "sonner";
import { adminActionToast } from "@/lib/admin-ops";
import { usePartnerContact } from "@/hooks/usePartnerPrivate";
import { partnerEmail } from "@/lib/onboarding";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ResetPasswordDialog } from "@/components/admin/vendors/ResetPasswordDialog";
import { VendorContactDialog } from "@/components/admin/vendors/VendorContactDialog";

const inr = (n?: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;
const toDate = (ts: unknown): Date | null => {
  try {
    return (ts as { toDate?: () => Date } | undefined)?.toDate?.() ?? null;
  } catch {
    return null;
  }
};
const isCancelled = (s?: string) => ["cancelled", "canceled", "rejected"].includes((s || "").toLowerCase());
const isDone = (s?: string) => ["delivered", "completed"].includes((s || "").toLowerCase());

interface Restaurant {
  name?: string;
  billingModel?: string;
  email?: string;
  phone?: string;
  cuisine?: string;
  city?: string;
  kycStatus?: string;
  isBlocked?: boolean;
  commissionRate?: number;
  platformCommission?: number;
  ratingAvg?: number;
  ratingCount?: number;
  ownerId?: string;
  branches?: number;
  operatingHours?: string;
  deliverySettings?: string;
}
interface OrderRow {
  id: string;
  orderNumber?: string;
  total?: number;
  status?: string;
  timestamp?: unknown;
  customerName?: string;
  /** Acquisition channel — used to exclude walk-in/QR from marketplace metrics. */
  orderSource?: string;
}
interface MenuItem {
  id: string;
  name: string;
  price: number;
  categoryId?: string;
  imageUrl?: string;
  description?: string;
}

export default function Vendor360() {
  const { id = "" } = useParams();
  const [r, setR] = useState<Restaurant | null | undefined>(undefined);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [pendingPayout, setPendingPayout] = useState(0);
  // Real lifetime commission billed to this vendor — summed from historical
  // settlement docs, NOT computed client-side as `gmv * currentRate` (which
  // silently lies whenever the rate has ever changed).
  const [lifetimeCommission, setLifetimeCommission] = useState(0);
  const [commissionDialogOpen, setCommissionDialogOpen] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [commissionInput, setCommissionInput] = useState("");
  const [savingCommission, setSavingCommission] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    cuisine: "",
    city: "",
    operatingHours: "",
    deliverySettings: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // The login email lives in partner_contact — the restaurants doc is public.
  const contact = usePartnerContact("vendor", id);

  useEffect(() => {
    if (!id) return;
    const u1 = onSnapshot(
      doc(db, "restaurants", id),
      (s) => setR(s.exists() ? (s.data() as Restaurant) : null),
      (err) => {
        console.error("Vendor360: restaurant doc listener error:", err);
        setR(null);
      },
    );
    const u2 = onSnapshot(
      query(collection(db, "orders"), where("restaurantId", "==", id), limit(100)),
      (s) => setOrders(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderRow, "id">) }))),
      (err) => {
        console.error("Vendor360: orders listener error:", err);
        setOrders([]);
      },
    );
    // Single listener over ALL settlements (not just pending), so we can
    // derive the vendor's real lifetime commission billed from historical
    // commissionAmount instead of the old `gmv * currentRate` estimate.
    const u3 = onSnapshot(
      query(
        collection(db, "vendor_settlements"),
        where("restaurantId", "==", id),
        limit(500),
      ),
      (s) => {
        let pending = 0;
        let commissionSum = 0;
        s.forEach((d) => {
          const data = d.data();
          if (data.status === "pending") {
            pending += Number(data.netPayout ?? 0) || 0;
          }
          commissionSum += Number(data.commissionAmount ?? 0) || 0;
        });
        setPendingPayout(pending);
        setLifetimeCommission(commissionSum);
      },
      (err) => {
        console.error("Vendor360: settlements listener error:", err);
        setPendingPayout(0);
        setLifetimeCommission(0);
      },
    );
    const u4 = onSnapshot(
      query(collection(db, "restaurant_items"), where("restaurantId", "==", id)),
      (s) => setMenuItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MenuItem, "id">) }))),
      (err) => {
        console.error("Vendor360: menu items listener error:", err);
        setMenuItems([]);
      },
    );
    return () => { u1(); u2(); u3(); u4(); };
  }, [id]);

  const stats = useMemo(() => {
    // Vendor360's headline "Revenue" is the marketplace revenue Kada acquired
    // for the vendor — walk-in POS and QR-menu orders are the vendor's own
    // in-store business and shouldn't inflate the marketplace metric.
    const marketplace = orders.filter(isOnlineOrder);
    const total = marketplace.length;
    const done = marketplace.filter((o) => isDone(o.status));
    const cancelled = marketplace.filter((o) => isCancelled(o.status)).length;
    const gmv = done.reduce((s, o) => s + Number(o.total || 0), 0);
    const aov = done.length ? gmv / done.length : 0;
    const cancelRate = total ? (cancelled / total) * 100 : 0;
    const completionRate = total ? (done.length / total) * 100 : 100;
    return { total, doneCount: done.length, cancelledCount: cancelled, gmv, aov, cancelRate, completionRate };
  }, [orders]);
  
  const menuStats = useMemo(() => {
    const total = menuItems.length;
    const missingImg = menuItems.filter(i => !i.imageUrl).length;
    const missingDesc = menuItems.filter(i => !i.description).length;
    const categories = new Set(menuItems.map(i => i.categoryId)).size;
    const score = total > 0 ? Math.round(((total - (missingImg + missingDesc)/2) / total) * 100) : 0;
    return { total, missingImg, missingDesc, categories, score };
  }, [menuItems]);

  if (r === undefined) {
    return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading vendor…</div>;
  }
  if (r === null) {
    return (
      <div className="max-w-md mx-auto text-center py-24">
        <Store className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="text-lg font-semibold">Vendor not found</h2>
        <Link to="/admin/vendors" className="text-sm text-primary hover:underline mt-3 inline-block">← Back to Vendors</Link>
      </div>
    );
  }

  const commission = Number(r.commissionRate ?? r.platformCommission ?? 0);
  // Absent field = commission (matches the backend default in billingModel.ts).
  const billingModel: "commission" | "subscription" =
    String(r.billingModel ?? "").toLowerCase() === "subscription" ? "subscription" : "commission";
  const kycTone: Tone = r.kycStatus === "approved" || r.kycStatus === "verified" ? "success" : r.kycStatus === "rejected" ? "danger" : "warning";

  const handleChangeCommission = () => {
    setCommissionInput(String(commission));
    setCommissionDialogOpen(true);
  };

  const handleOpenEdit = () => {
    if (!r) return;
    setEditForm({
      name: r.name || "",
      phone: r.phone || "",
      cuisine: r.cuisine || "",
      city: r.city || "",
      operatingHours: r.operatingHours || "",
      deliverySettings: r.deliverySettings || "",
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!id || !r) return;
    if (!editForm.name.trim()) {
      toast.error("Business name cannot be empty.");
      return;
    }
    setSavingEdit(true);
    try {
      await updateDoc(doc(db, "restaurants", id), {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        cuisine: editForm.cuisine.trim(),
        city: editForm.city.trim(),
        operatingHours: editForm.operatingHours.trim(),
        deliverySettings: editForm.deliverySettings.trim(),
        updatedAt: new Date().toISOString(),
      });
      toast.success("Vendor details updated successfully");
      setEditDialogOpen(false);
    } catch (e: any) {
      toast.error("Failed to update vendor: " + (e?.message || "Unknown error"));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleImpersonate = () => {
    if (!id || !r) return;
    sessionStorage.setItem("kada_impersonate_id", id);
    toast.success(`Impersonating ${r.name || "vendor"} — viewing their dashboard`);
    window.open("/dashboard", "_blank");
  };

  const handleToggleSuspend = async () => {
    if (!id || !r) return;
    try {
      await adminActionToast(
        "setVendorStatus",
        {
          restaurantId: id,
          isBlocked: !r.isBlocked,
          reason: r.isBlocked ? "Reactivated by platform administrator" : "Suspended by platform administrator",
        },
        r.isBlocked ? `${r.name || "Vendor"} reactivated` : `${r.name || "Vendor"} suspended`,
      );
      setSuspendOpen(false);
    } catch {
      // toast already handled
    }
  };

  // Commission and subscription are ALTERNATIVES.
  const setBillingModel = async (model: "commission" | "subscription") => {
    setBillingBusy(true);
    try {
      await adminActionToast(
        "setBillingModel",
        { kind: "vendor", id: id ?? "", model },
        model === "subscription"
          ? "Switched to subscription — commission waived on future settlements"
          : "Switched to commission billing",
      );
    } finally {
      setBillingBusy(false);
    }
  };

  const submitCommissionChange = async () => {
    const rate = Number(commissionInput);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error("Enter a rate between 0 and 100.");
      return;
    }
    if (!id) return;
    setSavingCommission(true);
    try {
      await adminActionToast(
        "setCommission",
        { restaurantId: id, rate },
        `Commission rate for ${r?.name ?? "vendor"} set to ${rate}%`,
      );
      setCommissionDialogOpen(false);
    } finally {
      setSavingCommission(false);
    }
  };

  return (
    <div className="space-y-6">
      <Entity360Header
        backTo="/admin/vendors"
        backLabel="Vendors"
        icon={Store}
        title={r.name || "Vendor"}
        subtitle={[r.cuisine, r.city].filter(Boolean).join(" · ") || undefined}
        status={r.isBlocked ? "SUSPENDED" : "ACTIVE"}
        statusTone={r.isBlocked ? "danger" : "success"}
        metrics={[
          { label: "Revenue", value: inr(stats.gmv) },
          { label: "Total Orders", value: stats.total },
          { label: "Avg Order Value", value: inr(stats.aov) },
          { label: "Cancellation Rate", value: `${stats.cancelRate.toFixed(1)}%`, tone: stats.cancelRate > 15 ? "danger" : stats.cancelRate > 8 ? "warning" : "success" },
          { label: "Avg Prep Time", value: "24m" },
          { label: "Rating", value: r.ratingAvg ? `${r.ratingAvg.toFixed(1)}★` : "—", hint: r.ratingCount ? `${r.ratingCount} reviews` : undefined },
          { label: "Commission Rate", value: commission ? `${commission}%` : "—" },
        ]}
      />
      
      {/* ── Action Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setResetPasswordOpen(true)}
          className="gap-1.5 border-primary/40 text-primary hover:bg-primary/5 font-medium"
        >
          <KeyRound className="w-4 h-4" /> Reset Password
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleImpersonate}
          className="gap-1.5 font-medium"
        >
          <LogIn className="w-4 h-4 text-primary" /> Login as Vendor
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenEdit}
          className="gap-1.5"
        >
          <Edit className="w-4 h-4" /> Edit Details
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleChangeCommission}
          className="gap-1.5"
        >
          <Percent className="w-4 h-4" /> Change Commission
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setContactOpen(true)}
          className="gap-1.5 border-emerald-500/30 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
        >
          <MessageSquare className="w-4 h-4 text-emerald-600" /> Contact Vendor
        </Button>
        <Button
          variant={r.isBlocked ? "outline" : "destructive"}
          size="sm"
          className={r.isBlocked ? "gap-1.5 text-emerald-600 border-emerald-500/30 hover:bg-emerald-50" : "gap-1.5"}
          onClick={() => setSuspendOpen(true)}
        >
          {r.isBlocked ? <ShieldCheck className="w-4 h-4" /> : <ShieldBan className="w-4 h-4" />}
          {r.isBlocked ? "Reactivate Vendor" : "Suspend Vendor"}
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="menu">Menu</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Entity360Layout
            main={
              <div className="space-y-6">
                <Section title="Business Info">
                  <div className="grid grid-cols-2 gap-4">
                    <Fact label="Name">{r.name || "—"}</Fact>
                    <Fact label="Email">{partnerEmail(contact, r) || "—"}</Fact>
                    <Fact label="Phone">{r.phone || "—"}</Fact>
                    <Fact label="Location">{[r.cuisine, r.city].filter(Boolean).join(" · ") || "—"}</Fact>
                    <Fact label="Branches">{r.branches || 1}</Fact>
                    <Fact label="Operating Hours">{r.operatingHours || "Standard"}</Fact>
                    <Fact label="Delivery Settings">{r.deliverySettings || "Default"}</Fact>
                  </div>
                </Section>
                <Section title="Compliance & Operations">
                  <div className="grid grid-cols-2 gap-4">
                     <Fact label="KYC Status"><StatusBadge label={(r.kycStatus || "pending").toUpperCase()} tone={kycTone} /></Fact>
                     <Fact label="Account Status"><StatusBadge label={r.isBlocked ? "SUSPENDED" : "ACTIVE"} tone={r.isBlocked ? "danger" : "success"} /></Fact>
                     <Fact label="Delivery Mode">{r.deliverySettings || "Standard Delivery"}</Fact>
                     <Fact label="Commission Model"><strong className="capitalize">{billingModel}</strong> ({commission}%)</Fact>
                  </div>
                </Section>
                <Section title="Account & Security">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <Fact label="Login Email">{partnerEmail(contact, r) || r.email || "—"}</Fact>
                      <Fact label="Auth UID"><span className="font-mono text-xs text-muted-foreground">{r.ownerId || id}</span></Fact>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setResetPasswordOpen(true)}
                        className="text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Reset Password
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleImpersonate}
                        className="text-xs gap-1.5"
                      >
                        <LogIn className="w-3.5 h-3.5 text-primary" />
                        Login as User
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenEdit}
                        className="text-xs gap-1.5"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        Edit Info
                      </Button>
                    </div>
                  </div>
                </Section>
              </div>
            }
            rail={
              <Section title="Related">
                <Link to="/admin/vendors?tab=onboarding" className="flex items-center justify-between py-1.5 text-sm hover:text-primary transition-colors"><span>KYC review</span><ChevronRight className="h-4 w-4" /></Link>
                <Link to="/admin/quality" className="flex items-center justify-between py-1.5 text-sm hover:text-primary transition-colors"><span>Reviews</span><ChevronRight className="h-4 w-4" /></Link>
                <button onClick={() => setResetPasswordOpen(true)} className="w-full flex items-center justify-between py-1.5 text-sm hover:text-primary transition-colors text-left"><span>Credentials & Auth</span><ChevronRight className="h-4 w-4" /></button>
                <button onClick={handleImpersonate} className="w-full flex items-center justify-between py-1.5 text-sm hover:text-primary transition-colors text-left"><span>Open Merchant App</span><ExternalLink className="h-4 w-4" /></button>
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
                      <th className="px-4 py-2 font-medium">Customer</th>
                      <th className="px-4 py-2 font-medium">Total</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.sort((a,b) => (toDate(b.timestamp)?.getTime() ?? 0) - (toDate(a.timestamp)?.getTime() ?? 0)).map(o => (
                      <tr key={o.id} className="hover:bg-muted/50">
                        <td className="px-4 py-2"><Link to={`/admin/orders/${o.id}`} className="text-primary hover:underline">#{o.orderNumber || o.id.slice(-6)}</Link></td>
                        <td className="px-4 py-2">{toDate(o.timestamp)?.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) ?? "—"}</td>
                        <td className="px-4 py-2">{o.customerName || "Guest"}</td>
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

        <TabsContent value="menu">
          <Section title="Catalog Health Summary">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 border rounded-lg bg-card">
                <div className="text-sm text-muted-foreground mb-1">Health Score</div>
                <div className="text-2xl font-bold flex items-center gap-2">
                  {menuStats.score}%
                  <StatusBadge label={menuStats.score > 80 ? "Good" : "Needs Work"} tone={menuStats.score > 80 ? "success" : "warning"} />
                </div>
              </div>
              <div className="p-4 border rounded-lg bg-card">
                <div className="text-sm text-muted-foreground mb-1">Total Items</div>
                <div className="text-2xl font-bold">{menuStats.total}</div>
              </div>
              <div className="p-4 border rounded-lg bg-card">
                <div className="text-sm text-muted-foreground mb-1">Categories</div>
                <div className="text-2xl font-bold">{menuStats.categories}</div>
              </div>
              <div className="p-4 border rounded-lg bg-card">
                <div className="text-sm text-muted-foreground mb-1">Missing Info</div>
                <div className="text-sm">
                  <span className="text-danger font-medium">{menuStats.missingImg}</span> without images<br/>
                  <span className="text-danger font-medium">{menuStats.missingDesc}</span> without descriptions
                </div>
              </div>
            </div>
            <Link to="/admin/quality?tab=catalog" className="text-sm text-primary hover:underline flex items-center">
              Manage Catalog <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </Section>
        </TabsContent>

        <TabsContent value="financial">
          <Section title="Financial Overview">
            <div className="grid grid-cols-2 gap-4">
              <Fact label="Commission Rate">{commission ? `${commission}%` : "—"}</Fact>
              <Fact label="Total Commission Billed">{inr(lifetimeCommission)}</Fact>
              <Fact label="Outstanding Balance">{inr(pendingPayout)}</Fact>
              <Fact label="Settlement History"><Link to="/admin/finance?tab=settlements" className="text-primary hover:underline">View Ledger</Link></Fact>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="performance">
          <Section title="Performance & Fulfillment Metrics">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Fact label="Fulfillment Rate">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{stats.completionRate.toFixed(1)}%</span>
                  <StatusBadge
                    label={stats.completionRate >= 90 ? "Excellent" : stats.completionRate >= 75 ? "Moderate" : "Low"}
                    tone={stats.completionRate >= 90 ? "success" : stats.completionRate >= 75 ? "warning" : "danger"}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{stats.doneCount} completed of {stats.total} total</p>
              </Fact>
              <Fact label="Cancellation Rate">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{stats.cancelRate.toFixed(1)}%</span>
                  <StatusBadge
                    label={stats.cancelRate <= 8 ? "Low" : stats.cancelRate <= 15 ? "Elevated" : "High"}
                    tone={stats.cancelRate <= 8 ? "success" : stats.cancelRate <= 15 ? "warning" : "danger"}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{stats.cancelledCount} cancelled orders</p>
              </Fact>
              <Fact label="Avg Order Value (AOV)">
                <span className="text-lg font-bold text-foreground">{inr(stats.aov)}</span>
              </Fact>
              <Fact label="Customer Rating">
                <span className="text-lg font-bold text-foreground">{r.ratingAvg ? `${r.ratingAvg.toFixed(1)} ★` : "—"}</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">{r.ratingCount ? `${r.ratingCount} reviews` : "No reviews yet"}</p>
              </Fact>
              <Fact label="Catalog Completeness">
                <span className="text-lg font-bold text-foreground">{menuStats.score}%</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">{menuStats.total} active dishes listed</p>
              </Fact>
              <Fact label="Lifetime Marketplace GMV">
                <span className="text-lg font-bold text-emerald-600">{inr(stats.gmv)}</span>
              </Fact>
            </div>
          </Section>
        </TabsContent>
      </Tabs>

      {/* ── Suspend / Reactivate Confirmation ── */}
      <ConfirmationDialog
        isOpen={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        onConfirm={handleToggleSuspend}
        title={r.isBlocked ? "Reactivate Vendor" : "Suspend Vendor"}
        description={
          r.isBlocked
            ? `Are you sure you want to reactivate ${r.name}? They will immediately regain dashboard access and become eligible for marketplace orders.`
            : `Are you sure you want to suspend ${r.name}? They will be blocked from dashboard access and hidden from customer ordering.`
        }
        confirmText={r.isBlocked ? "Reactivate" : "Suspend"}
        isDanger={!r.isBlocked}
      />

      {/* ── Edit Business Details Dialog ── */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Vendor Details</DialogTitle>
            <DialogDescription>
              Update business details, contact information, and operating hours for {r.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Business Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                className="h-9 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Phone Number</Label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">City / District</Label>
                <Input
                  value={editForm.city}
                  onChange={(e) => setEditForm(prev => ({ ...prev, city: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cuisine Specialties</Label>
              <Input
                placeholder="e.g. North Indian, Chinese, Biryani"
                value={editForm.cuisine}
                onChange={(e) => setEditForm(prev => ({ ...prev, cuisine: e.target.value }))}
                className="h-9 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Operating Hours</Label>
                <Input
                  placeholder="e.g. 10:00 AM - 11:00 PM"
                  value={editForm.operatingHours}
                  onChange={(e) => setEditForm(prev => ({ ...prev, operatingHours: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Delivery Mode</Label>
                <Input
                  placeholder="e.g. Self, Marketplace"
                  value={editForm.deliverySettings}
                  onChange={(e) => setEditForm(prev => ({ ...prev, deliverySettings: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(false)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Dialog ── */}
      <ResetPasswordDialog
        open={resetPasswordOpen}
        onOpenChange={setResetPasswordOpen}
        vendor={{
          id,
          name: r.name || "Vendor",
          email: partnerEmail(contact, r) || r.email,
          phone: r.phone,
        }}
      />

      {/* ── Vendor Contact Dialog ── */}
      <VendorContactDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        vendor={{
          id,
          name: r.name || "Vendor",
          email: partnerEmail(contact, r) || r.email,
          phone: r.phone,
          city: r.city,
        }}
      />

      {/* ── Commission Dialog ── */}
      <Dialog open={commissionDialogOpen} onOpenChange={setCommissionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change commission rate</DialogTitle>
            <DialogDescription>
              Applied to future orders. Historical settlements keep their
              original rate. Requires platform-admin or finance-manager role.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="commission-rate">Commission rate (%)</Label>
            <Input
              id="commission-rate"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={commissionInput}
              onChange={(e) => setCommissionInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && submitCommissionChange()}
            />
            <p className="text-xs text-muted-foreground">Current: {commission}%</p>
          </div>

          {/* Billing model — the two models are mutually exclusive. */}
          <div className="space-y-2 border-t pt-4">
            <Label>Billing model</Label>
            <p className="text-xs text-muted-foreground">
              A subscription vendor pays a flat recurring fee and is charged
              <strong> 0% commission</strong> on future settlements. A commission
              vendor pays the rate above and no subscription fee.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant={billingModel === "commission" ? "default" : "outline"}
                size="sm"
                disabled={billingBusy || billingModel === "commission"}
                onClick={() => setBillingModel("commission")}
              >
                Commission
              </Button>
              <Button
                variant={billingModel === "subscription" ? "default" : "outline"}
                size="sm"
                disabled={billingBusy || billingModel === "subscription"}
                onClick={() => setBillingModel("subscription")}
              >
                Subscription
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1">
              Currently: <strong className="capitalize">{billingModel}</strong>
              {billingModel === "subscription" && " · commission waived"}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommissionDialogOpen(false)} disabled={savingCommission}>
              Cancel
            </Button>
            <Button onClick={submitCommissionChange} disabled={savingCommission}>
              {savingCommission ? "Saving…" : "Save new rate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
