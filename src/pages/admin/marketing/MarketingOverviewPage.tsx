import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getCountFromServer, getDoc, getDocs, query, where, type QueryConstraint } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { StatCards } from "@/components/admin/StatCards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowUpRight, Ban, Bell, CalendarRange, CheckCircle2, CircleAlert, CircleDashed, Loader2, Mail,
  MailCheck, Megaphone, MousePointerClick, RefreshCw, Smartphone, Target, Ticket, Users, Wallet,
} from "lucide-react";
import { comms, num, pct } from "../comms/commsApi";
import {
  BRAND_DOC, PLAN_COLLECTION, SOURCE_META, inr, loadMarketingEvents, type MarketingEvent,
} from "./marketingData";
import { cn } from "@/lib/utils";

async function count(path: string, ...filters: QueryConstraint[]): Promise<number | null> {
  try {
    const c = await getCountFromServer(filters.length ? query(collection(db, path), ...filters) : collection(db, path));
    return c.data().count;
  } catch {
    return null;
  }
}

interface EmailHealth {
  providerConfigured: boolean;
  webhookSecret: boolean;
  domains: { ok: boolean; domains: { status: string }[] };
  switches: { pauseAll: boolean; pauseMarketing: boolean };
  last30d: { reached: number; openRate: number | null; clickRate: number | null; complaintRate: number | null; bounceRate: number | null };
  thresholds: { complaintRate: number; bounceRate: number };
}

interface Snapshot {
  customers: number | null;
  emailOptIns: number | null;
  emailProfiles: number | null;
  pushDevices: number | null;
  suppressed: number | null;
  activeCoupons: number | null;
  liveAds: number | null;
  liveBanners: number | null;
  templates: number | null;
  brandSaved: boolean;
  autopilotOn: boolean;
  budget: number;
  spent: number;
  livePlans: number;
}

const DAY = 86_400_000;

function Check({ state, label, detail, to }: { state: "ok" | "warn" | "bad"; label: string; detail: string; to?: string }) {
  const Icon = state === "ok" ? CheckCircle2 : state === "warn" ? CircleDashed : CircleAlert;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0">
      <Icon className={cn("h-4.5 w-4.5 mt-0.5 shrink-0",
        state === "ok" ? "text-emerald-500" : state === "warn" ? "text-amber-500" : "text-rose-500")} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
      </div>
      {to && state !== "ok" && (
        <Link to={to} className="text-xs font-semibold text-primary shrink-0 hover:underline">Fix</Link>
      )}
    </div>
  );
}

/**
 * Marketing command centre — who we can reach, what's running, what's next,
 * and whether the stack is fit to send. Every figure is a live count or the
 * email platform's own health check; anything unreadable shows "—".
 */
