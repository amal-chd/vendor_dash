import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { COL } from "./types";

export type BroadcastAudience = "customers" | "vendors" | "riders" | "hosts" | "all_apps" | "topic:promo" | "topic:newsletter" | "topic:veg" | "segment:inactive_customers" | "segment:new_signups" | "segment:high_spenders";
// "trial" is gone from the product; only legacy docs still carry that status.
export type VendorFilter = "all" | "active" | "expired";

export interface BroadcastResult {
  recipients: number;
  pushed: number;
}

async function pushTokens(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string>,
  imageUrl?: string,
): Promise<number> {
  const unique = Array.from(new Set(tokens.filter((t) => typeof t === "string" && t)));
  let pushed = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    try {
      const res = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title, body, ...(imageUrl && { imageUrl }) },
        data,
        apns: { 
          payload: { aps: { sound: "default", badge: 1 } },
          ...(imageUrl && { fcmOptions: { imageUrl } })
        },
        android: {
          priority: "high",
          notification: { 
            channelId: "high_importance_channel", 
            sound: "default",
            ...(imageUrl && { imageUrl })
          },
        },
      });
      pushed += res.successCount;
    } catch (e) {
      logger.error("broadcast push chunk failed", e);
    }
  }
  return pushed;
}

function collectTokens(data: admin.firestore.DocumentData | undefined): string[] {
  const out: string[] = [];
  const t = data?.fcmTokens;
  if (Array.isArray(t)) {
    for (const tok of t) if (typeof tok === "string" && tok) out.push(tok);
  }
  const single = data?.fcmToken;
  if (typeof single === "string" && single) out.push(single);
  return out;
}

async function commitInbox(
  writes: Array<{ ref: admin.firestore.DocumentReference; data: Record<string, unknown> }>,
): Promise<void> {
  const db = admin.firestore();
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 450)) batch.set(w.ref, w.data);
    await batch.commit();
  }
}

export function mapAudience(raw: string | undefined): {
  audience: BroadcastAudience;
  vendorFilter: VendorFilter;
} {
  const v = (raw || "customers").toString().toLowerCase().trim();
  if (v === "all_apps") {
    return { audience: "all_apps", vendorFilter: "all" };
  }
  if (v.startsWith("topic:")) {
    return { audience: v as BroadcastAudience, vendorFilter: "all" };
  }
  if (v.startsWith("segment:")) {
    return { audience: v as BroadcastAudience, vendorFilter: "all" };
  }
  if (v === "riders" || v === "rider" || v === "delivery") {
    return { audience: "riders", vendorFilter: "all" };
  }
  if (v === "hosts" || v === "host") {
    return { audience: "hosts", vendorFilter: "all" };
  }
  if (v === "customers" || v === "customer") {
    return { audience: "customers", vendorFilter: "all" };
  }
  if (v === "active" || v === "expired") {
    return { audience: "vendors", vendorFilter: v as VendorFilter };
  }
  return { audience: "vendors", vendorFilter: "all" };
}

