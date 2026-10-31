import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { CalendarCheck, HandCoins, Hourglass, Users } from "lucide-react";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessSubscriptionSheet } from "./MessSubscriptionSheet";
import {
  REFUND_TONE,
  STATUS_TONE,
  customerName,
  customerPhone,
  daysLeft,
  fmtTs,
  headcount,
  inr,
  todayKey,
  type MessSub,
} from "./messAdmin";

const TABS = ["active", "ending", "refunds", "pending_payment", "cancelled", "expired", "all"] as const;
type Tab = (typeof TABS)[number];

/**
 * Every mess subscription, with the actions support needs: open one to see
 * its days, skips, closures and refund, and to extend, skip, cancel or refund.
 * Prices and dates are exactly what was charged.
 */
export default function MessSubscriptions() {
  const subs = useLiveCollection<MessSub>("mess_subscriptions", { orderByField: "createdAt", limit: 2000 });
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("view") ?? "") ? (params.get("view") as Tab) : "active";
  const setTab = (v: string) => {
    params.set("view", v);
    setParams(params, { replace: true });
  };
  const kitchenFilter = params.get("kitchenId");
  const [openId, setOpenId] = useState<string | null>(null);

  const all = useMemo(() => (kitchenFilter ? subs.rows.filter((s) => s.kitchenId === kitchenFilter) : subs.rows), [subs.rows, kitchenFilter]);
  const active = all.filter((s) => s.status === "active");
  const ending = active.filter((s) => daysLeft(s) <= 3);
  const refunds = all.filter((s) => s.refund?.status === "pending" || s.refund?.status === "failed" || s.refund?.status === "processing");
  const today = headcount(all, todayKey());
  const refundDue = refunds.reduce((sum, s) => sum + (s.refund?.amountPaise ?? 0), 0);

  const rows = useMemo(() => {
    switch (tab) {
      case "all":
        return all;
      case "ending":
        return ending;
      case "refunds":
        return refunds;
      default:
        return all.filter((s) => (s.status ?? "") === tab);
    }
  }, [all, tab, ending, refunds]);

  const open = openId ? subs.rows.find((s) => s.id === openId) ?? null : null;

  const columns: ColumnDef<MessSub>[] = [
    {
      id: "customer",
      header: "Customer",
      accessorFn: (s) => `${customerName(s)} ${customerPhone(s)} ${s.customerUid ?? ""}`,
      cell: ({ row }) => (
        <button className="min-w-0 text-left" onClick={() => setOpenId(row.original.id)}>
          <div className="font-medium truncate hover:underline">{customerName(row.original)}</div>
          <div className="text-[11px] text-muted-foreground truncate">{customerPhone(row.original) || row.original.customerUid || "—"}</div>
        </button>
      ),
    },
    { id: "kitchen", header: "Kitchen", accessorFn: (s) => s.kitchenName || s.kitchenId || "—" },
    {
      id: "plan",
      header: "Plan",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate">
            {row.original.plan?.name || "Meal plan"}
            {row.original.isTrial && <Badge variant="outline" className="ml-1.5 text-[10px]">trial</Badge>}
          </div>
          <div className="text-[11px] text-muted-foreground capitalize truncate">{(row.original.plan?.meals ?? []).join(" · ") || "—"}</div>
        </div>
      ),
    },
    {
      id: "dates",
      header: "Runs",
      cell: ({ row }) => (
        <div className="text-xs whitespace-nowrap">
          {fmtTs(row.original.startDate)} – {fmtTs(row.original.endDate)}
          {row.original.status === "active" && <div className="text-[11px] text-muted-foreground">{daysLeft(row.original)} days left</div>}
        </div>
      ),
    },
    { id: "paid", header: "Paid", cell: ({ row }) => <span className="tabular-nums">{row.original.isTrial ? "Free" : inr(row.original.amountPaise)}</span> },
    {
      id: "skips",
      header: "Skip / closed",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.skippedDays?.length ?? 0} / {row.original.holidayDays?.length ?? 0}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = row.original.status ?? "unknown";
        const r = row.original.refund?.status;
        return (
          <div className="flex flex-col gap-1 items-start">
            <Badge className={STATUS_TONE[s] ?? "bg-slate-500"}>{s.replace("_", " ")}</Badge>
            {r && <Badge className={REFUND_TONE[r] ?? "bg-slate-500"}>refund {r}</Badge>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Mess subscriptions"
        description="Who is on a plan, until when, what they skipped and what they're owed. Open a row to extend, skip, cancel or refund."
        icon={CalendarCheck}
        stats={[
          { label: "Active plans", value: active.length, icon: Users, tone: "text-emerald-600", onClick: () => setTab("active"), active: tab === "active" },
          { label: "Eating today", value: today.people, hint: `${today.breakfast} B · ${today.lunch} L · ${today.dinner} D` },
          { label: "Ending ≤3 days", value: ending.length, icon: Hourglass, tone: ending.length ? "text-amber-600" : undefined, onClick: () => setTab("ending"), active: tab === "ending" },
          { label: "Refunds to act on", value: refunds.length, icon: HandCoins, hint: inr(refundDue), tone: refunds.length ? "text-rose-600" : undefined, onClick: () => setTab("refunds"), active: tab === "refunds" },
        ]}
      />
      {kitchenFilter && (
        <div className="text-sm text-muted-foreground">
          Showing one kitchen ·{" "}
          <button className="underline" onClick={() => { params.delete("kitchenId"); setParams(params, { replace: true }); }}>
            show all
          </button>
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="ending">Ending soon ({ending.length})</TabsTrigger>
          <TabsTrigger value="refunds">Refunds ({refunds.length})</TabsTrigger>
          <TabsTrigger value="pending_payment">Unpaid</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          <TabsTrigger value="expired">Expired</TabsTrigger>
          <TabsTrigger value="all">All ({all.length})</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable columns={columns} data={rows} searchKey="customer" searchPlaceholder="Search by customer or phone…" exportFilename="mess-subscriptions" />
      <MessSubscriptionSheet sub={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
