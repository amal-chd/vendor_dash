import { useEffect, useState } from "react";
import { collection, onSnapshot, query, limit, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCommsApp } from "./channelShell";
import { comms, commsOp, errMessage, when, STATUS_TONE } from "./commsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, RotateCcw, Search, XCircle, Plus, Trash2, UserSearch, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface Log {
  bounceMessage?: string;
  id: string; recipientEmail: string; templateKey: string; category: string; userType?: string; status: string;
  provider: string; subject: string; error?: string; reason?: string; isTest?: boolean; campaignId?: string;
  createdAt?: { toMillis?: () => number };
}
interface Suppression { id: string; email: string; reason: string; source: string; detail?: string; createdAt?: { toMillis?: () => number } }

const REASON_LABEL: Record<string, string> = {
  unsubscribed: "Unsubscribed", hard_bounce: "Bounced", spam_complaint: "Marked as spam", invalid: "Invalid address",
  blocked: "Blocked", manual: "Added by admin",
};
const SKIP_LABEL: Record<string, string> = {
  no_consent: "Not opted in", unsubscribed: "Unsubscribed", frequency_capped: "Frequency cap", invalid_recipient: "Bad address",
};

function StatusBadge({ s }: { s: string }) {
  return <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[s])}>{s}</Badge>;
}

/** Everything that was sent, what's waiting, and who we won't mail. */
export default function EmailLogsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Activity</h2>
        <p className="text-sm text-muted-foreground">Every email, its delivery trail, the retry queue, and addresses we won't mail.</p>
      </div>
      <Tabs defaultValue="messages">
        <TabsList>
          <TabsTrigger value="messages">Mail log</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="suppressions">Suppressions</TabsTrigger>
          <TabsTrigger value="lookup">Look up a person</TabsTrigger>
        </TabsList>
        <TabsContent value="messages"><Messages /></TabsContent>
        <TabsContent value="queue"><Queue /></TabsContent>
        <TabsContent value="suppressions"><Suppressions /></TabsContent>
        <TabsContent value="lookup"><Lookup /></TabsContent>
      </Tabs>
    </div>
  );
}

const GROUPS: { label: string; items: { key: string; label: string; dot: string }[] }[] = [
  { label: "Customers", items: [
    { key: "orders", label: "Orders & bookings", dot: "bg-blue-500" },
    { key: "payments", label: "Payments & refunds", dot: "bg-emerald-500" },
    { key: "subscriptions", label: "Subscriptions", dot: "bg-cyan-500" },
    { key: "billing", label: "Billing", dot: "bg-teal-500" },
  ] },
  { label: "Account & help", items: [
    { key: "authentication", label: "Account & security", dot: "bg-slate-500" },
    { key: "support", label: "Support", dot: "bg-indigo-500" },
  ] },
  { label: "Partners", items: [
    { key: "vendor", label: "Restaurants", dot: "bg-amber-500" },
    { key: "rider", label: "Riders", dot: "bg-lime-600" },
    { key: "host", label: "Stay hosts", dot: "bg-rose-500" },
  ] },
  { label: "Marketing", items: [
    { key: "marketing", label: "Offers & campaigns", dot: "bg-violet-500" },
    { key: "announcements", label: "Announcements", dot: "bg-fuchsia-500" },
  ] },
];
const CAT = Object.fromEntries(GROUPS.flatMap((g) => g.items).map((i) => [i.key, i]));
const APP_USERTYPES: Record<string, string[]> = {
  customer: ["CUSTOMER"], vendor: ["VENDOR", "RESTAURANT_STAFF"], delivery: ["DELIVERY_PARTNER"], host: ["HOST"],
};
const STATUS_CHIPS = ["sent", "delivered", "opened", "clicked", "skipped", "failed", "bounced", "complained"];

interface Row {
  id: string; to: string; subject: string; templateKey: string; category: string; userType: string | null;
  status: string; reason: string | null; error: string | null; campaignId: string | null; automationId: string | null;
  isTest: boolean; createdAt: number | null; openedAt: number | null; clickedAt: number | null;
}
interface Facets { categories: Record<string, number>; statuses: Record<string, number> }

