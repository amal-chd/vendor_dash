import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { DatabaseZap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { functions } from "@/lib/firebase";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface BackfillReport {
  role: string;
  scanned: number;
  migrated: number;
  skipped: number;
  byState: Record<string, number>;
  byBankState: Record<string, number>;
  errors: string[];
}

interface BackfillResult {
  dryRun: boolean;
  reports: BackfillReport[];
  note: string;
}

const ROLE_LABEL: Record<string, string> = { vendor: "Restaurants", rider: "Riders", host: "Stay hosts", mess: "Mess kitchens" };

/**
 * Which partners a run covers. One type at a time matters: a partner with NO
 * record is treated as live by the restaurant rules, so migrating every type
 * at once can switch a working restaurant to "started" and stop its orders.
 * A kitchen that signed up before its create trigger existed can be fixed
 * without touching anyone else.
 */
type Scope = "all" | "vendor" | "mess" | "host" | "rider";
const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "All partner types" },
  { value: "vendor", label: "Restaurants only" },
  { value: "mess", label: "Mess kitchens only" },
  { value: "host", label: "Stay hosts only" },
  { value: "rider", label: "Riders only" },
];

const counts = (m: Record<string, number>) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(" · ") || "—";

/**
 * Runs the onboarding migration for partners created before the onboarding
 * engine. Until it runs, those hotels can't take bookings (the gate fails
 * closed) and restaurants and riders pass only through a legacy exemption.
 * Always a dry run first: nothing is written until an owner applies it.
 */
export function OnboardingBackfillDialog() {
  const { role } = usePermissions();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState<BackfillResult | null>(null);
  const [applied, setApplied] = useState<BackfillResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [scope, setScope] = useState<Scope>("all");

  if (role !== "super_admin" && role !== "platform_admin") return null;

  async function run(apply: boolean) {
    setBusy(true);
    try {
      // Apply always runs on the scope the dry run showed: changing the
      // selector clears the dry run below.
      const res = await httpsCallable(functions, "backfillOnboarding", { timeout: 540_000 })({
        apply,
        ...(scope === "all" ? {} : { role: scope }),
      });
      const data = res.data as BackfillResult;
      if (apply) {
        setApplied(data);
        toast.success("Existing partners migrated.");
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
          <DatabaseZap className="mr-1 h-4 w-4" /> Migrate existing partners
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Migrate partners created before onboarding</DialogTitle>
          <DialogDescription>
            Gives existing restaurants, mess kitchens, riders and hosts an onboarding record inferred from what they already
            have. Hotels and mess kitchens without one aren't shown to customers. Start with a dry run: it shows the result and
            writes nothing.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Partners</span>
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={scope}
            disabled={busy}
            onChange={(e) => {
              setScope(e.target.value as Scope);
              setDryRun(null);
              setApplied(null);
              setConfirmed(false);
            }}
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>

        {shown && (
          <div className="space-y-3 text-sm">
            <p className={shown.dryRun ? "text-muted-foreground" : "font-medium text-emerald-700 dark:text-emerald-400"}>{shown.note}</p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-2">Partners</th><th className="p-2 text-right">Scanned</th><th className="p-2 text-right">{shown.dryRun ? "Would migrate" : "Migrated"}</th>
                    <th className="p-2 text-right">Already set</th><th className="p-2">Resulting state</th><th className="p-2">Bank</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.reports.map((r) => (
                    <tr key={r.role} className="border-t align-top">
                      <td className="p-2 font-medium">{ROLE_LABEL[r.role] ?? r.role}</td>
                      <td className="p-2 text-right tabular-nums">{r.scanned}</td>
                      <td className="p-2 text-right tabular-nums">{r.migrated}</td>
                      <td className="p-2 text-right tabular-nums">{r.skipped}</td>
                      <td className="p-2">{counts(r.byState)}</td>
                      <td className="p-2">{counts(r.byBankState)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.reports.some((r) => r.errors.length) && (
              <ul className="list-disc pl-5 text-destructive">
                {shown.reports.flatMap((r) => r.errors.map((e) => <li key={`${r.role}-${e}`}>{ROLE_LABEL[r.role] ?? r.role}: {e}</li>))}
              </ul>
            )}
            {dryRun && !applied && (
              <label className="flex items-start gap-2 rounded-md border p-2">
                <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>
                  I've checked these numbers. Apply it: partners get the states above, and anyone without a completed past payout needs
                  their bank verified before they can be paid.
                </span>
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
            Apply migration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
