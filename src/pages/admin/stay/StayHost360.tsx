import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Entity360Layout, Entity360Header, Section, Fact } from "@/components/admin/entity360";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { listenCollection, useLiveCollection } from "@/hooks/useLiveCollection";
import { toast } from "sonner";
import { adminActionToast } from "@/lib/admin-ops";
import { usePartnerContact } from "@/hooks/usePartnerPrivate";
import { partnerEmail, publicBankLabel } from "@/lib/onboarding";
import { User, Phone, Mail, Calendar, Landmark, ShieldCheck, Hotel } from "lucide-react";

const inr = (n?: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

const fmtDate = (v: any): string => {
  const ms = typeof v?.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(ms) && ms ? new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
};

interface HostSettlement {
  id: string;
  netPayout?: number;
  grossSales?: number;
  status?: string;
  utrNumber?: string;
  periodStart?: string;
  periodEnd?: string;
  bookingCount?: number;
}

export default function StayHost360() {
  const { id } = useParams();
  const [hotel, setHotel] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [settlements, setSettlements] = useState<HostSettlement[]>([]);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  // Owner email/phone live in partner_contact — hotels docs are public.
  const contact = usePartnerContact("host", id);

  // Commission and subscription are ALTERNATIVES — a subscription host pays a
  // flat fee and is charged 0% on future settlements (and reverts to
  // commission automatically if that subscription lapses).
  const billingModel: "commission" | "subscription" =
    String(hotel?.billingModel ?? "").toLowerCase() === "subscription"
      ? "subscription"
      : "commission";

  const changeBillingModel = async (model: "commission" | "subscription") => {
    setBillingBusy(true);
    try {
      await adminActionToast(
        "setBillingModel",
        { kind: "host", id: id ?? "", model },
        model === "subscription"
          ? "Switched to subscription — commission waived on future settlements"
          : "Switched to commission billing",
      );
    } finally {
      setBillingBusy(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, "hotels", id), (snap) => {
      setHotel(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    }, (err) => {
      // Silent fail here rendered "Host not found" on a permission/network
      // error — indistinguishable from a genuinely missing host.
      console.error("StayHost360: hotel doc listener error:", err);
      setLoading(false);
    });
  }, [id]);

  // Host payouts — real host_settlements for this host, server-side filtered.
  useEffect(() => {
    if (!id) return;
    return listenCollection<HostSettlement>(
      "host_settlements",
      { wheres: [["hotelId", "==", id]], orderByField: "createdAt", orderDir: "desc" },
      setSettlements,
    );
  }, [id]);

  const bookings = useLiveCollection<any>(id ? `hotels/${id}/bookings` : "hotels", {
    orderByField: "createdAt",
    disabled: !id,
  });

  const paidOut = useMemo(
    () => settlements.filter((s) => s.status === "paid").reduce((sum, s) => sum + (s.netPayout || 0), 0),
    [settlements],
  );
  const pendingPayout = useMemo(
    () => settlements.filter((s) => s.status !== "paid").reduce((sum, s) => sum + (s.netPayout || 0), 0),
    [settlements],
  );

  const status = String(hotel?.status ?? "Pending").toLowerCase();
  const isActive = status === "active";
  const name = hotel?.hostName || hotel?.ownerName || hotel?.name || (loading ? "Loading…" : `Host #${id}`);
  const email = partnerEmail(contact, hotel);
  const phone = hotel?.phone || contact?.ownerPhone || hotel?.ownerPhone;

  const toggleSuspend = async () => {
    if (!id) return;
    try {
      await updateDoc(doc(db, "hotels", id), { status: isActive ? "Suspended" : "Active" });
      toast.success(isActive ? "Host suspended" : "Host reactivated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setSuspendOpen(false);
    }
  };

  const payoutAccount = publicBankLabel(hotel?.bank) || "—";

  return (
    <Entity360Layout
      header={
        <Entity360Header
          backTo="/admin/stay/hosts"
          backLabel="Hosts"
          icon={User}
          title={name}
          subtitle={hotel?.name ? `Host of ${hotel.name}` : "KadaStay host"}
          type="user"
          status={isActive ? "active" : status}
          statusTone={isActive ? "success" : status === "suspended" ? "danger" : "warning"}
          metrics={[
            { label: "Bookings", value: String(bookings.rows.length) },
            { label: "Paid out", value: inr(paidOut) },
            { label: "Pending", value: inr(pendingPayout) },
          ]}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setSuspendOpen(true)}>
                {isActive ? "Suspend" : "Reactivate"}
              </Button>
              {email && (
                <Button size="sm" asChild>
                  <a href={`mailto:${email}`}>Message</a>
                </Button>
              )}
            </>
          }
        />
      }
      rail={
        <>
        <Section title="Billing">
          <Fact
            label="Model"
            value={billingModel === "subscription" ? "Subscription (0% commission)" : "Commission"}
            icon={Landmark}
          />
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              variant={billingModel === "commission" ? "default" : "outline"}
              disabled={billingBusy || billingModel === "commission"}
              onClick={() => changeBillingModel("commission")}
            >
              Commission
            </Button>
            <Button
              size="sm"
              variant={billingModel === "subscription" ? "default" : "outline"}
              disabled={billingBusy || billingModel === "subscription"}
              onClick={() => changeBillingModel("subscription")}
            >
              Subscription
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground pt-2">
            A subscription host pays a flat fee instead of commission. If the
            subscription lapses, commission is charged again automatically.
          </p>
        </Section>

        <Section title="Host Details">
          <Fact label="Email" value={email || "—"} icon={Mail} />
          <Fact label="Phone" value={phone || "—"} icon={Phone} />
          <Fact
            label="KYC Status"
            value={hotel?.kycStatus || "pending"}
            icon={ShieldCheck}
            tone={hotel?.kycStatus === "verified" || hotel?.kycStatus === "approved" ? "success" : "warning"}
          />
          <Fact label="Payout A/C" value={payoutAccount} icon={Landmark} />
          <Fact label="Joined" value={fmtDate(hotel?.createdAt || hotel?.kycSubmittedAt)} icon={Calendar} />
        </Section>
        </>
      }
    >
      <Tabs defaultValue="financials">
        <TabsList className="mb-4">
          <TabsTrigger value="financials">Financials ({settlements.length})</TabsTrigger>
          <TabsTrigger value="property">Property</TabsTrigger>
        </TabsList>

        <TabsContent value="financials">
          <Section title="Payout history">
            {settlements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No settlements generated yet.</p>
            ) : (
              <div className="space-y-2">
                {settlements.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 border border-border/50 rounded-md">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.bookingCount ?? 0} bookings · gross {inr(s.grossSales)}
                        {s.utrNumber ? ` · UTR ${s.utrNumber}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-bold text-emerald-600">{inr(s.netPayout)}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase ${s.status === "paid" ? "text-emerald-600 border-emerald-200 bg-emerald-50" : "text-amber-600 border-amber-200 bg-amber-50"} dark:bg-emerald-500/10 dark:bg-amber-500/10 dark:border-emerald-500/30 dark:border-amber-500/30`}
                      >
                        {s.status || "pending"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="property">
          <Section title="Property" action={id ? <Button variant="ghost" size="sm" asChild><a href={`/admin/stay/properties/${id}`}>Open property 360</a></Button> : undefined}>
            {hotel ? (
              <div className="flex items-center justify-between p-3 border border-border/50 rounded-md">
                <div className="flex items-center gap-2">
                  <Hotel className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{hotel.name || "Property"}</span>
                </div>
                <Badge variant="outline" className="text-[10px] uppercase">{hotel.status || "pending"}</Badge>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No property found for this host.</p>
            )}
          </Section>
        </TabsContent>
      </Tabs>

      <ConfirmationDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title={isActive ? "Suspend host?" : "Reactivate host?"}
        description={
          isActive
            ? `${name} and their property will be hidden from KadaStay and cannot take new bookings.`
            : `${name} will be able to receive bookings again.`
        }
        variant={isActive ? "destructive" : "default"}
        confirmLabel={isActive ? "Suspend" : "Reactivate"}
        onConfirm={toggleSuspend}
      />
    </Entity360Layout>
  );
}
