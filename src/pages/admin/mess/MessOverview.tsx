import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChefHat, HandCoins, Hourglass, IndianRupee, LayoutDashboard, TrendingDown, Users, Utensils } from "lucide-react";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { messAction } from "./messAdmin";
import { addDays, daysLeft, headcount, inr, kitchenName, todayKey, type MessKitchen, type MessSub } from "./messAdmin";

interface Settlement {
  id: string;
  kitchenId?: string;
  status?: string;
  netPayoutPaise?: number;
  platformFeePaise?: number;
  periodEnd?: string;
}

const DEFAULT_FEE = 300;

/**
 * Kada Mess at a glance: how many plates kitchens cook today, what Kada earns
 * a day, money waiting on ops (refunds, payouts), and which kitchens need a
 * nudge — no menu, no plans, full, closed, unreachable by push.
 */
export default function MessOverview() {
  const kitchens = useLiveCollection<MessKitchen>("mess_kitchens", { orderByField: "createdAt" });
  const subs = useLiveCollection<MessSub>("mess_subscriptions", { orderByField: "createdAt", limit: 3000 });
  const settlements = useLiveCollection<Settlement>("mess_settlements", { orderByField: "createdAt", limit: 500 });

  const today = todayKey();
  const tomorrow = addDays(today, 1);
  const monthStart = `${today.slice(0, 7)}-01`;

  const data = useMemo(() => {
    const rows = subs.rows;
    const active = rows.filter((s) => s.status === "active");
    const live = kitchens.rows.filter((k) => k.onboarding?.state === "active" && !k.isBlocked);
    const nowCount = headcount(rows, today);
    const tmrCount = headcount(rows, tomorrow);
    const feeToday = rows.reduce((sum, s) => {
      const hc = headcount([s], today);
      return sum + (hc.people ? s.platformFeePerDayPaise ?? 0 : 0);
    }, 0);
    const createdThisMonth = rows.filter((s) => s.paymentStatus === "paid" && s.createdAt && s.createdAt.toDate() >= new Date(Date.parse(`${monthStart}T00:00:00+05:30`)));
    const gmvMonth = createdThisMonth.reduce((sum, s) => sum + (s.paidAmountPaise ?? s.amountPaise ?? 0), 0);
    const since30 = Date.now() - 30 * 86_400_000;
    const cancelled30 = rows.filter((s) => s.status === "cancelled" && (s.cancelledAt?.toMillis?.() ?? 0) >= since30).length;
    const new30 = rows.filter((s) => (s.paymentStatus === "paid" || s.paymentStatus === "free") && (s.createdAt?.toMillis?.() ?? 0) >= since30).length;
    const refunds = rows.filter((s) => s.refund?.status === "pending" || s.refund?.status === "failed");
    const ending = active.filter((s) => daysLeft(s) <= 3);
    const pendingPayout = settlements.rows.filter((s) => s.status === "pending" || s.status === "error");

    const byKitchen = new Map<string, MessSub[]>();
    rows.forEach((s) => {
      if (!s.kitchenId) return;
      byKitchen.set(s.kitchenId, [...(byKitchen.get(s.kitchenId) ?? []), s]);
    });

    const board = live
      .map((k) => {
        const ks = byKitchen.get(k.id) ?? [];
        const act = ks.filter((s) => s.status === "active");
        const hc = headcount(ks, today);
        const fee = (k.feePerCustomerPerDayPaise ?? DEFAULT_FEE) * hc.people;
        const cap = k.messSettings?.capacity ?? {};
        const capUse = Math.max(
          0,
          ...(["breakfast", "lunch", "dinner"] as const).map((m) => {
            const c = Number(cap[m] ?? 0);
            return c > 0 ? act.filter((s) => (s.plan?.meals ?? []).includes(m)).length / c : 0;
          }),
        );
        const menuDays = Object.values(k.weeklyMenu ?? {}).filter((d) => Object.values(d ?? {}).some((v) => String(v).trim())).length;
        const issues: string[] = [];
        // Plans live in a per-kitchen subcollection with no admin collection-
        // group rule, so "never sold anything" stands in for "no live plan".
        if (ks.length === 0) issues.push("no subscribers yet");
        if (menuDays < 7) issues.push(menuDays ? `menu ${menuDays}/7` : "no menu");
        if (!(k.fcmTokens?.length)) issues.push("no push");
        if (k.messSettings?.acceptingSubscribers === false) issues.push("not accepting");
        if ((k.holidays ?? []).includes(today)) issues.push("closed today");
        if ((k.ratingCount ?? 0) >= 3 && (k.ratingAvg ?? 5) < 3.5) issues.push(`rated ${(k.ratingAvg ?? 0).toFixed(1)}★`);
        if (!k.planSummary) issues.push("summary pending");
        if (capUse >= 0.9) issues.push(`${Math.round(capUse * 100)}% full`);
        return { k, active: act.length, hc, fee, issues, capUse };
      })
      .sort((a, b) => b.active - a.active);

    return { active, live, nowCount, tmrCount, feeToday, gmvMonth, cancelled30, new30, refunds, ending, pendingPayout, board };
  }, [subs.rows, kitchens.rows, settlements.rows, today, tomorrow, monthStart]);

  const churn = data.new30 + data.cancelled30 === 0 ? 0 : Math.round((data.cancelled30 / Math.max(1, data.active.length + data.cancelled30)) * 100);
  const alerts = [
    data.refunds.length && { tone: "rose", text: `${data.refunds.length} refund${data.refunds.length === 1 ? "" : "s"} waiting (${inr(data.refunds.reduce((s, r) => s + (r.refund?.amountPaise ?? 0), 0))})`, to: "/admin/mess?tab=subscriptions&view=refunds" },
    data.pendingPayout.length && { tone: "amber", text: `${data.pendingPayout.length} kitchen settlement${data.pendingPayout.length === 1 ? "" : "s"} to pay (${inr(data.pendingPayout.reduce((s, r) => s + (r.netPayoutPaise ?? 0), 0))})`, to: "/admin/mess?tab=settlements" },
    data.ending.length && { tone: "amber", text: `${data.ending.length} plan${data.ending.length === 1 ? "" : "s"} end within 3 days — renewal reminders go out at 10:00`, to: "/admin/mess?tab=subscriptions&view=ending" },
    data.board.filter((b) => b.issues.length).length && { tone: "slate", text: `${data.board.filter((b) => b.issues.length).length} live kitchen(s) need attention — see the table`, to: "" },
  ].filter(Boolean) as Array<{ tone: string; text: string; to: string }>;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Mess overview"
        description="Plates cooked today across every kitchen, what Kada earns, and what needs ops."
        icon={LayoutDashboard}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const r = await messAction<{ kitchens: number }>("backfillSummaries", {});
                toast.success(`Recomputed plan summaries and ratings for ${r.kitchens} kitchens.`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't recompute");
              }
            }}
          >
            Recompute summaries
          </Button>
        }
        stats={[
          { label: "Live kitchens", value: data.live.length, icon: ChefHat, hint: `${kitchens.rows.length} total` },
          { label: "Active subscribers", value: data.active.length, icon: Users, tone: "text-emerald-600", hint: `+${data.new30} in 30 days` },
          { label: "Plates today", value: data.nowCount.breakfast + data.nowCount.lunch + data.nowCount.dinner, icon: Utensils, hint: `${data.nowCount.breakfast} B · ${data.nowCount.lunch} L · ${data.nowCount.dinner} D` },
          { label: "Kada fee today", value: inr(data.feeToday), icon: IndianRupee, tone: "text-emerald-600", hint: "served subscribers × fee" },
          { label: "Sold this month", value: inr(data.gmvMonth), icon: HandCoins, hint: "paid plans, by purchase date" },
          { label: "Tomorrow", value: data.tmrCount.people, icon: Hourglass, hint: `${data.tmrCount.lunch} lunches · skips so far` },
          { label: "30-day churn", value: `${churn}%`, icon: TrendingDown, tone: churn > 20 ? "text-rose-600" : undefined, hint: `${data.cancelled30} cancelled` },
        ]}
      />

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => {
            const body = (
              <div
                className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
                  a.tone === "rose" ? "border-rose-300 bg-rose-50 dark:bg-rose-950/30" : a.tone === "amber" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : "bg-muted/40"
                }`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="flex-1">{a.text}</span>
                {a.to && <span className="text-xs underline">Open</span>}
              </div>
            );
            return a.to ? <Link key={i} to={a.to}>{body}</Link> : <div key={i}>{body}</div>;
          })}
        </div>
      )}

      <div className="rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[12px] text-muted-foreground">
            <tr>
              <th className="p-3">Kitchen</th>
              <th className="p-3">Active</th>
              <th className="p-3">Today (B · L · D)</th>
              <th className="p-3">Kada / day</th>
              <th className="p-3">Needs</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {data.board.length === 0 && (
              <tr>
                <td className="p-6 text-center text-muted-foreground" colSpan={6}>
                  No live kitchens yet. Approve applications in the Onboarding tab.
                </td>
              </tr>
            )}
            {data.board.map(({ k, active, hc, fee, issues }) => (
              <tr key={k.id} className="border-t">
                <td className="p-3">
                  <div className="font-medium">{kitchenName(k)}</div>
                  <div className="text-[11px] text-muted-foreground">{k.area || k.locality || "—"}</div>
                </td>
                <td className="p-3 tabular-nums">{active}</td>
                <td className="p-3 tabular-nums">
                  {(k.holidays ?? []).includes(today) ? <Badge variant="outline">closed</Badge> : `${hc.breakfast} · ${hc.lunch} · ${hc.dinner}`}
                </td>
                <td className="p-3 tabular-nums">{inr(fee)}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {issues.length === 0 ? <span className="text-emerald-600 text-xs">All good</span> : issues.map((x) => <Badge key={x} variant="outline" className="text-[10px]">{x}</Badge>)}
                  </div>
                </td>
                <td className="p-3 text-right">
                  <Link className="text-xs underline" to={`/admin/mess?tab=subscriptions&kitchenId=${k.id}`}>
                    Subscribers
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
