import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bell,
  CheckCircle,
  XCircle,
  Smartphone,
  Clock,
  MousePointerClick,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Megaphone,
  FileText,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import {
  NOTIFICATION_COLLECTIONS,
  NotificationDelivery,
  OverviewMetrics,
} from "@/types/notifications";
import { notificationService } from "@/services/notificationService";
import { formatDistanceToNow } from "date-fns";
import { useChannelTab } from "@/pages/admin/comms/channelShell";

const CHART_COLORS = ["#8b5cf6", "#a3e635", "#f43f5e"];

export default function NotificationOverview() {
  const setTab = useChannelTab();
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  // Built from live deliveries when present; otherwise an empty series.
  const trendData = deliveries.length
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => ({
        name,
        sent: 0,
        delivered: 0,
        failed: 0,
      }))
    : [];

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await notificationService.getOverviewMetrics();
        setMetrics(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    loadData();

    // Listen to real-time deliveries
    const q = query(
      collection(db, NOTIFICATION_COLLECTIONS.DELIVERIES),
      orderBy("createdAt", "desc"),
      limit(20),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as NotificationDelivery,
      );
      setDeliveries(data);
    }, (err) => console.error("[NotificationOverview] q listener failed", err));

    return () => unsubscribe();
  }, []);

  const channelData = [
    { name: "Push", value: deliveries.filter((d) => d.channel === "push").length },
    { name: "In-App", value: deliveries.filter((d) => d.channel === "in_app").length },
    { name: "Email", value: deliveries.filter((d) => d.channel === "email").length },
  ];
  const channelTotal = channelData.reduce((n, c) => n + c.value, 0);

  return (
    <div className="flex flex-col w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="text-sm text-muted-foreground">
            Live delivery activity and totals from campaigns and broadcasts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setTab("templates")}>
            <FileText className="w-4 h-4" /> Templates
          </Button>
          <Button variant="secondary" className="gap-2" onClick={() => setTab("create")}>
            <Sparkles className="w-4 h-4" /> Write with AI
          </Button>
          <Button className="gap-2" onClick={() => setTab("send")}>
            <Megaphone className="w-4 h-4" /> Send now
          </Button>
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          title="Sent Today"
          value={metrics?.sentToday ?? 0}
          icon={Bell}
          trend={metrics?.sentTrend || undefined}
          loading={loading}
        />
        <StatCard
          title="Delivered"
          value={metrics?.delivered ?? 0}
          icon={CheckCircle}
          suffix={`(${metrics?.deliveryRate ?? 0}%)`}
          loading={loading}
        />
        <StatCard
          title="Failed"
          value={metrics?.failed ?? 0}
          icon={XCircle}
          valueClassName="text-red-500"
          loading={loading}
        />
        <StatCard
          title="Active Devices"
          value={metrics?.activeDevices ?? 0}
          icon={Smartphone}
          loading={loading}
        />
        <StatCard
          title="Scheduled"
          value={metrics?.scheduled ?? 0}
          icon={Clock}
          loading={loading}
        />
        <StatCard
          title="Push CTR"
          value={`${metrics?.pushCtr ?? 0}%`}
          icon={MousePointerClick}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Charts */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Delivery Trends (7 Days)</CardTitle>
            <CardDescription>
              Volume of sent vs delivered notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {trendData.length === 0 ? (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">
                Charts fill in after the first deliveries arrive.
              </p>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={trendData}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient
                    id="colorDelivered"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#a3e635" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a3e635" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" className="text-xs" />
                <YAxis className="text-xs" />
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <RechartsTooltip />
                <Area
                  type="monotone"
                  dataKey="sent"
                  stroke="#8b5cf6"
                  fillOpacity={1}
                  fill="url(#colorSent)"
                />
                <Area
                  type="monotone"
                  dataKey="delivered"
                  stroke="#a3e635"
                  fillOpacity={1}
                  fill="url(#colorDelivered)"
                />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Channel Distribution</CardTitle>
            <CardDescription>By volume sent</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center">
            {channelTotal === 0 ? (
              <p className="text-sm text-muted-foreground">No channel mix yet.</p>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={channelData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {channelData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Live Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500"></span>
            </span>
            Live Activity
          </CardTitle>
          <CardDescription>
            Real-time delivery events across all apps
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground flex flex-col items-center justify-center">
              <Bell className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p>No notification activity yet.</p>
              <p className="text-sm">
                Send your first campaign to see live delivery data here.
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-4">
              {deliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className="flex items-center justify-between p-3 border rounded-lg bg-card animate-in fade-in slide-in-from-bottom-2"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <Smartphone className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{delivery.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {delivery.targetApp}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {delivery.channel}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={delivery.status} />
                    <p className="text-xs text-muted-foreground mt-1">
                      {delivery.createdAt
                        ? formatDistanceToNow(
                            (delivery.createdAt as any).toDate
                              ? (delivery.createdAt as any).toDate()
                              : new Date(delivery.createdAt as any),
                            { addSuffix: true },
                          )
                        : "just now"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  valueClassName,
  suffix,
  loading,
}: any) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <div className="h-7 w-20 bg-muted animate-pulse rounded mt-1" />
          ) : (
            <div className="flex items-baseline gap-2">
              <h3 className={`text-2xl font-bold mt-1 ${valueClassName || ""}`}>
                {value}
              </h3>
              {suffix && (
                <span className="text-sm text-muted-foreground">{suffix}</span>
              )}
            </div>
          )}
          {trend !== undefined && !loading && (
            <div
              className={`flex items-center text-xs mt-1 ${trend >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {trend >= 0 ? (
                <ArrowUpRight className="h-3 w-3 mr-1" />
              ) : (
                <ArrowDownRight className="h-3 w-3 mr-1" />
              )}
              {Math.abs(trend)}% from yesterday
            </div>
          )}
        </div>
        <div className="h-10 w-10 bg-purple-50 rounded-full flex items-center justify-center text-purple-600 dark:bg-purple-500/10">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    sent: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
    delivered: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
    read: "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300",
    failed: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  };

  return (
    <Badge
      variant="outline"
      className={`border-none ${styles[status] || "bg-muted text-foreground"}`}
    >
      {status}
    </Badge>
  );
}
