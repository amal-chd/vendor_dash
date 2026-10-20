import React, { useState, useMemo } from "react";
import { 
  LogIn, 
  LogOut, 
  CalendarPlus, 
  XCircle, 
  Building2, 
  CheckCircle2, 
  Clock, 
  Search, 
  Filter, 
  ChevronRight, 
  Phone, 
  Mail, 
  Calendar, 
  CreditCard, 
  Home, 
  Copy, 
  Check, 
  ExternalLink,
  ShieldCheck,
  AlertCircle
} from "lucide-react";
import { format, isToday, isTomorrow, isYesterday, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/currency";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export interface StayTimelineItem {
  id: string;
  type: "booking_new" | "check_in" | "check_out" | "cancellation" | "property_pending" | "property_approved";
  title: string;
  description?: string;
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  propertyName: string;
  propertyId?: string;
  bookingId?: string;
  bookingPath?: string;
  roomInfo?: string;
  timestamp: Date;
  checkIn?: Date | null;
  checkOut?: Date | null;
  nights?: number;
  amount?: number;
  status: string;
  statusTone: "success" | "warning" | "danger" | "info" | "neutral" | "purple";
  rawBooking?: any;
  rawProperty?: any;
}

interface StayOperationsTimelineProps {
  items: StayTimelineItem[];
  loading?: boolean;
  /**
   * Returns false when the update did not fully land, so the dialog can stay
   * open on the booking that still needs attention instead of closing on a
   * failure the operator never saw.
   */
  onUpdateBookingStatus?: (item: StayTimelineItem, newStatus: string) => Promise<boolean | void>;
  onApproveProperty?: (propertyId: string) => Promise<void>;
  onRejectProperty?: (propertyId: string) => Promise<void>;
}

