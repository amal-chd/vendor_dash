import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { toast } from "sonner";
import { Loader2, Wrench } from "lucide-react";
import { functions } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RiderRow {
  riderId: string;
  beforeLifetimeShown: number;
  beforeLifetimeStray: number;
  strayFields: string[];
  lifetime: number;
  today: number;
  week: number;
  month: number;
}

interface RepairResult {
  apply: boolean;
  ridersChecked: number;
  ridersWithStrayFields: number;
  missingEarningsFound: number;
  missingEarningsCredited: number;
  riders: RiderRow[];
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Rebuilds rider earnings from the ledger (fixRiderEarnings). A backend bug
 * wrote earnings to stray fields the app and payouts never read, so riders saw
 * ₹0 and couldn't withdraw. Preview first; apply is idempotent.
 */
export function RiderEarningsRepair() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [result, setResult] = useState<RepairResult | null>(null);

  const run = async (apply: boolean) => {
    setBusy(apply ? "apply" : "preview");
    try {
      const res = await httpsCallable<{ apply: boolean }, RepairResult>(functions, "fixRiderEarnings", {
        timeout: 540_000,
      })({ apply });
      setResult(res.data);
      if (apply) {
        toast.success(`Repaired ${res.data.ridersChecked} riders' earnings`);
      }
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't run the earnings repair.");
    } finally {
      setBusy(null);
    }
  };

  const affected = result?.riders.filter(
    (r) => r.strayFields.length > 0 || Math.abs(r.lifetime - r.beforeLifetimeShown) >= 1,
  ) ?? [];

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => {
          setOpen(true);
          setResult(null);
          run(false);
        }}
      >
        <Wrench className="h-4 w-4" /> Repair rider earnings
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Repair rider earnings</DialogTitle>
            <DialogDescription>
              Earnings were being saved where the rider app and payouts couldn't see them, so riders saw ₹0 and
              couldn't withdraw. This rebuilds every rider's totals from their trip ledger and credits any delivered
              order that was never paid. Safe to run more than once.
            </DialogDescription>
          </DialogHeader>

          {busy === "preview" && !result ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking riders…
            </div>
          ) : result ? (
            <div className="space-y-3 text-sm">
              <p>
                {result.apply ? "Applied" : "Preview"}: {result.ridersChecked} riders checked,{" "}
                <b>{affected.length}</b> {affected.length === 1 ? "needs" : "need"} fixing
                {result.missingEarningsFound > 0 && (
                  <>
                    , <b>{result.missingEarningsFound}</b> delivered order
                    {result.missingEarningsFound === 1 ? "" : "s"} never paid
                    {result.apply ? ` (${result.missingEarningsCredited} credited)` : ""}
                  </>
                )}
                .
              </p>
              {affected.length > 0 && (
                <div className="max-h-72 overflow-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60 text-left">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Rider</th>
                        <th className="px-3 py-2 font-semibold text-right">App showed</th>
                        <th className="px-3 py-2 font-semibold text-right">Correct lifetime</th>
                        <th className="px-3 py-2 font-semibold text-right">This month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {affected.map((r) => (
                        <tr key={r.riderId} className="border-t">
                          <td className="px-3 py-2 font-mono">{r.riderId.slice(0, 10)}…</td>
                          <td className="px-3 py-2 text-right tabular-nums">{inr(r.beforeLifetimeShown)}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{inr(r.lifetime)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{inr(r.month)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" disabled={!!busy} onClick={() => setOpen(false)}>
              Close
            </Button>
            {result && !result.apply && (affected.length > 0 || result.missingEarningsFound > 0) && (
              <Button disabled={!!busy} onClick={() => run(true)} className="gap-2">
                {busy === "apply" && <Loader2 className="h-4 w-4 animate-spin" />}
                Apply repair
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
