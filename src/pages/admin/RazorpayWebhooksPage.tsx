import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnDef } from "@tanstack/react-table";
import { Activity } from "lucide-react";
import { toast } from "sonner";

interface Ev {
  id: string;
  event?: string;
  event_type?: string;
  payment_context?: string;
  attempt_count?: number;
  processing_status?: string;
  status?: string;
  payment_id?: string;
  kada_order_id?: string;
  error_message?: string;
  received_at?: { toDate?: () => Date };
}

export default function RazorpayWebhooks() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "razorpay_webhook_events"), limit(400)),
      (snap) => {
        setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Ev[]);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast.error("Could not load webhook events");
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  // Re-runs the event on the server (adminPlatformAction → replayWebhookEvent).
  // Writing "pending" from here did nothing: the processor fires only when an
  // event is first stored, and the rules now keep this collection server-only.
  const retry = async (id: string) => {
    try {
      const fn = httpsCallable(functions, "adminPlatformAction");
      const res = await fn({ action: "replayWebhookEvent", payload: { eventId: id } });
      const out = res.data as { ok?: boolean; error?: string | null };
      if (out?.ok) toast.success("Event re-processed");
      else toast.error(`Still failing: ${out?.error ?? "unknown error"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    }
  };

  const columns: ColumnDef<Ev>[] = useMemo(
    () => [
      { accessorKey: "id", header: "Event", cell: ({ row }) => <span className="font-mono text-xs">{row.original.id.slice(0, 16)}</span> },
      { id: "type", header: "Type", cell: ({ row }) => row.original.event_type || row.original.event || "—" },
      { accessorKey: "payment_context", header: "Context" },
      {
        id: "st",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.processing_status || row.original.status || "—"}</Badge>
        ),
      },
      { accessorKey: "payment_id", header: "Payment" },
      { accessorKey: "kada_order_id", header: "Order" },
      { accessorKey: "error_message", header: "Error" },
      {
        id: "a",
        cell: ({ row }) => (
          row.original.processing_status === "processed" ? null : (
            <Button size="sm" variant="outline" onClick={() => retry(row.original.id)}>
              Retry
            </Button>
          )
        ),
      },
    ],
    [],
  );

  // Newest first, and how long since Razorpay last reached us — zero events
  // or a stale timestamp means the dashboard webhook is missing or disabled.
  const sorted = useMemo(
    () => [...events].sort((a, b) => (b.received_at?.toDate?.()?.getTime() ?? 0) - (a.received_at?.toDate?.()?.getTime() ?? 0)),
    [events],
  );
  const lastAt = sorted[0]?.received_at?.toDate?.();

  const failed = events.filter((e) => ["failed", "amount_mismatch"].includes(e.processing_status || e.status || ""));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Razorpay webhooks"
        description="Inbound, signature-verified Razorpay events. Retry re-runs a failed event on the server; every handler is idempotent."
        icon={Activity}
        stats={[
          { label: "Events", value: loading ? "—" : String(events.length) },
          { label: "Failed", value: String(failed.length) },
          { label: "Last received", value: loading ? "—" : lastAt ? lastAt.toLocaleString("en-IN") : "Never" },
        ]}
      />
      <DataTable columns={columns} data={sorted} searchPlaceholder="Search event, payment, order…" exportFilename="webhooks" />
    </div>
  );
}