export default function MarketingOverviewPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [health, setHealth] = useState<EmailHealth | null>(null);
  const [events, setEvents] = useState<MarketingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      customers, emailOptIns, emailProfiles, pushDevices, suppressed, activeCoupons, liveAds, liveBanners, templates,
      brand, plans, feed, h, autopilot,
    ] = await Promise.all([
      count("customer_users"),
      count("communicationProfiles", where("userType", "==", "CUSTOMER"), where("channels.marketing", "==", true)),
      count("communicationProfiles", where("userType", "==", "CUSTOMER")),
      count("notification_devices"),
      count("emailSuppressions"),
      count("promos", where("active", "==", true)),
      count("platform_ads", where("active", "==", true)),
      count("home_collections", where("active", "==", true)),
      count("emailTemplates"),
      getDoc(doc(db, ...BRAND_DOC)).then((d) => d.exists()).catch(() => false),
      getDocs(collection(db, PLAN_COLLECTION)).then((s) => s.docs.map((d) => d.data())).catch(() => []),
      loadMarketingEvents(),
      comms<EmailHealth>("health").catch(() => null),
      getDoc(doc(db, "marketing_settings", "autopilot")).then((d) => d.data()?.enabled === true).catch(() => false),
    ]);
    const active = plans.filter((p) => p.status !== "cancelled");
    setSnap({
      customers, emailOptIns, emailProfiles, pushDevices, suppressed, activeCoupons, liveAds, liveBanners, templates,
      brandSaved: brand,
      autopilotOn: autopilot,
      budget: active.reduce((s, p) => s + (Number(p.budget) || 0), 0),
      spent: active.reduce((s, p) => s + (Number(p.spent) || 0), 0),
      livePlans: plans.filter((p) => p.status === "live").length,
    });
    setEvents(feed);
    setHealth(h);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => e.start.getTime() >= now - DAY && e.start.getTime() <= now + 14 * DAY).slice(0, 12);
  }, [events]);

  if (loading && !snap) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading marketing overview…
      </div>
    );
  }
  const s = snap!;
  const optInRate = s.emailOptIns !== null && s.emailProfiles ? s.emailOptIns / s.emailProfiles : null;
  const l = health?.last30d;
  const complaintHigh = !!(l && l.complaintRate !== null && health && l.complaintRate > health.thresholds.complaintRate);
  const domainOk = !!health?.domains?.ok && (health.domains.domains || []).some((d) => d.status === "verified");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Marketing overview</h2>
          <p className="text-sm text-muted-foreground">Reach, what's live and what's next — across email, push, coupons, ads and banners.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Refresh
        </Button>
      </div>

      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reach</p>
        <StatCards stats={[
          { label: "Customers", value: s.customers === null ? "—" : num(s.customers), icon: Users, hint: "Customer accounts" },
          {
            label: "Email opt-ins", value: s.emailOptIns === null ? "—" : num(s.emailOptIns), icon: MailCheck, tone: "text-sky-600",
            hint: optInRate === null ? "Customers who said yes to offers" : `${pct(optInRate)} of customer email profiles`,
          },
          { label: "Push devices", value: s.pushDevices === null ? "—" : num(s.pushDevices), icon: Smartphone, tone: "text-violet-600", hint: "Registered app installs" },
          { label: "Suppressed emails", value: s.suppressed === null ? "—" : num(s.suppressed), icon: Ban, tone: "text-rose-600", hint: "Unsubscribed, bounced or reported" },
        ]} />
      </section>

      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Running now</p>
        <StatCards stats={[
          { label: "Active coupons", value: s.activeCoupons === null ? "—" : num(s.activeCoupons), icon: Ticket, tone: "text-amber-600" },
          { label: "Live ads", value: s.liveAds === null ? "—" : num(s.liveAds), icon: Megaphone, tone: "text-rose-600" },
          { label: "Home banners", value: s.liveBanners === null ? "—" : num(s.liveBanners), icon: Target },
          { label: "Plan budget", value: inr(s.budget), icon: Wallet, hint: s.budget ? `${inr(s.spent)} spent · ${s.livePlans} live plans` : "Add budgets in Planner" },
        ]} />
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="rounded-2xl lg:col-span-3">
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><CalendarRange className="h-4 w-4" />Next 14 days</CardTitle>
            <Link to="/admin/growth?tab=planner" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
              Open planner <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nothing scheduled. Plan the next campaign in Planner so the whole team sees it.
              </p>
            ) : (
              <ul className="divide-y">
                {upcoming.map((e) => (
                  <li key={e.id} className="py-2.5 flex items-center gap-3">
                    <div className="w-14 shrink-0 text-center">
                      <p className="text-[10px] uppercase text-muted-foreground">{e.start.toLocaleDateString("en-IN", { weekday: "short" })}</p>
                      <p className="text-sm font-bold">{e.start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0", SOURCE_META[e.source].chip)}>{SOURCE_META[e.source].label}</Badge>
                    <Link to={e.href} className="min-w-0 flex-1 text-sm font-medium truncate hover:underline">{e.title}</Link>
                    <span className="text-xs text-muted-foreground capitalize shrink-0">{e.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Email, last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            {!l ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Email stats are unavailable right now.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Delivered" value={num(l.reached)} />
                <Metric label="Open rate" value={pct(l.openRate)} hint="Apple Mail inflates opens" />
                <Metric label="Click rate" value={pct(l.clickRate)} icon={<MousePointerClick className="h-3.5 w-3.5" />} />
                <Metric
                  label="Complaint rate" value={pct(l.complaintRate, 2)}
                  tone={complaintHigh ? "text-rose-600" : undefined}
                  hint={`Gmail/Yahoo limit 0.3% · ours ${pct(health!.thresholds.complaintRate, 2)}`}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-1">
          <CardTitle className="text-base">Stack readiness</CardTitle>
          <p className="text-xs text-muted-foreground">What a marketing team needs before it can send at scale. Each line is checked live.</p>
        </CardHeader>
        <CardContent className="grid gap-x-8 md:grid-cols-2">
          <div>
            <Check
              state={health?.providerConfigured ? "ok" : "bad"} label="Email provider connected"
              detail={health?.providerConfigured ? "Bulk sending goes through the provider API." : "Set RESEND_API_KEY — the Gmail fallback can't send campaigns at volume."}
              to="/admin/growth?tab=email&section=settings"
            />
            <Check
              state={domainOk ? "ok" : "bad"} label="Sending domain authenticated (SPF, DKIM, DMARC)"
              detail={domainOk ? "Gmail, Yahoo and Outlook accept bulk mail from it." : "Bulk senders must authenticate the domain or mail is rejected."}
              to="/admin/growth?tab=email"
            />
            <Check
              state={health?.webhookSecret ? "ok" : "bad"} label="Bounce & complaint feedback"
              detail={health?.webhookSecret ? "Bounces and spam reports suppress the address automatically." : "Set RESEND_WEBHOOK_SECRET so bounces and complaints are recorded."}
            />
            <Check
              state={complaintHigh ? "bad" : l ? "ok" : "warn"} label="Complaint rate under limit"
              detail={l ? `${pct(l.complaintRate, 2)} in the last 30 days.` : "No email stats yet."}
            />
            <Check
              state={health?.switches?.pauseMarketing || health?.switches?.pauseAll ? "warn" : "ok"} label="Marketing sends enabled"
              detail={health?.switches?.pauseMarketing || health?.switches?.pauseAll ? "A kill switch is on — campaigns are paused." : "No kill switch is on."}
              to="/admin/growth?tab=email&section=settings"
            />
          </div>
          <div>
            <Check
              state={s.autopilotOn ? "ok" : "warn"} label="Marketing autopilot on"
              detail={s.autopilotOn ? "Lifecycle journeys, occasion campaigns, guard rails and the weekly digest run by themselves." : "Turn it on so journeys and occasion campaigns run without anyone remembering them."}
              to="/admin/growth?tab=autopilot"
            />
            <Check
              state={(s.emailOptIns ?? 0) > 0 ? "ok" : "warn"} label="Customers can opt in"
              detail={(s.emailOptIns ?? 0) > 0 ? "Opt-ins are arriving from app settings and the preference page." : "No opt-ins yet. The customer app's Settings → Email section is how customers join."}
              to="/admin/growth?tab=audience"
            />
            <Check
              state={(s.templates ?? 0) > 0 ? "ok" : "bad"} label="Email templates seeded"
              detail={(s.templates ?? 0) > 0 ? `${num(s.templates)} templates.` : "Nothing sends until templates exist — seed the defaults."}
              to="/admin/growth?tab=email&section=templates"
            />
            <Check
              state={(s.pushDevices ?? 0) > 0 ? "ok" : "warn"} label="Push audience"
              detail={(s.pushDevices ?? 0) > 0 ? `${num(s.pushDevices)} devices registered.` : "No devices registered for push."}
            />
            <Check
              state={s.brandSaved ? "ok" : "warn"} label="Brand kit written down"
              detail={s.brandSaved ? "Voice, colours and claims rules are saved for the team." : "Save the brand kit so every campaign sounds like The Kada."}
              to="/admin/growth?tab=brand"
            />
            <Check
              state={events.some((e) => e.source === "plan") ? "ok" : "warn"} label="Campaigns planned with a goal"
              detail={events.some((e) => e.source === "plan") ? "Plans carry a goal, KPI and budget." : "Write a brief in Planner before building the next campaign."}
              to="/admin/growth?tab=planner"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { to: "/admin/growth?tab=email&section=campaigns", label: "Send an email campaign", icon: Mail },
          { to: "/admin/growth?tab=notifications", label: "Send a push", icon: Bell },
          { to: "/admin/growth?tab=promos", label: "Create a coupon", icon: Ticket },
          { to: "/admin/growth?tab=links", label: "Make a tracked link / QR", icon: Target },
        ].map((a) => (
          <Link key={a.to} to={a.to}
            className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted/50 transition-colors">
            <a.icon className="h-4 w-4 text-primary" /> {a.label}
            <ArrowUpRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, hint, tone, icon }: { label: string; value: string; hint?: string; tone?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">{icon}{label}</p>
      <p className={cn("text-xl font-bold mt-1", tone)}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}
