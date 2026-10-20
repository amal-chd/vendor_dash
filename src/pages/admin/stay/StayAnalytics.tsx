import { useEffect, useMemo, useState } from "react";
import { collection, collectionGroup, onSnapshot, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Calendar, Home, IndianRupee } from "lucide-react";

type HotelRow = { id: string; status?: string; featured?: boolean; name?: string };
type BookingRow = { amount?: number; total?: number; status?: string; createdAt?: { toDate?: () => Date } };

export default function StayAnalytics() {
  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "hotels"), (s) => {
      setHotels(s.docs.map((d) => ({ id: d.id, ...d.data() })) as HotelRow[]);
    }, (err) => {
      console.error("StayAnalytics: hotels listener error:", err);
    });
    const u2 = onSnapshot(query(collectionGroup(db, "bookings"), limit(800)), (s) => {
      setBookings(
        s.docs
          .filter((d) => d.ref.path.includes("/hotels/"))
          .map((d) => d.data() as BookingRow),
      );
      setLoading(false);
    }, (err) => {
      console.error("StayAnalytics: bookings group listener error:", err);
      setLoading(false);
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  // Cancelled stays are not revenue.
  const live = bookings.filter((b) => (b.status || "").toLowerCase() !== "cancelled");
  const gross = live.reduce((s, b) => s + Number(b.amount ?? b.total ?? 0), 0);
  const approved = hotels.filter((h) => (h.status || "").toLowerCase() === "approved").length;

  const byMonth = useMemo(() => {
    const map: Record<string, number> = {};
    live.forEach((b) => {
      try {
        // An undated booking used to land in the current month and inflate it.
        const d = b.createdAt?.toDate?.();
        if (!d) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        map[key] = (map[key] || 0) + Number(b.amount ?? b.total ?? 0);
      } catch {
        /* skip */
      }
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([name, revenue]) => ({ name, revenue: Math.round(revenue) }));
  }, [bookings]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Stay analytics"
        description="Live from properties and their bookings — latest 800 bookings."
        stats={[
          { label: "Properties", value: hotels.length, hint: `${approved} approved`, icon: Home, loading },
          { label: "Bookings", value: live.length, hint: `${bookings.length - live.length} cancelled excluded`, icon: Calendar, loading },
          { label: "Booking value", value: `₹${Math.round(gross).toLocaleString("en-IN")}`, icon: IndianRupee, tone: "text-emerald-600", loading },
          { label: "Avg booking", value: live.length ? `₹${Math.round(gross / live.length).toLocaleString("en-IN")}` : "—", icon: IndianRupee, loading },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Revenue by month (loaded bookings)</CardTitle>
        </CardHeader>
        <CardContent className="h-[320px]">
          {byMonth.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">No booking timestamps yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth}>
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => `₹${v.toLocaleString("en-IN")}`} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
