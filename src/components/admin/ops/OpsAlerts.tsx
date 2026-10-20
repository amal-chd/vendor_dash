import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

interface Anomaly {
  key: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  href: string;
  count: number;
}

/**
 * What is wrong right now that nobody has reported yet.
 *
 * Fed by the `recomputeOpsHealth` job, which runs every 30 minutes and writes
 * one summary document. Reading a pre-computed doc keeps this free to render
 * on every dashboard load — the alternative, scanning orders and webhooks in
 * the browser, would be thousands of reads per admin per visit.
 *
 * Each alert names a number and links to the screen where you fix it. An alert
 * you cannot act on is just anxiety.
 */
export function OpsAlerts({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<Anomaly[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [everRan, setEverRan] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        doc(db, "ops_health", "anomalies"),
        (snap) => {
          const data = snap.data();
          setEverRan(snap.exists());
          setItems(Array.isArray(data?.items) ? (data!.items as Anomaly[]) : []);
          const ts = data?.generatedAt;
          setGeneratedAt(ts?.toDate ? ts.toDate() : null);
        },
        () => setItems([]),
      ),
    [],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await httpsCallable(functions, "refreshOpsHealth")({});
      toast.success("Health checks re-run");
    } catch (e: any) {
      toast.error(e?.message || "Could not refresh health checks.");
    } finally {
      setRefreshing(false);
    }
  };

  if (items === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="mt-3 h-3 w-56 rounded bg-muted animate-pulse" />
      </div>
    );
  }

  const critical = items.filter((i) => i.severity === "critical");
  const warnings = items.filter((i) => i.severity === "warning");

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert
            className={cn(
              "h-4 w-4 shrink-0",
              critical.length
                ? "text-rose-500"
                : warnings.length || !everRan
                  ? "text-amber-500"
                  : "text-emerald-500",
            )}
          />
          <p className="text-sm font-bold truncate">
            {items.length === 0
              ? everRan
                ? "Nothing needs attention"
                : "Health checks not run yet"
              : `${items.length} thing${items.length === 1 ? " needs" : "s need"} attention`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {generatedAt && (
            <span className="hidden sm:inline text-[10px] font-medium text-muted-foreground tabular-nums">
              checked{" "}
              {generatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={refresh}
            disabled={refreshing}
            title="Re-run the health checks now"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2.5 px-4 py-5 text-sm text-muted-foreground">
          {everRan ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>No stalled orders, failed payments, unzoned vendors or cash build-ups.</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <span>
                Health checks haven&apos;t run yet — this is not an all-clear. Use refresh to
                run them now.
              </span>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {[...critical, ...warnings].slice(0, compact ? 3 : undefined).map((a) => (
            <li key={a.key}>
              <Link
                to={a.href}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group"
              >
                <span
                  className={cn(
                    "mt-0.5 h-6 w-6 shrink-0 rounded-lg grid place-items-center",
                    a.severity === "critical"
                      ? "bg-rose-500/12 text-rose-500"
                      : "bg-amber-500/12 text-amber-600",
                  )}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{a.title}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums",
                        a.severity === "critical"
                          ? "bg-rose-500/12 text-rose-600"
                          : "bg-amber-500/12 text-amber-700",
                      )}
                    >
                      {a.count}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground leading-relaxed">
                    {a.detail}
                  </span>
                </span>
                <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Partner health, rendered as a score chip.
 *
 * Hovering shows the signals that produced the number — a score without its
 * reasons is one an operator can neither act on nor argue with.
 */
export function HealthChip({
  score,
  band,
  signals,
  className,
}: {
  score?: number | null;
  band?: "healthy" | "watch" | "at_risk" | null;
  signals?: Array<{ label: string; detail: string; delta: number }>;
  className?: string;
}) {
  if (typeof score !== "number") {
    return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  }

  const tone =
    band === "at_risk"
      ? "bg-rose-500/12 text-rose-600 border-rose-500/25"
      : band === "watch"
        ? "bg-amber-500/12 text-amber-700 border-amber-500/25"
        : "bg-emerald-500/12 text-emerald-600 border-emerald-500/25";

  const reasons = (signals ?? []).filter((s) => s.delta !== 0);
  const title = reasons.length
    ? reasons.map((s) => `${s.label}: ${s.detail} (${s.delta})`).join("\n")
    : "No issues detected in the last 30 days";

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums cursor-help",
        tone,
        className,
      )}
    >
      {score}
      {reasons.length > 0 && (
        <span className="font-medium opacity-70">
          · {reasons.length} issue{reasons.length === 1 ? "" : "s"}
        </span>
      )}
    </span>
  );
}
