import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  collection,
  onSnapshot,
  query,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, XCircle, Eye } from "lucide-react";
import { StatCards } from "@/components/admin/StatCards";

interface FailedDelivery {
  id: string;
  userId: string;
  title: string;
  channel: string;
  errorMessage: string;
  attempts: number;
  failedAt: any;
  status: string;
}

export default function FailedPage() {
  const navigate = useNavigate();
  const [failures, setFailures] = useState<FailedDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "notification_deliveries"), limit(80)),
      (snapshot) => {
        setFailures(
          snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }) as FailedDelivery)
            .filter((d) => d.status === "failed"),
        );
        setLoading(false);
      },
      (error) => {
        console.error(error);
        toast.error("Failed to load failures");
        setLoading(false);
      },
    );
  }, []);

  const invalidTokens = failures.filter((f) =>
    /token|unregistered|not.?registered|invalid/i.test(String(f.errorMessage || "")),
  ).length;
  const retryPending = failures.filter((f) => (f.attempts || 0) < 3).length;

  const stats = [
    {
      label: "Total Failed",
      value: failures.length.toString(),
      icon: AlertTriangle,
      color: "text-red-500",
    },
    {
      label: "Invalid Tokens",
      value: String(invalidTokens),
      icon: XCircle,
      color: "text-orange-500",
    },
    {
      label: "Retry Pending",
      value: String(retryPending),
      icon: RefreshCw,
      color: "text-blue-500",
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="Failed Notifications"
        description="Monitor and troubleshoot delivery failures across all channels."
      />

      <StatCards items={stats} />

      {loading ? (
        <div className="space-y-4 mt-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : failures.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 border-dashed mt-6">
          <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
            <span className="text-2xl">🎉</span>
          </div>
          <h3 className="text-lg font-semibold mb-2">
            No failed notifications
          </h3>
          <p className="text-muted-foreground text-center max-w-sm mb-4">
            Your notification delivery is running smoothly!
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden mt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">User / Title</th>
                  <th className="px-4 py-3 font-medium">Channel</th>
                  <th className="px-4 py-3 font-medium">Error Message</th>
                  <th className="px-4 py-3 font-medium">Failed At</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {failures.map((failure) => (
                  <tr key={failure.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {failure.title || "Unknown Title"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        User: {failure.userId}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{failure.channel}</Badge>
                    </td>
                    <td
                      className="px-4 py-3 text-red-500 max-w-[200px] truncate"
                      title={failure.errorMessage}
                    >
                      {failure.errorMessage}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {failure.failedAt?.toDate?.().toLocaleString("en-IN") ||
                        "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* "Retry" used to toast "Retry queued" and do nothing.
                            The retry worker (retryFailedNotifications) drives
                            notification_jobs, not these delivery records, so
                            there was nothing for a per-row retry to queue.
                            Removed rather than faked. */}
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Open this customer"
                          onClick={() => navigate(`/admin/customers/${failure.userId}`)}
                          disabled={!failure.userId}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
