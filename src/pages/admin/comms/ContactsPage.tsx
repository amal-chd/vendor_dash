import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { comms, commsOp, errMessage, num, when, STATUS_TONE } from "./commsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Ban, Loader2, LogOut, Mail, MousePointerClick, Eye, Search, ShieldCheck, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

interface Contact {
  found: boolean;
  profile: null | {
    id: string; email: string; displayName: string; userType: string | null; city: string; zoneName: string; emailStatus: string;
    channels: Record<string, boolean>;
    marketingConsent: null | { enabled: boolean; source: string | null; givenAt: number | null; withdrawnAt: number | null };
    orderStats: { count: number; totalSpend: number; lastOrderAt: number | null };
    lastVendor: string | null;
    engagement: { lastSentAt: number | null; lastMarketingAt: number | null; lastOpenAt: number | null; lastClickAt: number | null };
    tags: string[]; createdAt: number | null; sunsetAt: number | null;
  };
  suppression: null | { reason: string; source: string; at: number | null };
  consentHistory: { enabled: boolean; source: string; method: string; at: number | null }[];
  emails: { id: string; subject: string; templateKey: string; category: string; status: string; reason: string | null; createdAt: number | null; openedAt: number | null; clickedAt: number | null; source: string }[];
  journeys: { id: string; journeyId: string; name: string; status: string; stepId: string | null; holdout: boolean; test: boolean; enteredAt: number; convertedAt: number | null; exitReason: string | null }[];
}

const CHANNELS = [
  { key: "marketing", label: "Offers" },
  { key: "announcements", label: "Product news" },
  { key: "newsletter", label: "Newsletter" },
];

/**
 * Contact 360 — one person's whole email life: consent and where it came
 * from, suppression, every email and what happened to it, and every journey
 * they're in. Read-only except removing them from a journey.
 */
