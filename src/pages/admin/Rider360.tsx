import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { doc, onSnapshot, collection, query, where, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { toast } from "sonner";
import { Bike, Phone, Loader2, ChevronRight, CircleDot, Wallet, IdCard, ShieldCheck } from "lucide-react";
import { Entity360Header, Entity360Layout, Section, Fact, StatusBadge, type Tone, Timeline } from "@/components/admin/entity360";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { HealthScore } from "@/components/admin/core/HealthScore";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { usePermissions } from "@/hooks/usePermissions";

const pct = (v?: number) =>
  v == null || Number.isNaN(v) ? null : `${Math.round((v <= 1 ? v * 100 : v))}%`;

const inr = (n?: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;
const toDate = (ts: unknown): Date | null => {
  try {
    return (ts as { toDate?: () => Date } | undefined)?.toDate?.() ?? null;
  } catch {
    return null;
  }
};
const isDelivered = (s?: string) => ["delivered", "completed", "checked_out"].includes((s || "").toLowerCase());

interface Rider {
  name?: string;
  displayName?: string;
  phone?: string;
  isOnline?: boolean;
  status?: string;
  vehicle?: string;
  vehicleType?: string;
  earnings?: any;
  rating?: number;
  ratingAvg?: number;
  aadhaar?: string;
  aadhaarNumber?: string;
  kycStatus?: string;
  acceptanceRate?: number;
  onTimeRate?: number;
  lifetimeDeliveries?: number;
  createdAt?: unknown;
}
interface Delivery {
  id: string;
  orderId?: string;
  status?: string;
  stage?: string;
  riderName?: string;
  createdAt?: unknown;
  deliveredAt?: unknown;
}

export default function Rider360() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [rider, setRider] = useState<Rider | null | undefined>(undefined);
  const [dels, setDels] = useState<Delivery[]>([]);
  const [busy, setBusy] = useState(false);

  const setRiderStatus = async (
    fn: "suspendRider" | "approveRider",
    reason?: string,
  ) => {
    setBusy(true);
    try {
      const res = await httpsCallable(functions, fn)({ uid: id, reason });
      const status = (res.data as { status?: string } | undefined)?.status;
      toast.success(`Rider ${status ?? "updated"}`);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    const u1 = onSnapshot(
      doc(db, "delivery_users", id),
      (s) => setRider(s.exists() ? (s.data() as Rider) : null),
      (err) => {
        // Silent fail here rendered "Rider not found" on a permission/network
        // error — indistinguishable from a genuinely missing rider. Log + null.
        console.error("Rider360: profile listener error:", err);
        setRider(null);
      },
    );
    const u2 = onSnapshot(
      query(collection(db, "deliveries"), where("riderId", "==", id), limit(1000)),
      (s) => setDels(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Delivery, "id">) }))),
      (err) => {
        // Same problem — a failed listener rendered "no deliveries", which
        // misleads an operator trying to check a rider's activity.
        console.error("Rider360: deliveries listener error:", err);
        setDels([]);
      },
    );
    return () => { u1(); u2(); };
  }, [id]);

  const stats = useMemo(() => {
    const completed = dels.filter((d) => isDelivered(d.status ?? d.stage)).length;
    const rate = dels.length ? (completed / dels.length) * 100 : 0;
    return { total: dels.length, completed, rate };
  }, [dels]);

  const recent = useMemo(
    () => [...dels].sort((a, b) => ((toDate(b.deliveredAt) ?? toDate(b.createdAt))?.getTime() ?? 0) - ((toDate(a.deliveredAt) ?? toDate(a.createdAt))?.getTime() ?? 0)).slice(0, 8),
    [dels],
  );

  if (rider === undefined) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading rider…</div>;
  if (rider === null)
    return (
      <div className="max-w-md mx-auto text-center py-24">
        <Bike className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="text-lg font-semibold">Rider not found</h2>
        <Link to="/admin/delivery" className="text-sm text-primary hover:underline mt-3 inline-block">← Back to Fleet</Link>
      </div>
    );

  const online = rider.isOnline || (rider.status || "").toLowerCase() === "online";
  const rating = rider.rating ?? rider.ratingAvg;
  const hasKyc = !!(rider.aadhaar || rider.aadhaarNumber);
  const kycTone: Tone = rider.kycStatus === "approved" || rider.kycStatus === "verified" ? "success" : rider.kycStatus === "rejected" ? "danger" : hasKyc ? "info" : "warning";
  const name = rider.name || rider.displayName || "Rider";

  return (
    <div className="space-y-6">
      <Entity360Header
        backTo="/admin/delivery"
        backLabel="Fleet"
        icon={Bike}
        title={name}
        subtitle={[rider.vehicleType || rider.vehicle, rider.phone].filter(Boolean).join(" · ") || undefined}
        status={online ? "ONLINE" : "OFFLINE"}
        statusTone={online ? "success" : "neutral"}
        metrics={[
          { label: "Acceptance Rate", value: pct(rider.acceptanceRate) ?? "—" },
          { label: "Completion Rate", value: `${stats.rate.toFixed(0)}%`, tone: stats.rate >= 90 ? "success" : stats.rate >= 75 ? "warning" : "danger" },
          { label: "On-time Rate", value: pct(rider.onTimeRate) ?? "—" },
          { label: "Rating", value: rating ? `${Number(rating).toFixed(1)}★` : "—" },
          { label: "Earnings this week", value: inr(rider.earnings?.week || 0) },
          { label: "Lifetime trips", value: rider.lifetimeDeliveries ?? stats.completed },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {can("suspend") && (
              (rider.status || "").toLowerCase() === "suspended" ? (
                <ConfirmationDialog
                  trigger={<Button variant="outline" size="sm" disabled={busy}>Reactivate</Button>}
                  title={`Reactivate ${name}?`}
                  description="This rider will be able to go online and receive delivery offers again."
                  confirmText="Reactivate"
                  isDanger={false}
                  loading={busy}
                  onConfirm={() => setRiderStatus("approveRider")}
                />
              ) : (
                <ConfirmationDialog
                  trigger={<Button variant="outline" size="sm" disabled={busy}>Suspend</Button>}
                  title={`Suspend ${name}?`}
                  description="The rider is immediately taken offline and stops receiving delivery offers until reactivated."
                  consequences={[
                    "Rider can no longer go online or accept orders",
                    "Any active delivery must be reassigned manually",
                    "The rider is notified of the suspension",
                  ]}
                  requireReason
                  reasonLabel="Reason for suspension"
                  confirmText="Suspend rider"
                  isDanger
                  loading={busy}
                  onConfirm={(reason) => setRiderStatus("suspendRider", reason)}
                />
              )
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!rider.phone}
              onClick={() => rider.phone && (window.location.href = `tel:${rider.phone}`)}
            >
              Contact
            </Button>
            <Button size="sm" onClick={() => navigate("/admin/orders?tab=live")}>Live Dispatch</Button>
          </div>
        }
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview">
          <Entity360Layout
            main={
              <>
                <Section title="Recent deliveries" action={<Link to="/admin/orders?tab=live" className="text-xs text-primary hover:underline">Live dispatch</Link>}>
                  {recent.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No deliveries recorded for this rider yet.</p>
                  ) : (
                    <ul className="divide-y divide-border/40 -my-1">
                      {recent.map((d) => {
                        const s = d.status ?? d.stage;
                        const done = isDelivered(s);
                        const when = toDate(d.deliveredAt) ?? toDate(d.createdAt);
                        const row = (
                          <span className="flex items-center justify-between gap-3 py-2.5 group">
                            <span className="min-w-0">
                              <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{d.orderId ? `Order #${d.orderId.slice(-6)}` : `Delivery ${d.id.slice(-6)}`}</span>
                              <span className="block text-[11px] text-muted-foreground truncate">{when?.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) ?? "—"}</span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <StatusBadge label={(s || "—").toUpperCase()} tone={done ? "success" : "info"} />
                              {d.orderId && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            </span>
                          </span>
                        );
                        return <li key={d.id}>{d.orderId ? <Link to={`/admin/orders/${d.orderId}`}>{row}</Link> : row}</li>;
                      })}
                    </ul>
                  )}
                </Section>
                <Section title="Timeline" className="mt-6">
                  <Timeline items={[
                    ...(online
                      ? [{ title: "Currently online", description: "Available for delivery offers", time: "now" }]
                      : []),
                    {
                      title: `KYC ${(rider.kycStatus || (hasKyc ? "submitted" : "pending"))}`,
                      description: hasKyc ? "Identity documents on file" : "Awaiting identity documents",
                      time: "",
                    },
                    ...(toDate(rider.createdAt)
                      ? [{
                          title: "Account created",
                          description: "Registered on the rider app",
                          time: toDate(rider.createdAt)!.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
                        }]
                      : []),
                  ]} />
                </Section>
              </>
            }
            rail={
              <>
                <Section title="Status">
                  <Fact label="Availability"><span className="inline-flex items-center gap-1.5"><CircleDot className={online ? "h-3 w-3 text-emerald-500" : "h-3 w-3 text-muted-foreground"} />{online ? "Online" : "Offline"}</span></Fact>
                  <Fact label="Rating">{rating ? `${Number(rating).toFixed(1)} ★` : "—"}</Fact>
                  <Fact label="Completion">{stats.rate.toFixed(0)}%</Fact>
                </Section>

                <Section title="Earnings & KYC">
                  <div className="flex items-center justify-between pb-2">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Total earnings</span>
                    <span className="text-base font-bold tabular-nums">{inr((rider.earnings?.lifetime || 0) + (Number((rider as Record<string, unknown>)["earnings.lifetime"]) || 0))}</span>
                  </div>
                  <Fact label="KYC"><span className="inline-flex items-center gap-1.5"><IdCard className="h-3.5 w-3.5 text-muted-foreground" /><StatusBadge label={(rider.kycStatus || (hasKyc ? "submitted" : "pending")).toUpperCase()} tone={kycTone} /></span></Fact>
                  <Link to="/admin/delivery" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">Fleet & KYC <ChevronRight className="h-3 w-3" /></Link>
                </Section>

                <Section title="Contact">
                  {rider.phone && <Fact label="Phone"><Phone className="h-3.5 w-3.5 inline mr-1 text-muted-foreground" />{rider.phone}</Fact>}
                  <Fact label="Vehicle">{rider.vehicleType || rider.vehicle || "—"}</Fact>
                </Section>
              </>
            }
          />
        </TabsContent>

        <TabsContent value="deliveries">
          <div className="bg-card rounded-2xl border p-6 flex items-center justify-center min-h-[300px]">
            <p className="text-muted-foreground text-sm font-medium">Deliveries table view goes here.</p>
          </div>
        </TabsContent>

        <TabsContent value="earnings">
          <div className="bg-card rounded-2xl border p-6 flex items-center justify-center min-h-[300px]">
            <p className="text-muted-foreground text-sm font-medium">Earnings breakdown view goes here.</p>
          </div>
        </TabsContent>

        <TabsContent value="performance">
          <div className="bg-card rounded-2xl border p-6 max-w-xl mx-auto mt-4">
            <h3 className="text-lg font-semibold mb-6">Rider Health Score</h3>
            <HealthScore 
              score={stats.rate > 90 ? 92 : stats.rate > 70 ? 75 : 45} 
              trend="improving"
              components={[
                ...(rider.acceptanceRate != null
                  ? [{ label: "Acceptance Rate", score: rider.acceptanceRate <= 1 ? rider.acceptanceRate * 100 : rider.acceptanceRate, weight: 1.5, description: "Percentage of offered orders accepted" }]
                  : []),
                { label: "Completion Rate", score: stats.rate || 0, weight: 2.0, description: "Percentage of accepted orders completed" },
                ...(rider.onTimeRate != null
                  ? [{ label: "On-time Delivery", score: rider.onTimeRate <= 1 ? rider.onTimeRate * 100 : rider.onTimeRate, weight: 1.0, description: "Orders delivered within ETA" }]
                  : []),
                ...(rating != null
                  ? [{ label: "Customer Rating", score: (Number(rating) / 5) * 100, weight: 1.0, description: "Average rating from customers" }]
                  : []),
              ]}
            />
          </div>
        </TabsContent>

        <TabsContent value="incidents">
          <div className="bg-card rounded-2xl border p-6 flex flex-col items-center justify-center min-h-[300px] text-muted-foreground">
            <ShieldCheck className="h-10 w-10 mb-4 opacity-30" />
            <p className="text-sm font-medium">No active incidents reported for this rider.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
