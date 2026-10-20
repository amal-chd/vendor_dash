import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Filter, Clock, User,
  ChevronRight, MoreVertical, CheckCircle2,
  XCircle, Printer, Plus,
  SlidersHorizontal, Calendar, Phone,
  Settings, Info, Trash2, Users, TableProperties, Sparkles
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import {
  collection, query, where, orderBy,
  onSnapshot, doc, getDoc, updateDoc, addDoc, deleteDoc, serverTimestamp, Timestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCurrency } from "@/lib/currency";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface PreOrderItem {
  name: string;
  qty: number;
  price: number;
  variant?: string;
  addons?: string[];
  instructions?: string;
}

interface Reservation {
  id: string;
  restaurantId: string;
  guestName: string;
  guestPhone: string;
  guestCount: number;
  reservationDate: string; // YYYY-MM-DD
  reservationTime: string; // HH:MM
  tableName: string;
  notes?: string;
  specialRequests?: string;
  status: "pending" | "confirmed" | "seated" | "cancelled";
  preOrderItems?: PreOrderItem[];
  preOrderTotal?: number;
  depositAmount?: number;
  dineCoinsEarned?: number;
  source?: string;
  createdAt: any;
}

const transition = { duration: 0.4, ease: [0.2, 0, 0, 1] as const };

