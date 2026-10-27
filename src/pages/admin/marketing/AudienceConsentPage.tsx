import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, where, type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, CircleDashed, Loader2, MinusCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { num, pct, when } from "../comms/commsApi";
import { cn } from "@/lib/utils";

const USER_TYPES = [
  { v: "CUSTOMER", label: "Customers" },
  { v: "VENDOR", label: "Restaurants" },
  { v: "DELIVERY_PARTNER", label: "Riders" },
  { v: "HOST", label: "Hosts" },
];

const CHANNELS = [
  { key: "marketing", label: "Offers & recommendations" },
  { key: "announcements", label: "Product news" },
  { key: "newsletter", label: "Newsletter" },
];

// Where an opt-in came from — the values setMarketingConsent records.
const SOURCES = [
  { key: "app_settings", label: "App settings" },
  { key: "preference_center", label: "Email preference page" },
];

const REASONS = [
  { key: "unsubscribed", label: "Unsubscribed", hint: "Lifted automatically if they opt back in" },
  { key: "hard_bounce", label: "Hard bounce", hint: "Address doesn't exist" },
  { key: "spam_complaint", label: "Spam complaint", hint: "Never mail again without a fresh opt-in" },
  { key: "invalid", label: "Invalid", hint: "Malformed address" },
  { key: "blocked", label: "Blocked", hint: "Provider refused it" },
  { key: "manual", label: "Manual", hint: "Added by an admin" },
];

async function count(path: string, ...f: QueryConstraint[]): Promise<number | null> {
  try {
    return (await getCountFromServer(query(collection(db, path), ...f))).data().count;
  } catch {
    return null;
  }
}

interface AuditRow { id: string; action?: string; target?: string; via?: string; channels?: Record<string, boolean>; at?: { toMillis?: () => number } }
interface Settings { quietHoursStart?: number; quietHoursEnd?: number; maxMarketingPerDay?: number; maxMarketingPerWeek?: number; postalAddress?: string }

