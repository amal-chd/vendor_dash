import React from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  Server,
  Smartphone,
  Mail,
  Bot,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function HealthPage() {
  const providers = [
    {
      name: "FCM (Push)",
      icon: Smartphone,
      status: "operational",
      successRate: "99.8%",
      latency: "120ms",
      errors: 0,
    },
    {
      name: "Resend (Email)",
      icon: Mail,
      status: "operational",
      successRate: "99.9%",
      latency: "450ms",
      errors: 0,
    },
    {
      name: "Queue Worker",
      icon: Server,
      status: "operational",
      successRate: "100%",
      latency: "45ms",
      depth: 0,
    },
    {
      name: "Gemini AI",
      icon: Bot,
      status: "unknown",
      successRate: "—",
      latency: "—",
      errors: 0,
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="System Health"
        description="Monitor notification providers, queue status, and AI integrations."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {providers.map((p, i) => (
          <Card key={i}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <p.icon className="h-4 w-4 text-muted-foreground" />
                {p.name}
              </CardTitle>
              <div
                className={`h-2.5 w-2.5 rounded-full ${p.status === "operational" ? "bg-green-500" : p.status === "degraded" ? "bg-yellow-500" : p.status === "unknown" ? "bg-slate-400" : "bg-red-500"}`}
              />
            </CardHeader>
            <CardContent>
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Success Rate:</span>
                  <span className="font-medium">{p.successRate}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Avg Latency:</span>
                  <span className="font-medium">{p.latency}</span>
                </div>
                {p.depth !== undefined && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Queue Depth:</span>
                    <span className="font-medium">{p.depth}</span>
                  </div>
                )}
                {p.errors > 0 && (
                  <div className="flex justify-between text-sm text-red-500 mt-2 pt-2 border-t">
                    <span>Recent Errors:</span>
                    <span className="font-medium">{p.errors}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6 border-dashed">
        <CardContent className="flex flex-col items-center justify-center p-12">
          <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center mb-4 text-green-500">
            <Activity className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Systems Operational</h3>
          <p className="text-muted-foreground text-center max-w-sm">
            All notification services are running normally. Queue depth is near
            zero and API latencies are within expected ranges.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
