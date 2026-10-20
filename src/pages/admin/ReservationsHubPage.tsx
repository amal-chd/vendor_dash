import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock,
  Search,
  Filter,
  Users,
  Clock,
  Phone,
  Store,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  Eye,
  MoreVertical,
  Download,
  Calendar,
  Sparkles,
  Utensils,
  TableProperties,
  MessageSquare,
  Armchair,
  Share2,
  ChevronRight,
  RefreshCw,
  SlidersHorizontal,
  Flame,
  Check,
  UserCheck,
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
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PreOrderItem {
  name: string;
  qty?: number;
  quantity?: number;
  price?: number;
}

export interface LiveReservation {
  id: string;
  restaurantId?: string;
  restaurantName?: string;
  restaurantPhone?: string;
  guestName?: string;
  name?: string;
  guestPhone?: string;
  phone?: string;
  guestCount?: number;
  partySize?: number;
  covers?: number;
  reservationDate?: string; // YYYY-MM-DD
  date?: string;
  reservationTime?: string; // HH:MM
  time?: string;
  tableName?: string;
  notes?: string;
  specialRequests?: string;
  status?: "pending" | "confirmed" | "seated" | "completed" | "no_show" | "cancelled" | string;
  preOrderItems?: PreOrderItem[];
  preOrderTotal?: number;
  depositAmount?: number;
  dineCoinsEarned?: number;
  source?: string;
  createdAt?: unknown;
}

interface RestaurantRef {
  id: string;
  name?: string;
  phone?: string;
  city?: string;
  address?: string;
}

const formatINR = (n?: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

const getTodayDateStr = () => {
  const d = new Date();
  return d.toISOString().split("T")[0];
};

const getTomorrowDateStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
};

const normalizeDate = (r: LiveReservation): string => {
  return r.reservationDate || r.date || "";
};

const normalizeTime = (r: LiveReservation): string => {
  return r.reservationTime || r.time || "19:00";
};

const normalizeGuestName = (r: LiveReservation): string => {
  return r.guestName || r.name || "Guest";
};

const normalizePhone = (r: LiveReservation): string => {
  return r.guestPhone || r.phone || "";
};

const normalizeCovers = (r: LiveReservation): number => {
  return Number(r.guestCount || r.partySize || r.covers || 2);
};

