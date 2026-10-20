import { useEffect, useMemo, useState } from "react";
import { listenCollection } from "@/hooks/useLiveCollection";
import {
  TrendingUp,
  Bot,
  UserCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Download,
  Smile,
  Users,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SupportThread {
  id: string;
  status?: string;
  participantRole?: string;
  assignedAgentName?: string;
  createdAt?: any;
  resolvedAt?: any;
  csatRating?: number;
  /** Ratings from earlier resolutions of the same rolling thread. */
  csatHistory?: { rating?: number }[];
  firstResponseSecs?: number;
  slaBreached?: boolean;
  aiAnalysis?: {
    intent?: string;
    sentiment?: string;
    urgency?: string;
    confidenceScore?: number;
  };
}

export default function SupportAnalyticsPage() {
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return listenCollection<SupportThread>(
      "support_threads",
      { orderByField: "createdAt", limit: 500 },
      (rows) => {
        setThreads(rows);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const stats = useMemo(() => {
    const total = threads.length;
    const resolved = threads.filter((t) => t.status === "resolved").length;
    const escalated = threads.filter((t) => t.status === "escalated").length;
    const botHandled = threads.filter((t) => t.status === "bot" || (t.status === "resolved" && !t.assignedAgentName)).length;
    const humanHandled = total - botHandled;
    // Real value only — never fabricate a rate when there's no data (an empty
    // KB/support history must read as 0, not a made-up percentage).
    const aiResRate = total > 0 ? ((botHandled / total) * 100).toFixed(1) : "0.0";

    // Intent breakdown
    const intentCount: Record<string, number> = {};
    const roleCount: Record<string, number> = { customer: 0, vendor: 0, rider: 0 };
    const agentCount: Record<string, { resolved: number; active: number }> = {};

    threads.forEach((t) => {
      const intent = t.aiAnalysis?.intent || "General FAQ";
      intentCount[intent] = (intentCount[intent] || 0) + 1;

      const role = (t.participantRole || "customer").toLowerCase();
      if (roleCount[role] !== undefined) {
        roleCount[role]++;
      } else {
        roleCount.customer++;
      }

      const agent = t.assignedAgentName;
      if (agent) {
        if (!agentCount[agent]) agentCount[agent] = { resolved: 0, active: 0 };
        if (t.status === "resolved") agentCount[agent].resolved++;
        else agentCount[agent].active++;
      }
    });

    const topIntents = Object.entries(intentCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const agentLeaderboard = Object.entries(agentCount)
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.resolved - a.resolved);

    // CSAT — average of every post-chat rating (1–5). A thread is one rolling
    // conversation and each resolution is rated afresh; earlier ratings move
    // to csatHistory, so count those too.
    const rated = threads.flatMap((t) => [
      ...(Array.isArray(t.csatHistory) ? t.csatHistory.map((h) => h?.rating) : []),
      t.csatRating,
    ]).filter((r): r is number => typeof r === "number");
    const avgCsat = rated.length
      ? (rated.reduce((s, r) => s + r, 0) / rated.length).toFixed(2)
      : "—";

    // First-response SLA — average minutes to first human reply + breach count.
    const responded = threads.filter((t) => typeof t.firstResponseSecs === "number");
    const avgFirstResponseMins = responded.length
      ? (responded.reduce((s, t) => s + (t.firstResponseSecs || 0), 0) / responded.length / 60).toFixed(1)
      : "—";
    const slaBreaches = threads.filter((t) => t.slaBreached === true).length;

    return {
      total,
      resolved,
      escalated,
      botHandled,
      humanHandled,
      aiResRate,
      topIntents,
      roleCount,
      agentLeaderboard,
      avgCsat,
      csatCount: rated.length,
      avgFirstResponseMins,
      slaBreaches,
    };
  }, [threads]);

  const exportCsv = () => {
    if (threads.length === 0) return;
    const headers = ["Thread ID", "Role", "Status", "Intent", "Sentiment", "Urgency", "Assigned Agent"];
    const rows = threads.map((t) => [
      t.id,
      t.participantRole || "customer",
      t.status || "bot",
      t.aiAnalysis?.intent || "General",
      t.aiAnalysis?.sentiment || "neutral",
      t.aiAnalysis?.urgency || "low",
      t.assignedAgentName || "None (AI)",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `kada_support_analytics_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Assist analytics</h2>
          <p className="text-xs text-muted-foreground mt-1 font-bold uppercase tracking-widest flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-emerald-500" /> Real-time operational intelligence across Customer, Vendor, and Rider support
          </p>
        </div>
        <Button onClick={exportCsv} variant="outline" className="rounded-2xl gap-2 font-bold shadow-sm">
          <Download className="h-4 w-4" /> Export CSV Report
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="rounded-3xl border-border/40 shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-600 shrink-0">
                  <Bot className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">AI Resolution Rate</p>
                  <p className="text-2xl font-black text-foreground mt-0.5">{stats.aiResRate}%</p>
                  <span className="text-[10px] text-emerald-600 font-bold">First-line AI success</span>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border/40 shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 shrink-0">
                  <Smile className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">CSAT Score</p>
                  <p className="text-2xl font-black text-foreground mt-0.5">
                    {stats.avgCsat === "—" ? "—" : `${stats.avgCsat} / 5.0`}
                  </p>
                  <span className="text-[10px] text-emerald-600 font-bold">
                    {stats.csatCount > 0 ? `From ${stats.csatCount} post-chat rating${stats.csatCount > 1 ? "s" : ""}` : "Awaiting first rating"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border/40 shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 shrink-0">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Human First Response</p>
                  <p className="text-2xl font-black text-foreground mt-0.5">
                    {stats.avgFirstResponseMins === "—" ? "—" : `${stats.avgFirstResponseMins}m`}
                  </p>
                  <span className={`text-[10px] font-bold ${stats.slaBreaches > 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                    {stats.slaBreaches > 0 ? `${stats.slaBreaches} SLA breach${stats.slaBreaches > 1 ? "es" : ""}` : "Within SLA · instant bot reply"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border/40 shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Active Escalations</p>
                  <p className="text-2xl font-black text-foreground mt-0.5">{stats.escalated}</p>
                  <span className="text-[10px] text-rose-600 font-bold">Requires live agent action</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Breakdown Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Detected Intents */}
            <Card className="rounded-3xl border-border/40 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base uppercase tracking-wide text-foreground">Top AI Detected Intents</h3>
                <Badge variant="outline" className="text-[10px] font-bold">AI Categorized</Badge>
              </div>

              <div className="space-y-3">
                {stats.topIntents.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center font-bold">No intent data available yet</p>
                ) : (
                  stats.topIntents.map((item, i) => {
                    const percentage = Math.max(10, Math.round((item.count / (stats.total || 1)) * 100));
                    return (
                      <div key={i} className="space-y-1.5">
                        <div className="flex justify-between text-xs font-bold">
                          <span>{item.name}</span>
                          <span className="text-muted-foreground">{item.count} threads ({percentage}%)</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-violet-500 rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>

            {/* Department Volume Breakdown */}
            <Card className="rounded-3xl border-border/40 p-6 space-y-4 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-base uppercase tracking-wide text-foreground">Omnichannel Volume</h3>
                  <Badge variant="outline" className="text-[10px] font-bold">Across Ecosystem</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Distribution of support conversations generated from Customer, Vendor, and Delivery Partner apps.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-4">
                <div className="p-4 rounded-2xl bg-muted/40 border border-border/60 text-center space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Customer App</span>
                  <div className="text-2xl font-black text-foreground">{stats.roleCount.customer}</div>
                </div>
                <div className="p-4 rounded-2xl bg-muted/40 border border-border/60 text-center space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Vendor App</span>
                  <div className="text-2xl font-black text-foreground">{stats.roleCount.vendor}</div>
                </div>
                <div className="p-4 rounded-2xl bg-muted/40 border border-border/60 text-center space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Delivery App</span>
                  <div className="text-2xl font-black text-foreground">{stats.roleCount.rider}</div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between text-xs font-bold text-muted-foreground border-t border-border/40">
                <span>Total Conversations Tracked:</span>
                <span className="text-foreground font-black">{stats.total} threads</span>
              </div>
            </Card>

            {/* Agent Performance Leaderboard */}
            <Card className="rounded-3xl border-border/40 p-6 space-y-4 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base uppercase tracking-wide text-foreground">Human Agent Leaderboard</h3>
                <Badge variant="outline" className="text-[10px] font-bold">Resolution & Active Load</Badge>
              </div>

              {stats.agentLeaderboard.length === 0 ? (
                <div className="py-10 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  No human agents have resolved tickets yet (AI is handling most volume)
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {stats.agentLeaderboard.map((agent, idx) => (
                    <div key={idx} className="p-4 rounded-2xl bg-card border border-border/60 flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center font-black text-sm text-primary shrink-0">
                          {idx + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-sm truncate text-foreground">{agent.name}</p>
                          <span className="text-[10px] text-muted-foreground font-bold">Support Agent</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-black text-emerald-600">{agent.resolved} Resolved</div>
                        <div className="text-[10px] font-bold text-muted-foreground">{agent.active} Active</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
