import { useState } from "react";
import { CalendarPlus, Ban, CheckCircle2, MapPin, Phone, RefreshCw, Undo2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  REFUND_TONE,
  STATUS_TONE,
  addDays,
  customerName,
  customerPhone,
  dayKey,
  daysLeft,
  fmtDay,
  fmtTs,
  inr,
  messAction,
  todayKey,
  type MessSub,
} from "./messAdmin";

type Panel = null | "extend" | "cancel" | "decline";

/**
 * One subscription, end to end — the support desk's answer to "am I paying
 * for meals I'm not getting?": what was bought, every skip and who made it,
 * closures credited, the refund and its state, and the actions ops can take.
 * Every action goes through adminMessAction and lands on the record's adminLog.
 */
export function MessSubscriptionSheet({ sub, onClose }: { sub: MessSub | null; onClose: () => void }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [refundMode, setRefundMode] = useState<"prorata" | "full" | "none">("prorata");
  const [overrideRupees, setOverrideRupees] = useState("");

  const s = sub;
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      setPanel(null);
      setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };

  const today = todayKey();
  const window14 = Array.from({ length: 21 }, (_, i) => addDays(today, i - 7));
  const startKey = s?.startDate ? dayKey(s.startDate.toDate()) : "";
  const endKey = s?.endDate ? dayKey(s.endDate.toDate()) : "";
  const refund = s?.refund;
  const paid = s?.paidAmountPaise ?? s?.amountPaise ?? 0;

  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {s && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 flex-wrap">
                {customerName(s)}
                <Badge className={STATUS_TONE[s.status ?? ""] ?? "bg-slate-500"}>{(s.status ?? "").replace("_", " ")}</Badge>
                {s.isTrial && <Badge variant="outline">Trial</Badge>}
              </SheetTitle>
              <SheetDescription>
                {s.plan?.name ?? "Meal plan"} at {s.kitchenName ?? s.kitchenId} · {(s.plan?.meals ?? []).join(" · ")}
                {s.plan?.vegOnly ? " · veg" : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-5 text-sm">
              <section className="grid grid-cols-2 gap-3">
                <Fact label="Paid" value={s.isTrial ? "Free trial" : inr(paid)} hint={s.paymentStatus} />
                <Fact label="Kada fee / day" value={inr(s.platformFeePerDayPaise)} />
                <Fact label="Runs" value={`${fmtTs(s.startDate)} – ${endKey ? fmtDay(addDays(endKey, -1)) : "—"}`} hint={s.status === "active" ? `${daysLeft(s)} days left` : undefined} />
                <Fact
                  label="Skipped / closed"
                  value={`${s.skippedDays?.length ?? 0} / ${s.holidayDays?.length ?? 0}`}
                  hint={s.bonusDays ? `+${s.bonusDays} goodwill days` : undefined}
                />
              </section>

              <section className="rounded-xl border p-3 space-y-1.5">
                <div className="font-medium">Delivery</div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="w-3.5 h-3.5" />
                  {customerPhone(s) ? <a className="underline" href={`tel:${customerPhone(s)}`}>{customerPhone(s)}</a> : "No phone on record"}
                </div>
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5 mt-0.5" />
                  <span>
                    {s.customer?.address || "No address (subscribed before addresses were captured)"}
                    {s.customer?.lat != null && s.customer?.lng != null && (
                      <a className="ml-2 underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${s.customer.lat},${s.customer.lng}`}>
                        map
                      </a>
                    )}
                  </span>
                </div>
                {s.customer?.note && <div className="text-muted-foreground">Note: {s.customer.note}</div>}
              </section>

              <section>
                <div className="font-medium mb-2">Three weeks around today</div>
                <div className="grid grid-cols-7 gap-1.5">
                  {window14.map((k) => {
                    const inPlan = !!startKey && !!endKey && k >= startKey && k < endKey;
                    const skipped = s.skippedDays?.includes(k);
                    const closed = s.holidayDays?.includes(k);
                    const cancelled = !!s.cancelFrom && k >= s.cancelFrom;
                    const tone = !inPlan || cancelled
                      ? "bg-muted text-muted-foreground"
                      : closed
                        ? "bg-slate-300 text-slate-700"
                        : skipped
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
                    const canToggle = inPlan && !closed && !cancelled && k >= today && s.status === "active";
                    return (
                      <button
                        key={k}
                        disabled={!canToggle || busy}
                        title={canToggle ? (skipped ? "Mark eating" : "Mark away") : undefined}
                        onClick={() =>
                          run(skipped ? "Back on for that day" : "Marked away", () =>
                            messAction("skip", { subscriptionId: s.id, day: k, skip: !skipped }),
                          )
                        }
                        className={`rounded-lg px-1 py-1.5 text-center text-[11px] leading-tight ${tone} ${k === today ? "ring-2 ring-primary" : ""} ${canToggle ? "hover:opacity-80" : "cursor-default"}`}
                      >
                        <div className="font-semibold">{fmtDay(k).split(",")[0]}</div>
                        <div>{k.slice(8)}</div>
                        <div className="text-[9px]">{!inPlan ? "" : cancelled ? "stop" : closed ? "closed" : skipped ? "away" : "eat"}</div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {refund && (
                <section className="rounded-xl border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">Refund</div>
                    <Badge className={REFUND_TONE[refund.status ?? ""] ?? "bg-slate-500"}>{refund.status}</Badge>
                  </div>
                  <div className="text-muted-foreground">
                    {inr(refund.amountPaise)} for {refund.unusedDays ?? "?"} unused day(s) · requested by {refund.requestedBy}
                    {s.cancelFrom ? ` · plan stops ${fmtDay(s.cancelFrom)}` : ""}
                    {refund.error ? ` · ${refund.error}` : ""}
                    {refund.declineReason ? ` · declined: ${refund.declineReason}` : ""}
                  </div>
                  {(refund.status === "pending" || refund.status === "failed") && (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Amount (₹, optional override)</Label>
                        <Input className="w-36" type="number" min="1" value={overrideRupees} onChange={(e) => setOverrideRupees(e.target.value)} placeholder={String(Math.round((refund.amountPaise ?? 0) / 100))} />
                      </div>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run("Refund sent to Razorpay", () =>
                            messAction("approveRefund", {
                              subscriptionId: s.id,
                              ...(overrideRupees ? { amountPaise: Math.round(Number(overrideRupees) * 100) } : {}),
                            }),
                          )
                        }
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        {refund.status === "failed" ? "Retry refund" : "Approve refund"}
                      </Button>
                      <Button variant="outline" disabled={busy} onClick={() => setPanel("decline")}>
                        <XCircle className="w-4 h-4 mr-1" />
                        Decline
                      </Button>
                    </div>
                  )}
                  {refund.status === "processing" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run("Refund status refreshed", () => messAction("syncRefund", { subscriptionId: s.id }))}>
                      <RefreshCw className="w-3.5 h-3.5 mr-1" />
                      Re-check with gateway
                    </Button>
                  )}
                  {panel === "decline" && (
                    <div className="space-y-2">
                      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason the customer will read" />
                      <p className="text-[11px] text-muted-foreground">Declining lets the kitchen earn the unused days, as if the plan had run on.</p>
                      <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run("Refund declined", () => messAction("declineRefund", { subscriptionId: s.id, reason }))}>
                        Decline refund
                      </Button>
                    </div>
                  )}
                </section>
              )}

              {(s.status === "active" || s.status === "expired") && (
                <section className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setPanel(panel === "extend" ? null : "extend")}>
                    <CalendarPlus className="w-4 h-4 mr-1" />
                    Extend
                  </Button>
                  {s.status === "active" && (
                    <Button variant="outline" className="text-rose-600" onClick={() => setPanel(panel === "cancel" ? null : "cancel")}>
                      <Ban className="w-4 h-4 mr-1" />
                      Cancel plan
                    </Button>
                  )}
                </section>
              )}

              {panel === "extend" && (
                <section className="rounded-xl border p-3 space-y-2">
                  <div className="font-medium">Goodwill days</div>
                  <p className="text-[12px] text-muted-foreground">Added to the end of the plan. The kitchen is paid for them at the plan's day rate — Kada funds the gesture.</p>
                  <div className="flex gap-2">
                    <Input className="w-24" type="number" min="1" max="31" value={days} onChange={(e) => setDays(e.target.value)} />
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (goes on the record)" />
                  </div>
                  <Button disabled={busy || !reason.trim()} onClick={() => run("Plan extended", () => messAction("extend", { subscriptionId: s.id, days: Number(days), reason }))}>
                    Extend by {days} day(s)
                  </Button>
                </section>
              )}

              {panel === "cancel" && (
                <section className="rounded-xl border border-rose-300 p-3 space-y-2">
                  <div className="font-medium">Cancel from tomorrow</div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["prorata", "Refund unused days"],
                        ["full", "Full refund"],
                        ["none", "No refund"],
                      ] as const
                    ).map(([v, label]) => (
                      <Button key={v} size="sm" variant={refundMode === v ? "default" : "outline"} onClick={() => setRefundMode(v)}>
                        {label}
                      </Button>
                    ))}
                  </div>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (the customer is notified)" />
                  <p className="text-[11px] text-muted-foreground">
                    A refund is executed through Razorpay immediately. The kitchen is paid up to tonight; with "No refund" it keeps earning the remaining days.
                  </p>
                  <Button
                    variant="destructive"
                    disabled={busy || !reason.trim()}
                    onClick={() => run("Plan cancelled", () => messAction("cancel", { subscriptionId: s.id, refund: refundMode, reason }))}
                  >
                    <Undo2 className="w-4 h-4 mr-1" />
                    Cancel plan
                  </Button>
                </section>
              )}

              {(s.skipLog?.length || s.adminLog?.length) ? (
                <section>
                  <div className="font-medium mb-2">History</div>
                  <ul className="space-y-1 text-[12px] text-muted-foreground">
                    {[
                      ...(s.adminLog ?? []).map((e) => ({ at: e.at, text: `${e.action} by ${e.by}${e.reason ? ` — ${String(e.reason)}` : ""}${e.days ? ` (+${String(e.days)}d)` : ""}` })),
                      ...(s.skipLog ?? []).map((e) => ({ at: e.at, text: `${e.skip ? "Away" : "Back on"} ${fmtDay(e.day)} — by ${e.by}` })),
                    ]
                      .sort((a, b) => b.at - a.at)
                      .slice(0, 40)
                      .map((e, i) => (
                        <li key={i}>
                          <span className="tabular-nums">{new Date(e.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> · {e.text}
                        </li>
                      ))}
                  </ul>
                </section>
              ) : null}

              <p className="text-[11px] text-muted-foreground">
                {s.id} · payment {s.razorpayPaymentId ?? "—"}
                {s.cancelReason ? ` · cancelled: ${s.cancelReason} (${s.cancelledBy})` : ""}
              </p>
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
