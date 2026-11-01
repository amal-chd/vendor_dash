import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { listenCollection } from "@/hooks/useLiveCollection";
import { addDays, daysLeft, fmtDay, headcount, inr, kitchenName, todayKey, type MessKitchen, type MessReview, type MessSub } from "./messAdmin";

const WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/**
 * Kitchen 360: everything ops needs about one mess on one screen — how it is
 * set up (meals, times, capacity, cut-off, menu, plans), how it is doing
 * (subscribers, plates this week, churn, skips, rating), and what is coming
 * (closures, plans ending).
 */
export function MessKitchenSheet({ kitchen, onClose }: { kitchen: MessKitchen | null; onClose: () => void }) {
  const k = kitchen;
  const subs = { rows: useKitchenRows<MessSub>("mess_subscriptions", k?.id, 2000) };
  const reviews = { rows: useKitchenRows<MessReview>("mess_reviews", k?.id, 200) };

  const today = todayKey();
  const rows = subs.rows;
  const active = rows.filter((s) => s.status === "active");
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => ({ d, h: headcount(rows, d), closed: (k?.holidays ?? []).includes(d) }));
  const paid = rows.filter((s) => s.paymentStatus === "paid");
  const cancelled = paid.filter((s) => s.status === "cancelled").length;
  const sold = paid.reduce((t, s) => t + (s.paidAmountPaise ?? s.amountPaise ?? 0), 0);
  const ending = active.filter((s) => daysLeft(s) <= 5);
  const settings = k?.messSettings ?? {};
  const cap = settings.capacity ?? {};
  const latestReviews = [...reviews.rows].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)).slice(0, 5);

  return (
    <Sheet open={!!k} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {k && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 flex-wrap">
                {kitchenName(k)}
                <Badge variant={k.onboarding?.state === "active" ? "default" : "outline"}>{k.onboarding?.state ?? "unknown"}</Badge>
                {k.isBlocked && <Badge variant="destructive">blocked</Badge>}
                {settings.acceptingSubscribers === false && <Badge variant="outline">not accepting</Badge>}
              </SheetTitle>
              <SheetDescription>
                {[k.ownerName, k.area || k.locality, k.phone].filter(Boolean).join(" · ") || k.id}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-5 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Fact label="Active" value={String(active.length)} hint={`${ending.length} ending ≤5d`} />
                <Fact label="Sold (all time)" value={inr(sold)} hint={`${paid.length} paid plans`} />
                <Fact label="Cancelled" value={paid.length ? `${Math.round((cancelled / paid.length) * 100)}%` : "—"} hint={`${cancelled} plans`} />
                <Fact label="Rating" value={k.ratingCount ? `${(k.ratingAvg ?? 0).toFixed(1)} ★` : "New"} hint={`${k.ratingCount ?? 0} reviews`} />
              </div>

              <section>
                <div className="font-medium mb-2">Plates this week</div>
                <div className="grid grid-cols-7 gap-1.5">
                  {week.map(({ d, h, closed }) => (
                    <div key={d} className={`rounded-lg border p-2 text-center ${d === today ? "ring-2 ring-primary" : ""}`}>
                      <div className="text-[11px] text-muted-foreground">{fmtDay(d).split(",")[0]}</div>
                      <div className="font-semibold tabular-nums">{closed ? "—" : h.breakfast + h.lunch + h.dinner}</div>
                      <div className="text-[10px] text-muted-foreground">{closed ? "closed" : `${h.people} ppl`}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-xl border p-3 space-y-1">
                  <div className="font-medium">Set-up</div>
                  <Row k="Fee / customer / day" v={k.feePerCustomerPerDayPaise == null ? "₹3 (default)" : inr(k.feePerCustomerPerDayPaise)} />
                  <Row k="Plans" v={k.planSummary ? `${k.planSummary.count ?? 0} live${k.planSummary.hasTrial ? " · trial" : ""}` : "—"} />
                  <Row k="From" v={k.planSummary?.fromPerDayPaise ? `${inr(k.planSummary.fromPerDayPaise)}/day` : "—"} />
                  <Row
                    k="Capacity"
                    v={(["breakfast", "lunch", "dinner"] as const).map((m) => `${m[0].toUpperCase()} ${cap[m] ? cap[m] : "∞"}`).join(" · ")}
                  />
                  <Row k="Skip cut-off" v={settings.skipCutoffHour ? `${settings.skipCutoffHour}:00 the day before` : "midnight"} />
                  <Row
                    k="Meal times"
                    v={
                      Object.entries(k.mealTimes ?? {})
                        .filter(([, t]) => t?.enabled !== false && t?.start)
                        .map(([m, t]) => `${m.slice(0, 1).toUpperCase()} ${t.start}–${t.end ?? ""}`)
                        .join(" · ") || "—"
                    }
                  />
                  <Row k="Push" v={k.fcmTokens?.length ? `${k.fcmTokens.length} device(s)` : "not registered"} />
                </div>
                <div className="rounded-xl border p-3 space-y-1">
                  <div className="font-medium">Weekly menu</div>
                  {WEEK.map((d) => {
                    const m = k.weeklyMenu?.[d];
                    const line = m ? [m.breakfast, m.lunch, m.dinner].filter((x) => x && String(x).trim()).join(" / ") : "";
                    return <Row key={d} k={d.slice(0, 3)} v={line || "—"} />;
                  })}
                </div>
              </section>

              {(k.holidays ?? []).some((d) => d >= today) && (
                <section>
                  <div className="font-medium mb-1">Upcoming closures</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(k.holidays ?? []).filter((d) => d >= today).sort().map((d) => (
                      <Badge key={d} variant="outline">{fmtDay(d)}</Badge>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium">Latest reviews</div>
                  <Link className="text-xs underline" to="/admin/mess?tab=reviews">All reviews</Link>
                </div>
                {latestReviews.length === 0 ? (
                  <p className="text-muted-foreground">No reviews yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {latestReviews.map((r) => (
                      <li key={r.id} className="rounded-lg border p-2">
                        <div className="flex justify-between">
                          <span className="font-medium">{r.customerName || "Subscriber"}</span>
                          <span className="text-amber-500">{"★".repeat(r.rating ?? 0)}</span>
                        </div>
                        {r.text && <p className="text-muted-foreground">{r.text}</p>}
                        {r.hidden && <Badge variant="outline">hidden</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex flex-wrap gap-3 text-xs">
                <Link className="underline" to={`/admin/mess?tab=subscriptions&kitchenId=${k.id}`}>Subscribers</Link>
                <Link className="underline" to={`/admin/mess?tab=plans&kitchenId=${k.id}`}>Plans</Link>
                <Link className="underline" to="/admin/mess?tab=settlements">Settlements</Link>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-muted-foreground capitalize">{k}</span>
      <span className="min-w-0 break-words">{v}</span>
    </div>
  );
}

/** Live rows of a collection for one kitchen; empty while no kitchen is open. */
function useKitchenRows<T extends { id: string }>(path: string, kitchenId: string | undefined, limit: number): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    setRows([]);
    if (!kitchenId) return;
    return listenCollection<T>(path, { wheres: [["kitchenId", "==", kitchenId]], limit }, setRows, () => setRows([]));
  }, [path, kitchenId, limit]);
  return rows;
}
