import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, CheckCircle, AlertTriangle } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NOTIFICATION_COLLECTIONS } from "@/types/notifications";

interface Campaign {
  id: string;
  name?: string;
  status?: string;
  stats?: { sent?: number; delivered?: number; failed?: number };
}

export default function AnalyticsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    return onSnapshot(query(collection(db, NOTIFICATION_COLLECTIONS.CAMPAIGNS), limit(200)), (s) => {
      setCampaigns(s.docs.map((d) => ({ id: d.id, ...d.data() })) as Campaign[]);
    }, (err) => console.error("[AnalyticsPage] query listener failed", err));
  }, []);

  const sent = campaigns.reduce((n, c) => n + Number(c.stats?.sent ?? 0), 0);
  const delivered = campaigns.reduce((n, c) => n + Number(c.stats?.delivered ?? 0), 0);
  const failed = campaigns.reduce((n, c) => n + Number(c.stats?.failed ?? 0), 0);

  const chartData = useMemo(
    () =>
      campaigns.slice(0, 12).map((c) => ({
        name: (c.name || c.id).slice(0, 12),
        sent: Number(c.stats?.sent ?? 0),
        failed: Number(c.stats?.failed ?? 0),
      })),
    [campaigns],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Campaign analytics"
        description="Totals from notification_campaigns — empty until campaigns send."
      />
      <StatCards
        stats={[
          { label: "Campaigns", value: String(campaigns.length), icon: Send },
          { label: "Sent", value: String(sent), icon: CheckCircle },
          { label: "Delivered", value: String(delivered) },
          { label: "Failed", value: String(failed), icon: AlertTriangle },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Per campaign</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px]">
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">No campaign stats yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="sent" fill="hsl(var(--primary))" />
                <Bar dataKey="failed" fill="#f43f5e" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
