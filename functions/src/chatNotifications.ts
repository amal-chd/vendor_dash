/**
 * Pushes for the two PERSON-TO-PERSON chats.
 *
 * Kada Assist replies have had a push since `onSupportAgentReply`, but the two
 * chats where a human is waiting on the other end had none at all:
 *
 *   • orders/{orderId}/rider_chat — customer ↔ delivery partner
 *   • hotels/{hotelId}/guest_conversations/{guestId} — guest ↔ host
 *
 * So a rider standing at the gate asking which floor, or a host answering a
 * question about check-in, reached nobody unless that person already had the
 * chat screen open. Neither side even got an unread badge: the guest chat keeps
 * a single `unreadCount` that only the host reads, and the rider chat keeps none.
 */
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";

/** A preview short enough for a notification, whatever was sent. */
function preview(msg: Record<string, unknown>): string {
  const text = String(msg.text ?? "").trim();
  if (text) return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  if (msg.imageUrl || msg.mediaUrl) return "📷 Sent a photo";
  if (msg.audioUrl) return "🎤 Sent a voice note";
  return "Sent you a message";
}

/** Tokens for a customer / rider (array on the profile) or a host (single doc). */
async function tokensFor(
  db: admin.firestore.Firestore,
  uid: string,
  kind: "customer" | "rider" | "host",
): Promise<string[]> {
  if (!uid) return [];
  try {
    if (kind === "host") {
      const snap = await db.collection("fcm_tokens").doc(uid).get();
      const t = snap.data()?.token;
      return typeof t === "string" && t ? [t] : [];
    }
    const coll = kind === "rider" ? "delivery_users" : "customer_users";
    const snap = await db.collection(coll).doc(uid).get();
    const raw = snap.data()?.fcmTokens;
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string" && !!t) : [];
  } catch (err) {
    logger.warn("chat push token lookup failed", { uid, kind, err: (err as Error)?.message });
    return [];
  }
}

async function push(args: {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}): Promise<void> {
  if (args.tokens.length === 0) return;
  try {
    await admin.messaging().sendEachForMulticast({
      tokens: args.tokens,
      notification: { title: args.title, body: args.body },
      data: args.data,
      apns: { payload: { aps: { sound: "default", badge: 1 } } },
      android: {
        priority: "high",
        notification: { channelId: "high_importance_channel", sound: "default" },
      },
    });
  } catch (err) {
    logger.error("chat push failed", { err: (err as Error)?.message });
  }
}

/** The customer app's in-app inbox (same schema `AppNotification` reads). */
async function customerInbox(
  db: admin.firestore.Firestore,
  uid: string,
  entry: { title: string; body: string; type: string; orderId?: string | null },
): Promise<void> {
  try {
    await db.collection("customer_users").doc(uid).collection("notifications").add({
      title: entry.title,
      body: entry.body,
      type: entry.type,
      orderId: entry.orderId ?? null,
      read: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.error("chat inbox write failed", { uid, err: (err as Error)?.message });
  }
}

/**
 * Customer ↔ delivery partner, during a live delivery. Notifies whichever side
 * did NOT send the message.
 */
export const onRiderChatMessage = onDocumentCreated(
  "orders/{orderId}/rider_chat/{messageId}",
  async (event) => {
    const msg = event.data?.data();
    if (!msg) return;
    const orderId = event.params.orderId as string;
    const senderRole = String(msg.senderRole ?? "");
    if (senderRole !== "rider" && senderRole !== "customer") return;

    const db = admin.firestore();
    const orderSnap = await db.collection("orders").doc(orderId).get();
    const order = orderSnap.data();
    if (!order) return;

    const body = preview(msg);
    if (senderRole === "rider") {
      const customerUid = String(order.customerUid ?? "");
      if (!customerUid) return;
      const title = String(msg.senderName ?? "Your delivery partner");
      await Promise.all([
        customerInbox(db, customerUid, { title, body, type: "delivery", orderId }),
        push({
          tokens: await tokensFor(db, customerUid, "customer"),
          title,
          body,
          // `type: delivery` + orderId lands the tap on the order, where the
          // chat is one tap away — routeNotificationData already handles it.
          data: { type: "delivery", orderId },
        }),
      ]);
      return;
    }

    const riderId = String(order.riderId ?? "");
    if (!riderId) return;
    await push({
      tokens: await tokensFor(db, riderId, "rider"),
      title: String(msg.senderName ?? "Customer"),
      body,
      data: { type: "order_chat", orderId },
    });
  },
);

/**
 * Guest ↔ host on a Kada Stay property. `guestId` is the customer's uid and
 * `hotelId` is the host's, which is how the rules identify both parties.
 */
export const onGuestConversationMessage = onDocumentCreated(
  "hotels/{hotelId}/guest_conversations/{guestId}/messages/{messageId}",
  async (event) => {
    const msg = event.data?.data();
    if (!msg) return;
    const hotelId = event.params.hotelId as string;
    const guestId = event.params.guestId as string;
    const fromHost = msg.isHost === true;

    const db = admin.firestore();
    const body = preview(msg);

    if (fromHost) {
      const hotelSnap = await db.collection("hotels").doc(hotelId).get();
      const title = String(hotelSnap.data()?.name ?? "Your host");
      await Promise.all([
        customerInbox(db, guestId, { title, body, type: "stay_chat" }),
        push({
          tokens: await tokensFor(db, guestId, "customer"),
          title,
          body,
          data: { type: "stay_chat", hotelId },
        }),
      ]);
      return;
    }

    await push({
      tokens: await tokensFor(db, hotelId, "host"),
      title: String(msg.senderName ?? "Guest"),
      body,
      data: { type: "guest_chat", hotelId, guestId },
    });
  },
);
