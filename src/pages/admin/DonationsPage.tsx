import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { HeartHandshake, Send } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { functions } from "@/lib/firebase";
import { formatMoney } from "@/lib/currency";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLiveCollection } from "@/hooks/useLiveCollection";

interface Donation {
  id: string;
  uid?: string;
  amount?: number;
  cause?: string;
  status?: string; // "collected" | "disbursed"
  createdAt?: { toDate?: () => Date };
}
interface Disbursement {
  id: string;
  cause?: string;
  amount?: number;
  count?: number;
  note?: string;
  disbursedBy?: string;
  createdAt?: { toDate?: () => Date };
}

const when = (ts?: { toDate?: () => Date }) => {
  try {
    return ts?.toDate?.().toLocaleDateString("en-IN") ?? "—";
  } catch {
    return "—";
  }
};

export default function DonationsPage() {
  const { rows: donations, loading } = useLiveCollection<Donation>("donations", { orderByField: "createdAt" });
  const { rows: disbursements } = useLiveCollection<Disbursement>("donation_disbursements", { orderByField: "createdAt" });

  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const byCause = useMemo(() => {
    const map = new Map<string, { collected: number; collectedCount: number; disbursed: number; donors: Set<string> }>();
    for (const d of donations) {
      const cause = d.cause || "Kada Cares";
      const e = map.get(cause) ?? { collected: 0, collectedCount: 0, disbursed: 0, donors: new Set<string>() };
      const amt = Number(d.amount || 0);
      if (d.uid) e.donors.add(d.uid);
      if (d.status === "disbursed") e.disbursed += amt;
      else {
        e.collected += amt;
        e.collectedCount += 1;
      }
      map.set(cause, e);
    }
    return Array.from(map.entries()).map(([cause, v]) => ({ cause, ...v, donors: v.donors.size }));
  }, [donations]);

  const totals = useMemo(() => {
    const raised = donations.reduce((s, d) => s + Number(d.amount || 0), 0);
    const awaiting = donations.filter((d) => d.status !== "disbursed").reduce((s, d) => s + Number(d.amount || 0), 0);
    const donors = new Set(donations.map((d) => d.uid).filter(Boolean)).size;
    return { raised, awaiting, disbursed: raised - awaiting, donors };
  }, [donations]);

  async function confirmDisburse() {
    if (!target) return;
    setBusy(true);
    try {
      const fn = httpsCallable<{ cause: string; note: string }, { amount: number; count: number }>(functions, "disburseDonations");
      const res = await fn({ cause: target, note });
      toast.success(`Disbursed ${formatMoney(res.data.amount)} for ${target} (${res.data.count} donations).`);
      setTarget(null);
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disbursement failed.");
    } finally {
      setBusy(false);
    }
  }

  const historyCols: ColumnDef<Disbursement>[] = useMemo(
    () => [
      { accessorKey: "cause", header: "Cause", cell: ({ row }) => <span className="font-semibold">{row.original.cause}</span> },
      { accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums font-semibold">{formatMoney(Number(row.original.amount || 0))}</span> },
      { accessorKey: "count", header: "Donations", cell: ({ row }) => row.original.count ?? 0 },
      { accessorKey: "note", header: "Note", cell: ({ row }) => <span className="text-muted-foreground text-sm">{row.original.note || "—"}</span> },
      { accessorKey: "disbursedBy", header: "By", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.disbursedBy || "—"}</span> },
      { id: "when", header: "When", cell: ({ row }) => <span className="text-xs text-muted-foreground whitespace-nowrap">{when(row.original.createdAt)}</span> },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Kada Cares — donations"
        description="Customer donations pooled by cause. Disburse the collected pool to the cause and keep an auditable record; customers see their receipts in-app."
        icon={HeartHandshake}
        stats={[
          { label: "Total raised", value: loading ? "—" : formatMoney(totals.raised) },
          { label: "Awaiting disbursement", value: formatMoney(totals.awaiting), tone: "text-amber-600" },
          { label: "Disbursed", value: formatMoney(totals.disbursed), tone: "text-emerald-600" },
          { label: "Donors", value: String(totals.donors) },
        ]}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {byCause.length === 0 && (
          <Card className="rounded-2xl md:col-span-2 xl:col-span-3">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No donations yet. Once customers opt in at checkout, causes appear here to disburse.
            </CardContent>
          </Card>
        )}
        {byCause.map((c) => (
          <Card key={c.cause} className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <HeartHandshake className="h-4 w-4 text-rose-500" /> {c.cause}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-2xl font-bold tabular-nums">{formatMoney(c.collected)}</p>
                <p className="text-xs text-muted-foreground">awaiting disbursement · {c.collectedCount} donations · {c.donors} donors</p>
              </div>
              <p className="text-xs text-muted-foreground">Lifetime disbursed: <span className="font-medium text-foreground">{formatMoney(c.disbursed)}</span></p>
              <Button size="sm" className="w-full" disabled={c.collected <= 0} onClick={() => { setTarget(c.cause); setNote(""); }}>
                <Send className="h-3.5 w-3.5 mr-1.5" /> Disburse {formatMoney(c.collected)}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Disbursement history</h3>
        <DataTable columns={historyCols} data={disbursements} searchPlaceholder="Search disbursements…" exportFilename="donation-disbursements" />
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Disburse {target}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This marks all collected donations for <span className="font-semibold text-foreground">{target}</span> as disbursed and records it. Add a reference (transfer id, receipt no.) for the audit trail.
          </p>
          <Textarea placeholder="Disbursement reference / note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={confirmDisburse} disabled={busy}>{busy ? "Disbursing…" : "Confirm disbursement"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
