import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import React, { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { notificationService } from "@/services/notificationService";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Calendar as CalendarIcon, Clock, XCircle, Edit } from "lucide-react";

interface ScheduledCampaign {
  id: string;
  name: string;
  scheduledAt: any;
  audience: string;
  channels: string[];
  status: string;
}

export default function ScheduledPage() {
  const [campaigns, setCampaigns] = useState<ScheduledCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  // Was a toast that lied: it said "Campaign cancelled" while the campaign
  // stayed scheduled and sent on time.
  const handleCancel = async (id: string, name?: string) => {
    if (
      !(await confirmDialog({
        title: `Cancel "${name || "this campaign"}"?`,
        description: "It will not be sent.",
        confirmLabel: "Cancel campaign",
        cancelLabel: "Keep it scheduled",
        destructive: true,
      }))
    )
      return;
    setCancelling(id);
    try {
      await notificationService.cancelCampaign(id);
      toast.success("Campaign cancelled");
    } catch (err) {
      console.error("[ScheduledPage] cancelCampaign failed", err);
      toast.error("Couldn't cancel the campaign. It is still scheduled.");
    } finally {
      setCancelling(null);
    }
  };


  useEffect(() => {
    const q = query(
      collection(db, "notification_campaigns"),
      where("status", "in", ["scheduled", "approved"]),
      orderBy("scheduledAt", "asc"),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as ScheduledCampaign,
        );
        setCampaigns(data);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        toast.error("Failed to load scheduled campaigns");
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="Scheduled Notifications"
        description="View and manage upcoming scheduled campaigns."
      />

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 border-dashed">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <CalendarIcon className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">
            No scheduled notifications
          </h3>
          <p className="text-muted-foreground text-center max-w-sm mb-4">
            Create a campaign and schedule it for later to see it here.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {campaigns.map((campaign) => (
            <Card
              key={campaign.id}
              className="p-4 flex items-center justify-between"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-muted rounded-full hidden sm:block">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h4 className="font-semibold">{campaign.name}</h4>
                  <div className="flex gap-2 text-sm text-muted-foreground mt-1 items-center">
                    <span className="flex items-center gap-1">
                      <CalendarIcon className="h-3 w-3" />
                      {campaign.scheduledAt?.toDate?.().toLocaleString("en-IN") ||
                        "No Date"}
                    </span>
                    <span>•</span>
                    <span>Audience: {campaign.audience}</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {campaign.channels?.map((ch) => (
                      <Badge key={ch} variant="outline" className="text-xs">
                        {ch}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* "Reschedule" used to toast "Edit schedule" and do nothing.
                    There is no reschedule callable — only approveCampaign and
                    cancelCampaign exist — so the control is gone rather than
                    pretending. Cancel and recreate to move a send. */}
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={cancelling === campaign.id}
                  onClick={() => handleCancel(campaign.id, campaign.name)}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  {cancelling === campaign.id ? "Cancelling…" : "Cancel"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
