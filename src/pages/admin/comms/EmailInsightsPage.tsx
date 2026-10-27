import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listenCollection } from "@/hooks/useLiveCollection";
import { comms, errMessage, num, pct } from "./commsApi";
import { JOURNEY_STATUS_TONE, lift, pctOf, type Journey } from "./journeyTypes";
import { StatCards } from "@/components/admin/StatCards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Ban, Eye, Loader2, MousePointerClick, RefreshCw, Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface Day { day: string; sent: number; opened: number; clicked: number; bounced: number }

/**
 * Insights — 30 days of volume and engagement, plus how each journey and
 * campaign is actually performing. Counts come from emailLogs aggregations.
 */
export default function EmailInsightsPage() {
  const [, setParams] = useSearchParams();
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string; stats?: Record<string, number> }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDays((await comms<{ days: Day[] }>("emailTrend", { days: 30 })).days);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => listenCollection<Journey>("journeys", { limit: 200 }, setJourneys), []);
  useEffect(() => listenCollection<{ id: string; name: string; status: string; stats?: Record<string, number> }>(
    "emailCampaigns", { orderByField: "createdAt", limit: 20 }, setCampaigns), []);

  const totals = useMemo(() => (days || []).reduce((t, d) => ({
    sent: t.sent + d.sent, opened: t.opened + d.opened, clicked: t.clicked + d.clicked, bounced: t.bounced + d.bounced,
  }), { sent: 0, opened: 0, clicked: 0, bounced: 0 }), [days]);

  const chart = (days || []).map((d) => ({ ...d, label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) }));
  const ranked = journeys.filter((j) => j.status !== "archived" && Number(j.stats?.entered || 0) > 0)
    .sort((a, b) => Number(b.stats?.converted || 0) - Number(a.stats?.converted || 0));
  const openJourney = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("section", "journeys"); n.set("journey", id); return n; });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Insights</h2>
          <p className="text-sm text-muted-foreground">The last 30 days across every email The Kada sends. Opens are approximate — Apple Mail pre-loads images — so judge by clicks and goals.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}Refresh
        </Button>
      </div>

      <StatCards stats={[
        { label: "Sent · 30 days", value: num(totals.sent), icon: Send },
        { label: "Opens", value: num(totals.opened), icon: Eye, hint: totals.sent ? `${pct(totals.opened / totals.sent)} of sends` : undefined },
        { label: "Clicks", value: num(totals.clicked), icon: MousePointerClick, tone: "text-sky-600", hint: totals.sent ? `${pct(totals.clicked / totals.sent)} of sends` : undefined },
        { label: "Bounces", value: num(totals.bounced), icon: Ban, tone: totals.sent && totals.bounced / totals.sent > 0.02 ? "text-rose-600" : undefined, hint: totals.sent ? `${pct(totals.bounced / totals.sent, 2)} · keep under 2%` : undefined },
      ]} />

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">Daily volume & engagement</CardTitle></CardHeader>
        <CardContent>
          {error ? <p className="text-sm text-rose-600 py-10 text-center">{error}</p> : !days ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />Counting…</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chart} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563EB" stopOpacity={0.25} /><stop offset="100%" stopColor="#2563EB" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gOpen" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity={0.2} /><stop offset="100%" stopColor="#0d9488" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" name="Sent" dataKey="sent" stroke="#2563EB" strokeWidth={2} fill="url(#gSent)" />
                <Area type="monotone" name="Opened" dataKey="opened" stroke="#0d9488" strokeWidth={2} fill="url(#gOpen)" />
                <Area type="monotone" name="Clicked" dataKey="clicked" stroke="#d97706" strokeWidth={2} fill="transparent" />
                <Area type="monotone" name="Bounced" dataKey="bounced" stroke="#e11d48" strokeWidth={1.5} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Journeys by goals reached</CardTitle></CardHeader>
          <CardContent>
            {ranked.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No journey has had entrants yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] uppercase text-muted-foreground text-left">
                  <th className="py-1.5 font-medium">Journey</th><th className="font-medium text-right">Entered</th><th className="font-medium text-right">Conv.</th><th className="font-medium text-right">Lift</th><th className="font-medium text-right">Click</th>
                </tr></thead>
                <tbody className="divide-y">
                  {ranked.map((j) => {
                    const s = j.stats || {};
                    const up = lift(j);
                    return (
                      <tr key={j.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openJourney(j.id)}>
                        <td className="py-2 pr-2"><span className="font-medium">{j.name}</span> <Badge variant="outline" className={cn("ml-1 text-[9px] capitalize", JOURNEY_STATUS_TONE[j.status])}>{j.status}</Badge></td>
                        <td className="text-right">{num(s.entered)}</td>
                        <td className="text-right">{j.goal ? pct(pctOf(s.converted, Number(s.entered || 0) - Number(s.holdoutEntered || 0))) : "—"}</td>
                        <td className={cn("text-right", up !== null && (up > 0 ? "text-emerald-600" : "text-rose-600"))}>{up === null ? "—" : `${(up * 100).toFixed(1)}`}</td>
                        <td className="text-right">{pct(pctOf(j.emailStats?.clicked, j.emailStats?.sent))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent campaigns</CardTitle></CardHeader>
          <CardContent>
            {campaigns.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No campaigns yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] uppercase text-muted-foreground text-left">
                  <th className="py-1.5 font-medium">Campaign</th><th className="font-medium text-right">Sent</th><th className="font-medium text-right">Open</th><th className="font-medium text-right">Click</th><th className="font-medium text-right">Bounce</th>
                </tr></thead>
                <tbody className="divide-y">
                  {campaigns.map((c) => {
                    const s = c.stats || {};
                    return (
                      <tr key={c.id}>
                        <td className="py-2 pr-2 font-medium truncate max-w-[12rem]">{c.name} <span className="text-[10px] text-muted-foreground capitalize">{c.status}</span></td>
                        <td className="text-right">{num(s.sent)}</td>
                        <td className="text-right">{pct(pctOf(s.opened, s.sent))}</td>
                        <td className="text-right">{pct(pctOf(s.clicked, s.sent))}</td>
                        <td className="text-right">{pct(pctOf(s.bounced, s.sent), 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
