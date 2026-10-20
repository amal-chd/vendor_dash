import { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  doc,
  limit,
  onSnapshot,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterChips } from "@/components/admin/FilterChips";
import { ColumnDef } from "@tanstack/react-table";
import { Calendar } from "lucide-react";
import { toast } from "sonner";

interface Booking {
  id: string;
  path?: string;
  propertyName?: string;
  hotelName?: string;
  hotelId?: string;
  guestName?: string;
  guestEmail?: string;
  checkIn?: unknown;
  checkOut?: unknown;
  amount?: number;
  total?: number;
  grandTotal?: number;
  status?: string;
}

function money(b: Booking) {
  return Math.round(Number(b.amount ?? b.total ?? b.grandTotal ?? 0));
}

function label(v: unknown) {
  if (!v) return "—";
  try {
    if (typeof v === "object" && v && "toDate" in v) {
      return (v as { toDate: () => Date }).toDate().toLocaleDateString("en-IN");
    }
    return new Date(v as string).toLocaleDateString("en-IN");
  } catch {
    return String(v);
  }
}

async function writeStatus(b: Booking, status: string) {
  if (b.path) {
    const parts = b.path.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("Invalid booking path");
    await updateDoc(doc(db, parts[0], parts[1], ...parts.slice(2)), { status });
  } else {
    await updateDoc(doc(db, "stay_bookings", b.id), { status });
  }
}

export default function StayBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const map = new Map<string, Booking>();
    const apply = () => setBookings(Array.from(map.values()));

    const u1 = onSnapshot(
      query(collection(db, "stay_bookings"), limit(500)),
      (snap) => {
        snap.docs.forEach((d) => map.set(`stay:${d.id}`, { id: d.id, ...d.data() } as Booking));
        apply();
        setLoading(false);
      },
      (err) => {
        console.error("StayBookings: stay_bookings listener error:", err);
        setLoading(false);
      },
    );

    const u2 = onSnapshot(
      query(collectionGroup(db, "bookings"), limit(500)),
      (snap) => {
        snap.docs.forEach((d) => {
          if (!d.ref.path.includes("/hotels/")) return;
          const hotelId = d.ref.parent.parent?.id;
          map.set(d.ref.path, {
            id: d.id,
            path: d.ref.path,
            hotelId,
            ...(d.data() as object),
          } as Booking);
        });
        apply();
        setLoading(false);
      },
      (err) => {
        console.error("StayBookings: hotels/bookings group listener error:", err);
        setLoading(false);
      },
    );

    return () => {
      u1();
      u2();
    };
  }, []);

  const setStatus = async (b: Booking, status: string) => {
    try {
      await writeStatus(b, status);
      toast.success(`Marked ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const columns: ColumnDef<Booking>[] = useMemo(
    () => [
      {
        accessorKey: "propertyName",
        header: "Property",
        cell: ({ row }) => row.original.propertyName || row.original.hotelName || row.original.hotelId || "—",
      },
      { accessorKey: "guestName", header: "Guest" },
      { accessorKey: "guestEmail", header: "Email" },
      { id: "in", header: "Check-in", cell: ({ row }) => label(row.original.checkIn) },
      { id: "out", header: "Check-out", cell: ({ row }) => label(row.original.checkOut) },
      { id: "amt", header: "Amount", cell: ({ row }) => `₹${money(row.original).toLocaleString("en-IN")}` },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <Badge variant="outline">{row.original.status || "—"}</Badge>,
      },
      {
        id: "a",
        cell: ({ row }) => {
          const st = (row.original.status || "").toLowerCase();
          return (
            <div className="flex flex-wrap gap-1 justify-end">
              {st !== "confirmed" && st !== "cancelled" && (
                <Button size="sm" variant="outline" onClick={() => setStatus(row.original, "confirmed")}>
                  Confirm
                </Button>
              )}
              {st !== "completed" && st !== "checked_out" && st !== "cancelled" && (
                <Button size="sm" variant="outline" onClick={() => setStatus(row.original, "completed")}>
                  Complete
                </Button>
              )}
              {st !== "cancelled" && (
                <Button size="sm" variant="ghost" onClick={() => setStatus(row.original, "cancelled")}>
                  Cancel
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [],
  );

  const visible = useMemo(() => {
    return bookings.filter((b) => {
      const st = (b.status || "").toLowerCase();
      if (filter === "all") return true;
      if (filter === "open") return !["cancelled", "completed", "checked_out"].includes(st);
      return st === filter || (filter === "completed" && st === "checked_out");
    });
  }, [bookings, filter]);

  const st = (b: { status?: string }) => (b.status || "").toLowerCase();
  const confirmed = bookings.filter((b) => ["confirmed", "completed", "checked_out", "paid"].includes(st(b)));
  const open = bookings.filter((b) => !["cancelled", "completed", "checked_out"].includes(st(b)));
  const cancelled = bookings.filter((b) => st(b) === "cancelled");
  // Cancelled stays are not revenue.
  const bookingValue = bookings.filter((b) => st(b) !== "cancelled").reduce((s, b) => s + money(b), 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Stay bookings"
        description="Confirm, complete, or cancel guest stays. Changes write to the same document the host and guest apps read."
        icon={Calendar}
        stats={[
          { label: "Open", value: open.length, hint: "Not yet completed or cancelled", tone: "text-amber-600", loading, onClick: () => setFilter("open"), active: filter === "open" },
          { label: "Confirmed", value: confirmed.length, hint: "Confirmed, paid or completed", tone: "text-emerald-600", loading, onClick: () => setFilter("confirmed"), active: filter === "confirmed" },
          { label: "Cancelled", value: cancelled.length, tone: "text-rose-600", loading, onClick: () => setFilter("cancelled"), active: filter === "cancelled" },
          { label: "Booking value", value: `₹${Math.round(bookingValue).toLocaleString("en-IN")}`, hint: `${bookings.length} bookings · excludes cancelled`, loading },
        ]}
      />
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: "All" },
          { id: "open", label: "Open" },
          { id: "confirmed", label: "Confirmed" },
          { id: "completed", label: "Completed" },
          { id: "cancelled", label: "Cancelled" },
        ]}
      />
      <DataTable columns={columns} data={visible} searchPlaceholder="Search guest, property, email…" exportFilename="stay-bookings" />
    </div>
  );
}
