import { useEffect, useState, useMemo } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { 
  Hotel, 
  CalendarCheck, 
  IndianRupee, 
  Clock, 
  ArrowRight, 
  Activity, 
  TrendingUp, 
  AlertCircle, 
  Home, 
  CheckCircle,
  LogIn,
  LogOut,
  Users,
  BedDouble,
  Check,
  X,
  RefreshCw
} from "lucide-react";
import { formatMoney } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useNavigate } from "react-router-dom";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { collection, collectionGroup, doc, limit, onSnapshot, query, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Cell, PieChart, Pie } from "recharts";
import { 
  format, 
  subDays, 
  isSameDay, 
  differenceInCalendarDays, 
  startOfDay, 
  endOfDay 
} from "date-fns";
import { toast } from "sonner";
import { 
  StayOperationsTimeline, 
  StayTimelineItem 
} from "@/components/admin/stay/StayOperationsTimeline";

const ChartTooltip = ({ active, payload, label, formatter }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg shadow-xl">
        <p className="text-slate-400 text-xs mb-1 font-medium uppercase tracking-wider">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <p className="text-slate-100 text-sm font-semibold">
              {formatter ? formatter(entry.value) : entry.value}
            </p>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// Safe date parser handling Firestore Timestamp, string ISO, and numbers
function parseStayDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val === "object" && typeof val.toDate === "function") {
    const d = val.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
  if (typeof val === "number") {
    const d = new Date(val > 100000000000 ? val : val * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function getBookingAmount(b: any): number {
  const amt = Number(b.totalAmount ?? b.amount ?? b.total ?? b.grandTotal ?? b.price ?? 0);
  return isNaN(amt) ? 0 : amt;
}

export default function StayCommandCenter() {
  const navigate = useNavigate();
  const { rows: properties, loading: propsLoading } = useLiveCollection<any>("hotels");
  const [bookings, setBookings] = useState<any[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  useEffect(() => {
    const map = new Map<string, any>();
    const apply = () => {
      const arr = Array.from(map.values()).sort((a, b) => {
        const da = parseStayDate(a.createdAt)?.getTime() || 0;
        const db = parseStayDate(b.createdAt)?.getTime() || 0;
        return db - da;
      });
      setBookings(arr);
    };

    // 1. Listen to root stay_bookings
    const u1 = onSnapshot(
      query(collection(db, "stay_bookings"), limit(500)),
      (snap) => {
        snap.docs.forEach((d) => {
          const prev = map.get(d.id) || {};
          map.set(d.id, { ...prev, id: d.id, ...d.data() });
        });
        apply();
        setBookingsLoading(false);
      },
      (err) => {
        console.error("stay_bookings listener err:", err);
        setBookingsLoading(false);
      }
    );

    // 2. Listen to hotels/{id}/bookings subcollections (collectionGroup query WITHOUT orderBy to avoid index requirement)
    const u2 = onSnapshot(
      query(collectionGroup(db, "bookings"), limit(500)),
      (snap) => {
        snap.docs.forEach((d) => {
          if (!d.ref.path.includes("/hotels/")) return;
          const hotelId = d.ref.parent.parent?.id;
          const prev = map.get(d.id) || {};
          map.set(d.id, {
            ...prev,
            id: d.id,
            path: d.ref.path,
            hotelId: hotelId || prev.hotelId,
            ...d.data(),
          });
        });
        apply();
      },
      (err) => console.error("hotels/bookings collectionGroup err:", err)
    );

    return () => {
      u1();
      u2();
    };
  }, []);

  // Quick Action: Update Booking Status
  // A booking is mirrored in up to three places. Two of the three writes were
  // wrapped in `catch (_) {}`, and "Booking marked as cancelled" was announced
  // regardless — so the console could report a cancellation while
  // stay_bookings and the hotel's own copy still read "confirmed", and the
  // operator had no way to know. The stay_bookings write matters most: it is
  // the one onStayBookingClosedReleaseNights listens to, so losing it silently
  // also means the room-nights are never handed back.
  //
  // Each write is now reported. A partial write is named as partial.
  const handleUpdateBookingStatus = async (item: StayTimelineItem, newStatus: string) => {
    const patch = { status: newStatus, updatedAt: new Date() };
    const targets: { label: string; ref: ReturnType<typeof doc> }[] = [];

    if (item.bookingPath) {
      const parts = item.bookingPath.split("/").filter(Boolean);
      if (parts.length >= 2) {
        targets.push({ label: "booking record", ref: doc(db, parts[0], parts[1], ...parts.slice(2)) });
      }
    }
    if (item.bookingId) {
      const canonical = doc(db, "stay_bookings", item.bookingId);
      // Skip a duplicate when bookingPath already pointed here.
      if (!targets.some((t) => t.ref.path === canonical.path)) {
        targets.push({ label: "bookings index", ref: canonical });
      }
    }
    if (item.propertyId && item.bookingId) {
      targets.push({
        label: "property's copy",
        ref: doc(db, "hotels", item.propertyId, "bookings", item.bookingId),
      });
    }
    if (!targets.length) {
      toast.error("This timeline row has no booking to update.");
      return;
    }

    const outcomes = await Promise.all(
      targets.map(async (t) => {
        try {
          await updateDoc(t.ref, patch);
          return { ...t, ok: true, message: "" };
        } catch (e: unknown) {
          console.error(`[StayCommandCenter] ${t.label} update failed`, e);
          return { ...t, ok: false, message: e instanceof Error ? e.message : "write refused" };
        }
      }),
    );
    const failed = outcomes.filter((o) => !o.ok);
    if (!failed.length) {
      toast.success(`Booking marked as ${newStatus.replace(/_/g, " ")}`);
      return true;
    }
    if (failed.length === outcomes.length) {
      toast.error(`Couldn't update this booking: ${failed[0].message}`, { duration: 8000 });
    } else {
      toast.warning(
        `Partly updated: the ${failed.map((f) => f.label).join(" and ")} still ` +
          `${failed.length > 1 ? "show" : "shows"} the old status (${failed[0].message}). Retry before relying on it.`,
        { duration: 10000 },
      );
    }
    return false;
  };

  // Quick Action: Approve Property
  const handleApproveProperty = async (propertyId: string) => {
    setActionBusyId(propertyId);
    try {
      await updateDoc(doc(db, "hotels", propertyId), {
        status: "Approved",
        verified: true,
        isVerified: true,
        updatedAt: new Date(),
      });
      toast.success("Property approved and listed successfully");
    } catch (err: any) {
      console.error("Error approving property:", err);
      toast.error(err?.message || "Failed to approve property");
    } finally {
      setActionBusyId(null);
    }
  };

  // Quick Action: Reject Property
  const handleRejectProperty = async (propertyId: string) => {
    setActionBusyId(propertyId);
    try {
      await updateDoc(doc(db, "hotels", propertyId), {
        status: "Rejected",
        updatedAt: new Date(),
      });
      toast.success("Property rejected");
    } catch (err: any) {
      console.error("Error rejecting property:", err);
      toast.error(err?.message || "Failed to reject property");
    } finally {
      setActionBusyId(null);
    }
  };

  // Derived Properties metrics
  const activeProps = properties.filter((p) => {
    const s = (p.status || "").toLowerCase();
    return s === "active" || s === "approved";
  }).length;

  const pendingProps = properties.filter((p) => {
    const s = (p.status || "").toLowerCase();
    return !s || s === "pending";
  });

  // Derived Bookings metrics
  const today = useMemo(() => new Date(), []);

  const todayBookings = useMemo(() => {
    return bookings.filter((b) => {
      const created = parseStayDate(b.createdAt);
      return created && isSameDay(created, today);
    });
  }, [bookings, today]);

  const yesterdayBookings = useMemo(() => {
    const yesterday = subDays(today, 1);
    return bookings.filter((b) => {
      const created = parseStayDate(b.createdAt);
      return created && isSameDay(created, yesterday);
    });
  }, [bookings, today]);

  // Cancelled stays are not revenue.
  const notCancelled = (b: { status?: string }) => (b.status || "").toLowerCase() !== "cancelled";
  const todayRevenue = useMemo(() => {
    return todayBookings.filter(notCancelled).reduce((sum, b) => sum + getBookingAmount(b), 0);
  }, [todayBookings]);

  const yesterdayRevenue = useMemo(() => {
    return yesterdayBookings.filter(notCancelled).reduce((sum, b) => sum + getBookingAmount(b), 0);
  }, [yesterdayBookings]);

  // Real trend computation (no fake static 12.5%)
  const revenueTrend = useMemo(() => {
    if (yesterdayRevenue === 0) {
      return todayRevenue > 0
        ? { value: 100, label: "vs yesterday", isPositive: true }
        : undefined;
    }
    const diff = todayRevenue - yesterdayRevenue;
    const pct = Math.round((diff / yesterdayRevenue) * 100);
    return {
      value: Math.abs(pct),
      label: "vs yesterday",
      isPositive: pct >= 0,
    };
  }, [todayRevenue, yesterdayRevenue]);

  // Operational metrics: Check-ins today, Check-outs today, In-house guests
  const todayCheckIns = useMemo(() => {
    return bookings.filter((b) => {
      const ci = parseStayDate(b.checkIn ?? b.checkInDate ?? b.startDate);
      const status = (b.status || "").toLowerCase();
      return ci && isSameDay(ci, today) && status !== "cancelled";
    });
  }, [bookings, today]);

  const todayCheckOuts = useMemo(() => {
    return bookings.filter((b) => {
      const co = parseStayDate(b.checkOut ?? b.checkOutDate ?? b.endDate);
      const status = (b.status || "").toLowerCase();
      return co && isSameDay(co, today) && status !== "cancelled";
    });
  }, [bookings, today]);

  const inHouseGuests = useMemo(() => {
    const nowStart = startOfDay(today);
    const nowEnd = endOfDay(today);
    return bookings.filter((b) => {
      const ci = parseStayDate(b.checkIn ?? b.checkInDate ?? b.startDate);
      const co = parseStayDate(b.checkOut ?? b.checkOutDate ?? b.endDate);
      const status = (b.status || "").toLowerCase();
      if (!ci || !co || status === "cancelled") return false;
      return ci <= nowEnd && co >= nowStart;
    });
  }, [bookings, today]);

  const averageDailyRate = useMemo(() => {
    const valid = bookings.filter((b) => (b.status || "").toLowerCase() !== "cancelled");
    if (valid.length === 0) return 0;
    const total = valid.reduce((sum, b) => sum + getBookingAmount(b), 0);
    return Math.round(total / valid.length);
  }, [bookings]);

  // Last 15 Days Revenue & Booking Volume Data
  const revenueData = useMemo(() => {
    const data = [];
    for (let i = 14; i >= 0; i--) {
      const date = subDays(today, i);
      const dayStr = format(date, "MMM dd");
      const dayBookings = bookings.filter((b) => {
        const d = parseStayDate(b.createdAt);
        return d && isSameDay(d, date);
      });
      const rev = dayBookings.reduce((sum, b) => sum + getBookingAmount(b), 0);
      data.push({ date: dayStr, revenue: rev, bookings: dayBookings.length });
    }
    return data;
  }, [bookings, today]);

  // Property status distribution
  const propertyStatusData = useMemo(() => {
    const active = properties.filter((p) => {
      const s = (p.status || "").toLowerCase();
      return s === "active" || s === "approved";
    }).length;
    const pending = properties.filter((p) => {
      const s = (p.status || "").toLowerCase();
      return !s || s === "pending";
    }).length;
    const suspended = properties.filter((p) => {
      const s = (p.status || "").toLowerCase();
      return s === "suspended" || s === "rejected";
    }).length;
    return [
      { name: "Active", value: active, color: "#10b981" },
      { name: "Pending", value: pending, color: "#f59e0b" },
      { name: "Suspended", value: suspended, color: "#ef4444" },
    ].filter((d) => d.value > 0);
  }, [properties]);

  // Build Comprehensive Operations Timeline Feed
  const timelineItems = useMemo<StayTimelineItem[]>(() => {
    const items: StayTimelineItem[] = [];

    // 1. From Bookings
    bookings.forEach((b) => {
      const checkInDate = parseStayDate(b.checkIn ?? b.checkInDate ?? b.startDate);
      const checkOutDate = parseStayDate(b.checkOut ?? b.checkOutDate ?? b.endDate);
      const createdAtDate = parseStayDate(b.createdAt ?? b.created_at ?? b.bookingDate);
      const cancelledAtDate = parseStayDate(b.cancelledAt ?? b.updatedAt);
      const guestName = b.customerName || b.guestName || b.userName || b.name || "Guest";
      const guestPhone = b.guestPhone || b.customerPhone || b.phone;
      const guestEmail = b.guestEmail || b.customerEmail || b.email;
      const propertyName = b.hotelName || b.propertyName || "Kada Stay Property";
      const amount = getBookingAmount(b);
      const status = (b.status || "reserved").toLowerCase();

      let nights: number | undefined;
      if (checkInDate && checkOutDate) {
        nights = Math.max(1, differenceInCalendarDays(checkOutDate, checkInDate));
      }

      const roomInfo = b.roomNumber
        ? `Room #${b.roomNumber}`
        : b.roomType || b.roomName || (b.guests ? `${b.guests} Guests` : undefined);

      // Event A: Check-in event
      if (checkInDate) {
        const isCI = status === "checked_in";
        items.push({
          id: `ci-${b.id}`,
          type: "check_in",
          title: `Check-in: ${guestName}`,
          description: `${guestName} checking into ${propertyName}${roomInfo ? ` (${roomInfo})` : ""}`,
          guestName,
          guestPhone,
          guestEmail,
          propertyName,
          propertyId: b.hotelId,
          bookingId: b.id,
          bookingPath: b.path,
          roomInfo,
          timestamp: checkInDate,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          nights,
          amount,
          status: b.status || "reserved",
          statusTone: isCI ? "success" : "info",
          rawBooking: b,
        });
      }

      // Event B: Check-out event
      if (checkOutDate) {
        const isCO = status === "checked_out";
        items.push({
          id: `co-${b.id}`,
          type: "check_out",
          title: `Check-out: ${guestName}`,
          description: `${guestName} scheduled departure from ${propertyName}`,
          guestName,
          guestPhone,
          guestEmail,
          propertyName,
          propertyId: b.hotelId,
          bookingId: b.id,
          bookingPath: b.path,
          roomInfo,
          timestamp: checkOutDate,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          nights,
          amount,
          status: b.status || "reserved",
          statusTone: isCO ? "neutral" : "warning",
          rawBooking: b,
        });
      }

      // Event C: Booking creation or cancellation
      if (status === "cancelled") {
        items.push({
          id: `canc-${b.id}`,
          type: "cancellation",
          title: `Cancellation: ${guestName}`,
          description: `Booking #${b.id.slice(0, 8)} cancelled at ${propertyName}`,
          guestName,
          guestPhone,
          guestEmail,
          propertyName,
          propertyId: b.hotelId,
          bookingId: b.id,
          bookingPath: b.path,
          roomInfo,
          timestamp: cancelledAtDate || createdAtDate || new Date(),
          checkIn: checkInDate,
          checkOut: checkOutDate,
          nights,
          amount,
          status: "cancelled",
          statusTone: "danger",
          rawBooking: b,
        });
      } else if (createdAtDate) {
        items.push({
          id: `new-${b.id}`,
          type: "booking_new",
          title: `New Reservation: ${guestName}`,
          description: `Booked ${nights ? `${nights} night${nights > 1 ? "s" : ""}` : "stay"} at ${propertyName}`,
          guestName,
          guestPhone,
          guestEmail,
          propertyName,
          propertyId: b.hotelId,
          bookingId: b.id,
          bookingPath: b.path,
          roomInfo,
          timestamp: createdAtDate,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          nights,
          amount,
          status: b.status || "reserved",
          statusTone: status === "confirmed" ? "success" : "info",
          rawBooking: b,
        });
      }
    });

    // 2. From Properties
    properties.forEach((p) => {
      const pStatus = (p.status || "pending").toLowerCase();
      const createdAt = parseStayDate(p.createdAt);
      const updatedAt = parseStayDate(p.updatedAt);
      const cityName = p.city || p.location?.city || "Kerala";

      if (pStatus === "pending") {
        items.push({
          id: `prop-pending-${p.id}`,
          type: "property_pending",
          title: `Pending Approval: ${p.name || "Unnamed Property"}`,
          description: `Host property in ${cityName} awaiting verification`,
          propertyName: p.name || "Unnamed Property",
          propertyId: p.id,
          timestamp: createdAt || new Date(),
          status: "pending",
          statusTone: "warning",
          rawProperty: p,
        });
      } else if (pStatus === "approved" || pStatus === "active") {
        items.push({
          id: `prop-approved-${p.id}`,
          type: "property_approved",
          title: `Property Live: ${p.name || "Unnamed Property"}`,
          description: `Verified and active on KadaStay in ${cityName}`,
          propertyName: p.name || "Unnamed Property",
          propertyId: p.id,
          timestamp: updatedAt || createdAt || new Date(),
          status: "approved",
          statusTone: "success",
          rawProperty: p,
        });
      }
    });

    // Sort descending by timestamp (newest first)
    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [bookings, properties]);

  const recentBookings = bookings.slice(0, 8);

  return (
    <div className="space-y-6 pb-12">
      {/* Header with quick shortcuts */}
      <AdminPageHeader
        title="Command centre"
        description="Properties, today's bookings and guest movements across KadaStay."
        icon={Hotel}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/admin/stay?tab=properties")}>
              Properties ({properties.length})
            </Button>
            <Button onClick={() => navigate("/admin/stay?tab=bookings")}>
              Bookings ({bookings.length})
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-800">
          <TabsTrigger value="overview">Dashboard Overview</TabsTrigger>
          <TabsTrigger value="timeline">Operations Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Two aligned rows of four: supply and demand, then today's floor. */}
          <StatCards
            items={[
              { label: "Live properties", value: activeProps, hint: "Approved and bookable", icon: Home, tone: "text-emerald-600", loading: propsLoading, onClick: () => navigate("/admin/stay?tab=properties") },
              { label: "Awaiting review", value: pendingProps.length, hint: "Verify before they go live", icon: AlertCircle, tone: "text-amber-600", loading: propsLoading, onClick: () => navigate("/admin/stay?tab=properties") },
              { label: "Bookings today", value: todayBookings.length, icon: CalendarCheck, tone: "text-blue-600", loading: bookingsLoading, onClick: () => navigate("/admin/stay?tab=bookings") },
              { label: "Value today", value: formatMoney(todayRevenue, "INR"), icon: IndianRupee, tone: "text-emerald-600", trend: revenueTrend, loading: bookingsLoading },
              { label: "Check-ins today", value: todayCheckIns.length, hint: "Arriving", icon: LogIn, tone: "text-emerald-600", loading: bookingsLoading },
              { label: "Check-outs today", value: todayCheckOuts.length, hint: "Departing", icon: LogOut, tone: "text-amber-600", loading: bookingsLoading },
              { label: "In-house guests", value: inHouseGuests.length, hint: "Stays in progress", icon: Users, tone: "text-sky-600", loading: bookingsLoading },
              { label: "Avg booking value", value: formatMoney(averageDailyRate, "INR"), hint: "Per booking, excludes cancelled", icon: BedDouble, tone: "text-violet-600", loading: bookingsLoading },
            ]}
          />

      {/* Analytics & Distribution Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-sm border-slate-200/60 dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" /> Revenue & Volume (Last 15 Days)
            </CardTitle>
            <CardDescription>Daily gross booking value and transaction count from live bookings</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#84cc16" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#84cc16" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip formatter={(val: number) => formatMoney(val, "INR")} />} cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="revenue" stroke="#84cc16" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-slate-200/60 dark:border-slate-800 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Property Portfolio</CardTitle>
            <CardDescription>Live distribution by verification status</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col items-center justify-center relative min-h-[250px]">
            {propertyStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={propertyStatusData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={5} dataKey="value" stroke="none">
                    {propertyStatusData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-muted-foreground text-sm flex items-center gap-2">
                {propsLoading ? <Activity className="w-4 h-4 animate-spin" /> : "No property data"}
              </div>
            )}
            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
              {propertyStatusData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.name} ({d.value})
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Needs Verification & Live Bookings Quick Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm border-slate-200/60 dark:border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/50">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" /> Needs Verification ({pendingProps.length})
              </CardTitle>
              <CardDescription className="mt-1">Properties awaiting admin approval</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs font-semibold" asChild>
              <Link to="/admin/stay?tab=properties">View All <ArrowRight className="w-3 h-3 ml-1.5" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {pendingProps.length === 0 && !propsLoading && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle className="w-10 h-10 text-emerald-500 mb-3 opacity-20" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Inbox zero!</p>
                <p className="text-xs text-muted-foreground mt-1">No pending properties to review.</p>
              </div>
            )}
            <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {pendingProps.slice(0, 6).map((p) => (
                <div key={p.id} className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col truncate">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{p.name || "Unnamed Property"}</span>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {p.city || p.location?.city || "Unknown Location"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                      disabled={actionBusyId === p.id}
                      onClick={() => handleRejectProperty(p.id)}
                    >
                      <X className="w-3.5 h-3.5 mr-1" /> Reject
                    </Button>
                    <Button 
                      size="sm" 
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={actionBusyId === p.id}
                      onClick={() => handleApproveProperty(p.id)}
                    >
                      <Check className="w-3.5 h-3.5 mr-1" /> Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-slate-200/60 dark:border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/50">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                Live Incoming Bookings
                <span className="relative flex h-2.5 w-2.5 ml-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              </CardTitle>
              <CardDescription className="mt-1">Real-time reservations feed</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs font-semibold" asChild>
              <Link to="/admin/stay?tab=bookings">View All <ArrowRight className="w-3 h-3 ml-1.5" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {recentBookings.length === 0 && !bookingsLoading && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CalendarCheck className="w-10 h-10 text-slate-400 mb-3 opacity-20" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No recent bookings</p>
              </div>
            )}
            <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {recentBookings.map((b) => {
                const amt = getBookingAmount(b);
                const status = (b.status || "pending").toLowerCase();
                let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
                let badgeClass = "text-[10px] uppercase h-5 px-1.5 font-bold tracking-wider";
                if (status === "confirmed" || status === "completed" || status === "checked_in") {
                  badgeVariant = "default";
                  badgeClass += " bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-0";
                } else if (status === "cancelled" || status === "failed") {
                  badgeVariant = "destructive";
                  badgeClass += " bg-red-500/10 text-red-600 hover:bg-red-500/20 border-0";
                } else {
                  badgeVariant = "secondary";
                  badgeClass += " bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-0";
                }
                const created = parseStayDate(b.createdAt);
                const timeStr = created ? format(created, "MMM d, h:mm a") : "Just now";
                const checkInDate = parseStayDate(b.checkIn ?? b.checkInDate ?? b.startDate);

                return (
                  <div key={b.id} className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                    <div className="flex flex-col truncate pr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                          {b.guestName || b.customerName || b.guestEmail || `Booking #${b.id.slice(0, 6)}`}
                        </span>
                        <Badge variant={badgeVariant} className={badgeClass}>{status}</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                        <span>{b.propertyName || b.hotelName || "Unknown Property"}</span>
                        <span>•</span>
                        <span className="text-slate-400">{timeStr}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="text-[15px] font-black text-slate-900 dark:text-white">
                        {formatMoney(amt, "INR")}
                      </span>
                      {checkInDate && (
                        <span className="text-[10px] uppercase font-bold text-slate-400 mt-1">
                          In: {format(checkInDate, "MMM d")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
      </TabsContent>

      <TabsContent value="timeline" className="m-0 focus-visible:outline-none">
        <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <StayOperationsTimeline 
            items={timelineItems}
            loading={bookingsLoading || propsLoading}
            onUpdateBookingStatus={handleUpdateBookingStatus}
            onApproveProperty={handleApproveProperty}
            onRejectProperty={handleRejectProperty}
          />
        </div>
      </TabsContent>
    </Tabs>
  </div>
  );
}
