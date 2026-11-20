import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/ui/button";
import { addDays, dayKey, headcount, inr, kitchenName, todayKey, type MessKitchen, type MessSub } from "./messAdmin";

interface Settlement {
  id: string;
  kitchenId?: string;
  status?: string;
  platformFeePaise?: number;
  netPayoutPaise?: number;
  grossPaise?: number;
  periodStart?: string;
}

const tsKey = (t?: { toDate?: () => Date }) => (t?.toDate ? dayKey(t.toDate()) : "");

/**
 * Kada Mess analytics: is the department growing, are people staying, what
 * does Kada earn, and how many plates are coming. Every number is computed
 * from mess_subscriptions / mess_settlements as they stand — nothing modelled.
 */
export default function MessAnalytics() {
  const subs = useLiveCollection<MessSub>("mess_subscriptions", { orderByField: "createdAt", limit: 5000 });
  const kitchens = useLiveCollection<MessKitchen>("mess_kitchens", { orderByField: "createdAt" });
  const settlements = useLiveCollection<Settlement>("mess_settlements", { orderByField: "createdAt", limit: 1000 });
  const [weeksBack, setWeeksBack] = useState(12);
  const [kitchenId, setKitchenId] = useState<string>("all");

  const a = useMemo(() => {
    const today = todayKey();
    const rows = subs.rows.filter((s) => kitchenId === "all" || s.kitchenId === kitchenId);
    const bought = rows.filter((s) => s.paymentStatus === "paid" || s.paymentStatus === "free");
    const paid = rows.filter((s) => s.paymentStatus === "paid");

    // Week buckets (Mon-anchored by IST day keys).
    const weekStarts: string[] = [];
    const todayStart = new Date(Date.parse(`${today}T00:00:00+05:30`));
    const dow = (new Date(todayStart.getTime() + 5.5 * 3_600_000).getUTCDay() + 6) % 7;
    const thisMonday = addDays(today, -dow);
    for (let i = weeksBack - 1; i >= 0; i--) weekStarts.push(addDays(thisMonday, -7 * i));
    const weekOf = (k: string) => {
      for (let i = weekStarts.length - 1; i >= 0; i--) if (k >= weekStarts[i]) return i;
      return -1;
    };

    const weekly = weekStarts.map((w) => ({
      week: w.slice(5),
      newPaid: 0,
      trials: 0,
      cancelled: 0,
      soldPaise: 0,
      refundedPaise: 0,
      feePaise: 0,
      active: 0,
    }));
    for (const s of bought) {
      const i = weekOf(tsKey(s.createdAt));
      if (i < 0) continue;
      if (s.paymentStatus === "free") weekly[i].trials++;
      else {
        weekly[i].newPaid++;
        weekly[i].soldPaise += s.paidAmountPaise ?? s.amountPaise ?? 0;
      }
    }
    for (const s of rows) {
      if (s.status !== "cancelled") continue;
      const i = weekOf(tsKey(s.cancelledAt));
      if (i >= 0) {
        weekly[i].cancelled++;
        weekly[i].refundedPaise += s.refund?.status === "completed" ? s.refund.amountPaise ?? 0 : 0;
      }
    }
    for (const st of settlements.rows) {
      if (st.status === "void" || (kitchenId !== "all" && st.kitchenId !== kitchenId)) continue;
      const i = weekOf((st.periodStart ?? "").slice(0, 10));
      if (i >= 0) weekly[i].feePaise += st.platformFeePaise ?? 0;
    }
    // Active subscribers on each week's Monday.
    weekStarts.forEach((w, i) => {
      weekly[i].active = bought.filter((s) => {
        const st = tsKey(s.startDate);
        const en = tsKey(s.endDate);
        const stop = s.cancelFrom && s.cancelFrom < en ? s.cancelFrom : en;
        return st && st <= w && stop > w;
      }).length;
    });

    // Plates for the next 14 days, by meal.
    const forecast = Array.from({ length: 14 }, (_, i) => {
      const k = addDays(today, i);
      const h = headcount(rows, k);
      return { day: k.slice(5), breakfast: h.breakfast, lunch: h.lunch, dinner: h.dinner };
    });

    // Retention: paid plans that ended in the last 90 days, renewed within 3 days.
    const since = addDays(today, -90);
    const ended = paid.filter((s) => {
      const en = tsKey(s.endDate);
      return s.status === "expired" && en >= since && en <= today;
    });
    const renewed = ended.filter((e) =>
      bought.some((o) => {
        if (o.id === e.id || o.customerUid !== e.customerUid || o.kitchenId !== e.kitchenId) return false;
        const st = tsKey(o.startDate);
        return st >= addDays(tsKey(e.endDate), -1) && st <= addDays(tsKey(e.endDate), 3);
      }),
    ).length;

    // Trial conversion: trial takers who later bought a paid plan at that kitchen.
    const trials = rows.filter((s) => s.paymentStatus === "free");
    const converted = trials.filter((t) =>
      paid.some((p) => p.customerUid === t.customerUid && p.kitchenId === t.kitchenId && (p.createdAt?.toMillis?.() ?? 0) > (t.createdAt?.toMillis?.() ?? 0)),
    ).length;

    // Skip rate over the last 30 days.
    let covered = 0;
    let skipped = 0;
    for (let i = 1; i <= 30; i++) {
      const k = addDays(today, -i);
      for (const s of bought) {
        const st = tsKey(s.startDate);
        const en = tsKey(s.endDate);
        if (!st || k < st || k >= en || (s.holidayDays ?? []).includes(k)) continue;
        if (s.cancelFrom && k >= s.cancelFrom) continue;
        covered++;
        if ((s.skippedDays ?? []).includes(k)) skipped++;
      }
    }

    const avgPlan = paid.length ? paid.reduce((t, s) => t + (s.paidAmountPaise ?? s.amountPaise ?? 0), 0) / paid.length : 0;
    const avgDays = paid.length ? paid.reduce((t, s) => t + (s.plan?.durationDays ?? 0), 0) / paid.length : 0;
    const refundsDone = paid.filter((s) => s.refund?.status === "completed");
    const refundRate = paid.length ? refundsDone.length / paid.length : 0;

    // Kitchen leaderboard by value sold in the window.
    const windowStart = weekStarts[0];
    const byKitchen = new Map<string, { sold: number; subs: number; cancelled: number }>();
    for (const s of subs.rows) {
      if (!s.kitchenId || (s.paymentStatus !== "paid" && s.paymentStatus !== "free")) continue;
      if (tsKey(s.createdAt) < windowStart) continue;
      const b = byKitchen.get(s.kitchenId) ?? { sold: 0, subs: 0, cancelled: 0 };
      b.subs++;
      b.sold += s.paymentStatus === "paid" ? s.paidAmountPaise ?? s.amountPaise ?? 0 : 0;
      if (s.status === "cancelled") b.cancelled++;
      byKitchen.set(s.kitchenId, b);
    }
    const leaders = [...byKitchen.entries()]
      .map(([id, v]) => ({ id, name: kitchenName(kitchens.rows.find((k) => k.id === id)) || id, ...v }))
      .sort((x, y) => y.sold - x.sold)
      .slice(0, 10);

    return {
      weekly: weekly.map((w) => ({ ...w, sold: Math.round(w.soldPaise / 100), fee: Math.round(w.feePaise / 100), refunded: Math.round(w.refundedPaise / 100) })),
      forecast,
      retention: ended.length ? Math.round((renewed / ended.length) * 100) : null,
      endedCount: ended.length,
      conversion: trials.length ? Math.round((converted / trials.length) * 100) : null,
      trialsCount: trials.length,
      skipRate: covered ? (skipped / covered) * 100 : null,
      avgPlan,
      avgDays,
      refundRate,
      leaders,
    };
  }, [subs.rows, settlements.rows, kitchens.rows, weeksBack, kitchenId]);

  const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v.toFixed(d)}%`);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Mess analytics"
        description="Growth, retention, revenue and the plates coming up — computed live from subscriptions and settlements."
        icon={BarChart3}
        stats={[
          { label: "Renewal rate", value: pct(a.retention), hint: `${a.endedCount} plans ended · 90 days` },
          { label: "Trial → paid", value: pct(a.conversion), hint: `${a.trialsCount} trials` },
          { label: "Days skipped", value: pct(a.skipRate, 1), hint: "last 30 days" },
          { label: "Avg plan", value: inr(a.avgPlan), hint: `${a.avgDays.toFixed(0)} days on average` },
          { label: "Refunded plans", value: `${(a.refundRate * 100).toFixed(1)}%`, hint: "of paid plans" },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={kitchenId} onChange={(e) => setKitchenId(e.target.value)}>
              <option value="all">All kitchens</option>
              {kitchens.rows.map((k) => (
                <option key={k.id} value={k.id}>
                  {kitchenName(k)}
                </option>
              ))}
            </select>
            {[8, 12, 26].map((w) => (
              <Button key={w} size="sm" variant={weeksBack === w ? "default" : "outline"} onClick={() => setWeeksBack(w)}>
                {w}w
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="New subscriptions per week" hint="Paid plans, trials and cancellations, by week started (IST)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={a.weekly}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} width={28} />
              <Tooltip />
              <Legend />
              <Bar dataKey="newPaid" name="Paid" stackId="a" fill="#2563eb" radius={[0, 0, 0, 0]} />
              <Bar dataKey="trials" name="Trials" stackId="a" fill="#93c5fd" radius={[4, 4, 0, 0]} />
              <Bar dataKey="cancelled" name="Cancelled" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Active subscribers" hint="On each Monday">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={a.weekly}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} width={28} />
              <Tooltip />
              <Area type="monotone" dataKey="active" name="Active" stroke="#059669" fill="#05966933" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Money per week (₹)" hint="Plans sold, Kada's fee (from settlements), refunds paid">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={a.weekly}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" fontSize={11} />
              <YAxis fontSize={11} width={48} />
              <Tooltip formatter={(v: number) => `₹${v.toLocaleString("en-IN")}`} />
              <Legend />
              <Bar dataKey="sold" name="Sold" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="fee" name="Kada fee" fill="#059669" radius={[4, 4, 0, 0]} />
              <Bar dataKey="refunded" name="Refunded" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Plates, next 14 days" hint="Skips, meal skips and closures already removed — what kitchens will cook">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={a.forecast}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} width={28} />
              <Tooltip />
              <Legend />
              <Bar dataKey="breakfast" name="Breakfast" stackId="m" fill="#fbbf24" />
              <Bar dataKey="lunch" name="Lunch" stackId="m" fill="#2563eb" />
              <Bar dataKey="dinner" name="Dinner" stackId="m" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel title="Top kitchens" hint={`By value sold in the last ${weeksBack} weeks`}>
        <table className="w-full text-sm">
          <thead className="text-left text-[12px] text-muted-foreground">
            <tr>
              <th className="py-2">Kitchen</th>
              <th className="py-2">Plans</th>
              <th className="py-2">Sold</th>
              <th className="py-2">Cancelled</th>
            </tr>
          </thead>
          <tbody>
            {a.leaders.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted-foreground">
                  No plans sold in this window.
                </td>
              </tr>
            )}
            {a.leaders.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="py-2 font-medium">{l.name}</td>
                <td className="py-2 tabular-nums">{l.subs}</td>
                <td className="py-2 tabular-nums">{inr(l.sold)}</td>
                <td className="py-2 tabular-nums">
                  {l.cancelled} {l.subs ? <span className="text-muted-foreground">({Math.round((l.cancelled / l.subs) * 100)}%)</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="mb-3">
        <div className="font-semibold">{title}</div>
        {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </section>
  );
}

