import { PageSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState, useMemo } from "react";
import { collection, doc, onSnapshot, updateDoc, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast } from "sonner";
import { CalendarClock, Loader2, Mail, Phone, Info, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { DemoRequestDetailsDialog } from "@/components/admin/DemoRequestDetailsDialog";
import { useAuth } from "@/hooks/useAuth";
import { DataTable } from "@/components/admin/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface DemoRequest {
  id: string;
  restaurantName: string;
  email: string;
  phone: string;
  city?: string;
  monthlyRevenue?: string;
  outlets?: string;
  painPoint?: string;
  status?: "new" | "contacted" | "booked" | "closed";
  createdAt?: any;
  createdAtIso?: string;
  source?: string;
}

const getRequestSortTime = (createdAt?: any, createdAtIso?: string) => {
  if (createdAt?.toMillis) return createdAt.toMillis();
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === "string") {
    const parsed = Date.parse(createdAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (createdAtIso) {
    const parsed = Date.parse(createdAtIso);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};

const formatLeadAccessError = (err: unknown, email?: string | null) => {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  if (code.includes("permission-denied")) {
    return email
      ? `Demo inbox access is blocked for ${email}. Sign in with an approved admin email to view demo requests.`
      : "Demo inbox access is blocked. Sign in with an approved admin email to view demo requests.";
  }
  return "Failed to load demo requests. Please refresh and try again.";
};

export default function DemoRequestsPage() {
  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<DemoRequest | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const q = query(collection(db, "demo_requests"), limit(500));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = (snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as DemoRequest[])
          .sort((a, b) => getRequestSortTime(b.createdAt, b.createdAtIso) - getRequestSortTime(a.createdAt, a.createdAtIso));
        setRequests(data);
        setRequestError(null);
        setLoading(false);
      },
      (err) => {
        console.error("Demo requests sync failed:", err);
        setRequestError(formatLeadAccessError(err, user?.email));
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user?.email]);

  const updateStatus = async (requestId: string, newStatus: NonNullable<DemoRequest["status"]>) => {
    try {
      await updateDoc(doc(db, "demo_requests", requestId), { status: newStatus });
      toast.success(`Demo request moved to ${newStatus}`);
      if (selectedRequest?.id === requestId) {
        setSelectedRequest({ ...selectedRequest, status: newStatus });
      }
    } catch (error) {
      toast.error("Failed to update demo request");
    }
  };

  const handleOpenDetails = (request: DemoRequest) => {
    setSelectedRequest(request);
    setIsDialogOpen(true);
  };

  const buildMailto = (req: DemoRequest) => {
    const subject = encodeURIComponent(`Kada Dine Demo for ${req.restaurantName || "your restaurant"}`);
    const lines = [
      `Hi ${req.restaurantName || "team"},`,
      ``,
      `Thanks for requesting a Kada Dine demo.`,
      `When would you be available for a 15-minute call today or tomorrow?`,
      ``,
      `We will cover: POS billing, QR digital menu, table ordering, KDS/KOT, GST reports, inventory and analytics.`,
      ``,
      `Regards,`,
      `Kada Dine Team`,
    ];
    const body = encodeURIComponent(lines.join("\n"));
    return `mailto:${encodeURIComponent(req.email || "")}?subject=${subject}&body=${body}`;
  };

  const columns: ColumnDef<DemoRequest>[] = useMemo(() => [
    {
      accessorKey: "restaurantName",
      header: "Lead Info",
      cell: ({ row }) => {
        const d = row.original;
        return (
          <div className="flex gap-4 items-start cursor-pointer hover:opacity-80" onClick={() => handleOpenDetails(d)}>
            <div className={cn(
              "h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 border shadow-sm",
              (d.status || "new") === "new" ? "bg-emerald-500 text-white" :
              (d.status || "new") === "booked" ? "bg-primary text-white" :
              "bg-muted text-muted-foreground border-border/40"
            )}>
              <CalendarClock className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground uppercase tracking-tight text-sm">
                  {d.restaurantName || "Unknown"}
                </span>
                {d.city && (
                  <span className="text-[10px] font-bold text-muted-foreground/60 bg-muted/50 px-2 py-0.5 rounded-md uppercase tracking-widest">
                    {d.city}
                  </span>
                )}
              </div>
              <div className="text-[11px] font-bold text-muted-foreground">
                {d.email} {d.monthlyRevenue || d.outlets ? `• ${d.monthlyRevenue || `${d.outlets} outlets`}` : ""}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "phone",
      header: "Contact",
      cell: ({ row }) => (
        <span className="text-[11px] font-bold text-muted-foreground tracking-widest">
          {row.getValue("phone") || "—"}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const d = row.original;
        return (
          <Badge
            variant="outline"
            className={cn(
              "rounded-lg font-semibold uppercase text-[9px] tracking-wide px-2.5 py-1",
              (d.status || "new") === "new" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" :
              (d.status || "new") === "booked" ? "bg-primary/10 border-primary/20 text-primary" :
              "bg-muted text-muted-foreground border-border/40"
            )}
          >
            {(d.status || "new").toUpperCase()}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const d = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[160px] rounded-xl shadow-xl">
              <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleOpenDetails(d)} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer">
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={buildMailto(d)} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer">Email Lead</a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`tel:${encodeURIComponent((d.phone || "").replace(/\s+/g, ""))}`} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer">Call Lead</a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Change Status</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => updateStatus(d.id, 'new')} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-emerald-600">
                New
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateStatus(d.id, 'contacted')} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-blue-600">
                Contacted
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateStatus(d.id, 'booked')} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-primary">
                Booked
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateStatus(d.id, 'closed')} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-muted-foreground">
                Closed
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ], []);

  const renderMobileCard = (d: DemoRequest) => (
    <div className="bg-card rounded-xl border border-border/60 p-4 shadow-sm space-y-3 relative group hover:opacity-80 cursor-pointer" onClick={() => handleOpenDetails(d)}>
      <div className="flex items-start gap-4">
        <div className={cn(
          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border",
          (d.status || "new") === "new" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" :
          (d.status || "new") === "booked" ? "bg-primary/10 border-primary/20 text-primary" :
          "bg-muted/50 border-border/40 text-muted-foreground"
        )}>
          <CalendarClock className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm uppercase tracking-tight text-foreground truncate pr-2">{d.restaurantName || "Unknown"}</span>
          </div>
          <p className="text-[10px] font-bold text-muted-foreground mt-0.5 truncate">
            {d.email} {d.monthlyRevenue || d.outlets ? `• ${d.monthlyRevenue || `${d.outlets} outlets`}` : ""}
          </p>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-2 text-xs bg-muted/30 p-2.5 rounded-lg">
        <div className="overflow-hidden">
          <span className="block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Contact</span>
          <span className="font-semibold uppercase truncate">{d.phone || "—"}</span>
        </div>
        <div className="overflow-hidden">
          <span className="block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">City</span>
          <span className="font-semibold uppercase truncate">{d.city || "—"}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Badge variant="outline" className={cn("text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 border",
          (d.status || "new") === "new" ? "text-emerald-600 border-emerald-500/20 bg-emerald-500/10" :
          (d.status || "new") === "booked" ? "text-primary border-primary/20 bg-primary/10" :
          "text-muted-foreground border-border/40 bg-muted/50"
        )}>
          {(d.status || "new").toUpperCase()}
        </Badge>
        
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
           <Button aria-label="Send email" variant="outline" size="icon" className="h-7 w-7 rounded-full border-border/60" asChild>
             <a href={buildMailto(d)}><Mail className="h-3.5 w-3.5" /></a>
           </Button>
           <Button aria-label="Call" variant="outline" size="icon" className="h-7 w-7 rounded-full border-border/60" asChild>
             <a href={`tel:${encodeURIComponent((d.phone || "").replace(/\s+/g, ""))}`}><Phone className="h-3.5 w-3.5" /></a>
           </Button>
           <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="More actions" variant="outline" size="icon" className="h-7 w-7 rounded-full border-border/60">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[160px] rounded-xl shadow-xl">
                 <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Change Status</DropdownMenuLabel>
                 <DropdownMenuItem onClick={() => updateStatus(d.id, 'new')} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-emerald-600">New</DropdownMenuItem>
                 <DropdownMenuItem onClick={() => updateStatus(d.id, 'contacted')} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-blue-600">Contacted</DropdownMenuItem>
                 <DropdownMenuItem onClick={() => updateStatus(d.id, 'booked')} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-primary">Booked</DropdownMenuItem>
                 <DropdownMenuItem onClick={() => updateStatus(d.id, 'closed')} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-muted-foreground">Closed</DropdownMenuItem>
              </DropdownMenuContent>
           </DropdownMenu>
        </div>
      </div>
    </div>
  );

  const counts = {
    total: requests.length,
    new: requests.filter((r) => (r.status || "new") === "new").length,
    contacted: requests.filter((r) => (r.status || "new") === "contacted").length,
    booked: requests.filter((r) => (r.status || "new") === "booked").length,
    closed: requests.filter((r) => (r.status || "new") === "closed").length,
  };

  if (loading) {
    return (
      <PageSkeleton />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Demo requests</h2>
          <p className="text-xs text-muted-foreground mt-1 font-bold uppercase tracking-widest">
            {counts.total} total • {counts.new} new • {counts.booked} booked
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl bg-card p-6 border border-border/40 shadow-sm flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total Leads</span>
          <span className="text-3xl font-black tracking-tighter">{counts.total}</span>
        </div>
        <div className="rounded-3xl bg-emerald-500/10 p-6 border border-emerald-500/20 shadow-sm flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">New Leads</span>
          <span className="text-3xl font-black tracking-tighter text-emerald-600">{counts.new}</span>
        </div>
        <div className="rounded-3xl bg-primary/10 p-6 border border-primary/20 shadow-sm flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Booked</span>
          <span className="text-3xl font-black tracking-tighter text-primary">{counts.booked}</span>
        </div>
        <div className="rounded-3xl bg-card p-6 border border-border/40 shadow-sm flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Closed</span>
          <span className="text-3xl font-black tracking-tighter">{counts.closed}</span>
        </div>
      </div>

      {requestError && (
        <div className="border border-amber-500/30 rounded-2xl bg-amber-500/10 px-6 py-4 text-xs font-bold text-amber-700">
          {requestError}
        </div>
      )}

      <DataTable columns={columns} data={requests} searchKey="restaurantName" renderMobileCard={renderMobileCard} />

      <DemoRequestDetailsDialog
        request={selectedRequest}
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onStatusUpdate={updateStatus}
      />
    </div>
  );
}
