import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Send, Wallet } from "lucide-react";
import { functions } from "@/lib/firebase";
import { fetchPayoutConfig, disbursePayout, type PayoutConfig } from "@/lib/payouts";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

interface MessSettlement {
  id: string;
  kitchenId?: string;
  kitchenName?: string;
  periodStart?: string;
  periodEnd?: string;
  grossSales?: number;
  commissionAmount?: number;
  netPayout?: number;
  coveredDays?: number;
  servedDays?: number;
  skippedDays?: number;
  subscriberCount?: number;
  status?: string;
  utrNumber?: string;
}

const inr = (n?: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const TONE: Record<string, string> = {
  pending: "bg-amber-500",
  processing: "bg-blue-600",
  paid: "bg-emerald-600",
  error: "bg-rose-600",
};

/**
 * What Kada owes each mess kitchen for a period.
 *
 * The kitchen earns its plan value pro-rata for every day of a subscription
 * that fell inside the period — including days the customer skipped, since the
 * kitchen held capacity for them. Kada's per-customer-per-day fee is charged
 * only on days actually served, so a skip costs the kitchen nothing.
 */
export default function MessSettlements() {
  const live = useLiveCollection<MessSettlement>("mess_settlements", { orderByField: "createdAt" });
  const [tab, setTab] = useState("pending");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return iso(d);
  });
  const [to, setTo] = useState(() => iso(new Date()));
  const [generating, setGenerating] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null);

  useEffect(() => {
    fetchPayoutConfig().then(setPayoutCfg).catch(() => setPayoutCfg(null));
  }, []);

  const pending = useMemo(() => live.rows.filter((s) => s.status !== "paid"), [live.rows]);
  const paid = useMemo(() => live.rows.filter((s) => s.status === "paid"), [live.rows]);
  const rows = tab === "paid" ? paid : tab === "all" ? live.rows : pending;

  const generate = async () => {
    setGenerating(true);
    try {
      const fn = httpsCallable(functions, "generateMessSettlements");
      const res = (await fn({ startDate: from, endDate: to })).data as {
        count: number;
        skipped?: unknown[];
      };
      const skipped = res.skipped?.length ?? 0;
      toast.success(
        `${res.count} settlement${res.count === 1 ? "" : "s"} generated` +
          (skipped ? ` · ${skipped} left alone (already paid or in flight)` : ""),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate settlements");
    } finally {
      setGenerating(false);
    }
  };

  const pay = async (id: string) => {
    if (!payoutCfg?.configured) {
      toast.error("RazorpayX isn't configured yet — set RAZORPAY_ACCOUNT_NUMBER to enable payouts.");
      return;
    }
    setPayingId(id);
    try {
      const r = await disbursePayout("mess", id);
      toast.success(`Payout initiated (₹${r.amount}) — ${r.status}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payout failed");
    } finally {
      setPayingId(null);
    }
  };

  const columns: ColumnDef<MessSettlement>[] = [
    {
      id: "kitchen",
      header: "Kitchen",
      accessorFn: (s) => s.kitchenName || s.kitchenId || "",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{row.original.kitchenName || row.original.kitchenId}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {(row.original.periodStart ?? "").slice(0, 10)} → {(row.original.periodEnd ?? "").slice(0, 10)}
          </div>
        </div>
      ),
    },
    {
      id: "subscribers",
      header: "Subscribers",
      cell: ({ row }) => <span className="tabular-nums">{row.original.subscriberCount ?? 0}</span>,
    },
    {
      id: "days",
      header: "Days served",
      cell: ({ row }) => (
        <span className="text-xs whitespace-nowrap tabular-nums">
          {row.original.servedDays ?? 0} served
          {(row.original.skippedDays ?? 0) > 0 ? ` · ${row.original.skippedDays} skipped` : ""}
        </span>
      ),
    },
    {
      id: "gross",
      header: "Kitchen earned",
      cell: ({ row }) => <span className="tabular-nums">{inr(row.original.grossSales)}</span>,
    },
    {
      id: "fee",
      header: "Kada fee",
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">−{inr(row.original.commissionAmount)}</span>
      ),
    },
    {
      id: "net",
      header: "Payout",
      cell: ({ row }) => <span className="font-semibold tabular-nums">{inr(row.original.netPayout)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = row.original.status ?? "pending";
        return (
          <div className="flex flex-col gap-0.5">
            <Badge className={TONE[s] ?? "bg-slate-500"}>{s}</Badge>
            {row.original.utrNumber && (
              <span className="text-[10px] text-muted-foreground">{row.original.utrNumber}</span>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) =>
        row.original.status === "paid" ? null : (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => pay(row.original.id)}
              disabled={payingId === row.original.id || row.original.status === "processing"}
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              {payingId === row.original.id ? "Sending…" : "Pay"}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Mess settlements"
        description="The kitchen earns its plan value for every day covered in the period; Kada's per-customer-per-day fee is charged only on days actually served."
        icon={Wallet}
        stats={[
          {
            label: "Awaiting payout",
            value: inr(pending.reduce((s, r) => s + (r.netPayout ?? 0), 0)),
            hint: `${pending.length} settlement${pending.length === 1 ? "" : "s"}`,
            tone: "text-amber-600",
          },
          {
            label: "Kada fee earned",
            value: inr(live.rows.reduce((s, r) => s + (r.commissionAmount ?? 0), 0)),
            tone: "text-emerald-600",
          },
          { label: "Paid out", value: inr(paid.reduce((s, r) => s + (r.netPayout ?? 0), 0)), hint: `${paid.length} settlements` },
        ]}
        actions={
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="mess-from" className="text-[11px]">
                From
              </Label>
              <Input id="mess-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mess-to" className="text-[11px]">
                To
              </Label>
              <Input id="mess-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" />
            </div>
            <Button onClick={generate} disabled={generating}>
              {generating ? "Generating…" : "Generate"}
            </Button>
          </div>
        }
      />

      {payoutCfg && !payoutCfg.configured && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
          <span>
            RazorpayX payouts aren&apos;t configured, so settlements can be generated but not sent.
            Set <code>RAZORPAY_ACCOUNT_NUMBER</code> to enable them.
          </span>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="paid">Paid ({paid.length})</TabsTrigger>
          <TabsTrigger value="all">All ({live.rows.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      <DataTable
        columns={columns}
        data={rows}
        searchKey="kitchen"
        searchPlaceholder="Search kitchens…"
        exportFilename="mess-settlements"
      />
    </div>
  );
}