export default function ReservationsHubPage() {
  // ── Live Firestore Collections ────────────────────────────────────────────
  const { rows: reservations, loading: resLoading } = useLiveCollection<LiveReservation>(
    "reservations",
    { orderByField: "createdAt", orderDir: "desc", limit: 500 },
  );

  const { rows: restaurants } = useLiveCollection<RestaurantRef>("restaurants", {
    limit: 400,
  });

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRestaurantFilter, setSelectedRestaurantFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "tomorrow" | "upcoming">("today");
  const [shiftFilter, setShiftFilter] = useState<"all" | "lunch" | "dinner">("all");

  // Modals
  const [inspectingReservation, setInspectingReservation] = useState<LiveReservation | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [assignTableRes, setAssignTableRes] = useState<LiveReservation | null>(null);
  const [customTableName, setCustomTableName] = useState("");

  // New Reservation Form State
  const [newResForm, setNewResForm] = useState({
    guestName: "",
    guestPhone: "",
    restaurantId: "",
    restaurantName: "",
    guestCount: "2",
    date: getTodayDateStr(),
    time: "19:30",
    tableName: "Table 1",
    specialRequests: "",
    notes: "",
  });
  const [isSavingNew, setIsSavingNew] = useState(false);

  // ── Restaurant Lookup Map ─────────────────────────────────────────────────
  const restaurantMap = useMemo(() => {
    const map = new Map<string, RestaurantRef>();
    restaurants.forEach((r) => {
      if (r.id) map.set(r.id, r);
    });
    return map;
  }, [restaurants]);

  // ── Filtered Reservations ─────────────────────────────────────────────────
  const todayStr = getTodayDateStr();
  const tomorrowStr = getTomorrowDateStr();

  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const gName = normalizeGuestName(r).toLowerCase();
        const gPhone = normalizePhone(r).toLowerCase();
        const rName = (r.restaurantName || "").toLowerCase();
        const tName = (r.tableName || "").toLowerCase();
        const bId = r.id.toLowerCase();
        if (!gName.includes(q) && !gPhone.includes(q) && !rName.includes(q) && !tName.includes(q) && !bId.includes(q)) {
          return false;
        }
      }

      // 2. Restaurant Filter
      if (selectedRestaurantFilter !== "all" && r.restaurantId !== selectedRestaurantFilter) {
        return false;
      }

      // 3. Date Filter
      const rDate = normalizeDate(r);
      if (dateFilter === "today" && rDate !== todayStr) return false;
      if (dateFilter === "tomorrow" && rDate !== tomorrowStr) return false;
      if (dateFilter === "upcoming" && rDate < todayStr) return false;

      // 4. Shift Filter
      const rTime = normalizeTime(r);
      const hour = parseInt(rTime.split(":")[0] || "0", 10);
      if (shiftFilter === "lunch" && (hour < 11 || hour >= 16)) return false;
      if (shiftFilter === "dinner" && (hour < 18 || hour > 23)) return false;

      // 5. Tab Filter
      const s = (r.status || "pending").toLowerCase();
      if (activeTab === "pending" && s !== "pending") return false;
      if (activeTab === "confirmed" && s !== "confirmed") return false;
      if (activeTab === "seated" && s !== "seated") return false;
      if (activeTab === "special" && !r.specialRequests && !r.notes) return false;
      if (activeTab === "preorder" && (!r.preOrderItems || r.preOrderItems.length === 0)) return false;

      return true;
    });
  }, [reservations, searchQuery, selectedRestaurantFilter, dateFilter, shiftFilter, activeTab, todayStr, tomorrowStr]);

  // ── Aggregate KPI Metrics ─────────────────────────────────────────────────
  const kpis: StatItem[] = useMemo(() => {
    const todayBookings = reservations.filter((r) => normalizeDate(r) === todayStr);
    const todayCovers = todayBookings.reduce((sum, r) => sum + normalizeCovers(r), 0);
    const pendingCount = reservations.filter((r) => (r.status || "pending").toLowerCase() === "pending").length;
    const currentlySeated = reservations.filter((r) => (r.status || "").toLowerCase() === "seated").length;
    const totalPreOrderValue = reservations.reduce((sum, r) => sum + Number(r.preOrderTotal || 0), 0);

    return [
      { title: "Today's bookings", value: todayBookings.length, icon: CalendarClock, tone: "text-primary", loading: resLoading },
      { title: "Guests expected", value: todayCovers, hint: "Covers booked for today", icon: Users, tone: "text-emerald-600", loading: resLoading },
      { title: "Awaiting confirmation", value: pendingCount, hint: "Restaurant hasn't confirmed", icon: AlertCircle, tone: "text-amber-600", loading: resLoading },
      { title: "Seated now", value: currentlySeated, hint: "Tables in use", icon: Armchair, tone: "text-sky-600", loading: resLoading },
    ];
  }, [reservations, resLoading, todayStr]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleUpdateStatus = async (resId: string, status: string) => {
    try {
      await updateDoc(doc(db, "reservations", resId), {
        status,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Reservation marked as ${status.replace("_", " ")}`);
      if (inspectingReservation && inspectingReservation.id === resId) {
        setInspectingReservation({ ...inspectingReservation, status });
      }
    } catch (err: unknown) {
      toast.error(`Update failed: ${(err as Error).message}`);
    }
  };

  const handleAssignTable = async () => {
    if (!assignTableRes || !customTableName.trim()) {
      toast.error("Please enter a table name");
      return;
    }

    try {
      await updateDoc(doc(db, "reservations", assignTableRes.id), {
        tableName: customTableName.trim(),
        updatedAt: serverTimestamp(),
      });
      toast.success(`Assigned ${customTableName} to ${normalizeGuestName(assignTableRes)}`);
      setAssignTableRes(null);
      setCustomTableName("");
    } catch (err: unknown) {
      toast.error(`Table assignment failed: ${(err as Error).message}`);
    }
  };

  const handleCreateReservation = async () => {
    if (!newResForm.guestName.trim() || !newResForm.guestPhone.trim() || !newResForm.restaurantId) {
      toast.error("Please fill in guest name, phone, and select a restaurant");
      return;
    }

    setIsSavingNew(true);
    try {
      const chosenRest = restaurantMap.get(newResForm.restaurantId);
      const restName = chosenRest?.name || newResForm.restaurantName || "Partner Restaurant";

      await addDoc(collection(db, "reservations"), {
        guestName: newResForm.guestName.trim(),
        guestPhone: newResForm.guestPhone.trim(),
        restaurantId: newResForm.restaurantId,
        restaurantName: restName,
        guestCount: Number(newResForm.guestCount) || 2,
        reservationDate: newResForm.date,
        reservationTime: newResForm.time,
        tableName: newResForm.tableName || "Auto-assign",
        specialRequests: newResForm.specialRequests.trim() || null,
        notes: newResForm.notes.trim() || null,
        status: "confirmed",
        source: "admin_hub",
        createdAt: serverTimestamp(),
      });

      toast.success(`Reservation confirmed for ${newResForm.guestName} at ${restName}`);
      setIsAddModalOpen(false);
      setNewResForm({
        guestName: "",
        guestPhone: "",
        restaurantId: "",
        restaurantName: "",
        guestCount: "2",
        date: getTodayDateStr(),
        time: "19:30",
        tableName: "Table 1",
        specialRequests: "",
        notes: "",
      });
    } catch (err: unknown) {
      toast.error(`Failed to create reservation: ${(err as Error).message}`);
    } finally {
      setIsSavingNew(false);
    }
  };

  const handleExportCSV = () => {
    if (!filteredReservations.length) {
      toast.info("No reservations to export.");
      return;
    }

    const headers = [
      "Booking ID",
      "Guest Name",
      "Phone",
      "Restaurant",
      "Covers",
      "Date",
      "Time",
      "Table",
      "Status",
      "Special Requests",
    ];

    const rows = filteredReservations.map((r) => [
      `"${r.id}"`,
      `"${normalizeGuestName(r).replace(/"/g, '""')}"`,
      `"${normalizePhone(r)}"`,
      `"${(r.restaurantName || "").replace(/"/g, '""')}"`,
      normalizeCovers(r),
      `"${normalizeDate(r)}"`,
      `"${normalizeTime(r)}"`,
      `"${r.tableName || "Unassigned"}"`,
      `"${r.status || "pending"}"`,
      `"${(r.specialRequests || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `kada_reservations_${dateFilter}_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${filteredReservations.length} reservations`);
  };

  const openWhatsAppConfirmation = (res: LiveReservation) => {
    const phone = normalizePhone(res).replace(/[^0-9]/g, "");
    if (!phone) {
      toast.error("No phone number on record for this guest.");
      return;
    }

    const formattedPhone = phone.startsWith("91") ? phone : `91${phone}`;
    const text = encodeURIComponent(
      `Hello ${normalizeGuestName(res)}! 🍽️\n\nYour table reservation at *${res.restaurantName || "The Kada Restaurant"}* is confirmed for *${normalizeCovers(res)} guests* on *${normalizeDate(res)}* at *${normalizeTime(res)}*.\n\nTable: ${res.tableName || "Reserved Seating"}\n\nWe look forward to hosting you!`,
    );
    window.open(`https://wa.me/${formattedPhone}?text=${text}`, "_blank");
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="Table Reservations"
        description="Cross-tenant floor plan coordination, real-time table assignments, and guest hospitality management."
        badge="Live Table Sync"
      />

      {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
      <StatCards items={kpis} />

      {/* ── Main Operations Card ────────────────────────────────────────────── */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="p-4 border-b border-border/60 bg-muted/20 space-y-3">
          {/* Top Filter Toolbar */}
          <div className="flex flex-col lg:flex-row gap-3 items-center justify-between">
            {/* Search Input */}
            <div className="relative w-full lg:w-80">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search guest, phone, table, venue..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 text-xs h-8"
              />
            </div>

            {/* Quick Filters */}
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
              {/* Date Filter */}
              <div className="flex rounded-lg border border-border/60 p-0.5 bg-background text-xs">
                <button
                  type="button"
                  onClick={() => setDateFilter("today")}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-colors",
                    dateFilter === "today" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setDateFilter("tomorrow")}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-colors",
                    dateFilter === "tomorrow" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  onClick={() => setDateFilter("upcoming")}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-colors",
                    dateFilter === "upcoming" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Upcoming
                </button>
                <button
                  type="button"
                  onClick={() => setDateFilter("all")}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-colors",
                    dateFilter === "all" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  All
                </button>
              </div>

              {/* Restaurant Selector */}
              <Select
                value={selectedRestaurantFilter}
                onValueChange={setSelectedRestaurantFilter}
              >
                <SelectTrigger className="text-xs h-8 w-[180px]">
                  <SelectValue placeholder="All Restaurants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Restaurants</SelectItem>
                  {restaurants.map((rest) => (
                    <SelectItem key={rest.id} value={rest.id}>
                      {rest.name || "Restaurant"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Shift Filter */}
              <Select
                value={shiftFilter}
                onValueChange={(val: any) => setShiftFilter(val)}
              >
                <SelectTrigger className="text-xs h-8 w-[130px]">
                  <SelectValue placeholder="All Shifts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Shifts</SelectItem>
                  <SelectItem value="lunch">Lunch (12–4 PM)</SelectItem>
                  <SelectItem value="dinner">Dinner (7–11 PM)</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={handleExportCSV}
                title="Export to CSV"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Export
              </Button>

              <Button
                size="sm"
                className="text-xs h-8"
                onClick={() => setIsAddModalOpen(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                New Booking
              </Button>
            </div>
          </div>

          {/* Workflow Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="bg-transparent h-auto p-0 space-x-4 border-b-0">
              <TabsTrigger
                value="all"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 pb-2 text-xs font-medium"
              >
                All Bookings ({filteredReservations.length})
              </TabsTrigger>
              <TabsTrigger
                value="pending"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 pb-2 text-xs font-medium"
              >
                Pending Review
              </TabsTrigger>
              <TabsTrigger
                value="confirmed"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 pb-2 text-xs font-medium"
              >
                Confirmed
              </TabsTrigger>
              <TabsTrigger
                value="seated"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 pb-2 text-xs font-medium"
              >
                Seated Now
              </TabsTrigger>
              <TabsTrigger
                value="special"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 pb-2 text-xs font-medium"
              >
                VIP & Special Requests
              </TabsTrigger>
              <TabsTrigger
                value="preorder"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 pb-2 text-xs font-medium"
              >
                Pre-Ordered Meals
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>

        <CardContent className="p-0">
          {filteredReservations.length === 0 ? (
            <div className="p-16 text-center text-muted-foreground bg-muted/10">
              <CalendarClock className="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm font-medium">No table reservations found for this selection.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Try clearing filters or change the date range.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-left text-muted-foreground bg-muted/30">
                    <th className="p-3 font-semibold">Guest</th>
                    <th className="p-3 font-semibold">Venue & City</th>
                    <th className="p-3 font-semibold">Covers</th>
                    <th className="p-3 font-semibold">Date & Time</th>
                    <th className="p-3 font-semibold">Table Assigned</th>
                    <th className="p-3 font-semibold">Requests / Pre-Order</th>
                    <th className="p-3 font-semibold">Status</th>
                    <th className="p-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredReservations.map((res) => {
                    const status = (res.status || "pending").toLowerCase();
                    const guestName = normalizeGuestName(res);
                    const phone = normalizePhone(res);
                    const covers = normalizeCovers(res);
                    const rDate = normalizeDate(res);
                    const rTime = normalizeTime(res);
                    const hasPreOrder = res.preOrderItems && res.preOrderItems.length > 0;

                    return (
                      <tr key={res.id} className="hover:bg-muted/30 transition-colors">
                        {/* Guest */}
                        <td className="p-3">
                          <p className="font-semibold text-foreground">{guestName}</p>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                            <Phone className="w-3 h-3" />
                            <span>{phone || "No phone"}</span>
                          </div>
                        </td>

                        {/* Restaurant */}
                        <td className="p-3 max-w-[200px]">
                          <div className="flex items-center gap-1 font-medium text-foreground line-clamp-1">
                            <Store className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            <span>{res.restaurantName || "Restaurant Partner"}</span>
                          </div>
                        </td>

                        {/* Covers */}
                        <td className="p-3">
                          <Badge variant="secondary" className="font-semibold text-[11px] px-2 py-0.5">
                            <Users className="w-3 h-3 mr-1" />
                            {covers} Pax
                          </Badge>
                        </td>

                        {/* Date & Time */}
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex items-center gap-1 font-semibold text-foreground">
                            <Clock className="w-3 h-3 text-primary" />
                            <span>{rTime}</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground">{rDate}</span>
                        </td>

                        {/* Table */}
                        <td className="p-3 whitespace-nowrap">
                          {res.tableName ? (
                            <Badge variant="outline" className="font-medium text-[11px]">
                              <TableProperties className="w-3 h-3 mr-1 text-primary" />
                              {res.tableName}
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] text-amber-600 hover:bg-amber-500/10 px-2"
                              onClick={() => {
                                setAssignTableRes(res);
                                setCustomTableName("Table 1");
                              }}
                            >
                              + Assign Table
                            </Button>
                          )}
                        </td>

                        {/* Special Requests & Pre-Orders */}
                        <td className="p-3 max-w-[220px]">
                          <div className="space-y-1">
                            {res.specialRequests && (
                              <div className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded line-clamp-1">
                                <Sparkles className="w-3 h-3 flex-shrink-0" />
                                <span>{res.specialRequests}</span>
                              </div>
                            )}
                            {hasPreOrder && (
                              <div className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                <Utensils className="w-3 h-3 flex-shrink-0" />
                                <span>{res.preOrderItems!.length} pre-ordered items ({formatINR(res.preOrderTotal)})</span>
                              </div>
                            )}
                            {!res.specialRequests && !hasPreOrder && (
                              <span className="text-[11px] text-muted-foreground italic">Standard dine-in</span>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="p-3">
                          <Badge
                            variant={
                              status === "confirmed"
                                ? "default"
                                : status === "seated"
                                ? "secondary"
                                : status === "completed"
                                ? "outline"
                                : status === "cancelled" || status === "no_show"
                                ? "destructive"
                                : "outline"
                            }
                            className={cn(
                              "text-[10px] capitalize",
                              status === "seated" && "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30",
                            )}
                          >
                            {status.replace("_", " ")}
                          </Badge>
                        </td>

                        {/* Actions */}
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Inspect Details"
                              onClick={() => setInspectingReservation(res)}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                              title="Send WhatsApp Confirmation"
                              onClick={() => openWhatsAppConfirmation(res)}
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button aria-label="More actions" variant="ghost" size="icon" className="h-7 w-7">
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 text-xs">
                                <DropdownMenuItem onClick={() => handleUpdateStatus(res.id, "confirmed")}>
                                  <Check className="w-3.5 h-3.5 mr-2 text-emerald-500" />
                                  Confirm Booking
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleUpdateStatus(res.id, "seated")}>
                                  <Armchair className="w-3.5 h-3.5 mr-2 text-primary" />
                                  Seat Guests (Check-In)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleUpdateStatus(res.id, "completed")}>
                                  <CheckCircle2 className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                                  Mark Completed
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setAssignTableRes(res);
                                    setCustomTableName(res.tableName || "Table 1");
                                  }}
                                >
                                  <TableProperties className="w-3.5 h-3.5 mr-2" />
                                  Assign / Move Table
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-amber-600"
                                  onClick={() => handleUpdateStatus(res.id, "no_show")}
                                >
                                  <AlertCircle className="w-3.5 h-3.5 mr-2" />
                                  Mark as No-Show
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-rose-600 focus:text-rose-600"
                                  onClick={() => handleUpdateStatus(res.id, "cancelled")}
                                >
                                  <XCircle className="w-3.5 h-3.5 mr-2" />
                                  Cancel Reservation
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
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

      {/* ═════════════════════════════════════════════════════════════════════
          MODAL 1: CREATE NEW RESERVATION
      ═════════════════════════════════════════════ */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-primary" />
              New Dine-In Table Reservation
            </DialogTitle>
            <DialogDescription>
              Book a table for a guest at any partner restaurant venue.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Guest Name *</Label>
                <Input
                  value={newResForm.guestName}
                  onChange={(e) => setNewResForm({ ...newResForm, guestName: e.target.value })}
                  placeholder="e.g. Arun Nair"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Guest Phone *</Label>
                <Input
                  value={newResForm.guestPhone}
                  onChange={(e) => setNewResForm({ ...newResForm, guestPhone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Restaurant Venue *</Label>
              <Select
                value={newResForm.restaurantId}
                onValueChange={(val) => {
                  const r = restaurantMap.get(val);
                  setNewResForm({
                    ...newResForm,
                    restaurantId: val,
                    restaurantName: r?.name || "",
                  });
                }}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select a restaurant..." />
                </SelectTrigger>
                <SelectContent>
                  {restaurants.map((rest) => (
                    <SelectItem key={rest.id} value={rest.id}>
                      {rest.name || "Restaurant"} {rest.city ? `(${rest.city})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Party Size (Pax) *</Label>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  value={newResForm.guestCount}
                  onChange={(e) => setNewResForm({ ...newResForm, guestCount: e.target.value })}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Date *</Label>
                <Input
                  type="date"
                  value={newResForm.date}
                  onChange={(e) => setNewResForm({ ...newResForm, date: e.target.value })}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Time Slot *</Label>
                <Input
                  type="time"
                  value={newResForm.time}
                  onChange={(e) => setNewResForm({ ...newResForm, time: e.target.value })}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Table Assignment</Label>
              <Input
                value={newResForm.tableName}
                onChange={(e) => setNewResForm({ ...newResForm, tableName: e.target.value })}
                placeholder="e.g. Table 4 / Window Booth"
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Special Requests (Optional)</Label>
              <Input
                value={newResForm.specialRequests}
                onChange={(e) => setNewResForm({ ...newResForm, specialRequests: e.target.value })}
                placeholder="e.g. Anniversary celebration, quiet corner"
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateReservation} disabled={isSavingNew}>
              {isSavingNew ? "Confirming..." : "Confirm Table Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════════
          MODAL 2: INSPECT RESERVATION DETAILS
      ═════════════════════════════════════════════ */}
      <Dialog
        open={!!inspectingReservation}
        onOpenChange={(open) => !open && setInspectingReservation(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-primary" />
              Reservation Details: {inspectingReservation && normalizeGuestName(inspectingReservation)}
            </DialogTitle>
          </DialogHeader>

          {inspectingReservation && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-lg">
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <p className="font-semibold capitalize">
                    {(inspectingReservation.status || "pending").replace("_", " ")}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Party Size:</span>
                  <p className="font-semibold">{normalizeCovers(inspectingReservation)} Guests</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Date & Time:</span>
                  <p className="font-semibold">
                    {normalizeDate(inspectingReservation)} at {normalizeTime(inspectingReservation)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Table:</span>
                  <p className="font-semibold">{inspectingReservation.tableName || "Unassigned"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Restaurant:</span>
                  <p className="font-semibold">
                    {inspectingReservation.restaurantName || "Partner Restaurant"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Guest Phone:</span>
                  <p className="font-semibold">{normalizePhone(inspectingReservation) || "—"}</p>
                </div>
              </div>

              {inspectingReservation.specialRequests && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700">
                  <strong>Special Requests:</strong> {inspectingReservation.specialRequests}
                </div>
              )}

              {/* Pre-Orders List */}
              {inspectingReservation.preOrderItems && inspectingReservation.preOrderItems.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-semibold text-foreground">Pre-Ordered Food Items:</span>
                  <div className="border rounded-lg p-2 divide-y divide-border/40 max-h-36 overflow-y-auto">
                    {inspectingReservation.preOrderItems.map((item, idx) => (
                      <div key={idx} className="py-1 flex justify-between">
                        <span>
                          {item.qty || item.quantity || 1}x {item.name}
                        </span>
                        <span className="font-semibold">{formatINR(item.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Status Modifiers */}
              <div className="pt-2 border-t flex gap-2 flex-wrap justify-between">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => openWhatsAppConfirmation(inspectingReservation)}
                >
                  <MessageSquare className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                  WhatsApp Guest
                </Button>

                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs text-emerald-600"
                    onClick={() => handleUpdateStatus(inspectingReservation.id, "seated")}
                  >
                    <Armchair className="w-3.5 h-3.5 mr-1" />
                    Seat Guest
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs"
                    onClick={() => handleUpdateStatus(inspectingReservation.id, "completed")}
                  >
                    Mark Done
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setInspectingReservation(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════════
          MODAL 3: ASSIGN TABLE DIALOG
      ═════════════════════════════════════════════ */}
      <Dialog
        open={!!assignTableRes}
        onOpenChange={(open) => !open && setAssignTableRes(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TableProperties className="w-4 h-4 text-primary" />
              Assign Table
            </DialogTitle>
          </DialogHeader>

          {assignTableRes && (
            <div className="space-y-3 py-2 text-xs">
              <p>
                Assign table for <strong>{normalizeGuestName(assignTableRes)}</strong> (
                {normalizeCovers(assignTableRes)} Pax) at {assignTableRes.restaurantName}.
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Table Name / Number *</Label>
                <Input
                  value={customTableName}
                  onChange={(e) => setCustomTableName(e.target.value)}
                  placeholder="e.g. Table 12 or VIP Rooftop"
                  className="text-xs"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setAssignTableRes(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAssignTable}>
              Save Table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
