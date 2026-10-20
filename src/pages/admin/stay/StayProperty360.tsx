import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Entity360Layout, Entity360Header, Section, Fact } from "@/components/admin/entity360";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { usePartnerContact } from "@/hooks/usePartnerPrivate";
import { toast } from "sonner";
import { Hotel, MapPin, IndianRupee, Users, ShieldCheck } from "lucide-react";

const inr = (n?: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

interface Booking {
  id: string;
  guestName?: string;
  customerName?: string;
  status?: string;
  amount?: number;
  total?: number;
  grandTotal?: number;
  checkIn?: any;
  createdAt?: any;
}

const bookingAmount = (b: Booking) => Number(b.amount ?? b.total ?? b.grandTotal ?? 0) || 0;

const fmtDate = (v: any): string => {
  const ms = typeof v?.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(ms) && ms ? new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
};

export default function StayProperty360() {
  const { id } = useParams();
  const [hotel, setHotel] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [suspendOpen, setSuspendOpen] = useState(false);
  // The owner's personal phone lives in partner_contact — hotels docs are public.
  const contact = usePartnerContact("host", id);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, "hotels", id), (snap) => {
      setHotel(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    }, (err) => {
      console.error("StayProperty360: hotel doc listener error:", err);
      setLoading(false);
    });
  }, [id]);

  const bookings = useLiveCollection<Booking>(id ? `hotels/${id}/bookings` : "hotels", {
    orderByField: "createdAt",
    disabled: !id,
  });
  const reviews = useLiveCollection<any>(id ? `hotels/${id}/reviews` : "hotels", { disabled: !id });

  const revenue = useMemo(() => bookings.rows.reduce((s, b) => s + bookingAmount(b), 0), [bookings.rows]);
  const rating = hotel?.rating ?? hotel?.avgRating;
  const status = String(hotel?.status ?? "Pending").toLowerCase();
  const isActive = status === "active";

  const toggleSuspend = async () => {
    if (!id) return;
    try {
      await updateDoc(doc(db, "hotels", id), { status: isActive ? "Suspended" : "Active" });
      toast.success(isActive ? "Property suspended" : "Property reactivated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setSuspendOpen(false);
    }
  };

  const name = hotel?.name || hotel?.propertyName || (loading ? "Loading…" : `Property #${id}`);
  const hostPhone = hotel?.phone || contact?.ownerPhone || hotel?.ownerPhone;

  return (
    <Entity360Layout
      header={
        <Entity360Header
          backTo="/admin/stay/properties"
          backLabel="Properties"
          icon={Hotel}
          title={name}
          subtitle={hotel?.location || hotel?.city || "KadaStay property"}
          type="stay"
          status={isActive ? "active" : status}
          statusTone={isActive ? "success" : status === "suspended" ? "danger" : "warning"}
          metrics={[
            { label: "Bookings", value: String(bookings.rows.length) },
            { label: "Revenue", value: inr(revenue) },
            { label: "Rating", value: rating != null ? Number(rating).toFixed(1) : "—" },
          ]}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setSuspendOpen(true)}>
                {isActive ? "Suspend" : "Reactivate"}
              </Button>
              {hostPhone && (
                <Button size="sm" asChild>
                  <a href={`tel:${hostPhone}`}>Contact Host</a>
                </Button>
              )}
            </>
          }
        />
      }
      rail={
        <Section title="Property Details">
          <Fact label="Type" value={hotel?.propertyType || hotel?.type || "Property"} icon={Hotel} />
          <Fact label="Capacity" value={hotel?.maxGuests ? `Up to ${hotel.maxGuests} guests` : "—"} icon={Users} />
          <Fact label="Base Price" value={hotel?.basePrice || hotel?.pricePerNight ? `${inr(hotel.basePrice ?? hotel.pricePerNight)} / night` : "—"} icon={IndianRupee} />
          <Fact label="Location" value={hotel?.location || hotel?.city || hotel?.address || "—"} icon={MapPin} />
          <Fact
            label="KYC"
            value={hotel?.kycStatus || "pending"}
            icon={ShieldCheck}
            tone={hotel?.kycStatus === "verified" || hotel?.kycStatus === "approved" ? "success" : "warning"}
          />
          {id && <Fact label="Host" value="View host 360" link={`/admin/stay/hosts/${id}`} />}
        </Section>
      }
    >
      <Tabs defaultValue="bookings">
        <TabsList className="mb-4">
          <TabsTrigger value="bookings">Bookings ({bookings.rows.length})</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reviews">Reviews ({reviews.rows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="bookings">
          <Section title="Recent bookings">
            {bookings.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bookings yet.</p>
            ) : (
              <div className="space-y-2">
                {bookings.rows.slice(0, 30).map((b) => (
                  <div key={b.id} className="flex items-center justify-between p-3 border border-border/50 rounded-md">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{b.guestName || b.customerName || "Guest"}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(b.checkIn || b.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold">{inr(bookingAmount(b))}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{b.status || "—"}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="overview" className="space-y-6">
          <Section title="Description">
            <p className="text-sm text-muted-foreground">{hotel?.description || "No description provided."}</p>
          </Section>
          <Section title="Amenities">
            {Array.isArray(hotel?.amenities) && hotel.amenities.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {hotel.amenities.map((a: string, i: number) => (
                  <Badge key={i} variant="secondary">{a}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No amenities configured.</p>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="reviews">
          <Section title="Guest reviews">
            {reviews.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews yet.</p>
            ) : (
              <div className="space-y-3">
                {reviews.rows.slice(0, 20).map((r) => (
                  <div key={r.id} className="p-3 border border-border/50 rounded-md">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{r.guestName || r.customerName || "Guest"}</span>
                      <Badge variant="outline">{r.rating != null ? `${r.rating}★` : "—"}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{r.comment || r.text || ""}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </TabsContent>
      </Tabs>

      <ConfirmationDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title={isActive ? "Suspend property?" : "Reactivate property?"}
        description={
          isActive
            ? `${name} will be hidden from KadaStay search and cannot take new bookings.`
            : `${name} will be visible in KadaStay search again.`
        }
        variant={isActive ? "destructive" : "default"}
        confirmLabel={isActive ? "Suspend" : "Reactivate"}
        onConfirm={toggleSuspend}
      />
    </Entity360Layout>
  );
}
