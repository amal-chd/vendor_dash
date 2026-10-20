import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Loader2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { functions } from "@/lib/firebase";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface SealReport {
  role: string;
  scanned: number;
  needsSeal: number;
  sealed: number;
  byField: Record<string, number>;
  conflicts: { partnerId: string; notes: string[] }[];
  errors: string[];
  nextCursor: string | null;
}

interface SealResult {
  dryRun: boolean;
  reports: SealReport[];
  note: string;
}

const ROLE_LABEL: Record<string, string> = { vendor: "Restaurants", rider: "Riders", host: "Stay hosts" };

const fields = (m: Record<string, number>) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ") || "—";

/**
 * Runs sealPartnerPrivateData: moves bank details, payout routing, PAN and
 * owner contact off the publicly readable partner docs into admin-only
 * records. Dry run first; nothing is written until an owner applies it.
 */
export function PartnerPrivateSealDialog() {
  const { role } = usePermissions();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState<SealResult | null>(null);
  const [applied, setApplied] = useState<SealResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  if (role !== "super_admin" && role !== "platform_admin") return null;

  async function run(apply: boolean) {
    setBusy(true);
    try {
      const res = await httpsCallable(functions, "sealPartnerPrivateData", { timeout: 540_000 })({ apply });
      const data = res.data as SealResult;
      if (apply) {
        setApplied(data);
        toast.success("Private partner data moved.");
      } else {
        setDryRun(data);
        setApplied(null);
        setConfirmed(false);
      }
    } catch (e) {
      toast.error((e as Error).message || "The migration failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const shown = applied ?? dryRun;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <LockKeyhole className="mr-1 h-4 w-4" /> Seal private data
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move bank details off public partner records</DialogTitle>
          <DialogDescription>
            Restaurant and hotel documents are publicly readable. This moves account numbers, IFSC, payout routing, PAN and
            owner email/phone into admin-only records, leaving a masked account and the bank name. Start with a dry run: it
            shows what would move and writes nothing.
          </DialogDescription>
        </DialogHeader>

        {shown && (
          <div className="space-y-3 text-sm">
            <p className={shown.dryRun ? "text-muted-foreground" : "font-medium text-emerald-700 dark:text-emerald-400"}>{shown.note}</p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-2">Partners</th>
                    <th className="p-2 text-right">Scanned</th>
                    <th className="p-2 text-right">{shown.dryRun ? "Would seal" : "Sealed"}</th>
                    <th className="p-2 text-right">Conflicts</th>
                    <th className="p-2">Fields found</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.reports.map((r) => (
                    <tr key={r.role} className="border-t align-top">
                      <td className="p-2 font-medium">{ROLE_LABEL[r.role] ?? r.role}</td>
                      <td className="p-2 text-right tabular-nums">{r.scanned}</td>
                      <td className="p-2 text-right tabular-nums">{shown.dryRun ? r.needsSeal : r.sealed}</td>
                      <td className="p-2 text-right tabular-nums">{r.conflicts.length}</td>
                      <td className="p-2">{fields(r.byField)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.reports.some((r) => r.nextCursor) && (
              <p className="text-amber-700 dark:text-amber-400">
                Some roles have more partners than one run covers. Run it again after applying — sealed records are skipped.
              </p>
            )}
            {shown.reports.some((r) => r.conflicts.length) && (
              <p className="text-muted-foreground">
                Conflicts: an old public bank field disagrees with the account already on record. The record is kept and the old
                value is archived for review.
              </p>
            )}
            {shown.reports.some((r) => r.errors.length) && (
              <ul className="list-disc pl-5 text-destructive">
                {shown.reports.flatMap((r) => r.errors.map((e) => <li key={`${r.role}-${e}`}>{ROLE_LABEL[r.role] ?? r.role}: {e}</li>))}
              </ul>
            )}
            {dryRun && !applied && (
              <label className="flex items-start gap-2 rounded-md border p-2">
                <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>I've checked these numbers. Move the fields — they will no longer exist on the public documents.</span>
              </label>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={() => run(false)}>
            {busy && !confirmed ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {dryRun ? "Run dry run again" : "Dry run"}
          </Button>
          <Button disabled={busy || !dryRun || !confirmed || !!applied} onClick={() => run(true)}>
            {busy && confirmed ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
