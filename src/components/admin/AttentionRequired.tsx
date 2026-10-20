import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AlertTriangle, AlertOctagon, CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { roleCan } from "@/lib/rbac";

type Severity = "critical" | "warning";
interface Alert {
  id: string;
  severity: Severity;
  label: string;
  sub?: string;
  href: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Command Center — "Attention Required".
 *
 * Derives actionable operational alerts from live Firestore collections (real
 * data, no new backend). Every alert is a deep-link into the filtered view that
 * lets an operator act on it. Alerts with a zero count are hidden; when nothing
 * needs attention it shows an explicit all-clear state (never a blank panel).
 */
export function AttentionRequired() {
  const navigate = useNavigate();
  const { role } = usePermissions();
  const seeFinance = !!role && roleCan(role, "view_financial");
  const [payFail, setPayFail] = useState(0);
  const [escalated, setEscalated] = useState(0);
  const [payout, setPayout] = useState({ count: 0, amount: 0 });
  const [awaitingRider, setAwaitingRider] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const unsubs: Array<() => void> = [];
    // Each listener carries its own tag so a Firestore rules/network failure
    // shows up in the browser console alongside the source, instead of the
    // widget silently hiding that alert row forever.
    const logErr = (source: string) => (err: unknown) => {
      console.error(`AttentionRequired: ${source} listener error:`, err);
    };

    // Payment failures today — single-field query, filter to today in memory
    // (avoids a composite index).
    unsubs.push(
      onSnapshot(
        query(collection(db, "orders"), where("paymentStatus", "==", "failed"), limit(500)),
        (s) => {
          let n = 0;
          s.forEach((d) => {
            const ts = (d.data().timestamp as { toDate?: () => Date } | undefined)?.toDate?.();
            if (!ts || ts >= startToday) n++;
          });
          setPayFail(n);
          setReady(true);
        },
        logErr("payment-failures"),
      ),
    );

    // Support chats escalated to a human.
    unsubs.push(
      onSnapshot(
        query(collection(db, "support_threads"), where("status", "==", "escalated"), limit(200)),
        (s) => setEscalated(s.size),
        logErr("escalated-support"),
      ),
    );

    if (!seeFinance) setPayout({ count: 0, amount: 0 });
    if (seeFinance) unsubs.push(
      onSnapshot(
        query(collection(db, "vendor_settlements"), where("status", "==", "pending"), limit(500)),
        (s) => {
          let amount = 0;
          s.forEach((d) => (amount += Number(d.data().netPayout ?? 0) || 0));
          setPayout({ count: s.size, amount });
        },
        logErr("vendor-payouts"),
      ),
    );

    // Deliveries still awaiting a rider for more than 10 minutes.
    unsubs.push(
      onSnapshot(
        query(collection(db, "deliveries"), limit(600)),
        (s) => {
          const now = Date.now();
          let n = 0;
          s.forEach((d) => {
            const x = d.data() as Record<string, unknown>;
            const stage = String(x.status ?? x.stage ?? "").toLowerCase();
            const active = ["offered", "pending", "assigned", "at_restaurant", "searching"].includes(stage);
            const noRider = !x.riderName || String(x.riderName).trim() === "";
            const tsRaw = (x.createdAt ?? x.timestamp) as { toDate?: () => Date } | undefined;
            const ts = tsRaw?.toDate?.();
            const ageMin = ts ? (now - ts.getTime()) / 60000 : 0;
            if (active && noRider && ageMin > 10) n++;
          });
          setAwaitingRider(n);
        },
        logErr("awaiting-rider"),
      ),
    );

    return () => unsubs.forEach((u) => u());
  }, [seeFinance]);

  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];
    if (awaitingRider > 0)
      out.push({
        id: "rider",
        severity: "critical",
        label: `${awaitingRider} order${awaitingRider > 1 ? "s" : ""} without a rider > 10 min`,
        sub: "Assign or reassign from Live Dispatch",
        href: "/admin/orders?tab=live",
      });
    if (payFail > 0)
      out.push({
        id: "pay",
        severity: "critical",
        label: `${payFail} payment failure${payFail > 1 ? "s" : ""} today`,
        sub: "Review orders with failed payment",
        href: "/admin/orders",
      });
    if (escalated > 0)
      out.push({
        id: "esc",
        severity: "warning",
        label: `${escalated} support chat${escalated > 1 ? "s" : ""} escalated to a human`,
        sub: "Waiting for an agent",
        href: "/admin/support?tab=chats",
      });
    if (payout.count > 0)
      out.push({
        id: "payout",
        severity: "warning",
        label: `${payout.count} vendor payout${payout.count > 1 ? "s" : ""} pending`,
        sub: `${inr(payout.amount)} owed · run settlements`,
        href: "/admin/finance?tab=settlements",
      });
    return out;
  }, [awaitingRider, payFail, escalated, payout]);

  const critical = alerts.filter((a) => a.severity === "critical").length;

  // OpsAlerts directly above already says when nothing needs attention; a
  // second "All clear" panel read as a contradiction next to its alerts.
  if (ready && alerts.length === 0) return null;

  return (
    <section
      aria-label="Attention required"
      className="rounded-xl border border-border/70 bg-card overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <AlertOctagon className={cn("h-4 w-4", critical > 0 ? "text-rose-500" : "text-muted-foreground")} />
          <h2 className="text-sm font-semibold text-foreground">Attention Required</h2>
        </div>
        {ready && alerts.length > 0 && (
          <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
            {alerts.length} item{alerts.length > 1 ? "s" : ""}
            {critical > 0 && <span className="text-rose-500"> · {critical} critical</span>}
          </span>
        )}
      </div>

      {!ready ? (
        <div className="divide-y divide-border/50">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 animate-pulse bg-muted/30" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {alerts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => navigate(a.href)}
                className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    a.severity === "critical" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-600",
                  )}
                >
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground truncate">{a.label}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                        a.severity === "critical" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-600",
                      )}
                    >
                      {a.severity}
                    </span>
                  </span>
                  {a.sub && <span className="block text-xs text-muted-foreground truncate">{a.sub}</span>}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