export async function deliverBroadcast(opts: {
  title: string;
  body: string;
  audience: BroadcastAudience;
  vendorFilter?: VendorFilter;
  type?: string;
  urgent?: boolean;
  campaignId?: string;
  imageUrl?: string;
  deepLink?: string;
}): Promise<BroadcastResult> {
  const title = opts.title.trim();
  const body = opts.body.trim();
  const type = opts.type || (opts.urgent ? "alert" : "promo");
  const db = admin.firestore();
  const tokens: string[] = [];
  const writes: Array<{ ref: admin.firestore.DocumentReference; data: Record<string, unknown> }> = [];
  const now = admin.firestore.FieldValue.serverTimestamp();
  
  const extendedData: Record<string, string> = { type, audience: opts.audience };
  const customerPayload = {
    title,
    body,
    read: false,
    type,
    orderId: null,
    timestamp: now,
    ...(opts.imageUrl && { imageUrl: opts.imageUrl }),
    ...(opts.deepLink && { deepLink: opts.deepLink }),
  };
  const vendorPayload = {
    title,
    message: body,
    source: "admin",
    severity: opts.urgent ? "high" : "info",
    read: false,
    metadata: { campaignId: opts.campaignId || null },
    createdAt: now,
  };
  const riderPayload = { title, body, type, isRead: false, createdAt: now };
  const hostPayload = { title, body, read: false, type, createdAt: now };

  type QueryConfig = {
    query: admin.firestore.Query;
    getRef: (id: string, ref: admin.firestore.DocumentReference) => admin.firestore.DocumentReference;
    getPayload: (doc: admin.firestore.DocumentData, id: string) => Record<string, unknown>;
  };

  const queries: QueryConfig[] = [];

  const pushCustomer: QueryConfig = {
    query: db.collection("customer_users").limit(5000),
    getRef: (id, ref) => ref.collection("notifications").doc(),
    getPayload: () => customerPayload,
  };
  const pushRider: QueryConfig = {
    query: db.collection("delivery_users").limit(3000),
    getRef: (id, ref) => db.collection("riders").doc(id).collection("notifications").doc(),
    getPayload: () => riderPayload,
  };
  const pushVendor: QueryConfig = {
    query: db.collection("restaurants").limit(2000),
    getRef: (id, ref) => db.collection("restaurants").doc(id).collection("notifications").doc(),
    getPayload: (doc, id) => ({ ...vendorPayload, restaurantId: id }),
  };
  const pushHost: QueryConfig = {
    query: db.collection("hotels").limit(1000),
    getRef: (id, ref) => ref.collection("notifications").doc(),
    getPayload: () => hostPayload,
  };

  if (opts.audience === "all_apps") {
    queries.push(pushCustomer, pushRider, pushVendor, pushHost);
  } else if (opts.audience === "customers") {
    queries.push(pushCustomer);
  } else if (opts.audience === "riders") {
    queries.push(pushRider);
  } else if (opts.audience === "hosts") {
    queries.push(pushHost);
  } else if (opts.audience === "vendors") {
    let q: admin.firestore.Query = db.collection("restaurants").limit(2000);
    if (opts.vendorFilter && opts.vendorFilter !== "all") {
      q = db.collection("restaurants").where("subscriptionStatus", "==", opts.vendorFilter).limit(2000);
    }
    queries.push({ ...pushVendor, query: q });
  } else if (opts.audience.startsWith("topic:")) {
    const topic = opts.audience.split(":")[1];
    queries.push({ ...pushCustomer, query: db.collection("customer_users").where("preferences", "array-contains", topic).limit(5000) });
  } else if (opts.audience === "segment:inactive_customers") {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    queries.push({ ...pushCustomer, query: db.collection("customer_users").where("lastOrderDate", "<", admin.firestore.Timestamp.fromDate(date)).limit(5000) });
  } else if (opts.audience === "segment:new_signups") {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    queries.push({ ...pushCustomer, query: db.collection("customer_users").where("createdAt", ">", admin.firestore.Timestamp.fromDate(date)).limit(5000) });
  } else if (opts.audience === "segment:high_spenders") {
    queries.push({ ...pushCustomer, query: db.collection("customer_users").where("totalSpent", ">", 5000).limit(5000) });
  }

  for (const q of queries) {
    const snap = await q.query.get();
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (data.isDeleted === true) continue;
      writes.push({
        ref: q.getRef(docSnap.id, docSnap.ref),
        data: q.getPayload(data, docSnap.id),
      });
      tokens.push(...collectTokens(data));
    }
  }

  await commitInbox(writes);
  const pushed = await pushTokens(tokens, title, body, extendedData, opts.imageUrl);

  const deliveryRef = db.collection(COL.NOTIFICATION_DELIVERIES).doc();
  await deliveryRef.set({
    campaignId: opts.campaignId || null,
    recipientId: "broadcast",
    userId: "broadcast",
    targetApp: opts.audience === "riders" ? "rider" : opts.audience === "vendors" ? "vendor" : opts.audience === "hosts" ? "host" : "customer",
    channel: "push",
    title,
    status: writes.length ? "sent" : "failed",
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
  });

  logger.info(
    `Broadcast "${title}" → ${opts.audience}: ${writes.length} inboxes, ${pushed} pushed`,
  );
  return { recipients: writes.length, pushed };
}