export default function ReservationsPage() {
  const { user, activeRestaurantId } = useAuth();
  const { format } = useCurrency();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>("today"); // today, upcoming, all, cancelled
  const [search, setSearch] = useState("");
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
  
  // Add Reservation Form State
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newGuestName, setNewGuestName] = useState("");
  const [newGuestPhone, setNewGuestPhone] = useState("");
  const [newGuestCount, setNewGuestCount] = useState(2);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("19:00");
  const [newTable, setNewTable] = useState("Auto-assign");
  const [newNotes, setNewNotes] = useState("");
  const [newSpecial, setNewSpecial] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // Settings State
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [enableReservations, setEnableReservations] = useState(true);
  const [costForTwo, setCostForTwo] = useState(1000);
  const [dineInOffer, setDineInOffer] = useState("Flat 15% OFF + Cashback");
  const [preBookOffer, setPreBookOffer] = useState("Flat 45% OFF ON PRE-BOOK TABLE");
  const [preBookCashback, setPreBookCashback] = useState(250);
  const [dineInFeatures, setDineInFeatures] = useState<string[]>(["Cozy cafes", "Premium dining", "Buffet"]);
  const [maxGuests, setMaxGuests] = useState(20);
  const [holdTime, setHoldTime] = useState(15);
  const [bookingRules, setBookingRules] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Dine-in detail page content (drives the customer app's detail screen)
  const [dineInHighlights, setDineInHighlights] = useState("");
  const [facilities, setFacilities] = useState<string[]>([]);
  const [galleryText, setGalleryText] = useState(""); // one URL per line
  const [buffets, setBuffets] = useState<{ name: string; period: string; price: number; note: string }[]>([]);
  const [dineOffers, setDineOffers] = useState<{ label: string; discountPct: number; period: string; startTime: string; slotsLeft: number; coverCharge: number }[]>([]);
  const [newBuffet, setNewBuffet] = useState({ name: "", period: "Lunch", price: 0, note: "" });
  const [newOffer, setNewOffer] = useState({ label: "", discountPct: 0, period: "All day", startTime: "", slotsLeft: 0, coverCharge: 0 });

  const facilityOptions = [
    "Lunch", "Dinner", "Serves alcohol", "Valet parking", "Table reservation recommended",
    "Family friendly", "Live Screening", "Outdoor Seating", "Rooftop Ambience", "Free Wifi", "Card accepted"
  ];

  const availableFeatures = [
    "Cozy cafes", "Premium dining", "Buffet", "Live Screening", "Outdoor Seating", "Rooftop Ambience", "Family friendly"
  ];

  const todayStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  // Set default reservation date to today when dialog opens
  useEffect(() => {
    if (addDialogOpen && !newDate) {
      setNewDate(todayStr);
    }
  }, [addDialogOpen, newDate, todayStr]);

  // Load restaurant settings
  useEffect(() => {
    if (!user || !activeRestaurantId) return;
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, "restaurants", activeRestaurantId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setEnableReservations(data.enableReservations !== false);
          setCostForTwo(Number(data.costForTwo) || 1000);
          setDineInOffer(data.dineInOffer || "Flat 15% OFF + Cashback");
          setPreBookOffer(data.preBookOffer || "Flat 45% OFF ON PRE-BOOK TABLE");
          setPreBookCashback(Number(data.preBookCashback) || 250);
          if (Array.isArray(data.dineInFeatures) && data.dineInFeatures.length > 0) {
            setDineInFeatures(data.dineInFeatures);
          }
          setMaxGuests(data.maxGuestsPerBooking || 20);
          setHoldTime(data.holdTimeMinutes || 15);
          setBookingRules(data.bookingRules || "1. Please arrive within 15 minutes of your booking.\n2. Parties larger than 12 must contact the restaurant directly.");
          setDineInHighlights(data.dineInHighlights || "");
          setFacilities(Array.isArray(data.facilities) ? data.facilities : []);
          setGalleryText(Array.isArray(data.dineInGallery) ? data.dineInGallery.join("\n") : "");
          setBuffets(Array.isArray(data.buffets) ? data.buffets : []);
          setDineOffers(Array.isArray(data.dineOffers) ? data.dineOffers : []);
        }
      } catch (e) {
        console.error("Error loading settings:", e);
      }
    };
    fetchSettings();
  }, [user, activeRestaurantId]);

  // Load restaurant tables list
  useEffect(() => {
    if (!user || !activeRestaurantId) return;
    const q = query(collection(db, "tables"), where("restaurantId", "==", activeRestaurantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        name: docSnap.data().name || docSnap.data().label || docSnap.id,
        seats: docSnap.data().seats || 4
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setTables(list);
    }, (err) => console.error("[ReservationsPage] q listener failed", err));
    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  // Load reservations in real-time
  useEffect(() => {
    if (!user || !activeRestaurantId) return;

    const q = query(
      collection(db, "reservations"),
      where("restaurantId", "==", activeRestaurantId),
      orderBy("reservationDate", "asc"),
      orderBy("reservationTime", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          guestCount: Number(data.guestCount) || 2
        } as Reservation;
      });
      setReservations(list);
    }, (err) => {
      console.error("Reservations sync error:", err);
      toast.error("Failed to sync reservations.");
    });

    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  // Filter and Search reservations
  const filteredReservations = useMemo(() => {
    return reservations.filter(res => {
      const matchesSearch =
        res.guestName.toLowerCase().includes(search.toLowerCase()) ||
        res.guestPhone.includes(search) ||
        res.tableName.toLowerCase().includes(search.toLowerCase());

      let matchesFilter = true;
      if (filter === "today") {
        matchesFilter = res.reservationDate === todayStr && res.status !== "cancelled";
      } else if (filter === "upcoming") {
        matchesFilter = res.reservationDate > todayStr && res.status !== "cancelled";
      } else if (filter === "cancelled") {
        matchesFilter = res.status === "cancelled";
      } else if (filter === "seated") {
        matchesFilter = res.status === "seated";
      } else if (filter === "all") {
        matchesFilter = true;
      }

      return matchesSearch && matchesFilter;
    });
  }, [reservations, search, filter, todayStr]);

  const updateStatus = async (id: string, status: Reservation["status"]) => {
    try {
      await updateDoc(doc(db, "reservations", id), { status });
      toast.success(`Booking marked as ${status}`);
      if (selectedRes && selectedRes.id === id) {
        setSelectedRes(prev => prev ? { ...prev, status } : null);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to update status");
    }
  };

  const deleteReservation = async (id: string) => {
    try {
      await deleteDoc(doc(db, "reservations", id));
      toast.success("Reservation deleted");
      setSelectedRes(null);
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete reservation");
    }
  };

  const saveSettings = async () => {
    if (!activeRestaurantId) return;
    setIsSavingSettings(true);
    try {
      await updateDoc(doc(db, "restaurants", activeRestaurantId), {
        enableReservations,
        costForTwo: Number(costForTwo) || 1000,
        dineInOffer: dineInOffer.trim(),
        preBookOffer: preBookOffer.trim(),
        preBookCashback: Number(preBookCashback) || 250,
        dineInFeatures,
        maxGuestsPerBooking: maxGuests,
        holdTimeMinutes: holdTime,
        bookingRules: bookingRules.trim(),
        dineInHighlights: dineInHighlights.trim(),
        facilities,
        dineInGallery: galleryText.split("\n").map(s => s.trim()).filter(Boolean),
        buffets,
        dineOffers
      });
      toast.success("Dine-in & table reservation settings saved!");
      setSettingsDialogOpen(false);
    } catch (e) {
      console.error(e);
      toast.error("Failed to save rules.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleAddReservation = async () => {
    if (!newGuestName.trim() || !newGuestPhone.trim() || !newDate || !newTime) {
      toast.error("Please fill in name, phone, date and time.");
      return;
    }
    setIsAdding(true);
    try {
      await addDoc(collection(db, "reservations"), {
        restaurantId: activeRestaurantId,
        guestName: newGuestName.trim(),
        guestPhone: newGuestPhone.trim(),
        guestCount: Number(newGuestCount) || 2,
        reservationDate: newDate,
        reservationTime: newTime,
        tableName: newTable,
        notes: newNotes.trim(),
        specialRequests: newSpecial.trim(),
        status: "confirmed", // manual additions default to confirmed
        createdAt: serverTimestamp(),
        source: "dashboard"
      });
      toast.success("Reservation added!");
      setAddDialogOpen(false);
      // Reset form
      setNewGuestName("");
      setNewGuestPhone("");
      setNewGuestCount(2);
      setNewNotes("");
      setNewSpecial("");
      setNewTable("Auto-assign");
    } catch (e) {
      console.error(e);
      toast.error("Failed to add reservation");
    } finally {
      setIsAdding(false);
    }
  };

  const printBookingSlip = (res: Reservation) => {
    const printWindow = window.open('', '', 'width=450,height=800');
    if (!printWindow) return;

    const itemsHtml = res.preOrderItems && res.preOrderItems.length > 0
      ? res.preOrderItems.map(item => `
          <tr class="item-row">
            <td class="qty">${item.qty}x</td>
            <td class="desc">
              <strong>${item.name}</strong>
              ${item.variant ? `<br><small>Variant: ${item.variant}</small>` : ''}
              ${item.addons && item.addons.length > 0 ? `<br><small>Addons: ${item.addons.join(", ")}</small>` : ''}
            </td>
            <td class="price">${format(item.price * item.qty)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="3" class="no-items">No pre-ordered food items</td></tr>';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reservation Slip - ${res.guestName}</title>
        <style>
          body { font-family: sans-serif; padding: 20px; color: #333; line-height: 1.5; }
          .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
          .title { font-size: 20px; font-weight: bold; margin: 0; text-transform: uppercase; }
          .meta { font-size: 12px; color: #666; margin-top: 5px; }
          .section { margin-bottom: 20px; }
          .section-title { font-size: 12px; font-weight: bold; text-transform: uppercase; color: #555; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-bottom: 10px; }
          .field-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 14px; }
          .field-label { color: #666; }
          .field-value { font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th { font-size: 11px; text-transform: uppercase; color: #777; text-align: left; border-bottom: 1px solid #ccc; padding-bottom: 6px; }
          td { padding: 10px 0; border-bottom: 1px solid #eee; font-size: 13px; vertical-align: top; }
          .qty { width: 35px; font-weight: bold; }
          .price { text-align: right; font-weight: bold; }
          .total-row { display: flex; justify-content: space-between; border-top: 2px solid #333; padding-top: 10px; font-weight: bold; font-size: 16px; margin-top: 15px; }
          .footer { text-align: center; font-size: 10px; color: #999; margin-top: 40px; border-top: 1px dashed #ccc; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="header">
          <p class="title">Reservation Details</p>
          <p class="meta">KadaDine Operating Slip</p>
        </div>

        <div class="section">
          <div class="section-title">Booking Information</div>
          <div class="field-row">
            <span class="field-label">Guest Name:</span>
            <span class="field-value">${res.guestName}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Phone:</span>
            <span class="field-value">${res.guestPhone}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Date & Time:</span>
            <span class="field-value">${res.reservationDate} at ${res.reservationTime}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Guests Size:</span>
            <span class="field-value">${res.guestCount} People</span>
          </div>
          <div class="field-row">
            <span class="field-label">Assigned Table:</span>
            <span class="field-value">${res.tableName || 'Auto-assign'}</span>
          </div>
          ${res.notes ? `
            <div class="field-row" style="margin-top: 10px; flex-direction: column;">
              <span class="field-label">Notes:</span>
              <span class="field-value" style="font-weight: normal; font-style: italic; margin-top: 2px;">"${res.notes}"</span>
            </div>
          ` : ''}
          ${res.specialRequests ? `
            <div class="field-row" style="margin-top: 10px; flex-direction: column;">
              <span class="field-label">Special Requests:</span>
              <span class="field-value" style="font-weight: normal; color: #d97706; margin-top: 2px;">"${res.specialRequests}"</span>
            </div>
          ` : ''}
        </div>

        <div class="section">
          <div class="section-title">Pre-Order Food Cart</div>
          <table>
            <thead>
              <tr>
                <th>Qty</th>
                <th>Item Details</th>
                <th style="text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          ${res.preOrderTotal ? `
            <div class="total-row">
              <span>Pre-order Total:</span>
              <span>${format(res.preOrderTotal)}</span>
            </div>
          ` : ''}
        </div>

        <div class="footer">
          <p>Printed on: ${new Date().toLocaleString()}</p>
          <p>Powered by Kada Dine Restaurant OS</p>
        </div>

        <script>
          window.onload = function() {
            window.print();
            setTimeout(() => window.close(), 500);
          }
        </script>
      </body>
      </html>
    `;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const getStatusBadge = (status: Reservation["status"]) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-lg h-7 px-3 text-[10px] font-bold uppercase tracking-wider shadow-sm">Pending</Badge>;
      case "confirmed":
        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-lg h-7 px-3 text-[10px] font-bold uppercase tracking-wider shadow-sm">Confirmed</Badge>;
      case "seated":
        return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-lg h-7 px-3 text-[10px] font-bold uppercase tracking-wider shadow-sm">Seated</Badge>;
      case "cancelled":
        return <Badge className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg h-7 px-3 text-[10px] font-bold uppercase tracking-wider shadow-sm">Cancelled</Badge>;
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8 pb-20 lg:pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-2">
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
            Bookings & <span className="text-primary">Reservations</span>
          </h1>
          <p className="text-sm text-muted-foreground font-medium flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Real-time customer dining scheduler
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          <Button
            variant="outline"
            className="w-full sm:w-auto rounded-xl font-semibold h-11 px-6 border-border/40 hover:bg-muted/50"
            onClick={() => setSettingsDialogOpen(true)}
          >
            <Settings className="w-4 h-4 mr-2" /> Booking Rules
          </Button>
          <Button
            className="w-full sm:w-auto rounded-xl font-semibold h-11 px-6 shadow-sm bg-primary text-primary-foreground"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" /> New Reservation
          </Button>
        </div>
      </div>

      {/* Analytics Mini Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {[
          { label: "Today's Bookings", count: reservations.filter(r => r.reservationDate === todayStr && r.status !== "cancelled").length, color: "text-blue-500", border: "border-blue-500/20" },
          { label: "Pending Requests", count: reservations.filter(r => r.status === "pending").length, color: "text-amber-500", border: "border-amber-500/20" },
          { label: "Confirmed Today", count: reservations.filter(r => r.reservationDate === todayStr && r.status === "confirmed").length, color: "text-emerald-500", border: "border-emerald-500/20" },
          { label: "Currently Seated", count: reservations.filter(r => r.status === "seated").length, color: "text-indigo-500", border: "border-indigo-500/20" },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            className={cn("bg-card rounded-2xl p-5 border transition-all hover:scale-[1.02] shadow-sm", item.border)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...transition, delay: i * 0.1 }}
          >
            <span className={cn("text-xs font-bold uppercase tracking-wider block mb-2", item.color)}>{item.label}</span>
            <div className="text-3xl font-bold tracking-tight text-foreground">{item.count}</div>
          </motion.div>
        ))}
      </div>

      {/* Main Booking List */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
            {[
              { key: "today", label: "Today" },
              { key: "upcoming", label: "Upcoming" },
              { key: "seated", label: "Seated" },
              { key: "cancelled", label: "Cancelled" },
              { key: "all", label: "All Bookings" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border whitespace-nowrap",
                  filter === t.key
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card text-muted-foreground border-border/40 hover:border-primary/50"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-64 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Search Guest Name, Table..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 h-10 bg-card border-border/40 rounded-xl font-medium text-sm shadow-sm focus:ring-1 focus:ring-primary focus-visible:ring-offset-0"
            />
          </div>
        </div>

        {/* Cards Grid */}
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredReservations.map((res, i) => (
              <motion.div
                key={res.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ ...transition, delay: i * 0.02 }}
                onClick={() => setSelectedRes(res)}
                className={cn(
                  "group relative bg-card border rounded-2xl transition-all cursor-pointer p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm",
                  selectedRes?.id === res.id ? "ring-2 ring-primary border-primary z-10" : "border-border/40 hover:border-primary/40"
                )}
              >
                <div className="flex items-start gap-4">
                  {/* Time icon bubble */}
                  <div className="w-12 h-12 rounded-xl bg-muted border border-border/20 flex flex-col items-center justify-center shrink-0">
                    <Clock className="w-4 h-4 text-muted-foreground opacity-60 mb-0.5" />
                    <span className="text-xs font-bold text-foreground leading-none">{res.reservationTime}</span>
                  </div>

                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-base sm:text-lg font-bold text-foreground truncate">{res.guestName}</h4>
                      <span className="text-xs text-muted-foreground font-medium">({res.guestPhone})</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-muted-foreground">
                      <div className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {res.reservationDate}</div>
                      <div className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {res.guestCount} guests</div>
                      <div className="flex items-center gap-1"><TableProperties className="w-3.5 h-3.5" /> {res.tableName || 'Auto-assign'}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-md text-[10px] font-bold">
                        Deposit: {format(res.depositAmount || 200)} Paid
                      </span>
                      <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-md text-[10px] font-bold">
                        +{res.dineCoinsEarned || 200} Coins
                      </span>
                      {res.preOrderItems && res.preOrderItems.length > 0 && (
                        <Badge className="bg-primary/5 text-primary border border-primary/10 rounded-md text-[9px] font-bold uppercase tracking-wider py-0.5 px-2">
                          Food Pre-ordered ({res.preOrderItems.length} items)
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 self-stretch sm:self-auto pt-3 sm:pt-0 border-t border-border/10 sm:border-0">
                  <div className="flex items-center gap-2">
                    {getStatusBadge(res.status)}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:translate-x-1 transition-all hidden sm:block" />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredReservations.length === 0 && (
            <div className="py-20 text-center space-y-3 opacity-60">
              <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">No Bookings Found</h3>
            </div>
          )}
        </div>
      </div>

      {/* Dialog: Reservation Details Pop up */}
      <Dialog open={selectedRes !== null} onOpenChange={(open) => { if (!open) setSelectedRes(null); }}>
        {selectedRes && (
          <DialogContent className="rounded-[28px] max-w-lg p-0 border-border/40 shadow-2xl bg-card overflow-hidden">
            {/* Header */}
            <div className="bg-muted/30 px-6 py-5 border-b border-border/40 flex items-start justify-between relative shrink-0">
              <div className="space-y-1">
                <DialogTitle className="text-xl font-bold tracking-tight text-foreground truncate max-w-[280px]">
                  {selectedRes.guestName}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
                  {selectedRes.guestPhone}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2 pr-6">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full bg-background border border-border/40 h-8 w-8 shadow-sm transition-transform hover:scale-105"
                  onClick={() => printBookingSlip(selectedRes)}
                >
                  <Printer className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            </div>

            {/* Details Body */}
            <div className="p-6 overflow-y-auto max-h-[60vh] hide-scrollbar space-y-6">
              
              {/* Status Indicator */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-muted/20 border border-border/40">
                <span className="text-xs font-bold text-muted-foreground uppercase">Current Status</span>
                {getStatusBadge(selectedRes.status)}
              </div>

              {/* Summary Rows */}
              <div className="space-y-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/5 flex items-center justify-center border border-primary/10 shrink-0">
                    <Calendar className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Date</p>
                    <p className="text-sm font-bold text-foreground">{selectedRes.reservationDate}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/5 flex items-center justify-center border border-primary/10 shrink-0">
                    <Clock className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Scheduled Time</p>
                    <p className="text-sm font-bold text-foreground">{selectedRes.reservationTime}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/5 flex items-center justify-center border border-primary/10 shrink-0">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Party Size</p>
                    <p className="text-sm font-bold text-foreground">{selectedRes.guestCount} Guests</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/5 flex items-center justify-center border border-primary/10 shrink-0">
                    <TableProperties className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Table Allocation</p>
                    <p className="text-sm font-bold text-foreground">{selectedRes.tableName || "Auto-assign"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Pre-booking Deposit</p>
                    <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{format(selectedRes.depositAmount || 200)} (100% Adjustable)</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0">
                    <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">DineCoins Reward</p>
                    <p className="text-sm font-bold text-amber-600 dark:text-amber-400">+{selectedRes.dineCoinsEarned || 200} Coins</p>
                  </div>
                </div>
              </div>

              {/* Notes / Requests */}
              {(selectedRes.notes || selectedRes.specialRequests) && (
                <div className="space-y-3 pt-4 border-t border-border/10">
                  {selectedRes.notes && (
                    <div className="space-y-1 bg-muted/10 p-3.5 rounded-xl border border-border/20">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Guest Notes</p>
                      <p className="text-xs font-semibold text-foreground italic leading-relaxed">"{selectedRes.notes}"</p>
                    </div>
                  )}
                  {selectedRes.specialRequests && (
                    <div className="space-y-1 bg-amber-500/[0.04] p-3.5 rounded-xl border border-amber-500/20">
                      <p className="text-[10px] font-bold text-amber-600 uppercase flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-500" /> Special Request
                      </p>
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 italic leading-relaxed">"{selectedRes.specialRequests}"</p>
                    </div>
                  )}
                </div>
              )}

              {/* Pre-ordered items */}
              {selectedRes.preOrderItems && selectedRes.preOrderItems.length > 0 && (
                <div className="space-y-3.5 pt-4 border-t border-border/10">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Pre-ordered Food</h4>
                  <div className="space-y-3">
                    {selectedRes.preOrderItems.map((item, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className="bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded text-[10px] h-fit mt-0.5">{item.qty}x</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-sm font-bold text-foreground">{item.name}</p>
                              {item.variant && <p className="text-[10px] text-muted-foreground mt-0.5">Variant: {item.variant}</p>}
                              {item.addons && item.addons.length > 0 && <p className="text-[10px] text-muted-foreground">Addons: {item.addons.join(", ")}</p>}
                            </div>
                            <span className="text-sm font-bold text-foreground whitespace-nowrap">{format(item.price * item.qty)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {selectedRes.preOrderTotal && (
                    <div className="flex justify-between items-center bg-primary/5 p-4 rounded-xl border border-primary/15 font-bold text-sm text-primary mt-2">
                      <span>Total Amount</span>
                      <span>{format(selectedRes.preOrderTotal)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Quick Status Actions */}
            <div className="p-6 bg-muted/20 border-t border-border/40 space-y-4 shrink-0">
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Update Booking Status</p>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    variant={selectedRes.status === "confirmed" ? "default" : "outline"}
                    className={cn("rounded-xl font-bold text-xs h-9", selectedRes.status === "confirmed" && "bg-emerald-600 hover:bg-emerald-700")}
                    onClick={() => updateStatus(selectedRes.id, "confirmed")}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedRes.status === "seated" ? "default" : "outline"}
                    className={cn("rounded-xl font-bold text-xs h-9", selectedRes.status === "seated" && "bg-blue-600 hover:bg-blue-700")}
                    onClick={() => updateStatus(selectedRes.id, "seated")}
                  >
                    Seated
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedRes.status === "cancelled" ? "destructive" : "outline"}
                    className="rounded-xl font-bold text-xs h-9"
                    onClick={() => updateStatus(selectedRes.id, "cancelled")}
                  >
                    Cancel
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full text-destructive hover:bg-destructive/10 border-destructive/20 h-10 rounded-xl text-xs font-bold gap-1.5"
                onClick={() => {
                  if (confirm("Delete this reservation permanently?")) {
                    deleteReservation(selectedRes.id);
                  }
                }}
              >
                <Trash2 className="w-4 h-4" /> Delete Reservation
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* Dialog: New Booking */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="rounded-2xl max-w-md p-6 border-border/40 shadow-xl bg-card">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl font-bold">Add Reservation</DialogTitle>
            <DialogDescription className="text-sm font-medium text-muted-foreground">
              Manually book a table for walk-ins or phone reservations.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Guest Name</label>
                <Input
                  value={newGuestName}
                  onChange={(e) => setNewGuestName(e.target.value)}
                  placeholder="Guest Name"
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Phone Number</label>
                <Input
                  value={newGuestPhone}
                  onChange={(e) => setNewGuestPhone(e.target.value)}
                  placeholder="+91 9876543210"
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Date</label>
                <Input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Time</label>
                <Input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Guests Size</label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={newGuestCount}
                  onChange={(e) => setNewGuestCount(Number(e.target.value) || 2)}
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Preferred Table</label>
                <select
                  value={newTable}
                  onChange={(e) => setNewTable(e.target.value)}
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 w-full focus:ring-1 focus:ring-primary text-sm font-semibold"
                >
                  <option value="Auto-assign">Auto-assign Table</option>
                  {tables.map(t => (
                    <option key={t.id} value={t.name}>{t.name} (Seats {t.seats})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground ml-1">Special Requests</label>
              <Input
                value={newSpecial}
                onChange={(e) => setNewSpecial(e.target.value)}
                placeholder="High-chair, anniversary, etc."
                className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground ml-1">Notes (internal)</label>
              <Input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Staff notes..."
                className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-5 border-t border-border/10">
            <Button
              variant="outline"
              className="rounded-xl font-semibold text-xs h-10 px-5 border-border/40"
              onClick={() => setAddDialogOpen(false)}
              disabled={isAdding}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl font-semibold text-xs h-10 px-6 bg-primary text-primary-foreground shadow-sm"
              onClick={handleAddReservation}
              disabled={isAdding}
            >
              {isAdding ? "Adding..." : "Confirm Book"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: Reservation Settings */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="rounded-2xl max-w-lg p-6 border-border/40 shadow-xl bg-card max-h-[85vh] overflow-y-auto">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl font-bold">Table Booking & Dine-in Settings</DialogTitle>
            <DialogDescription className="text-sm font-medium text-muted-foreground">
              Master controls for customer discovery, offers, pre-booking cashback, and guidelines.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border/40">
              <div className="space-y-0.5">
                <span className="text-sm font-bold text-foreground">Enable Table Reservations</span>
                <p className="text-xs text-muted-foreground">Allow customers to book dine-in tables via app</p>
              </div>
              <input
                type="checkbox"
                checked={enableReservations}
                onChange={(e) => setEnableReservations(e.target.checked)}
                className="w-5 h-5 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Cost for Two (₹)</label>
                <Input
                  type="number"
                  value={costForTwo}
                  onChange={(e) => setCostForTwo(Number(e.target.value) || 1000)}
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Pre-Book Cashback (₹ value)</label>
                <Input
                  type="number"
                  value={preBookCashback}
                  onChange={(e) => setPreBookCashback(Number(e.target.value) || 250)}
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground ml-1">Dine-in Offer Title</label>
              <Input
                value={dineInOffer}
                onChange={(e) => setDineInOffer(e.target.value)}
                placeholder="e.g. Flat 15% OFF + Cashback"
                className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground ml-1">Pre-Book Deal Pill Text</label>
              <Input
                value={preBookOffer}
                onChange={(e) => setPreBookOffer(e.target.value)}
                placeholder="e.g. Flat 45% OFF ON PRE-BOOK TABLE"
                className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground ml-1">Dine-in Features & Highlights</label>
              <div className="flex flex-wrap gap-2">
                {availableFeatures.map((f) => {
                  const isSel = dineInFeatures.includes(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        if (isSel) {
                          setDineInFeatures(dineInFeatures.filter(item => item !== f));
                        } else {
                          setDineInFeatures([...dineInFeatures, f]);
                        }
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-bold transition-all border",
                        isSel
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/40 text-muted-foreground border-border/40 hover:border-primary/50"
                      )}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/10">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Max Guests Limit</label>
                <Input
                  type="number"
                  min={1}
                  value={maxGuests}
                  onChange={(e) => setMaxGuests(Number(e.target.value) || 20)}
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground ml-1">Hold Window (Mins)</label>
                <Input
                  type="number"
                  min={5}
                  value={holdTime}
                  onChange={(e) => setHoldTime(Number(e.target.value) || 15)}
                  className="h-11 rounded-xl bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground ml-1">Booking Policy Terms</label>
              <textarea
                value={bookingRules}
                onChange={(e) => setBookingRules(e.target.value)}
                rows={3}
                className="w-full text-sm font-semibold rounded-xl bg-muted/30 border-none p-4 focus:ring-1 focus:ring-primary resize-none outline-none"
                placeholder="Enter booking policy terms..."
              />
            </div>

            <div className="space-y-1.5 pt-2 border-t border-border/10">
              <label className="text-xs font-bold text-muted-foreground ml-1">Restaurant Highlights (About section)</label>
              <textarea
                value={dineInHighlights}
                onChange={(e) => setDineInHighlights(e.target.value)}
                rows={2}
                className="w-full text-sm font-semibold rounded-xl bg-muted/30 border-none p-4 focus:ring-1 focus:ring-primary resize-none outline-none"
                placeholder="e.g. Experience a symphony of flavors at this multicuisine restaurant…"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground ml-1">Dine-in Gallery Image URLs (one per line)</label>
              <textarea
                value={galleryText}
                onChange={(e) => setGalleryText(e.target.value)}
                rows={3}
                className="w-full text-xs font-semibold rounded-xl bg-muted/30 border-none p-4 focus:ring-1 focus:ring-primary resize-none outline-none"
                placeholder={"https://…/interior.jpg\nhttps://…/buffet.jpg"}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground ml-1">Facilities</label>
              <div className="flex flex-wrap gap-2">
                {facilityOptions.map((f) => {
                  const isSel = facilities.includes(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() =>
                        setFacilities(isSel ? facilities.filter(x => x !== f) : [...facilities, f])
                      }
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-bold transition-all border",
                        isSel
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/40 text-muted-foreground border-border/40 hover:border-primary/50"
                      )}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border/10">
              <label className="text-xs font-bold text-muted-foreground ml-1">Buffets</label>
              {buffets.map((b, i) => (
                <div key={i} className="flex items-center justify-between bg-muted/30 rounded-xl px-4 py-2.5">
                  <span className="text-xs font-bold text-foreground">
                    {b.name} · ₹{b.price} <span className="text-muted-foreground font-semibold">({b.period}{b.note ? ` · ${b.note}` : ""})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setBuffets(buffets.filter((_, x) => x !== i))}
                    className="text-destructive text-xs font-bold hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="grid grid-cols-4 gap-2">
                <Input placeholder="Name" value={newBuffet.name}
                  onChange={(e) => setNewBuffet({ ...newBuffet, name: e.target.value })}
                  className="h-9 rounded-lg bg-muted/30 border-none px-3 text-xs" />
                <select value={newBuffet.period}
                  onChange={(e) => setNewBuffet({ ...newBuffet, period: e.target.value })}
                  className="h-9 rounded-lg bg-muted/30 border-none px-2 text-xs font-semibold">
                  {["Breakfast", "Lunch", "Dinner"].map(p => <option key={p}>{p}</option>)}
                </select>
                <Input type="number" placeholder="₹ / guest" value={newBuffet.price || ""}
                  onChange={(e) => setNewBuffet({ ...newBuffet, price: Number(e.target.value) || 0 })}
                  className="h-9 rounded-lg bg-muted/30 border-none px-3 text-xs" />
                <Button type="button" variant="outline" className="h-9 rounded-lg text-xs font-bold"
                  onClick={() => {
                    if (!newBuffet.name.trim()) return;
                    setBuffets([...buffets, { ...newBuffet, name: newBuffet.name.trim() }]);
                    setNewBuffet({ name: "", period: "Lunch", price: 0, note: "" });
                  }}>
                  + Add
                </Button>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border/10">
              <label className="text-xs font-bold text-muted-foreground ml-1">Time-Slot Offers</label>
              {dineOffers.map((o, i) => (
                <div key={i} className="flex items-center justify-between bg-muted/30 rounded-xl px-4 py-2.5">
                  <span className="text-xs font-bold text-foreground">
                    {o.label} ({o.discountPct}%){" "}
                    <span className="text-muted-foreground font-semibold">
                      {o.period}{o.startTime ? ` from ${o.startTime}` : ""} · {o.slotsLeft} slots · Cover ₹{o.coverCharge}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDineOffers(dineOffers.filter((_, x) => x !== i))}
                    className="text-destructive text-xs font-bold hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Label — FLAT 25% OFF" value={newOffer.label}
                  onChange={(e) => setNewOffer({ ...newOffer, label: e.target.value })}
                  className="h-9 rounded-lg bg-muted/30 border-none px-3 text-xs" />
                <Input type="number" placeholder="Discount %" value={newOffer.discountPct || ""}
                  onChange={(e) => setNewOffer({ ...newOffer, discountPct: Number(e.target.value) || 0 })}
                  className="h-9 rounded-lg bg-muted/30 border-none px-3 text-xs" />
                <select value={newOffer.period}
                  onChange={(e) => setNewOffer({ ...newOffer, period: e.target.value })}
                  className="h-9 rounded-lg bg-muted/30 border-none px-2 text-xs font-semibold">
                  {["Breakfast", "Lunch", "Dinner", "All day"].map(p => <option key={p}>{p}</option>)}
                </select>
                <Input placeholder="Start — 9:30 AM" value={newOffer.startTime}
                  onChange={(e) => setNewOffer({ ...newOffer, startTime: e.target.value })}
                  className="h-9 rounded-lg bg-muted/30 border-none px-3 text-xs" />
                <Input type="number" placeholder="Slots" value={newOffer.slotsLeft || ""}
                  onChange={(e) => setNewOffer({ ...newOffer, slotsLeft: Number(e.target.value) || 0 })}
                  className="h-9 rounded-lg bg-muted/30 border-none px-3 text-xs" />
                <div className="flex gap-2">
                  <Input type="number" placeholder="Cover ₹" value={newOffer.coverCharge || ""}
                    onChange={(e) => setNewOffer({ ...newOffer, coverCharge: Number(e.target.value) || 0 })}
                    className="h-9 rounded-lg bg-muted/30 border-none px-3 text-xs flex-1" />
                  <Button type="button" variant="outline" className="h-9 rounded-lg text-xs font-bold"
                    onClick={() => {
                      if (!newOffer.label.trim()) return;
                      setDineOffers([...dineOffers, { ...newOffer, label: newOffer.label.trim().toUpperCase() }]);
                      setNewOffer({ label: "", discountPct: 0, period: "All day", startTime: "", slotsLeft: 0, coverCharge: 0 });
                    }}>
                    + Add
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-5 border-t border-border/10">
            <Button
              variant="outline"
              className="rounded-xl font-semibold text-xs h-10 px-5 border-border/40"
              onClick={() => setSettingsDialogOpen(false)}
              disabled={isSavingSettings}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl font-semibold text-xs h-10 px-6 bg-primary text-primary-foreground shadow-sm"
              onClick={saveSettings}
              disabled={isSavingSettings}
            >
              {isSavingSettings ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
