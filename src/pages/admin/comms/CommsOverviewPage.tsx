import { useEffect, useState } from "react";
import { collection, getCountFromServer } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useChannelTab } from "./channelShell";
import { comms, commsOp, errMessage, num, pct } from "./commsApi";
import { StatCards } from "@/components/admin/StatCards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, CircleAlert, CircleDashed, Loader2, RefreshCw, Send, MailCheck, MousePointerClick,
  Eye, Ban, ShieldAlert, PauseCircle, Users, Clock, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Health {
  provider: string;
  providerConfigured: boolean;
  resendKey: boolean;
  webhookSecret: boolean;
  tokenSecret: boolean;
  webhookUrl: string;
  unsubscribeUrl: string;
  domains: { ok: boolean; error?: string; restricted?: boolean; inferredVerified?: boolean; domains: { name: string; status: string; records: { record: string; type: string; status: string }[] }[] };
  webhookLastAt?: number | null;
  resendAccount?: { ok: boolean; error?: string; at?: number | null; fallingBack?: boolean };
  reach?: { customers: number; customerProfiles: number; pushReachable: number };
  switches: { pauseAll: boolean; pauseMarketing: boolean };
  last30d: {
    accepted: number; reached: number; opened: number; clicked: number; bounced: number; complained: number;
    failed: number; skipped: number; deliveryRate: number | null; openRate: number | null; clickRate: number | null;
    bounceRate: number | null; complaintRate: number | null;
  };
  thresholds: { complaintRate: number; bounceRate: number };
  queue: { transactional: number; bulk: number; failed24h: number; failed7d?: number };
  audience: { profiles: number; optedIn: number; suppressed: number };
}

