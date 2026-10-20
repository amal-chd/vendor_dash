import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { ColumnDef } from "@tanstack/react-table";
import { CreditCard } from "lucide-react";

interface Tx {
  id: string;
  source: string;
  order_id?: string;
  orderId?: string;
  kada_order_id?: string;
  context?: string;
  event?: string;
  gross_amount?: number;
  amount?: number;
  status?: string;
  processing_status?: string;
}

export default function TransactionLedger() {
  const [rows, setRows] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const map = new Map<string, Tx>();
    const flush = () => {
      setRows(Array.from(map.values()));
      setLoading(false);
    };

    const listen = (path: string, source: string) =>
      onSnapshot(
        query(collection(db, path), limit(300)),
        (snap) => {
          snap.docs.forEach((d) => map.set(`${source}:${d.id}`, { id: d.id, source, ...d.data() } as Tx));
          flush();
        },
        (err) => {
          console.error(`[TransactionLedger] ${source} (${path}) listener failed`, err);
          flush();
        },
      );

    const u1 = listen("transactions", "ledger");
    const u2 = listen("razorpay_webhook_events", "webhook");
    const u3 = listen("wallet_topups", "wallet");
    const u4 = listen("platform_refunds", "refund");
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, []);

  const amount = (t: Tx) => Number(t.gross_amount ?? t.amount ?? 0);
  // Per source, never one grand total: webhook events echo the same payments
  // the ledger records, and refunds flow the other way.
  const bySource = useMemo(() => {
    const agg: Record<string, { count: number; sum: number }> = {};
    for (const t of rows) {
      const a = (agg[t.source] ??= { count: 0, sum: 0 });
      a.count++;
      a.sum += amount(t);
    }
    return (k: string) => agg[k] ?? { count: 0, sum: 0 };
  }, [rows]);
  const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

  const columns: ColumnDef<Tx>[] = useMemo(
    () => [
      { accessorKey: "source", header: "Source" },
      { accessorKey: "id", header: "ID", cell: ({ row }) => <span className="font-mono text-xs">{row.original.id.slice(0, 12)}</span> },
      { accessorKey: "event", header: "Type", cell: ({ row }) => row.original.event || row.original.context || "—" },
      {
        id: "order",
        header: "Order",
        cell: ({ row }) => row.original.order_id || row.original.orderId || row.original.kada_order_id || "—",
      },
      { id: "amt", header: "Amount", cell: ({ row }) => `₹${Math.round(amount(row.original)).toLocaleString("en-IN")}` },
      {
        id: "st",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.processing_status || row.original.status || "—"}</Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Transaction ledger"
        description="Payments, wallet top-ups, refunds and Razorpay webhook events in one list. Latest 300 of each."
        icon={CreditCard}
        stats={[
          { label: "Payments", value: inr(bySource("ledger").sum), hint: `${bySource("ledger").count} ledger entries`, tone: "text-emerald-600", loading },
          { label: "Wallet top-ups", value: inr(bySource("wallet").sum), hint: `${bySource("wallet").count} top-ups`, tone: "text-sky-600", loading },
          { label: "Refunds", value: inr(bySource("refund").sum), hint: `${bySource("refund").count} refunds`, tone: "text-rose-600", loading },
          { label: "Webhook events", value: bySource("webhook").count, hint: "Razorpay notifications", loading },
        ]}
      />
      <DataTable columns={columns} data={rows} searchPlaceholder="Search ledger…" exportFilename="ledger" />
    </div>
  );
}