/** The mail log: every email, categorised, filterable, newest first. */
function Messages() {
  const app = useCommsApp();
  const [period, setPeriod] = useState("7d");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [stream, setStream] = useState("");
  const [email, setEmail] = useState("");
  const [emailQ, setEmailQ] = useState("");
  const [template, setTemplate] = useState("");
  const [tests, setTests] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<unknown>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const filters = { period, category, status, stream, email: emailQ, templateKey: template.trim(), includeTests: tests, userTypes: APP_USERTYPES[app] || [] };

  const load = async (append = false) => {
    if (append) setMore(true);
    else setLoading(true);
    try {
      const r = await comms<{ rows: Row[]; nextCursor: unknown }>("searchLogs", { ...filters, cursor: append ? cursor : undefined });
      setRows((prev) => (append ? [...prev, ...r.rows] : r.rows));
      setCursor(r.nextCursor);
    } catch (e) {
      const { toast } = await import("sonner");
      toast.error(errMessage(e));
    } finally {
      setLoading(false);
      setMore(false);
    }
  };
  useEffect(() => { load(false); }, [period, category, status, stream, emailQ, tests, app]);
  useEffect(() => { comms<Facets>("logFacets", { period }).then(setFacets).catch(() => setFacets(null)); }, [period]);

  const total = facets ? Object.values(facets.categories).reduce((a, b) => a + b, 0) : null;
  const CatButton = ({ k, label, dot }: { k: string; label: string; dot?: string }) => (
    <button onClick={() => setCategory(k)}
      className={cn("w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition",
        category === k ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted text-foreground/80")}>
      {dot ? <span className={cn("h-2 w-2 rounded-full shrink-0", dot)} /> : <Inbox className="h-3.5 w-3.5 shrink-0" />}
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[11px] tabular-nums text-muted-foreground">{facets ? (k ? facets.categories[k] ?? 0 : total)?.toLocaleString("en-IN") : ""}</span>
    </button>
  );

  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-[210px_minmax(0,1fr)]">
      {/* Category rail */}
      <aside className="rounded-2xl border bg-card p-2 h-fit lg:sticky lg:top-3">
        <CatButton k="" label="All email" />
        {GROUPS.map((g) => (
          <div key={g.label} className="mt-2">
            <p className="px-2.5 pb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{g.label}</p>
            {g.items.map((i) => <CatButton key={i.key} k={i.key} label={i.label} dot={i.dot} />)}
          </div>
        ))}
      </aside>

      <div className="space-y-2 min-w-0">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <form className="relative" onSubmit={(e) => { e.preventDefault(); setEmailQ(email.trim()); }}>
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Recipient email ⏎" value={email} onChange={(e) => { setEmail(e.target.value); if (!e.target.value) setEmailQ(""); }} className="h-8 w-56 pl-8 text-xs" />
          </form>
          <form onSubmit={(e) => { e.preventDefault(); load(false); }}>
            <Input placeholder="Template key ⏎" value={template} onChange={(e) => setTemplate(e.target.value)} className="h-8 w-40 text-xs font-mono" />
          </form>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{[["24h", "Last 24 h"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={stream || "all"} onValueChange={(v) => setStream(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All streams</SelectItem><SelectItem value="transactional">Service</SelectItem><SelectItem value="marketing">Marketing</SelectItem></SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} />Tests</label>
          <Button size="sm" variant="ghost" className="h-8 ml-auto" onClick={() => load(false)}><RotateCcw className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setStatus("")} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", !status ? "bg-foreground text-background" : "hover:bg-muted")}>Any status</button>
          {STATUS_CHIPS.map((st) => (
            <button key={st} onClick={() => setStatus(status === st ? "" : st)}
              className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize", status === st ? "bg-foreground text-background" : cn("hover:bg-muted", STATUS_TONE[st]))}>
              {st} {facets ? <span className="opacity-60 tabular-nums">{(facets.statuses[st] ?? 0).toLocaleString("en-IN")}</span> : null}
            </button>
          ))}
        </div>

        <Card><CardContent className="p-0 overflow-x-auto">
          {loading ? <div className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
            : rows.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground"><Inbox className="h-6 w-6 mx-auto mb-2 opacity-40" />No email matches these filters.</div>
            : (
            <table className="w-full text-[13px]">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b bg-muted/30">
                <tr><th className="text-left px-3 py-2">Email</th><th className="text-left px-3 py-2">To</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">When</th></tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => setOpen(l.id)}>
                    <td className="px-3 py-2 max-w-[380px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", CAT[l.category]?.dot || "bg-slate-400")} title={CAT[l.category]?.label} />
                        <span className="truncate font-medium">{l.subject || "—"}</span>
                        {l.isTest && <Badge variant="secondary" className="text-[9px] px-1 py-0">test</Badge>}
                        {l.campaignId && <Badge variant="outline" className="text-[9px] px-1 py-0">campaign</Badge>}
                        {l.automationId && <Badge variant="outline" className="text-[9px] px-1 py-0">auto</Badge>}
                      </div>
                      <span className="ml-4 text-[10px] text-muted-foreground font-mono">{l.templateKey}</span>
                    </td>
                    <td className="px-3 py-2 max-w-[220px] truncate text-muted-foreground">{l.to}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StatusBadge s={l.status} />
                      {(l.reason || l.error) && <span className="ml-1.5 text-[10px] text-muted-foreground" title={l.error || l.reason || ""}>{SKIP_LABEL[l.reason || ""] || (l.reason || l.error || "").slice(0, 28)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-muted-foreground whitespace-nowrap">{when(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent></Card>
        {!!cursor && !loading && (
          <div className="text-center"><Button variant="outline" size="sm" disabled={more} onClick={() => load(true)}>{more ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load more"}</Button></div>
        )}
      </div>
      {open && <MessageSheet id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

interface Detail {
  log: Log & { providerMessageId?: string; lastClickedLink?: string; bounceMessage?: string };
  event: { status: string; attemptCount: number; lastError: string | null; reason: string | null; lane: string; data: Record<string, unknown> } | null;
  suppression: { reason: string; source: string } | null;
  timeline: { label: string; at: number | null }[];
}

function MessageSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { comms<Detail>("messageDetail", { id }).then(setD).catch((e) => setError(errMessage(e))); }, [id]);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle>Email details</SheetTitle></SheetHeader>
        {error ? <p className="mt-6 text-sm text-rose-600">{error}</p> : !d ? <Loader2 className="h-5 w-5 animate-spin mx-auto mt-10" /> : (
          <div className="mt-5 space-y-5 text-sm">
            <div className="space-y-1">
              <p className="font-bold">{d.log.subject}</p>
              <p className="text-muted-foreground">to {d.log.recipientEmail}</p>
              <div className="flex gap-2 items-center"><StatusBadge s={d.log.status} /><span className="text-xs font-mono text-muted-foreground">{d.log.templateKey}</span></div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Timeline</p>
              <ol className="relative border-l pl-4 space-y-3">
                {d.timeline.map((t) => (
                  <li key={t.label}><span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                    <p className="font-semibold">{t.label}</p><p className="text-xs text-muted-foreground">{when(t.at)}</p></li>
                ))}
              </ol>
              {d.timeline.length <= 1 && <p className="text-xs text-muted-foreground mt-2">Delivery, open and bounce events appear once the Resend webhook is connected.</p>}
            </div>
            {(d.log.error || d.event?.lastError || d.log.bounceMessage) && (
              <div className="rounded-xl bg-rose-500/5 border border-rose-500/20 p-3 text-xs text-rose-700 break-words">{d.log.bounceMessage || d.log.error || d.event?.lastError}</div>
            )}
            {d.log.reason && <p className="text-xs">Skipped: <b>{SKIP_LABEL[d.log.reason] || d.log.reason}</b></p>}
            {d.suppression && <p className="text-xs">This address is suppressed: <b>{REASON_LABEL[d.suppression.reason] || d.suppression.reason}</b> ({d.suppression.source})</p>}
            {d.log.lastClickedLink && <p className="text-xs break-all">Last click: {d.log.lastClickedLink}</p>}
            {d.event && d.event.lane !== "bulk" && !d.log.isTest && (
              <div className="rounded-xl border p-3 space-y-2">
                <Label className="text-xs">Send it again</Label>
                <div className="flex gap-2">
                  <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={d.log.recipientEmail} className="h-9" />
                  <Button size="sm" disabled={busy} onClick={() => commsOp("resend", { id, to: to || undefined }, "Queued again — it goes out in a few seconds.", setBusy)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Resend
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Uses the same content and the current template. Suppression rules still apply.</p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface QueueRow { eventId: string; to: string; templateKey: string; type: string; attemptCount: number; lastError: string | null; nextAttemptAt: number | null; updatedAt: number | null }

function Queue() {
  const [lane, setLane] = useState<"transactional" | "bulk">("transactional");
  const [status, setStatus] = useState<"failed" | "queued">("failed");
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const load = async () => {
    setRows(null);
    const r = await comms<{ rows: QueueRow[] }>("listQueue", { lane, status }).catch(() => ({ rows: [] }));
    setRows(r.rows);
  };
  useEffect(() => { load(); }, [lane, status]);
  return (
    <div className="space-y-3 mt-3">
      <div className="flex gap-2 flex-wrap items-center">
        <Select value={lane} onValueChange={(v) => setLane(v as typeof lane)}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="transactional">Service emails</SelectItem><SelectItem value="bulk">Campaign & marketing</SelectItem></SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="failed">Failed</SelectItem><SelectItem value="queued">Waiting</SelectItem></SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        {!rows ? <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          : rows.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">{status === "failed" ? "No failures. 🎉" : "Nothing waiting."}</div>
          : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b">
              <tr><th className="text-left p-3">To</th><th className="text-left p-3">Email</th><th className="text-left p-3">{status === "failed" ? "Error" : "Next try"}</th><th className="p-3" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.eventId} className="border-b last:border-0">
                  <td className="p-3 font-medium max-w-[200px] truncate">{r.to}</td>
                  <td className="p-3"><span className="font-mono text-xs">{r.templateKey}</span><div className="text-[10px] text-muted-foreground">{r.type} · {r.attemptCount} attempt(s)</div></td>
                  <td className="p-3 text-xs text-muted-foreground max-w-[280px] truncate" title={r.lastError || ""}>{status === "failed" ? r.lastError : `${when(r.nextAttemptAt)}${r.lastError ? ` · ${r.lastError}` : ""}`}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" className="h-7" onClick={async () => { if (await commsOp("retryEvent", { lane, eventId: r.eventId }, "Retrying now.")) load(); }}><RotateCcw className="h-3 w-3 mr-1" />Retry</Button>
                    {status === "queued" && <Button size="sm" variant="ghost" className="h-7 text-rose-600" onClick={async () => { if (confirm("Cancel this email?") && await commsOp("cancelEvent", { lane, eventId: r.eventId }, "Cancelled.")) load(); }}><XCircle className="h-3.5 w-3.5" /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>
    </div>
  );
}

function Suppressions() {
  const [rows, setRows] = useState<Suppression[]>([]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Suppression | null>(null);
  useEffect(() => onSnapshot(query(collection(db, "emailSuppressions"), orderBy("createdAt", "desc"), limit(500)),
    (s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Suppression, "id">) }))),
    (e) => console.error("[Activity] suppressions listener failed", e)), []);
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q || r.email?.toLowerCase().includes(q));
  return (
    <div className="space-y-3 mt-3">
      <div className="flex gap-2 justify-between flex-wrap">
        <Input placeholder="Search address" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
        <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-2" />Block an address</Button>
      </div>
      <p className="text-xs text-muted-foreground">Bounced and spam-reported addresses get no email at all. Unsubscribed ones still get receipts and account emails.</p>
      <Card><CardContent className="p-0 overflow-x-auto">
        {visible.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No suppressed addresses.</div> : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b">
              <tr><th className="text-left p-3">Address</th><th className="text-left p-3">Why</th><th className="text-left p-3">Since</th><th className="p-3" /></tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{s.email}</td>
                  <td className="p-3"><Badge variant="outline" className={cn("text-[10px]", s.reason === "unsubscribed" ? STATUS_TONE.skipped : STATUS_TONE.bounced)}>{REASON_LABEL[s.reason] || s.reason}</Badge>
                    <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[260px] truncate" title={s.detail || s.source}>{s.detail || s.source}</div></td>
                  <td className="p-3 text-xs text-muted-foreground">{when(s.createdAt)}</td>
                  <td className="p-3 text-right"><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRemoving(s)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>
      {adding && <AddSuppression onClose={() => setAdding(false)} />}
      {removing && <RemoveSuppression s={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function AddSuppression({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Stop emailing an address</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="someone@example.com" /></div>
          <div><Label>Why (kept in the audit log)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Asked by phone to stop all email" /></div>
          <p className="text-xs text-muted-foreground">This blocks every email to the address, including receipts.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => { if (await commsOp("addSuppression", { email, note }, "Address blocked.", setBusy)) onClose(); }}>Block</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveSuppression({ s, onClose }: { s: Suppression; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const risky = s.reason !== "unsubscribed" && s.reason !== "manual";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Allow email to {s.email} again?</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          {risky ? (
            <p className="rounded-xl bg-amber-500/10 p-3 text-amber-800 text-xs">
              This address {s.reason === "spam_complaint" ? "marked our email as spam" : "bounced"}. Mailing it again hurts delivery for everyone unless the person confirmed the address works and wants email.
            </p>
          ) : s.reason === "unsubscribed" ? (
            <p className="text-xs text-muted-foreground">Only do this if the person asked to resubscribe. Better: send them their preference link so the opt-in is on record.</p>
          ) : null}
          <div><Label>Reason (required, audited)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Customer confirmed new mailbox on a call" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Keep blocked</Button>
          <Button variant={risky ? "destructive" : "default"} disabled={busy || !note.trim()} onClick={async () => {
            if (await commsOp("removeSuppression", { email: s.email, note }, "Address allowed again.", setBusy)) onClose();
          }}>Allow again</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface LookupResult {
  profiles: { id: string; userType: string; displayName: string; channels: Record<string, boolean>; marketingConsent: boolean; emailStatus: string; orderStats: { count: number } | null }[];
  suppression: { reason: string; source: string; detail: string | null } | null;
  logs: { id: string; subject: string; templateKey: string; status: string; createdAt: number | null }[];
}

function Lookup() {
  const [email, setEmail] = useState("");
  const [res, setRes] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3 mt-3">
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); setRes(await commsOp<LookupResult>("lookupRecipient", { email }, undefined, setBusy)); }}>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" className="w-80" />
        <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserSearch className="h-4 w-4 mr-2" />}Look up</Button>
      </form>
      <p className="text-xs text-muted-foreground">For “I never got my email” tickets: see whether they can be mailed, what they opted into, and every email we sent them.</p>
      {res && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Card><CardContent className="p-4 space-y-3 text-sm">
            {res.suppression ? (
              <p className="rounded-xl bg-rose-500/10 p-3 text-xs text-rose-700"><b>{REASON_LABEL[res.suppression.reason] || res.suppression.reason}</b> — {res.suppression.reason === "unsubscribed" ? "gets service emails only." : "gets no email at all."} {res.suppression.detail || ""}</p>
            ) : <p className="rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700">Not suppressed — we can email this address.</p>}
            {res.profiles.length === 0 ? <p className="text-xs text-muted-foreground">No profile yet (they haven't ordered with this email, or a backfill hasn't run).</p>
              : res.profiles.map((p) => (
                <div key={p.id} className="rounded-xl border p-3 space-y-1">
                  <p className="font-semibold">{p.displayName || "—"} <span className="text-xs text-muted-foreground">· {p.userType}</span></p>
                  <p className="text-xs">Offers: <b>{p.marketingConsent ? "opted in" : "not opted in"}</b> · News: <b>{p.channels.announcements ? "on" : "off"}</b></p>
                  <p className="text-xs text-muted-foreground">Address status: {p.emailStatus}{p.orderStats ? ` · ${p.orderStats.count} delivered orders` : ""}</p>
                </div>
              ))}
          </CardContent></Card>
          <Card><CardContent className="p-0">
            {res.logs.length === 0 ? <p className="p-6 text-sm text-muted-foreground text-center">No emails sent to this address.</p> : (
              <table className="w-full text-sm"><tbody>
                {res.logs.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => setOpen(l.id)}>
                    <td className="p-3"><span className="block truncate max-w-[320px]">{l.subject}</span><span className="text-[10px] font-mono text-muted-foreground">{l.templateKey}</span></td>
                    <td className="p-3"><StatusBadge s={l.status} /></td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{when(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </CardContent></Card>
        </div>
      )}
      {open && <MessageSheet id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