export function StayOperationsTimeline({
  items,
  loading = false,
  onUpdateBookingStatus,
  onApproveProperty,
  onRejectProperty,
}: StayOperationsTimelineProps) {
  const [filter, setFilter] = useState<"all" | "today" | "check_in" | "check_out" | "new" | "property">("all");
  const [search, setSearch] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<StayTimelineItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  /**
   * The four quick-transition buttons each ran
   *   setActionBusy(true); await onUpdateBookingStatus(...); setActionBusy(false);
   * with no try/finally, so a rejected write left actionBusy stuck true: every
   * button in the group stayed disabled and the dialog sat there inert until
   * the page was remounted. The busy flag is now always cleared, and the dialog
   * only closes when the update actually landed.
   */
  const applyBookingStatus = async (newStatus: string) => {
    if (!selectedBooking || !onUpdateBookingStatus) return;
    const booking = selectedBooking;
    setActionBusy(true);
    try {
      const ok = await onUpdateBookingStatus(booking, newStatus);
      if (ok !== false) setSelectedBooking(null);
    } catch (e) {
      // The parent reports the failure; keep the dialog open on the booking
      // that still needs attention.
      console.error("[StayOperationsTimeline] booking status update failed", e);
    } finally {
      setActionBusy(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Type / category filter
      if (filter === "today") {
        const isEventToday = isToday(item.timestamp) || (item.checkIn && isToday(item.checkIn)) || (item.checkOut && isToday(item.checkOut));
        if (!isEventToday) return false;
      } else if (filter === "check_in" && item.type !== "check_in") {
        return false;
      } else if (filter === "check_out" && item.type !== "check_out") {
        return false;
      } else if (filter === "new" && item.type !== "booking_new") {
        return false;
      } else if (filter === "property" && item.type !== "property_pending" && item.type !== "property_approved") {
        return false;
      }

      // Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = item.guestName?.toLowerCase().includes(q);
        const matchProp = item.propertyName?.toLowerCase().includes(q);
        const matchId = item.bookingId?.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
        const matchEmail = item.guestEmail?.toLowerCase().includes(q);
        const matchPhone = item.guestPhone?.toLowerCase().includes(q);
        return matchName || matchProp || matchId || matchEmail || matchPhone;
      }

      return true;
    });
  }, [items, filter, search]);

  const renderEventIcon = (type: StayTimelineItem["type"]) => {
    switch (type) {
      case "check_in":
        return (
          <div className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center ring-4 ring-card shrink-0">
            <LogIn className="w-4 h-4" />
          </div>
        );
      case "check_out":
        return (
          <div className="w-8 h-8 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center ring-4 ring-card shrink-0">
            <LogOut className="w-4 h-4" />
          </div>
        );
      case "booking_new":
        return (
          <div className="w-8 h-8 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center ring-4 ring-card shrink-0">
            <CalendarPlus className="w-4 h-4" />
          </div>
        );
      case "cancellation":
        return (
          <div className="w-8 h-8 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center ring-4 ring-card shrink-0">
            <XCircle className="w-4 h-4" />
          </div>
        );
      case "property_pending":
        return (
          <div className="w-8 h-8 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center ring-4 ring-card shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
        );
      case "property_approved":
        return (
          <div className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center ring-4 ring-card shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        );
      default:
        return (
          <div className="w-8 h-8 rounded-full bg-slate-500/15 text-muted-foreground flex items-center justify-center ring-4 ring-card shrink-0">
            <Clock className="w-4 h-4" />
          </div>
        );
    }
  };

  const getToneBadge = (tone: StayTimelineItem["statusTone"], text: string) => {
    let classes = "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border";
    switch (tone) {
      case "success":
        classes += " bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
        break;
      case "warning":
        classes += " bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
        break;
      case "danger":
        classes += " bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
        break;
      case "info":
        classes += " bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20";
        break;
      case "purple":
        classes += " bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
        break;
      default:
        classes += " bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
        break;
    }
    return <span className={classes}>{text}</span>;
  };

  const formatEventDate = (d: Date) => {
    if (isToday(d)) return `Today, ${format(d, "h:mm a")}`;
    if (isTomorrow(d)) return `Tomorrow, ${format(d, "h:mm a")}`;
    if (isYesterday(d)) return `Yesterday, ${format(d, "h:mm a")}`;
    return format(d, "MMM d, h:mm a");
  };

  return (
    <Card className="shadow-sm border border-slate-200/60 dark:border-slate-800">
      <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800/50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                Operations & Booking Timeline
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </CardTitle>
              <Badge variant="outline" className="text-xs font-semibold px-2">
                {items.length} live events
              </Badge>
            </div>
            <CardDescription className="mt-1 text-xs">
              Chronological live feed of stay reservations, guest check-ins, departures, and property activities
            </CardDescription>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search guest, property, ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs bg-muted/40"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-3 pb-1 -mb-1 scrollbar-none">
          {[
            { id: "all", label: "All Activity" },
            { id: "today", label: "Today's Schedule" },
            { id: "new", label: "New Reservations" },
            { id: "check_in", label: "Check-ins" },
            { id: "check_out", label: "Check-outs" },
            { id: "property", label: "Property Reviews" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id as any)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors shrink-0 ${
                filter === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <Clock className="w-8 h-8 animate-spin text-muted-foreground mx-auto opacity-50" />
            <p className="text-xs text-muted-foreground font-medium">Syncing live stay timeline from backend...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Calendar className="w-10 h-10 text-muted-foreground mx-auto opacity-20" />
            <p className="text-sm font-semibold text-foreground">No events found</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {search
                ? `No events matching "${search}". Try clearing your search query.`
                : "No timeline activities found for the selected category."}
            </p>
            {(search || filter !== "all") && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-xs h-7"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Reset filters
              </Button>
            )}
          </div>
        ) : (
          <div className="relative pl-6 pr-4 py-4 space-y-6 before:absolute before:left-10 before:top-4 before:bottom-4 before:w-[2px] before:bg-slate-200 dark:before:bg-slate-800">
            {filteredItems.map((item) => {
              const hasBooking = !!item.bookingId;
              const hasProperty = !!item.propertyId;

              return (
                <div
                  key={item.id}
                  className="relative flex items-start gap-4 group"
                >
                  {/* Icon Node */}
                  <div className="z-10 bg-card">
                    {renderEventIcon(item.type)}
                  </div>

                  {/* Main Event Card */}
                  <div className="flex-1 min-w-0 bg-slate-50/70 dark:bg-slate-900/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 transition-colors border border-slate-200/50 dark:border-slate-800/80 rounded-xl p-3.5 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {item.title}
                        </span>
                        {getToneBadge(item.statusTone, item.status)}
                      </div>
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                        {formatEventDate(item.timestamp)}
                        <span className="text-slate-400 ml-1.5 font-normal">
                          ({formatDistanceToNow(item.timestamp, { addSuffix: true })})
                        </span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300 mt-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Home className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground font-semibold truncate">{item.propertyName}</span>
                          {item.roomInfo && (
                            <span className="text-slate-400 truncate">• {item.roomInfo}</span>
                          )}
                        </div>

                        {item.guestName && (
                          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                            <span className="font-semibold text-slate-700 dark:text-slate-200">Guest:</span>
                            <span className="truncate">{item.guestName}</span>
                            {item.guestPhone && (
                              <span className="text-slate-400">({item.guestPhone})</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1 sm:text-right">
                        {item.checkIn && item.checkOut && (
                          <div className="flex sm:justify-end items-center gap-1 text-slate-500 dark:text-slate-400">
                            <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span>
                              {format(item.checkIn, "MMM d")} → {format(item.checkOut, "MMM d")}
                              {item.nights ? ` (${item.nights}n)` : ""}
                            </span>
                          </div>
                        )}

                        {item.amount !== undefined && (
                          <div className="text-sm font-black text-slate-900 dark:text-white">
                            {formatMoney(item.amount, "INR")}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quick Action Footer */}
                    <div className="flex items-center justify-between border-t border-slate-200/40 dark:border-slate-800/60 mt-3 pt-2 text-xs">
                      <div className="flex items-center gap-2">
                        {item.bookingId && (
                          <button
                            onClick={() => copyToClipboard(item.bookingId!, item.id)}
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                            title="Click to copy booking ID"
                          >
                            {copiedId === item.id ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            #{item.bookingId.slice(0, 8)}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {item.type === "property_pending" && onApproveProperty && onRejectProperty && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[11px] px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                              onClick={() => onRejectProperty(item.propertyId!)}
                            >
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              className="h-6 text-[11px] px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => onApproveProperty(item.propertyId!)}
                            >
                              Approve
                            </Button>
                          </>
                        )}

                        {hasBooking && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 text-[11px] px-2 font-medium"
                            onClick={() => setSelectedBooking(item)}
                          >
                            Manage Booking
                            <ChevronRight className="w-3 h-3 ml-0.5" />
                          </Button>
                        )}

                        {hasProperty && !hasBooking && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[11px] px-2 font-medium"
                            asChild
                          >
                            <Link to={`/admin/stay/properties?search=${item.propertyId}`}>
                              View Property
                              <ExternalLink className="w-3 h-3 ml-1" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Booking Quick Manage Dialog */}
      <Dialog open={!!selectedBooking} onOpenChange={(open) => !open && setSelectedBooking(null)}>
        <DialogContent className="sm:max-w-md">
          {selectedBooking && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base font-bold">
                    Booking #{selectedBooking.bookingId?.slice(0, 8)}
                  </DialogTitle>
                  {getToneBadge(selectedBooking.statusTone, selectedBooking.status)}
                </div>
                <DialogDescription className="text-xs">
                  {selectedBooking.propertyName}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-xs py-2">
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/40">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Guest Name</span>
                    <span className="font-semibold text-sm text-foreground">
                      {selectedBooking.guestName || "Guest"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Total Amount</span>
                    <span className="font-bold text-sm text-foreground">
                      {formatMoney(selectedBooking.amount || 0, "INR")}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Check-in</span>
                    <span className="font-medium text-foreground">
                      {selectedBooking.checkIn ? format(selectedBooking.checkIn, "EEE, MMM d, yyyy") : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Check-out</span>
                    <span className="font-medium text-foreground">
                      {selectedBooking.checkOut ? format(selectedBooking.checkOut, "EEE, MMM d, yyyy") : "—"}
                    </span>
                  </div>
                  {selectedBooking.roomInfo && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground block text-[11px]">Room / Accommodation</span>
                      <span className="font-medium text-foreground">{selectedBooking.roomInfo}</span>
                    </div>
                  )}
                </div>

                {/* Contact Actions */}
                {(selectedBooking.guestPhone || selectedBooking.guestEmail) && (
                  <div className="flex items-center gap-2">
                    {selectedBooking.guestPhone && (
                      <Button variant="outline" size="sm" className="h-7 text-xs flex-1" asChild>
                        <a href={`tel:${selectedBooking.guestPhone}`}>
                          <Phone className="w-3 h-3 mr-1.5" /> Call Guest
                        </a>
                      </Button>
                    )}
                    {selectedBooking.guestEmail && (
                      <Button variant="outline" size="sm" className="h-7 text-xs flex-1" asChild>
                        <a href={`mailto:${selectedBooking.guestEmail}`}>
                          <Mail className="w-3 h-3 mr-1.5" /> Email Guest
                        </a>
                      </Button>
                    )}
                  </div>
                )}

                {/* Quick Status Update */}
                {onUpdateBookingStatus && (
                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Quick Status Transition
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant={selectedBooking.status === "confirmed" ? "default" : "outline"}
                        className="h-7 text-xs"
                        disabled={actionBusy || selectedBooking.status === "confirmed"}
                        onClick={() => applyBookingStatus("confirmed")}
                      >
                        Mark Confirmed
                      </Button>
                      <Button
                        size="sm"
                        variant={selectedBooking.status === "checked_in" ? "default" : "outline"}
                        className="h-7 text-xs"
                        disabled={actionBusy || selectedBooking.status === "checked_in"}
                        onClick={() => applyBookingStatus("checked_in")}
                      >
                        Check-in Guest
                      </Button>
                      <Button
                        size="sm"
                        variant={selectedBooking.status === "checked_out" ? "default" : "outline"}
                        className="h-7 text-xs"
                        disabled={actionBusy || selectedBooking.status === "checked_out"}
                        onClick={() => applyBookingStatus("checked_out")}
                      >
                        Check-out Guest
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        disabled={actionBusy || selectedBooking.status === "cancelled"}
                        onClick={() => applyBookingStatus("cancelled")}
                      >
                        Cancel Booking
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="border-t border-border/40 pt-3">
                <Button variant="ghost" size="sm" onClick={() => setSelectedBooking(null)}>
                  Close
                </Button>
                <Button size="sm" asChild>
                  <Link to={`/admin/stay/bookings?search=${selectedBooking.bookingId}`}>
                    Open in Stays Table
                    <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                  </Link>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