function Check({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0">
      {ok ? <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 mt-0.5 shrink-0" />
        : warn ? <CircleDashed className="h-4.5 w-4.5 text-amber-500 mt-0.5 shrink-0" />
        : <CircleAlert className="h-4.5 w-4.5 text-rose-500 mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {detail && <p className="text-xs text-muted-foreground mt-0.5 break-words">{detail}</p>}
      </div>
    </div>
  );
}

const USER_TYPES = [
  { v: "CUSTOMER", label: "Customers" },
  { v: "VENDOR", label: "Restaurants" },
  { v: "DELIVERY_PARTNER", label: "Riders" },
  { v: "HOST", label: "Hosts" },
];

/** Email overview — every number is live (Firestore aggregations, Resend API). */
export default function CommsOverviewPage() {
  const goTab = useChannelTab();
  const [h, setH] = useState<Health | null>(null);
  const [templates, setTemplates] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [job, setJob] = useState<{ label: string; done: number } | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [health, tpl] = await Promise.all([
        comms<Health>("health"),
        getCountFromServer(collection(db, "emailTemplates")).then((c) => c.data().count).catch(() => null),
      ]);
      setH(health);
      setTemplates(tpl);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  /** Page through a cursor-based server job until it reports done. */
  const runPaged = async (label: string, action: string, payload: Record<string, unknown>) => {
    let cursor: string | null = null;
    let total = 0;
    setJob({ label, done: 0 });
    try {
      for (let i = 0; i < 200; i++) {
        const res: { count?: number; repaired?: number; nextCursor: string | null } | null =
          await commsOp(action, { ...payload, cursor });
        if (!res) break;
        total += res.count ?? res.repaired ?? 0;
        setJob({ label, done: total });
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
    } finally {
      setJob(null);
      load();
    }
    return total;
  };

  const domain = h?.domains.domains.find((d) => d.name.endsWith("thekada.in")) || h?.domains.domains[0];
  const domainOk = domain?.status === "verified" || !!h?.domains.inferredVerified;
  // Delivery reports only count as working if one actually arrived lately.
  const webhookFresh = !!h?.webhookLastAt && Date.now() - h.webhookLastAt < 7 * 86400_000;
  const missingProfiles = h?.reach ? Math.max(0, h.reach.customers - h.reach.customerProfiles) : 0;
  const [busyFix, setBusyFix] = useState<string | null>(null);
  const syncProfiles = async () => {
    const r = await commsOp<Record<string, number>>("syncProfiles", {}, undefined, (b) => setBusyFix(b ? "sync" : null));
    if (r) { toast.success(`Synced ${num(Object.values(r).reduce((a, b) => a + b, 0))} accounts into marketing profiles.`); load(); }
  };
  const retryFailed = async () => {
    const r = await commsOp<{ retried: number }>("retryFailedSends", { hours: 24 }, undefined, (b) => setBusyFix(b ? "retry" : null));
    if (r) { toast.success(r.retried ? `${r.retried} failed emails are queued again — they go out within 5 minutes.` : "Nothing failed in the last 24 hours."); load(); }
  };
  const r = h?.last30d;
  const over = (v: number | null | undefined, limit: number) => v !== null && v !== undefined && v > limit;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">Platform-wide health of every email The Kada sends. Live from Firestore and Resend.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {error && (
        <Card className="border-rose-500/30"><CardContent className="p-4 text-sm text-rose-600">{error}</CardContent></Card>
      )}

      {(h?.switches.pauseAll || h?.switches.pauseMarketing) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <PauseCircle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="text-sm font-bold">{h.switches.pauseAll ? "All email is paused" : "Marketing email is paused"}</p>
                <p className="text-xs text-muted-foreground">Held emails stay queued and go out when you resume. Sign-in and security email is never held.</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => goTab("settings")}>Open settings</Button>
          </CardContent>
        </Card>
      )}

      <StatCards
        stats={[
          { label: "Sent (30 days)", value: loading ? "—" : num(r?.accepted), icon: Send, tone: "text-blue-600", hint: `${num(r?.failed)} failed · ${num(r?.skipped)} skipped by rules` },
          { label: "Delivery rate", value: loading ? "—" : pct(r?.deliveryRate), icon: MailCheck, tone: "text-emerald-600", hint: "Needs the Resend webhook" },
          { label: "Open rate", value: loading ? "—" : pct(r?.openRate), icon: Eye, tone: "text-sky-600", hint: "Apple Mail inflates opens" },
          { label: "Click rate", value: loading ? "—" : pct(r?.clickRate), icon: MousePointerClick, tone: "text-violet-600" },
          {
            label: "Bounce rate", value: loading ? "—" : pct(r?.bounceRate, 2), icon: Ban,
            tone: over(r?.bounceRate, h?.thresholds.bounceRate ?? 0.05) ? "text-rose-600" : "text-foreground",
            hint: `Keep under ${pct(h?.thresholds.bounceRate, 0)}`,
          },
          {
            label: "Spam complaints", value: loading ? "—" : pct(r?.complaintRate, 2), icon: ShieldAlert,
            tone: over(r?.complaintRate, h?.thresholds.complaintRate ?? 0.003) ? "text-rose-600" : "text-foreground",
            hint: "Gmail limit 0.3% · aim under 0.1%",
          },
          { label: "Waiting to send", value: loading ? "—" : num((h?.queue.transactional ?? 0) + (h?.queue.bulk ?? 0)), icon: Clock, tone: "text-amber-600", hint: `${num(h?.queue.failed24h)} failed in 24 h` },
          { label: "Opted in to offers", value: loading ? "—" : num(h?.audience.optedIn), icon: Users, tone: "text-blue-600", hint: `of ${num(h?.audience.profiles)} profiles · ${num(h?.audience.suppressed)} suppressed` },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-bold">Setup & deliverability checklist</CardTitle></CardHeader>
          <CardContent>
            {loading && !h ? (
              <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
            ) : h && (
              <>
                <Check ok={h.provider === "resend" && h.resendKey}
                  warn={h.provider === "smtp" && h.providerConfigured}
                  label={h.provider === "resend" ? "Sending through Resend" : "Sending through Gmail SMTP (fallback)"}
                  detail={h.provider === "resend" ? undefined : "Gmail caps volume and gives no delivery events. Set RESEND_API_KEY to switch."} />
                {h.resendAccount && !h.resendAccount.ok && (
                  <Check ok={false} warn={h.resendAccount.fallingBack}
                    label={h.resendAccount.fallingBack ? "Resend is refusing your key — service email is going through Gmail" : "Resend is refusing your API key"}
                    detail={`Resend says: "${(h.resendAccount.error || "").replace(/^\d+\s*/, "").replace(/^\{"message":"/, "").split('","')[0]}". Fix it in Resend: create an API key with sending access for your verified domain (thekada.in), then set it as the RESEND_API_KEY secret and redeploy the email functions. Until then, receipts and account email go through Gmail; marketing email waits.`} />
                )}
                <Check ok={domainOk}
                  label={domain ? `${domain.name} is ${domain.status}` : h.domains.inferredVerified ? "Sending domain verified" : "Sending domain"}
                  detail={h.domains.ok
                    ? domain ? domain.records.map((x) => `${x.record} ${x.status}`).join(" · ") : "No domain added in Resend yet."
                    : h.domains.restricted
                      ? h.domains.inferredVerified
                        ? "Your Resend key can only send, so it can't read DNS status — but Resend is accepting your mail, which it only does for a verified domain."
                        : "Your Resend key can only send, so domain status can't be read here. Check it in the Resend dashboard."
                      : h.domains.error || "Couldn't reach Resend."} />
                <Check ok={webhookFresh} warn={h.webhookSecret && !webhookFresh} label="Delivery reports from Resend"
                  detail={webhookFresh
                    ? `Last report ${new Date(h.webhookLastAt!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`
                    : `No reports have arrived${h.webhookLastAt ? " in the last week" : " yet"}. In Resend → Webhooks, add ${h.webhookUrl} for all email events and use its signing secret as RESEND_WEBHOOK_SECRET. Until then there are no delivery, open, click, bounce or complaint numbers, bounced addresses aren't suppressed, and journeys can't react to clicks.`} />
                <Check ok={h.tokenSecret} label="Signed unsubscribe links"
                  detail={h.tokenSecret ? `One-click unsubscribe (RFC 8058): ${h.unsubscribeUrl}` : "COMMS_TOKEN_SECRET is missing — unsubscribe links can't be signed."} />
                <Check ok={(templates ?? 0) > 0} label={templates ? `${templates} templates` : "No templates yet"}
                  detail={templates ? undefined : "Seed the default set from Templates — every send skips until it exists."} />
                <Check ok={!!h.reach && missingProfiles === 0} warn={missingProfiles > 0}
                  label={h.reach ? `${num(h.reach.customerProfiles)} of ${num(h.reach.customers)} customers are reachable` : `${num(h.audience.profiles)} recipient profiles`}
                  detail={missingProfiles > 0 ? `${num(missingProfiles)} customers have no marketing profile yet, so no journey or campaign can reach them. Syncing adds them with marketing off — phone-only customers can still get push.` : "Every customer account has a marketing profile."} />
                {(h.queue.failed24h ?? 0) > 0 && (
                  <Check ok={false} label={`${num(h.queue.failed24h)} emails failed in the last 24 hours`}
                    detail="Usually a provider or key problem that's since been fixed. Retrying sends them again through the normal checks." />
                )}
                <div className="flex flex-wrap gap-2 pt-3">
                  {missingProfiles > 0 && (
                    <Button size="sm" onClick={syncProfiles} disabled={busyFix === "sync"}>
                      {busyFix === "sync" && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Sync all accounts
                    </Button>
                  )}
                  {(h.queue.failed24h ?? 0) > 0 && (
                    <Button size="sm" variant="outline" onClick={retryFailed} disabled={busyFix === "retry"}>
                      {busyFix === "retry" && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Retry failed sends
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => goTab("templates")}>Templates</Button>
                  <Button size="sm" variant="outline" onClick={() => goTab("settings")}>Settings</Button>
                  <Button size="sm" variant="outline" onClick={() => goTab("activity")}>Activity</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-bold flex items-center gap-2"><Wrench className="h-4 w-4" />Data tools</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-semibold">Backfill recipient profiles</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Creates profiles for existing users so they can be found and segmented. Never changes anyone's consent — offers stay off until a person opts in.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {USER_TYPES.map((u) => (
                  <Button key={u.v} size="sm" variant="outline" disabled={!!job}
                    onClick={async () => {
                      try {
                        const n = await runPaged(`Backfilling ${u.label.toLowerCase()}`, "backfillProfiles", { userType: u.v });
                        toast.success(`${num(n)} ${u.label.toLowerCase()} profiles written.`);
                      } catch (e) {
                        toast.error(errMessage(e));
                      }
                    }}>
                    {u.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold">Repair profile fields</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Before 17 Oct 2026, opt-ins were saved under the wrong field name, so campaigns couldn't see them. Run once after deploying; safe to repeat.
              </p>
              <Button size="sm" variant="outline" className="mt-2" disabled={!!job}
                onClick={async () => {
                  try {
                    const n = await runPaged("Repairing profiles", "repairProfiles", {});
                    toast.success(`${num(n)} profiles repaired.`);
                  } catch (e) {
                    toast.error(errMessage(e));
                  }
                }}>
                Repair profiles
              </Button>
            </div>
            {job && (
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs font-semibold">{job.label}… {num(job.done)} so far</p>
                <Progress value={undefined} className={cn("h-1.5 mt-2 animate-pulse")} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
