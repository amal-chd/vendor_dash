import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { CalendarCheck, Users } from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Sub {
  id: string;
  customerUid?: string;
  customerName?: string;
  customerPhone?: string;
  kitchenId?: string;
  kitchenName?: string;
  plan?: { name?: string; pricePaise?: number; durationDays?: number; meals?: string[] };
  amountPaise?: number;
  platformFeePerDayPaise?: number;
  status?: string;
  paymentStatus?: string;
  startDate?: Timestamp;
  endDate?: Timestamp;
  skippedDays?: string[];
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const day = (t?: Timestamp) =>
  t?.toDate ? t.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

const TONE: Record<string, string> = {
  active: "bg-emerald-600",
  pending_payment: "bg-amber-500",
  cancelled: "bg-rose-600",
  expired: "bg-slate-500",
};

/**
 * Every mess subscription, which is also the support desk's answer to "am I
 * paying for meals I'm not getting?" — the plan, the dates, the days skipped
 * and the fee Kada snapshotted are all here.
 */
export default function MessSubscriptions() {
  const subs = useLiveCollection<Sub>("mess_subscriptions", { orderByField: "createdAt", limit: 1000 });
  const [tab, setTab] = useState("active");

  const rows = useMemo(() => {
    if (tab === "all") return subs.rows;
    return subs.rows.filter((s) => (s.status ?? "") === tab);
  }, [subs.rows, tab]);

  const active = subs.rows.filter((s) => s.status === "active");
  const paidValue = subs.rows
    .filter((s) => s.paymentStatus === "paid")
    .reduce((sum, s) => sum + (s.amountPaise ?? 0) / 100, 0);
  const mealsToday = active.reduce((sum, s) => sum + ((s.plan?.meals?.length ?? 0) || 0), 0);

  const columns: ColumnDef<Sub>[] = [
    {
      id: "customer",
      header: "Customer",
      accessorFn: (s) => s.customerName || s.customerUid || "",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{row.original.customerName || "Customer"}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {row.original.customerPhone || row.original.customerUid || "—"}
          </div>
        </div>
      ),
    },
    { id: "kitchen", header: "Kitchen", accessorFn: (s) => s.kitchenName || s.kitchenId || "—" },
    {
      id: "plan",
      header: "Plan",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate">{row.original.plan?.name || "Meal plan"}</div>
          <div className="text-[11px] text-muted-foreground capitalize truncate">
            {(row.original.plan?.meals ?? []).join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      id: "dates",
      header: "Runs",
      cell: ({ row }) => (
        <span className="text-xs whitespace-nowrap">
          {day(row.original.startDate)} – {day(row.original.endDate)}
        </span>
      ),
    },
    {
      id: "paid",
      header: "Paid",
      cell: ({ row }) => <span className="tabular-nums">{inr((row.original.amountPaise ?? 0) / 100)}</span>,
    },
    {
      id: "fee",
      header: "Kada / day",
      cell: ({ row }) => (
        <span className="tabular-nums text-xs">
          {inr((row.original.platformFeePerDayPaise ?? 0) / 100)}
        </span>
      ),
    },
    {
      id: "skips",
      header: "Skipped",
      cell: ({ row }) => <span className="tabular-nums">{row.original.skippedDays?.length ?? 0}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = row.original.status ?? "unknown";
        return <Badge className={TONE[s] ?? "bg-slate-500"}>{s.replace("_", " ")}</Badge>;
      },
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Mess subscriptions"
        description="Who is on a plan, until when, and what they have skipped. Prices and dates are exactly what was charged."
        icon={CalendarCheck}
        stats={[
          { label: "Active plans", value: active.length, icon: Users, tone: "text-emerald-600", onClick: () => setTab("active"), active: tab === "active" },
          { label: "Meals a day", value: mealsToday, hint: "Before skips" },
          { label: "Collected", value: inr(paidValue), hint: "All paid subscriptions", tone: "text-emerald-600" },
          { label: "Awaiting payment", value: subs.rows.filter((s) => s.status === "pending_payment").length, tone: "text-amber-600", onClick: () => setTab("pending_payment"), active: tab === "pending_payment" },
        ]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="pending_payment">Unpaid</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          <TabsTrigger value="all">All ({subs.rows.length})</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        columns={columns}
        data={rows}
        searchKey="customer"
        searchPlaceholder="Search by customer…"
        exportFilename="mess-subscriptions"
      />
    </div>
  );
}
