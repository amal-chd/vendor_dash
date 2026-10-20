import { useEffect, useMemo, useState } from "react";
import { collectionGroup, doc, limit, onSnapshot, query, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnDef } from "@tanstack/react-table";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { useLiveCollection } from "@/hooks/useLiveCollection";

interface Review {
  id: string;
  path?: string;
  hotelId?: string;
  propertyName?: string;
  guestName?: string;
  rating?: number;
  text?: string;
  reviewText?: string;
  status?: string;
  hidden?: boolean;
}

export default function StayReviews() {
  const standalone = useLiveCollection<Review>("stay_reviews");
  const [nested, setNested] = useState<Review[]>([]);

  useEffect(() => {
    return onSnapshot(
      query(collectionGroup(db, "reviews"), limit(400)),
      (snap) => {
        setNested(
          snap.docs
            .filter((d) => d.ref.path.includes("/hotels/"))
            .map((d) => ({
              id: d.id,
              path: d.ref.path,
              hotelId: d.ref.parent.parent?.id,
              ...(d.data() as object),
            })) as Review[],
        );
      },
      (err) => {
        // Was silently rendering "no reviews" on a permission/network fail.
        console.error("StayReviews: nested review-group listener error:", err);
        setNested([]);
      },
    );
  }, []);

  const rows = useMemo(() => {
    const map = new Map<string, Review>();
    standalone.rows.forEach((r) => map.set(`stay:${r.id}`, r));
    nested.forEach((r) => map.set(r.path || r.id, r));
    return Array.from(map.values());
  }, [standalone.rows, nested]);

  const hide = async (r: Review, hidden: boolean) => {
    try {
      const patch = { hidden, status: hidden ? "removed" : "published" };
      if (r.path) {
        const parts = r.path.split("/").filter(Boolean);
        if (parts.length < 2) throw new Error("Invalid review path");
        await updateDoc(doc(db, parts[0], parts[1], ...parts.slice(2)), patch);
      } else {
        await updateDoc(doc(db, "stay_reviews", r.id), patch);
      }
      toast.success(hidden ? "Hidden" : "Published");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const columns: ColumnDef<Review>[] = useMemo(
    () => [
      { accessorKey: "propertyName", header: "Property", cell: ({ row }) => row.original.propertyName || row.original.hotelId || "—" },
      { accessorKey: "guestName", header: "Guest" },
      { accessorKey: "rating", header: "★" },
      {
        id: "text",
        header: "Review",
        cell: ({ row }) => <span className="line-clamp-2 max-w-md text-sm">{row.original.text || row.original.reviewText || "—"}</span>,
      },
      {
        id: "st",
        header: "Status",
        cell: ({ row }) => <Badge variant="outline">{row.original.hidden ? "hidden" : row.original.status || "published"}</Badge>,
      },
      {
        id: "a",
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => hide(row.original, !row.original.hidden)}>
            {row.original.hidden ? "Publish" : "Hide"}
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Stay reviews"
        description="Guest reviews across every property. Hide anything abusive or fake."
        icon={Star}
        stats={(() => {
          const rated = rows.filter((r) => Number(r.rating) > 0);
          const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : 0;
          return [
            { label: "Reviews", value: rows.length },
            { label: "Average rating", value: rated.length ? `${avg.toFixed(1)} ★` : "—", hint: `${rated.length} rated`, tone: "text-amber-600" },
            { label: "Low ratings", value: rated.filter((r) => Number(r.rating) <= 2).length, hint: "2★ or below", tone: "text-rose-600" },
            { label: "Hidden", value: rows.filter((r) => r.hidden).length, hint: "Removed from the app" },
          ];
        })()}
      />
      <DataTable columns={columns} data={rows} searchPlaceholder="Search reviews…" exportFilename="stay-reviews" />
    </div>
  );
}
