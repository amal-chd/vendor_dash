import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Bot, CheckCircle2, Clock, Loader2, Send, Smartphone, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db, functions } from "@/lib/firebase";

/**
 * Notification system health — every number here is read live. This page
 * used to show hard-coded figures ("99.8% success", "Systems Operational")
 * whatever was actually happening.
 */

type Ts = Timestamp | { toMillis?: () => number } | null | undefined;
const ms = (t: Ts) => (t && typeof (t as Timestamp).toMillis === "function" ? (t as Timestamp).toMillis() : 0);
const ago = (t: Ts) => {
  const m = ms(t);
  if (!m) return "never";
  const min = Math.round((Date.now() - m) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 2880) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
};

interface Delivery {
  id: string;
  status?: string;
  targetApp?: string;
  title?: string;
  recipients?: number;
  devices?: number;
  pushed?: number;
  deadTokensPruned?: number;
  createdAt?: Ts;
}
interface Cron {
  id: string;
  everyMinutes?: number;
  lastSuccessAt?: Ts;
  lastRunAt?: Ts;
  lastError?: string | null;
  consecutiveFailures?: number;
}
interface AiLog {
  validationResult?: boolean;
  timestamp?: { _seconds?: number } | string;
  adminEmail?: string;
  requestPrompt?: string;
}

const NOTIFICATION_CRONS = ["processScheduledCampaigns", "retryFailedNotifications"];

export default function HealthPage() {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [crons, setCrons] = useState<Cron[]>([]);
  const [ai, setAi] = useState<AiLog[] | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "notification_deliveries"), orderBy("createdAt", "desc"), limit(200)),
        (s) => setDeliveries(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Delivery, "id">) }))),
        () => setDeliveries([]),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(
        collection(db, "cron_health"),
        (s) => setCrons(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Cron, "id">) }))),
        () => setCrons([]),
      ),
    [],
  );
  useEffect(() => {
    httpsCallable<{ limit: number }, { logs: AiLog[] }>(functions, "listAiAuditLogs")({ limit: 50 })
      .then((r) => setAi(r.data.logs))
      .catch(() => setAi([]));
  }, []);

  const week = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    const rows = (deliveries ?? []).filter((d) => ms(d.createdAt) >= since);
    const devices = rows.reduce((s, d) => s + (d.devices ?? 0), 0);
    const pushed = rows.reduce((s, d) => s + (d.pushed ?? 0), 0);
    return {
      sends: rows.length,
      people: rows.reduce((s, d) => s + (d.recipients ?? 0), 0),
      devices,
      pushed,
      pruned: rows.reduce((s, d) => s + (d.deadTokensPruned ?? 0), 0),
      rate: devices ? `${((pushed / devices) * 100).toFixed(1)}%` : "—",
      failed: rows.filter((d) => d.status === "failed").length,
    };
  }, [deliveries]);

  const aiOk = ai ? ai.filter((l) => l.validationResult).length : 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Notification health" description="Live delivery results, scheduler heartbeats and AI generation quality." />

      <StatCards
        stats={[
          { label: "Sends (7 days)", value: deliveries ? week.sends : "—" },
          { label: "People reached", value: deliveries ? week.people.toLocaleString("en-IN") : "—" },
          { label: "Device delivery", value: week.rate, tone: "text-emerald-600", hint: `${week.pushed} of ${week.devices} devices` },
          { label: "Dead tokens pruned", value: week.pruned, hint: "uninstalled / rotated" },
          { label: "Failed sends", value: week.failed, tone: week.failed ? "text-rose-600" : undefined },
          { label: "AI drafts valid", value: ai ? (ai.length ? `${aiOk}/${ai.length}` : "—") : "…", hint: "last 50 generations" },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Schedulers</CardTitle>
            <CardDescription>Campaigns go out only while these heartbeat on time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {NOTIFICATION_CRONS.map((name) => {
              const c = crons.find((x) => x.id === name);
              const late = !c || Date.now() - ms(c.lastSuccessAt) > (c.everyMinutes ?? 5) * 3 * 60_000;
              return (
                <div key={name} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    {late ? <XCircle className="h-4 w-4 text-rose-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    <span className="font-mono text-xs">{name}</span>
                  </div>
                  <span className="text-muted-foreground text-xs text-right">
                    {c ? `ok ${ago(c.lastSuccessAt)}` : "no heartbeat yet"}
                    {c?.lastError ? ` · ${String(c.lastError).slice(0, 60)}` : ""}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <TestPushCard />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="h-4 w-4" /> Recent sends</CardTitle>
        </CardHeader>
        <CardContent>
          {!deliveries ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
          ) : (
            <div className="divide-y">
              {deliveries.slice(0, 15).map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.title || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.targetApp ?? "—"} · {ago(d.createdAt)}
                      {d.devices !== undefined ? ` · ${d.pushed ?? 0}/${d.devices} devices` : ""}
                    </p>
                  </div>
                  <Badge variant={d.status === "failed" ? "destructive" : "secondary"}>{d.status ?? "—"}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {ai && ai.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" /> Recent AI drafts</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {ai.slice(0, 8).map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate">{l.requestPrompt || "—"}</span>
                <Badge variant={l.validationResult ? "secondary" : "destructive"}>{l.validationResult ? "valid" : "rejected"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface TestResult {
  summary: string;
  devices: Array<{ token: string; ok: boolean; error?: string }>;
}

function TestPushCard() {
  const [app, setApp] = useState<"customer" | "vendor" | "rider" | "host">("customer");
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await httpsCallable<unknown, TestResult>(functions, "sendTestPush")({ app, user });
      setResult(r.data);
      toast.success(r.data.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test push failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4" /> Send a test push</CardTitle>
        <CardDescription>Writes an inbox row and pushes to every device registered for that person in that app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {(["customer", "vendor", "rider", "host"] as const).map((a) => (
            <Button key={a} size="sm" variant={app === a ? "default" : "outline"} onClick={() => setApp(a)} className="capitalize">
              {a}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="tp-user" className="text-xs text-muted-foreground">User id, email or phone</Label>
          <Input id="tp-user" value={user} onChange={(e) => setUser(e.target.value)} placeholder="e.g. 98765 43210" />
        </div>
        <Button onClick={send} disabled={busy || !user.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
          Send test
        </Button>
        {result && (
          <div className="rounded-md border p-3 text-xs space-y-1">
            <p className="font-medium">{result.summary}</p>
            {result.devices.map((d) => (
              <p key={d.token} className={d.ok ? "text-emerald-600" : "text-rose-600"}>
                {d.ok ? "✓" : "✕"} <span className="font-mono">{d.token}</span>
                {d.error ? ` — ${d.error.replace("messaging/", "")}` : ""}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
