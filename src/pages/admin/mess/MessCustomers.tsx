import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { UserRound } from "lucide-react";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessSubscriptionSheet } from "./MessSubscriptionSheet";
import { customerName, customerPhone, fmtTs, inr, type MessSub } from "./messAdmin";

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  plans: number;
  lifetimePaise: number;
  refundedPaise: number;
  kitchens: string[];
  current?: MessSub;
  last?: MessSub;
  since?: MessSub["createdAt"];
  status: "active" | "lapsed" | "trial-only";
}

/**
 * Mess customers, one row per person: lifetime value, how many plans, where
 * they eat, and whether they're on a plan now — the list to win back lapsed
 * subscribers from, and the first stop for a support call.
 */
export default function MessCustomers() {
  const subs = useLiveCollection<MessSub>("mess_subscriptions", { orderByField: "createdAt", limit: 5000 });
  const [tab, setTab] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo<CustomerRow[]>(() => {
    const by = new Map<string, MessSub[]>();
    for (const s of subs.rows) {
      if (!s.customerUid || (s.paymentStatus !== "paid" && s.paymentStatus !== "free")) continue;
      by.set(s.customerUid, [...(by.get(s.customerUid) ?? []), s]);
    }
    return [...by.entries()].map(([id, list]) => {
      const sorted = [...list].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      const current = sorted.find((s) => s.status === "active");
      const paid = list.filter((s) => s.paymentStatus === "paid");
      return {
        id,
        name: customerName(sorted[0]),
        phone: customerPhone(sorted[0]),
        plans: list.length,
        lifetimePaise: paid.reduce((t, s) => t + (s.paidAmountPaise ?? s.amountPaise ?? 0), 0),
        refundedPaise: list.reduce((t, s) => t + (s.refundedPaise ?? 0), 0),
        kitchens: [...new Set(list.map((s) => s.kitchenName || s.kitchenId || "—"))],
        current,
        last: sorted[0],
        since: sorted[sorted.length - 1].createdAt,
        status: current ? "active" : paid.length ? "lapsed" : "trial-only",
      } as CustomerRow;
    });
  }, [subs.rows]);

  const shown = tab === "all" ? rows : rows.filter((r) => r.status === tab);
  const ltv = rows.length ? rows.reduce((t, r) => t + r.lifetimePaise, 0) / rows.length : 0;
  const repeat = rows.filter((r) => r.plans > 1).length;
  const open = openId ? subs.rows.find((s) => s.id === openId) ?? null : null;

  const columns: ColumnDef<CustomerRow>[] = [
    {
      id: "name",
      header: "Customer",
      accessorFn: (r) => `${r.name} ${r.phone}`,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{row.original.name}</div>
          <div className="text-[11px] text-muted-foreground">{row.original.phone || row.original.id}</div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Now",
      cell: ({ row }) => (
        <Badge className={row.original.status === "active" ? "bg-emerald-600" : row.original.status === "lapsed" ? "bg-amber-500" : "bg-slate-500"}>
          {row.original.status}
        </Badge>
      ),
    },
    { id: "plans", header: "Plans", cell: ({ row }) => <span className="tabular-nums">{row.original.plans}</span> },
    { id: "ltv", header: "Lifetime", cell: ({ row }) => <span className="tabular-nums">{inr(row.original.lifetimePaise)}</span> },
    {
      id: "refunds",
      header: "Refunded",
      cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.refundedPaise ? inr(row.original.refundedPaise) : "—"}</span>,
    },
    { id: "kitchens", header: "Kitchens", accessorFn: (r) => r.kitchens.join(", ") },
    { id: "since", header: "Since", cell: ({ row }) => <span className="text-xs">{fmtTs(row.original.since)}</span> },
    {
      id: "open",
      cell: ({ row }) =>
        row.original.last ? (
          <button className="text-xs underline" onClick={() => setOpenId((row.original.current ?? row.original.last)!.id)}>
            {row.original.current ? "Current plan" : "Last plan"}
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Mess customers"
        description="Everyone who has eaten on a Kada Mess plan — who is on one now, who lapsed, and what each is worth."
        icon={UserRound}
        stats={[
          { label: "Customers", value: rows.length },
          { label: "On a plan now", value: rows.filter((r) => r.status === "active").length, tone: "text-emerald-600", onClick: () => setTab("active"), active: tab === "active" },
          { label: "Lapsed", value: rows.filter((r) => r.status === "lapsed").length, tone: "text-amber-600", hint: "win-back list", onClick: () => setTab("lapsed"), active: tab === "lapsed" },
          { label: "Repeat buyers", value: rows.length ? `${Math.round((repeat / rows.length) * 100)}%` : "—", hint: `${repeat} bought 2+ plans` },
          { label: "Avg lifetime value", value: inr(ltv) },
        ]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">On a plan</TabsTrigger>
          <TabsTrigger value="lapsed">Lapsed</TabsTrigger>
          <TabsTrigger value="trial-only">Trial only</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable columns={columns} data={shown} searchKey="name" searchPlaceholder="Search name or phone…" exportFilename="mess-customers" />
      <MessSubscriptionSheet sub={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