const hour = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "am" : "pm"}`;

type State = "done" | "partial" | "na";
function Rule({ state, title, body, source }: { state: State; title: string; body: string; source: string }) {
  const Icon = state === "done" ? CheckCircle2 : state === "partial" ? CircleDashed : MinusCircle;
  return (
    <div className="flex gap-3 py-3 border-b last:border-0">
      <Icon className={cn("h-4.5 w-4.5 mt-0.5 shrink-0",
        state === "done" ? "text-emerald-500" : state === "partial" ? "text-amber-500" : "text-muted-foreground")} />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
        <p className="text-[10px] text-muted-foreground/80 mt-1 uppercase tracking-wide">{source}</p>
      </div>
    </div>
  );
}

/**
 * Audience & consent — how many people said yes, where they said it, who
 * can't be mailed and why, and the rules the send pipeline enforces. Marketing
 * reaches only profiles with channels.<x> == true; nothing here can opt
 * anyone in — consent comes from the person, never from an admin.
 */
export default function AudienceConsentPage() {
  const [userType, setUserType] = useState("CUSTOMER");
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<number | null>(null);
  const [channels, setChannels] = useState<Record<string, number | null>>({});
  const [sources, setSources] = useState<Record<string, number | null>>({});
  const [reasons, setReasons] = useState<Record<string, number | null>>({});
  const [recent, setRecent] = useState<AuditRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const ut = where("userType", "==", userType);
    const [total, chan, src, rsn, audit, set] = await Promise.all([
      count("communicationProfiles", ut),
      Promise.all(CHANNELS.map((c) => count("communicationProfiles", ut, where(`channels.${c.key}`, "==", true)))),
      Promise.all(SOURCES.map((s) => count("communicationProfiles", ut,
        where("marketingConsent.enabled", "==", true), where("marketingConsent.source", "==", s.key)))),
      Promise.all(REASONS.map((r) => count("emailSuppressions", where("reason", "==", r.key)))),
      getDocs(query(collection(db, "communicationAuditLogs"), orderBy("at", "desc"), limit(150)))
        .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditRow)).catch(() => []),
      getDoc(doc(db, "communicationSettings", "email")).then((d) => (d.data() as Settings) ?? {}).catch(() => null),
    ]);
    setProfiles(total);
    setChannels(Object.fromEntries(CHANNELS.map((c, i) => [c.key, chan[i]])));
    setSources(Object.fromEntries(SOURCES.map((s, i) => [s.key, src[i]])));
    setReasons(Object.fromEntries(REASONS.map((r, i) => [r.key, rsn[i]])));
    setRecent(audit.filter((a) => a.action === "preferences_updated" || a.action === "unsubscribed_all").slice(0, 25));
    setSettings(set);
    setLoading(false);
  }, [userType]);

  useEffect(() => { load(); }, [load]);

  const qStart = settings?.quietHoursStart ?? 21;
  const qEnd = settings?.quietHoursEnd ?? 9;
  const perDay = settings?.maxMarketingPerDay ?? 2;
  const perWeek = settings?.maxMarketingPerWeek ?? 5;
  const optedIn = channels.marketing ?? null;
  const knownSources = SOURCES.reduce((s, x) => s + (sources[x.key] ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Audience & consent</h2>
          <p className="text-sm text-muted-foreground">Who agreed to hear from us, where they agreed, and who we must not mail.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={userType} onValueChange={setUserType}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{USER_TYPES.map((u) => <SelectItem key={u.v} value={u.v}>{u.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Email opt-in by channel</CardTitle>
            <p className="text-xs text-muted-foreground">Out of {profiles === null ? "—" : num(profiles)} {USER_TYPES.find((u) => u.v === userType)?.label.toLowerCase()} with an email profile. Everything starts off.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {CHANNELS.map((c) => {
              const n = channels[c.key];
              const rate = n !== null && n !== undefined && profiles ? n / profiles : null;
              return (
                <div key={c.key}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{c.label}</span>
                    <span className="text-muted-foreground">{n === null || n === undefined ? "—" : num(n)} · {pct(rate)}</span>
                  </div>
                  <Progress value={rate === null ? 0 : rate * 100} className="h-2 mt-1.5" />
                </div>
              );
            })}
            <div className="flex items-center justify-between text-sm border-t pt-3">
              <span className="font-medium">Orders, payments & account</span>
              <Badge variant="outline" className="text-[10px]">Always on · not marketing</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Where opt-ins came from</CardTitle>
            <p className="text-xs text-muted-foreground">Current opt-ins to offers, by the place the person said yes.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {SOURCES.map((s) => (
              <div key={s.key} className="flex items-center justify-between text-sm">
                <span>{s.label}</span>
                <span className="font-semibold">{sources[s.key] === null || sources[s.key] === undefined ? "—" : num(sources[s.key])}</span>
              </div>
            ))}
            {optedIn !== null && optedIn > knownSources && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Earlier, before sources were recorded</span>
                <span className="font-semibold">{num(optedIn - knownSources)}</span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground border-t pt-3">
              Each change is kept with its source, method and time in the profile's consent history — the record you'd show if anyone asks when they agreed.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Suppression list</CardTitle>
          <Link to="/admin/growth?tab=email&section=activity" className="text-xs font-semibold text-primary hover:underline">Manage</Link>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {REASONS.map((r) => (
            <div key={r.key} className="rounded-xl border bg-muted/30 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.label}</p>
              <p className="text-xl font-bold mt-1">{reasons[r.key] === null || reasons[r.key] === undefined ? "—" : num(reasons[r.key])}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{r.hint}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="rounded-2xl lg:col-span-3">
          <CardHeader className="pb-1">
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Rules we follow</CardTitle>
            <p className="text-xs text-muted-foreground">What the law and the inbox providers ask, and where we stand.</p>
          </CardHeader>
          <CardContent>
            <Rule state="done" title="Opt-in is explicit and off by default"
              body="No toggle starts on and no admin can opt someone in. Consent is a clear action by the person, for a stated purpose."
              source="DPDP Act 2023 — consent" />
            <Rule state="done" title="Withdrawing is as easy as agreeing"
              body="The same toggle in the app, a preference link and a one-click unsubscribe in every marketing email. Unsubscribes apply immediately."
              source="DPDP Act 2023 · Gmail/Yahoo bulk-sender rules (RFC 8058)" />
            <Rule state="done" title="Consent is recorded"
              body="Every change stores who, when, where (source) and how (method), plus the consent text version."
              source="DPDP Rules 2025 — consent records" />
            <Rule state="done" title="Service mail is separate from marketing"
              body="Receipts, refunds and security alerts always send; they never carry promotions."
              source="Good practice · keeps transactional deliverability clean" />
            <Rule state="partial" title="Domain authenticated and complaints under 0.3%"
              body="SPF, DKIM and DMARC on the sending domain; spam reports kept well under 0.3%. Check the live status on the Overview tab."
              source="Gmail · Yahoo · Outlook bulk-sender requirements" />
            <Rule state="done" title={`Quiet hours ${hour(qStart)}–${hour(qEnd)}, at most ${perDay}/day and ${perWeek}/week`}
              body="Marketing is held overnight and capped per person, enforced in the send pipeline."
              source="Email → Settings" />
            <Rule state="na" title="Promotional SMS and WhatsApp"
              body="Not sent today. Before adding them: DLT registration with a telecom operator, approved templates and a promotional header (SMS), and WhatsApp opt-in per Meta's policy."
              source="TRAI TCCCPR 2018 · WhatsApp Business policy" />
          </CardContent>
        </Card>

        <Card className="rounded-2xl lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent preference changes</CardTitle>
            <p className="text-xs text-muted-foreground">All user types, newest first.</p>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No preference changes yet.</p>
            ) : (
              <ul className="divide-y">
                {recent.map((r) => {
                  const on = Object.entries(r.channels || {}).filter(([k, v]) => v && k !== "transactional").map(([k]) => k);
                  return (
                    <li key={r.id} className="py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{r.action === "unsubscribed_all" ? "Unsubscribed from all" : on.length ? `On: ${on.join(", ")}` : "All marketing off"}</span>
                        <span className="text-muted-foreground shrink-0">{when(r.at)}</span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 font-mono truncate">
                        {r.target} · {r.via === "app" ? "app settings" : r.via === "token" ? "email link" : r.via || "—"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
