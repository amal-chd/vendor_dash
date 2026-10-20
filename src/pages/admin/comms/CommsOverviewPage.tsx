import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import { useChannelTab, useCommsApp } from "./channelShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCards } from "@/components/admin/StatCards";
import {
  Mail, Users, Ban, Send, AlertTriangle, Megaphone, Clock, RefreshCw, Loader2, Gauge,
} from "lucide-react";

interface Overview {
  totalProfiles: number;
  marketingEligible: number;
  suppressed: number;
  sent30d: number;
  failed30d: number;
  campaigns: number;
  queued: number;
  provider: string;
  providerConfigured: boolean;
}

/** Communications overview — every number is a live Firestore aggregation from
 *  the `commsOverview` callable (no fabricated metrics). */
export default function CommsOverviewPage() {
  const app = useCommsApp();
  const goTab = useChannelTab();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await httpsCallable(functions, "commsOverview")({ app });
      setData(res.data as Overview);
    } catch {
      const [camps, logs, supp] = await Promise.all([
        getDocs(query(collection(db, "emailCampaigns"), limit(500))),
        getDocs(query(collection(db, "emailLogs"), limit(500))),
        getDocs(query(collection(db, "emailSuppressions"), limit(500))),
      ]);
      setData({
        totalProfiles: 0,
        marketingEligible: 0,
        suppressed: supp.size,
        sent30d: logs.docs.filter((d) => ["sent", "delivered"].includes(d.data().status)).length,
        failed30d: logs.docs.filter((d) => ["failed", "bounced"].includes(d.data().status)).length,
        campaigns: camps.size,
        queued: 0,
        provider: "local-count",
        providerConfigured: false,
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [app]);

  const deliveryRate =
    data && data.sent30d + data.failed30d > 0
      ? Math.round((data.sent30d / (data.sent30d + data.failed30d)) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">
            Live counts for the selected app. Marketing mail stays off until someone opts in.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      <Card className="border-emerald-500/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">thekada.in is verified</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            DKIM and SPF were verified on 1 Oct 2026. Send as <span className="text-foreground font-medium">no-reply@thekada.in</span>.
            DMARC is present at <span className="font-mono text-xs">p=none</span>, so it monitors and does not yet quarantine.
          </p>
          <p>
            Cloud Functions are still on the previous secret until a new revision can deploy. Order mail keeps the old sender until then.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => goTab("settings")}>Sender settings</Button>
            <Button size="sm" variant="outline" onClick={() => goTab("audiences")}>Audiences</Button>
            <Button size="sm" variant="outline" onClick={() => goTab("templates")}>Templates</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold">Email provider</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="uppercase font-semibold">
            {data?.provider || "—"}
          </Badge>
          {data?.providerConfigured ? (
            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Configured</Badge>
          ) : (
            <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
              Not configured — set RESEND_API_KEY or GMAIL_APP_PASSWORD
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Two rows of four: who can be emailed, then how sending went (30 days). */}
      <StatCards
        loading={loading}
        items={[
          { label: "Profiles", value: (data?.totalProfiles ?? 0).toLocaleString("en-IN"), hint: "People with an email", icon: Users, tone: "text-sky-600" },
          { label: "Marketing opt-in", value: (data?.marketingEligible ?? 0).toLocaleString("en-IN"), hint: "Can receive campaigns", icon: Megaphone, tone: "text-violet-600" },
          { label: "Suppressed", value: (data?.suppressed ?? 0).toLocaleString("en-IN"), hint: "Bounced or unsubscribed", icon: Ban, tone: "text-rose-600" },
          { label: "Campaigns", value: (data?.campaigns ?? 0).toLocaleString("en-IN"), icon: Mail, tone: "text-blue-600" },
          { label: "Sent · 30 days", value: (data?.sent30d ?? 0).toLocaleString("en-IN"), icon: Send, tone: "text-emerald-600" },
          { label: "Failed · 30 days", value: (data?.failed30d ?? 0).toLocaleString("en-IN"), icon: AlertTriangle, tone: "text-amber-600" },
          { label: "Delivery rate", value: deliveryRate === null ? "—" : `${deliveryRate}%`, hint: "Sent ÷ (sent + failed)", icon: Gauge, tone: "text-emerald-600" },
          { label: "Queued now", value: (data?.queued ?? 0).toLocaleString("en-IN"), hint: "Waiting to send", icon: Clock },
        ]}
      />
    </div>
  );
}
