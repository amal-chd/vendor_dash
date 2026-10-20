import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  ScrollText,
  ShoppingCart,
  Wallet,
  Bike,
  Building2,
  Bell,
  Mail,
  ShieldCheck,
  Server,
  Filter,
  Search,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Activity,
  Users,
  Settings,
  Gift,
  Hotel,
  Megaphone,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { collection, onSnapshot, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";

/* ─── Types ───────────────────────────────────────────────────────────────────── */

type LogCategory =
  | "all"
  | "orders"
  | "finance"
  | "delivery"
  | "vendors"
  | "notifications"
  | "email"
  | "security"
  | "team"
  | "stay"
  | "gift-cards"
  | "system";

type LogSeverity = "info" | "success" | "warning" | "error";

interface UnifiedLogRow {
  id: string;
  when: string;
  ts: number;
  actor: string;
  action: string;
  entity: string;
  description: string;
  reason?: string;
  category: LogCategory;
  severity: LogSeverity;
  source: string; // which Firestore collection it came from
}

interface RawEvent {
  id: string;
  action?: string;
  description?: string;
  entity?: string;
  entityId?: string;
  orderId?: string;
  actorEmail?: string;
  actorUid?: string;
  reason?: string;
  timestamp?: { toDate?: () => Date };
  [key: string]: unknown;
}

interface NotifLog {
  id: string;
  title?: string;
  body?: string;
  audience?: string;
  sentAt?: string;
  recipientCount?: number;
  pushed?: number;
  status?: string;
}

interface EmailLog {
  id: string;
  recipientEmail?: string;
  templateKey?: string;
  category?: string;
  status?: string;
  provider?: string;
  subject?: string;
  error?: string;
  createdAt?: { toDate?: () => Date };
}

/* ─── Category definitions ────────────────────────────────────────────────────── */

const CATEGORIES: { id: LogCategory; label: string; icon: React.ElementType; color: string }[] = [
  { id: "all", label: "All Activity", icon: Activity, color: "text-foreground" },
  { id: "orders", label: "Orders", icon: ShoppingCart, color: "text-blue-600" },
  { id: "finance", label: "Finance & Settlements", icon: Wallet, color: "text-emerald-600" },
  { id: "delivery", label: "Delivery & Fleet", icon: Bike, color: "text-orange-600" },
  { id: "vendors", label: "Vendors", icon: Building2, color: "text-violet-600" },
  { id: "notifications", label: "Push Notifications", icon: Bell, color: "text-amber-600" },
  { id: "email", label: "Email", icon: Mail, color: "text-pink-600" },
  { id: "security", label: "Security & Auth", icon: ShieldCheck, color: "text-red-600" },
  { id: "team", label: "Team", icon: Users, color: "text-cyan-600" },
  { id: "stay", label: "KadaStay", icon: Hotel, color: "text-teal-600" },
  { id: "gift-cards", label: "Gift Cards", icon: Gift, color: "text-fuchsia-600" },
  { id: "system", label: "System", icon: Server, color: "text-slate-500" },
];

const SEVERITY_STYLES: Record<LogSeverity, { badge: string; icon: React.ElementType }> = {
  info: { badge: "bg-blue-500/10 text-blue-600 border-blue-500/20", icon: Clock },
  success: { badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", icon: CheckCircle2 },
  warning: { badge: "bg-amber-500/10 text-amber-600 border-amber-500/20", icon: AlertCircle },
  error: { badge: "bg-rose-500/10 text-rose-600 border-rose-500/20", icon: XCircle },
};

/* ─── Helpers ─────────────────────────────────────────────────────────────────── */

const fmtTs = (ts?: { toDate?: () => Date }) => {
  try { return ts?.toDate?.() ?? null; } catch { return null; }
};

const humanize = (a?: string) =>
  (a || "—").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Infer the category from an action keyword */
function inferCategory(action?: string, entity?: string, desc?: string): LogCategory {
  const haystack = `${action ?? ""} ${entity ?? ""} ${desc ?? ""}`.toLowerCase();
  if (/order|refund|cancel.*order/i.test(haystack)) return "orders";
  if (/settlement|payout|commission|tds|tcs|gateway|invoice|reconcil/i.test(haystack)) return "finance";
  if (/rider|delivery|fleet|assign|offer|dispatch|cash.*collect/i.test(haystack)) return "delivery";
  if (/vendor|restaurant|menu|subscription|plan|kyc|onboard/i.test(haystack)) return "vendors";
  if (/broadcast|notif|push|alert|campaign/i.test(haystack)) return "notifications";
  if (/email|mail|smtp|ses|suppres/i.test(haystack)) return "email";
  if (/login|auth|session|password|permission|role|admin.*action|suspend|ban|block/i.test(haystack)) return "security";
  if (/team|invite|operator|google.*workspace/i.test(haystack)) return "team";
  if (/stay|hotel|booking|host|check-?in|check-?out|amenity/i.test(haystack)) return "stay";
  if (/gift.*card|voucher|redeem|bulk.*issue/i.test(haystack)) return "gift-cards";
  return "system";
}

function inferSeverity(action?: string, status?: string): LogSeverity {
  const a = `${action ?? ""} ${status ?? ""}`.toLowerCase();
  if (/fail|error|bounce|reject|suspend|block|crash/i.test(a)) return "error";
  if (/warn|complaint|expire|overdue/i.test(a)) return "warning";
  if (/success|approve|complet|deliver|paid|sent|resolved/i.test(a)) return "success";
  return "info";
}

/* ─── Component ───────────────────────────────────────────────────────────────── */

export default function AuditLogPage() {
  const [activeCategory, setActiveCategory] = useState<LogCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<LogSeverity | "all">("all");

  // ── Firestore sources ──
  const auditEvents = useLiveCollection<RawEvent>("audit_events", { orderByField: "timestamp" });
  const adminLogs = useLiveCollection<RawEvent>("admin_logs", { orderByField: "timestamp" });

  const [notifLogs, setNotifLogs] = useState<NotifLog[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);

  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, "admin_notifications"), limit(200)),
      (s) => setNotifLogs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotifLog, "id">) }))),
      (err) => console.error("[AuditLog] admin_notifications listener failed", err),
    );
    const u2 = onSnapshot(
      query(collection(db, "emailLogs"), limit(300)),
      (s) => setEmailLogs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EmailLog, "id">) }))),
      (err) => console.error("[AuditLog] emailLogs listener failed", err),
    );
    return () => { u1(); u2(); };
  }, []);

  // ── Merge all sources ──
  const allRows = useMemo<UnifiedLogRow[]>(() => {
    const rows: UnifiedLogRow[] = [];

    // 1. audit_events + admin_logs
    const mapRaw = (e: RawEvent, source: string): UnifiedLogRow => {
      const d = fmtTs(e.timestamp);
      const action = humanize(e.action);
      const entity = e.entity
        ? `${e.entity}${e.entityId ? ` · ${e.entityId.slice(-6)}` : ""}`
        : e.orderId
          ? `order · ${e.orderId.slice(-6)}`
          : "—";
      return {
        id: e.id,
        when: d ? d.toLocaleString("en-IN") : "—",
        ts: d?.getTime() ?? 0,
        actor: e.actorEmail || (e.actorUid as string) || "system",
        action,
        entity,
        description: (e.description as string) || "—",
        reason: e.reason,
        category: inferCategory(e.action, e.entity, e.description),
        severity: inferSeverity(e.action),
        source,
      };
    };
    auditEvents.rows.forEach((e) => rows.push(mapRaw(e, "audit_events")));
    adminLogs.rows.forEach((e) => rows.push(mapRaw(e, "admin_logs")));

    // 2. Push notification broadcasts
    notifLogs.forEach((n) => {
      const ts = n.sentAt ? new Date(n.sentAt).getTime() : 0;
      rows.push({
        id: `notif-${n.id}`,
        when: n.sentAt ? new Date(n.sentAt).toLocaleString("en-IN") : "—",
        ts,
        actor: "admin",
        action: "Broadcast Sent",
        entity: `${n.audience ?? "all"} (${n.recipientCount ?? 0} recipients)`,
        description: `${n.title ?? ""} — ${n.body ?? ""}`.trim(),
        category: "notifications",
        severity: n.status === "failed" ? "error" : "success",
        source: "admin_notifications",
      });
    });

    // 3. Email logs
    emailLogs.forEach((e) => {
      const d = fmtTs(e.createdAt);
      rows.push({
        id: `email-${e.id}`,
        when: d ? d.toLocaleString("en-IN") : "—",
        ts: d?.getTime() ?? 0,
        actor: e.recipientEmail ?? "—",
        action: `Email ${humanize(e.status)}`,
        entity: e.templateKey ?? "—",
        description: `${e.subject ?? ""} via ${e.provider ?? "unknown"}`.trim(),
        reason: e.error,
        category: "email",
        severity: inferSeverity(undefined, e.status),
        source: "emailLogs",
      });
    });

    return rows.sort((a, b) => b.ts - a.ts);
  }, [auditEvents.rows, adminLogs.rows, notifLogs, emailLogs]);

  // ── Filter ──
  const filteredRows = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return allRows.filter((r) => {
      if (activeCategory !== "all" && r.category !== activeCategory) return false;
      if (severityFilter !== "all" && r.severity !== severityFilter) return false;
      if (q && ![r.actor, r.action, r.entity, r.description, r.reason ?? ""].some((v) => v.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [allRows, activeCategory, severityFilter, searchQuery]);

  // ── Category counts ──
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allRows.length };
    allRows.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
    return counts;
  }, [allRows]);

  const severityCounts = useMemo(() => {
    const base = activeCategory === "all" ? allRows : allRows.filter((r) => r.category === activeCategory);
    const counts: Record<string, number> = { all: base.length, info: 0, success: 0, warning: 0, error: 0 };
    base.forEach((r) => { counts[r.severity]++; });
    return counts;
  }, [allRows, activeCategory]);

  // ── Columns ──
  const columns = useMemo<ColumnDef<UnifiedLogRow>[]>(
    () => [
      {
        accessorKey: "when",
        header: "When",
        cell: ({ row }) => (
          <span className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">{row.original.when}</span>
        ),
      },
      {
        accessorKey: "severity",
        header: "Level",
        cell: ({ row }) => {
          const s = SEVERITY_STYLES[row.original.severity];
          const Icon = s.icon;
          return (
            <Badge variant="outline" className={cn("text-[10px] gap-1", s.badge)}>
              <Icon className="h-3 w-3" />
              {row.original.severity}
            </Badge>
          );
        },
      },
      {
        accessorKey: "category",
        header: "Section",
        cell: ({ row }) => {
          const cat = CATEGORIES.find((c) => c.id === row.original.category);
          if (!cat) return <span className="text-xs text-muted-foreground">—</span>;
          const CIcon = cat.icon;
          return (
            <div className="flex items-center gap-1.5">
              <CIcon className={cn("h-3.5 w-3.5", cat.color)} />
              <span className="text-xs font-medium">{cat.label}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "actor",
        header: "Actor",
        cell: ({ row }) => <span className="text-xs font-medium truncate max-w-[180px] block">{row.original.actor}</span>,
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[10px] font-semibold">{row.original.action}</Badge>
        ),
      },
      {
        accessorKey: "entity",
        header: "Entity",
        cell: ({ row }) => <span className="text-xs font-mono text-muted-foreground">{row.original.entity}</span>,
      },
      {
        accessorKey: "description",
        header: "Detail",
        cell: ({ row }) => (
          <div className="max-w-sm">
            <p className="text-sm truncate">{row.original.description}</p>
            {row.original.reason && (
              <p className="text-[11px] text-muted-foreground truncate">Reason: {row.original.reason}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: "source",
        header: "Source",
        cell: ({ row }) => (
          <span className="text-[10px] font-mono text-muted-foreground/60">{row.original.source}</span>
        ),
      },
    ],
    [],
  );

  const isLoading = auditEvents.loading && adminLogs.loading;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Activity log"
        description="Admin actions, settlements, deliveries, broadcasts, emails and security events in one immutable record."
        icon={ScrollText}
        stats={[
          { label: "Events", value: allRows.length, hint: "Latest from every source", loading: isLoading, onClick: () => setSeverityFilter("all"), active: severityFilter === "all" },
          { label: "Errors", value: allRows.filter((r) => r.severity === "error").length, hint: "Failed actions or deliveries", tone: "text-rose-600", loading: isLoading, onClick: () => setSeverityFilter("error"), active: severityFilter === "error" },
          { label: "Warnings", value: allRows.filter((r) => r.severity === "warning").length, tone: "text-amber-600", loading: isLoading, onClick: () => setSeverityFilter("warning"), active: severityFilter === "warning" },
        ]}
      />

      {/* ── Category Tabs ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {CATEGORIES.map((cat) => {
          const CIcon = cat.icon;
          const count = categoryCounts[cat.id] ?? 0;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-all shrink-0",
                isActive
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-card text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground",
              )}
            >
              <CIcon className={cn("h-3.5 w-3.5", isActive ? "text-primary" : cat.color)} />
              {cat.label}
              {count > 0 && (
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", isActive ? "bg-primary/20" : "bg-muted")}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Severity Quick-filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 rounded-lg border border-border/60 p-1 bg-card">
          {(["all", "info", "success", "warning", "error"] as const).map((sev) => {
            const isActive = severityFilter === sev;
            const count = severityCounts[sev] ?? 0;
            return (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors",
                  isActive ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {sev === "all" ? "All" : sev.charAt(0).toUpperCase() + sev.slice(1)}
                <span className="text-[10px] opacity-60">({count})</span>
              </button>
            );
          })}
        </div>

        <Input
          placeholder="Search actor, action, entity, detail…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-72"
        />

        <div className="ml-auto text-xs text-muted-foreground">
          Showing {filteredRows.length} of {allRows.length} events
        </div>
      </div>

      {/* ── Data Table ── */}
      <DataTable
        columns={columns}
        data={filteredRows}
        searchKey="description"
        searchPlaceholder="Full-text search…"
        exportFilename="activity-log"
        savedViewsKey="activity-log"
      />
    </div>
  );
}
