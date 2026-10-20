import { useMemo } from "react";
import { runOp } from "@/lib/opFeedback";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ColumnDef } from "@tanstack/react-table";
import { Hotel } from "lucide-react";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { toast } from "sonner";

interface Property {
  id: string;
  name?: string;
  location?: string | { address?: string; city?: string; state?: string };
  city?: string;
  status?: string;
  rating?: number;
  ratingAvg?: number;
  featured?: boolean;
}

function loc(p: Property) {
  if (typeof p.location === "string") return p.location;
  if (p.location?.city) return `${p.location.city}${p.location.state ? `, ${p.location.state}` : ""}`;
  return p.city || "—";
}

export default function StayProperties() {
  const { rows, loading } = useLiveCollection<Property>("hotels");

  const setStatus = async (id: string, status: string) => {
    try {
      await updateDoc(doc(db, "hotels", id), { status });
      toast.success(`Marked ${status}`);
    } catch {
      toast.error("Update failed");
    }
  };

  const columns: ColumnDef<Property>[] = useMemo(
    () => [
      { accessorKey: "name", header: "Property", cell: ({ row }) => row.original.name || "Unnamed" },
      { id: "loc", header: "Location", cell: ({ row }) => loc(row.original) },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <Badge variant="outline">{row.original.status || "pending"}</Badge>,
      },
      {
        id: "rating",
        header: "Rating",
        cell: ({ row }) => row.original.ratingAvg ?? row.original.rating ?? "—",
      },
      {
        accessorKey: "featured",
        header: "Featured",
        cell: ({ row }) => (
          <Switch
            checked={!!row.original.featured}
            onCheckedChange={(v) =>
              runOp(
                () => updateDoc(doc(db, "hotels", row.original.id), { featured: v }),
                v ? "Featured" : "Unfeatured",
                { failure: "Couldn't change the featured flag" },
              )
            }
          />
        ),
      },
      {
        id: "a",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => setStatus(row.original.id, "Approved")}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStatus(row.original.id, "Rejected")}>
              Reject
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Properties"
        description="Approve, feature or reject host listings."
        icon={Hotel}
        stats={[
          { label: "Listings", value: rows.length, loading },
          { label: "Awaiting review", value: rows.filter((r) => !r.status || (r.status || "").toLowerCase() === "pending").length, hint: "Not yet approved or rejected", tone: "text-amber-600", loading },
          { label: "Approved", value: rows.filter((r) => (r.status || "").toLowerCase() === "approved").length, tone: "text-emerald-600", loading },
          { label: "Featured", value: rows.filter((r) => r.featured).length, hint: "Promoted in the app", tone: "text-violet-600", loading },
        ]}
      />
      <DataTable columns={columns} data={rows} searchPlaceholder="Search properties…" exportFilename="stay-properties" />
    </div>
  );
}
