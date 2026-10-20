import { useEffect, useState } from "react";
import { useCommsApp, categoryToApp, userTypeToApp, matchesApp } from "./channelShell";
import { collection, onSnapshot, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Log {
  id: string;
  recipientEmail: string;
  templateKey: string;
  category: string;
  userType?: string;
  status: string;
  provider: string;
  subject: string;
  error?: string;
  createdAt?: { toDate?: () => Date };
}
interface Suppression {
  id: string;
  email: string;
  reason: string;
  source: string;
  createdAt?: { toDate?: () => Date };
}

const statusTone: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  delivered: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  failed: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  bounced: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  complained: "bg-amber-500/10 text-amber-600 border-amber-500/20",
};

function fmt(ts?: { toDate?: () => Date }) {
  const d = ts?.toDate?.();
  return d ? d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default function EmailLogsPage() {
  const app = useCommsApp();
  const [logs, setLogs] = useState<Log[]>([]);
  const [supp, setSupp] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, "emailLogs"), limit(300)),
      (s) => { setLogs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Log, "id">) }))); setLoading(false); }, (err) => { console.error("[EmailLogsPage] emailLogs listener failed", err); setLoading(false); });
    const u2 = onSnapshot(
      query(collection(db, "emailSuppressions"), limit(300)),
      (s) => setSupp(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Suppression, "id">) }))), (err) => console.error("[EmailLogsPage] emailSuppressions listener failed", err));
    return () => { u1(); u2(); };
  }, []);

  const q = search.toLowerCase();
  const logApp = (l: Log) => (l.userType ? userTypeToApp(l.userType) : categoryToApp(l.category));
  const filteredLogs = logs.filter(
    (l) =>
      matchesApp(app, logApp(l)) &&
      (!q || l.recipientEmail?.toLowerCase().includes(q) || l.templateKey?.toLowerCase().includes(q) || l.subject?.toLowerCase().includes(q))
  );
  const filteredSupp = supp.filter((s) => !q || s.email?.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Analytics</h2>
          <p className="text-sm text-muted-foreground">Recent sends and addresses that will not be mailed again.</p>
        </div>
        <Input placeholder="Search email, template, or subject…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
      </div>

      <Tabs defaultValue="logs">
        <TabsList>
          <TabsTrigger value="logs">Logs ({filteredLogs.length})</TabsTrigger>
          <TabsTrigger value="supp">Suppression ({filteredSupp.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="logs">
          <Card><CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : filteredLogs.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">No email logs yet. They appear as emails are sent.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b">
                  <tr><th className="text-left p-3">Recipient</th><th className="text-left p-3">Subject</th><th className="text-left p-3">Status</th><th className="text-left p-3">Provider</th><th className="text-left p-3">When</th></tr>
                </thead>
                <tbody>
                  {filteredLogs.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="p-3 font-medium">{l.recipientEmail}</td>
                      <td className="p-3"><span className="text-sm">{l.subject || "—"}</span><div className="text-[10px] text-muted-foreground font-mono">{l.templateKey}</div></td>
                      <td className="p-3"><Badge variant="outline" className={cn("text-[10px]", statusTone[l.status])}>{l.status}</Badge>{l.error && <div className="text-[10px] text-rose-600 max-w-[220px] truncate" title={l.error}>{l.error}</div>}</td>
                      <td className="p-3 text-xs">{l.provider}</td>
                      <td className="p-3 text-xs text-muted-foreground">{fmt(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="supp">
          <Card><CardContent className="p-0 overflow-x-auto">
            {filteredSupp.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">Suppression list is empty.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b">
                  <tr><th className="text-left p-3">Email</th><th className="text-left p-3">Reason</th><th className="text-left p-3">Source</th><th className="text-left p-3">Added</th></tr>
                </thead>
                <tbody>
                  {filteredSupp.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="p-3 font-medium">{s.email}</td>
                      <td className="p-3"><Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 border-rose-500/20">{s.reason}</Badge></td>
                      <td className="p-3 text-xs text-muted-foreground">{s.source}</td>
                      <td className="p-3 text-xs text-muted-foreground">{fmt(s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
