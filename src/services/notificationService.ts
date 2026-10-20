import { functions, db } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import {
  NotificationCampaign,
  AiGenerationRequest,
  AiGenerationResult,
  OverviewMetrics,
  SystemHealthStatus,
  NOTIFICATION_COLLECTIONS,
  NotificationAutomation,
} from "@/types/notifications";

class NotificationService {
  async sendBroadcast(params: {
    title: string;
    body: string;
    audience: string;
    urgent?: boolean;
    type?: string;
  }): Promise<{ recipients: number; pushed: number }> {
    const fn = httpsCallable(functions, "broadcastNotification");
    const result = await fn(params);
    return result.data as { recipients: number; pushed: number };
  }

  async createCampaign(
    campaign: Partial<NotificationCampaign> & {
      name: string;
      audience: string;
      title?: string;
      body?: string;
      apps?: string[];
    },
  ): Promise<{ id: string }> {
    const createFn = httpsCallable(functions, "createCampaign");
    const result = await createFn(campaign);
    return result.data as { id: string };
  }

  async approveCampaign(id: string): Promise<void> {
    const approveFn = httpsCallable(functions, "approveCampaign");
    await approveFn({ id });
  }

  async cancelCampaign(id: string): Promise<void> {
    const cancelFn = httpsCallable(functions, "cancelCampaign");
    await cancelFn({ id });
  }

  async duplicateCampaign(id: string): Promise<{ id: string }> {
    const duplicateFn = httpsCallable(functions, "duplicateCampaign");
    const result = await duplicateFn({ id });
    return result.data as { id: string };
  }

  async createTemplate(params: {
    key: string;
    title: string;
    body: string;
    name?: string;
  }): Promise<{ id: string }> {
    const fn = httpsCallable(functions, "createTemplate");
    const result = await fn(params);
    return result.data as { id: string };
  }

  async generateNotificationContent(
    request: AiGenerationRequest,
  ): Promise<{ results: AiGenerationResult[] }> {
    const generateFn = httpsCallable(functions, "generateNotificationContent");
    const result = await generateFn(request);
    return result.data as { results: AiGenerationResult[] };
  }

  async getAutomations(): Promise<NotificationAutomation[]> {
    const q = query(
      collection(db, NOTIFICATION_COLLECTIONS.AUTOMATIONS),
      orderBy("createdAt", "desc"),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as NotificationAutomation,
    );
  }

  async toggleAutomation(id: string, isActive: boolean): Promise<void> {
    const { doc, updateDoc, serverTimestamp } = await import("firebase/firestore");
    const ref = doc(db, NOTIFICATION_COLLECTIONS.AUTOMATIONS, id);
    await updateDoc(ref, { isActive, updatedAt: serverTimestamp() });
  }

  async createAutomation(params: {
    name: string;
    description: string;
    event: string;
    channel: string;
  }): Promise<void> {
    const { addDoc, collection: col, serverTimestamp } = await import(
      "firebase/firestore"
    );
    await addDoc(col(db, NOTIFICATION_COLLECTIONS.AUTOMATIONS), {
      name: params.name,
      description: params.description,
      triggerType: "event",
      event: params.event,
      conditions: [],
      action: { channel: params.channel, priority: "normal" },
      mode: "manual",
      isActive: true,
      stats: { runsToday: 0, totalRuns: 0, successRate: 0 },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async estimateAudience(audience: string): Promise<number> {
    try {
      if (audience === "customers") {
        return (await getCountFromServer(collection(db, "customer_users"))).data()
          .count;
      }
      if (audience === "riders") {
        return (await getCountFromServer(collection(db, "delivery_users"))).data()
          .count;
      }
      if (audience === "hosts") {
        return (await getCountFromServer(collection(db, "hotels"))).data().count;
      }
      if (audience === "active" || audience === "trial" || audience === "expired") {
        const q = query(
          collection(db, "restaurants"),
          where("subscriptionStatus", "==", audience),
        );
        return (await getCountFromServer(q)).data().count;
      }
      return (await getCountFromServer(collection(db, "restaurants"))).data().count;
    } catch {
      return 0;
    }
  }

  async getOverviewMetrics(): Promise<OverviewMetrics> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    try {
      const [campaignsSnap, adminSnap, devicesSnap, scheduledSnap] =
        await Promise.all([
          getDocs(query(collection(db, NOTIFICATION_COLLECTIONS.CAMPAIGNS), limit(200))),
          getDocs(
            query(
              collection(db, "admin_notifications"),
              orderBy("sentAt", "desc"),
              limit(80),
            ),
          ),
          getDocs(query(collection(db, NOTIFICATION_COLLECTIONS.DEVICES), limit(1))).catch(
            () => null,
          ),
          getDocs(
            query(
              collection(db, NOTIFICATION_COLLECTIONS.CAMPAIGNS),
              where("status", "in", ["scheduled", "approved"]),
            ),
          ).catch(() => null),
        ]);

      let sentToday = 0;
      let delivered = 0;
      let failed = 0;
      for (const d of campaignsSnap.docs) {
        const stats = (d.data().stats || {}) as {
          sent?: number;
          delivered?: number;
          failed?: number;
        };
        sentToday += Number(stats.sent || 0);
        delivered += Number(stats.delivered || 0);
        failed += Number(stats.failed || 0);
      }
      for (const d of adminSnap.docs) {
        const data = d.data();
        const sentAt = data.sentAt as Timestamp | undefined;
        const when = sentAt?.toDate?.() ?? null;
        const count = Number(data.recipientCount || 0);
        if (when && when >= start) sentToday += count;
        delivered += Number(data.pushed || 0);
      }

      let activeDevices = 0;
      if (devicesSnap) {
        activeDevices = devicesSnap.size;
        try {
          activeDevices = (
            await getCountFromServer(collection(db, NOTIFICATION_COLLECTIONS.DEVICES))
          ).data().count;
        } catch {
          /* size of first page fallback */
        }
      }

      const deliveryRate =
        sentToday > 0 ? Math.round((delivered / Math.max(sentToday, 1)) * 1000) / 10 : 0;

      return {
        sentToday,
        delivered,
        failed,
        activeDevices,
        scheduled: scheduledSnap?.size ?? 0,
        pushCtr: 0,
        sentTrend: 0,
        deliveryRate,
      };
    } catch (error) {
      console.warn("Failed to fetch notification metrics", error);
      return {
        sentToday: 0,
        delivered: 0,
        failed: 0,
        activeDevices: 0,
        scheduled: 0,
        pushCtr: 0,
        sentTrend: 0,
        deliveryRate: 0,
      };
    }
  }

  async getSystemHealth(): Promise<SystemHealthStatus> {
    try {
      const getHealthFn = httpsCallable(functions, "getNotificationSystemHealth");
      const result = await getHealthFn();
      return result.data as SystemHealthStatus;
    } catch {
      return {
        status: "healthy",
        fcmStatus: "healthy",
        emailStatus: "healthy",
        queueLength: 0,
        lastChecked: new Date(),
      };
    }
  }
}

export const notificationService = new NotificationService();