export default function ContactsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("contact") || "");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Contact | null>(null);
  const [error, setError] = useState("");

  const lookup = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError("");
    try {
      setData(await comms<Contact>("contact360", { query: q.trim() }));
      setParams((p) => { const n = new URLSearchParams(p); n.set("contact", q.trim()); return n; }, { replace: true });
    } catch (err) {
      setError(errMessage(err));
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  const p = data?.profile;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Contacts</h2>
        <p className="text-sm text-muted-foreground">Look anyone up by email or user id to see their consent, every email we sent them, and the journeys they're in.</p>
      </div>
      <form onSubmit={lookup} className="flex gap-2 max-w-xl">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name@example.com or user id" />
        <Button type="submit" disabled={busy || !q.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}<span className="ml-1.5">Look up</span></Button>
      </form>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {data && !data.found && <p className="text-sm text-muted-foreground">No account, email history or suppression for that.</p>}

      {data?.found && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            <Card className="rounded-2xl">
              <CardContent className="p-5 space-y-3">
                {p ? (
                  <>
                    <div>
                      <p className="text-lg font-bold">{p.displayName || p.email}</p>
                      <p className="text-sm text-muted-foreground break-all">{p.email}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {p.userType && <Badge variant="outline">{p.userType.replace("_", " ").toLowerCase()}</Badge>}
                        {(p.zoneName || p.city) && <Badge variant="outline">{p.zoneName || p.city}</Badge>}
                        <Badge variant="outline" className={p.emailStatus === "active" ? "" : "text-rose-600 border-rose-500/30"}>{p.emailStatus}</Badge>
                        {p.tags.map((t) => <Badge key={t} variant="secondary">#{t}</Badge>)}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Mini label="Orders" value={num(p.orderStats.count)} />
                      <Mini label="Spend" value={`₹${num(p.orderStats.totalSpend)}`} />
                      <Mini label="Last order" value={p.orderStats.lastOrderAt ? new Date(p.orderStats.lastOrderAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"} />
                    </div>
                    {p.lastVendor && <p className="text-xs text-muted-foreground">Last ordered from <b>{p.lastVendor}</b></p>}
                    <p className="text-xs text-muted-foreground">Joined {when(p.createdAt)}</p>
                  </>
                ) : <p className="text-sm text-muted-foreground">No profile — this address only appears in the email history.</p>}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Consent</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {data.suppression && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-xs flex gap-2">
                    <Ban className="h-4 w-4 text-rose-600 shrink-0" />
                    <span>Suppressed: <b>{data.suppression.reason.replace("_", " ")}</b> via {data.suppression.source} · {when(data.suppression.at)}</span>
                  </div>
                )}
                {p && CHANNELS.map((c) => (
                  <div key={c.key} className="flex items-center justify-between">
                    <span>{c.label}</span>
                    <Badge variant="outline" className={p.channels[c.key] ? "text-emerald-700 border-emerald-500/30" : ""}>{p.channels[c.key] ? "On" : "Off"}</Badge>
                  </div>
                ))}
                {p?.marketingConsent && (
                  <p className="text-xs text-muted-foreground">
                    {p.marketingConsent.enabled ? `Opted in ${when(p.marketingConsent.givenAt)}` : p.marketingConsent.withdrawnAt ? `Opted out ${when(p.marketingConsent.withdrawnAt)}` : "Never opted in"}
                    {p.marketingConsent.source ? ` · via ${p.marketingConsent.source.replace("_", " ")}` : ""}
                  </p>
                )}
                {p?.sunsetAt && <p className="text-xs text-amber-700">Marketing stopped by the sunset policy {when(p.sunsetAt)}.</p>}
                {data.consentHistory.length > 0 && (
                  <ul className="border-t pt-2 space-y-1">
                    {data.consentHistory.map((h, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground flex justify-between gap-2">
                        <span>{h.enabled ? "Opted in" : "Opted out"} · {h.source?.replace("_", " ")}</span><span>{when(h.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {p && (
                  <div className="grid grid-cols-2 gap-2 border-t pt-2 text-[11px] text-muted-foreground">
                    <span>Last marketing: {when(p.engagement.lastMarketingAt)}</span>
                    <span>Last open: {when(p.engagement.lastOpenAt)}</span>
                    <span>Last click: {when(p.engagement.lastClickAt)}</span>
                    <span>Last email: {when(p.engagement.lastSentAt)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Workflow className="h-4 w-4" />Journeys</CardTitle></CardHeader>
              <CardContent>
                {data.journeys.length === 0 ? <p className="text-sm text-muted-foreground">Not in any journey.</p> : (
                  <ul className="divide-y">
                    {data.journeys.map((j) => (
                      <li key={j.id} className="py-2 flex items-center gap-2 text-sm">
                        <a className="font-medium hover:underline flex-1 truncate" href={`?tab=email&section=journeys&journey=${j.journeyId}`}>{j.name}</a>
                        {j.holdout && <Badge variant="outline" className="text-[10px]">holdout</Badge>}
                        {j.test && <Badge variant="outline" className="text-[10px]">test</Badge>}
                        {j.convertedAt && <Badge className="text-[10px] bg-emerald-600">goal</Badge>}
                        <span className="text-xs text-muted-foreground capitalize">{j.status}{j.exitReason ? ` · ${j.exitReason}` : ""}</span>
                        <span className="text-xs text-muted-foreground hidden sm:inline">{when(j.enteredAt)}</span>
                        {j.status === "active" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove from journey"
                            onClick={async () => { if (await commsOp("exitEnrollment", { id: j.id }, "Removed from the journey")) lookup(); }}>
                            <LogOut className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Emails ({data.emails.length})</CardTitle></CardHeader>
              <CardContent>
                {data.emails.length === 0 ? <p className="text-sm text-muted-foreground">No emails yet.</p> : (
                  <ul className="divide-y">
                    {data.emails.map((m) => (
                      <li key={m.id} className="py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate flex-1">{m.subject}</span>
                          <Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[m.status])}>{m.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
                          <span>{when(m.createdAt)}</span><span>· {m.category}</span><span>· {m.source}</span>
                          {m.openedAt && <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" />{when(m.openedAt)}</span>}
                          {m.clickedAt && <span className="inline-flex items-center gap-0.5"><MousePointerClick className="h-3 w-3" />{when(m.clickedAt)}</span>}
                          {m.reason && <span className="text-amber-700">· {m.reason.replace(/_/g, " ")}</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/40 py-2"><p className="text-sm font-bold">{value}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p></div>;
}
