import { PageSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, query, limit, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { 
  ShieldCheck, Loader2, Activity, Lock, 
  ShieldAlert, UserCog, Settings2, Database, Key, AlertOctagon, Terminal,
  Clock, CheckCircle2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/admin/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { useCurrency } from "@/lib/currency";

interface AdminLog {
  id: string;
  type?: string;
  description?: string;
  action?: string;
  adminEmail?: string;
  performedBy?: string;
  timestamp: any;
}

const getTypeInfo = (type: string = "system") => {
  const t = type.toLowerCase();
  if (t.includes("auth") || t.includes("login")) return { icon: Key, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" };
  if (t.includes("user") || t.includes("tenant") || t.includes("account")) return { icon: UserCog, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" };
  if (t.includes("setting") || t.includes("config")) return { icon: Settings2, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" };
  if (t.includes("data") || t.includes("delete") || t.includes("remove")) return { icon: Database, color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20" };
  if (t.includes("security") || t.includes("alert")) return { icon: AlertOctagon, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" };
  return { icon: Terminal, color: "text-zinc-500 dark:text-zinc-400", bg: "bg-zinc-100 dark:bg-zinc-800", border: "border-zinc-200 dark:border-zinc-700" };
};

export default function SecurityPage() {
  const { locale } = useCurrency();
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "admin_logs"), orderBy("timestamp", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AdminLog[]);
        setLoading(false);
      },
      (err) => {
        console.error("[SecurityPage] admin_logs listener failed", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    let todayCount = 0;
    let authCount = 0;
    let tenantCount = 0;

    logs.forEach(l => {
      const ts = l.timestamp?.toDate ? l.timestamp.toDate() : l.timestamp ? new Date(l.timestamp) : new Date(0);
      if (ts >= today) todayCount++;
      const t = (l.type || "system").toLowerCase();
      if (t.includes("auth") || t.includes("login")) authCount++;
      if (t.includes("tenant") || t.includes("account")) tenantCount++;
    });

    return { todayCount, authCount, tenantCount };
  }, [logs]);

  const columns: ColumnDef<AdminLog>[] = useMemo(() => [
    {
      accessorKey: "description",
      header: "Action Event",
      cell: ({ row }) => {
        const log = row.original;
        const info = getTypeInfo(log.type || "system");
        const Icon = info.icon;
        return (
          <div className="flex gap-4 items-start py-1">
            <div className={cn("h-10 w-10 rounded-2xl border flex items-center justify-center shrink-0", info.bg, info.border)}>
              <Icon className={cn("h-4 w-4", info.color)} />
            </div>
            <div className="space-y-1">
              <p className="font-bold text-foreground text-xs uppercase tracking-tight leading-normal">
                {log.description || log.action || "Unknown Action"}
              </p>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                {log.adminEmail || log.performedBy || "System"}
              </div>
            </div>
          </div>
        );
      }
    },
    {
      accessorKey: "type",
      header: "Category",
      cell: ({ row }) => {
        const typeStr = row.getValue("type") as string || "system";
        const info = getTypeInfo(typeStr);
        return (
          <Badge variant="outline" className={cn("text-[9px] font-semibold uppercase tracking-wide border", info.color, info.border, info.bg)}>
            {typeStr}
          </Badge>
        );
      }
    },
    {
      accessorKey: "timestamp",
      header: "Timestamp",
      cell: ({ row }) => {
        const timestamp: any = row.getValue("timestamp");
        const dateStr = typeof timestamp?.toDate === "function"
          ? timestamp.toDate().toLocaleString(locale, { dateStyle: "medium", timeStyle: "medium" })
          : timestamp
          ? new Date(timestamp).toLocaleString(locale, { dateStyle: "medium", timeStyle: "medium" })
          : "—";
        return (
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground tracking-widest">
            <Clock className="h-3 w-3 opacity-50" />
            {dateStr}
          </div>
        );
      }
    }
  ], []);

  const renderMobileCard = (log: AdminLog) => {
    const timestamp: any = log.timestamp;
    const dateStr = typeof timestamp?.toDate === "function"
      ? timestamp.toDate().toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
      : timestamp
      ? new Date(timestamp).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
      : "—";

    const typeStr = log.type || "system";
    const info = getTypeInfo(typeStr);
    const Icon = info.icon;

    return (
      <div className="bg-card rounded-2xl border border-border/40 p-4 shadow-sm space-y-4 relative group hover:border-border/80 transition-all">
        <div className="flex gap-4 items-start">
          <div className={cn("h-10 w-10 rounded-xl border flex items-center justify-center shrink-0", info.bg, info.border)}>
            <Icon className={cn("h-4 w-4", info.color)} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-foreground text-xs uppercase tracking-tight leading-normal break-words">
              {log.description || log.action || "Unknown Action"}
            </p>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-1 truncate">
              {log.adminEmail || log.performedBy || "System"}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-border/40">
           <Badge variant="outline" className={cn("text-[9px] font-semibold uppercase tracking-wide border", info.color, info.border, info.bg)}>
             {typeStr}
           </Badge>
           <span className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground tracking-widest">
             <Clock className="h-3 w-3" />
             {dateStr}
           </span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <PageSkeleton kpis={5} />
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <AdminPageHeader
        title="Security events"
        description="Sign-ins, permission changes and admin actions on partner accounts, from the admin audit log."
        icon={ShieldCheck}
      />

      <StatCards
        items={[
          { label: "Today", value: stats.todayCount, icon: Activity },
          { label: "Logged", value: logs.length, hint: "Latest entries loaded", icon: CheckCircle2 },
          { label: "Auth events", value: stats.authCount, hint: "Sign-ins and role changes", icon: Key, tone: "text-blue-600" },
          { label: "Partner actions", value: stats.tenantCount, hint: "Vendor and host accounts", icon: UserCog, tone: "text-emerald-600" },
          { label: "System changes", value: logs.length - stats.authCount - stats.tenantCount, hint: "Config and everything else", icon: Settings2, tone: "text-amber-600" },
        ]}
      />

      {/* Main Table Card */}
      <Card className="rounded-2xl border-border/40 shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/20 border-b border-border/40 pb-6">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold text-foreground">Event stream</CardTitle>
              <CardDescription className="text-xs mt-1">Chronological log of all administrative activities.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable 
            columns={columns} 
            data={logs} 
            searchKey="description" 
            renderMobileCard={renderMobileCard} 
          />
        </CardContent>
      </Card>
    </div>
  );
}
