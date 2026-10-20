import * as admin from "firebase-admin";
import { allowCall } from "./rateLimit";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import { retrieveRelevantArticles } from "./rag";
import { cancelOrderForCustomer } from "./customerOrders";
import { customerCancelProblem, refundAmountRupees } from "./vendorOrderRules";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "./refunds";
import { isAdminCaller } from "./adminAuthz";
import { HOT_PATH } from "./options";
import {
  cleanSuggestedActions,
  inferRole,
  messagePreview,
  parseModelJson,
  planForUserMessage,
  wantsHuman,
} from "./supportFlow";

/**
 * Support chat — enterprise omnichannel AI platform powered by Gemini + RAG.
 *
 * Data model (`support_threads/{threadId}`):
 *   participantUid, participantRole ('customer'|'vendor'|'rider'|'host'), participantName,
 *   orderId?, status ('bot'|'escalated'|'open'|'resolved'; legacy 'disconnected' = resolved),
 *   lastMessage, lastSender, lastMessageAt, unreadForAdmin, unreadForUser,
 *   aiAnalysis?: { intent, sentiment, urgency, language, confidenceScore, summary },
 *   assignedAgentName?, assignedAgentUid?, department?
 *   + messages subcollection: { text, sender ('user'|'bot'|'admin'), createdAt, imageUrl, audioUrl, mediaType, suggestedActions }
 */

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const HISTORY_LIMIT = 16;

const SYSTEM_PROMPT = `You are "Kada Assist", the enterprise omnichannel AI support specialist for The Kada — a premier super-app spanning food & grocery delivery and KadaStay hospitality (Customer App, Vendor/KadaDine App, Delivery Partner App, and KadaStay Host App) in Kerala, India. Currency is Indian Rupees (₹).

Your goal: resolve the user's inquiry immediately with high intelligence, empathy, and speed. You are communicating with a {ROLE}.
If the user communicates in Malayalam, Hindi, Tamil, Kannada, or Arabic, ALWAYS respond fluently in their language while keeping names and technical terms clear.

### Capabilities & Guidelines:
1. **Order Tracking & Delivery**: Explain ETA, live order status, rider details if available.
2. **Refunds & Cancellations**: Apply standard refund rules (auto-initiated to source within 5–7 business days). If there is a dispute, payment failure, or complex calculation needed, escalate immediately.
3. **Vendor & Rider SOPs**: Guide vendors on menu updates, order acceptance, POS, settlement, and promotions. Guide riders on daily earnings, payouts, navigation, vehicle verification, and OTP flows.
4. **Grounded RAG Context**: Use the retrieved Knowledge Base articles below strictly. If an answer exists in the Knowledge Base, rely on it and cite relevant policy guidelines. Do not hallucinate policies.

### Smart Escalation & Human Handoff Rules:
You MUST set "escalate": true when:
- The user asks for a refund dispute, compensation, or reports an overcharge/unauthorized deduction.
- The user reports missing/spoiled items, harassment, rider/vendor/customer abuse, a physical accident, safety hazard, or account compromise.
- The user exhibits high frustration ("angry" sentiment), repeated failures, or explicitly asks for a human, agent, manager, or customer care phone call.
- You lack confidence or required tools to execute an action.

If an image or voice message is attached, carefully analyze its visual or audio contents, acknowledge specific details observed, and determine appropriate action or escalation.

Respond ONLY as strict JSON matching this exact structure:
{
  "reply": "<Your warm, clear response (2-4 sentences max unless detailed step-by-step guidance is needed)>",
  "escalate": <boolean>,
  "aiAnalysis": {
    "intent": "<e.g. Order Tracking | Refund Dispute | Payout Inquiry | Menu Management | General FAQ | Safety Issue>",
    "sentiment": "<positive | neutral | frustrated | angry>",
    "urgency": "<low | medium | high | emergency>",
    "language": "<en | ml | hi | ta | kn | ar>",
    "confidenceScore": <float 0.0 to 1.0>,
    "summary": "<1-2 sentence executive summary of user issue and current state for human agent handoff>",
    "suggestedActions": ["<Action/Quick reply 1>", "<Action/Quick reply 2>"]
  }
}`;

interface ThreadData {
  participantUid?: string;
  /** Set when the bot has asked the customer to confirm something. */
  pendingAction?: { type?: string; orderId?: string };
  participantRole?: string;
  participantName?: string;
  orderId?: string;
  status?: string;
  assignedAgentName?: string;
  assignedAgentUid?: string;
  department?: string;
  ticketId?: string;
  escalatedAt?: admin.firestore.Timestamp;
  firstResponseAt?: admin.firestore.Timestamp;
  slaBreached?: boolean;
  awaitingCsat?: boolean;
  csatRating?: number;
  csatComment?: string | null;
  csatAt?: admin.firestore.Timestamp;
}

// First-response SLA target for an escalated thread (minutes). Beyond this with
// no human reply, slaSweep flags the thread + raises a Command Center alert.
const SLA_FIRST_RESPONSE_MINS = 10;

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

function ownStorageBuckets(): string[] {
  const buckets = ["kada-restaurant-os-v1.firebasestorage.app", "kada-restaurant-os-v1.appspot.com"];
  try {
    const cfg = JSON.parse(process.env.FIREBASE_CONFIG ?? "{}") as { storageBucket?: string };
    if (cfg.storageBucket) buckets.push(cfg.storageBucket);
  } catch {
    /* fall back to the known buckets */
  }
  return buckets;
}

/** Only files uploaded to our own Storage bucket may be fetched for the AI. */
function isOwnStorageUrl(url: string): boolean {
  return ownStorageBuckets().some((b) =>
    url.startsWith(`https://firebasestorage.googleapis.com/v0/b/${b}/`),
  );
}

/**
 * Whether the thread's participant may see the linked order. A thread's
 * orderId is client-supplied, so without this the bot read out any order's
 * status, restaurant and total to whoever linked it.
 */
function orderVisibleTo(o: FirebaseFirestore.DocumentData, thread: ThreadData): boolean {
  const uid = String(thread.participantUid ?? "");
  if (!uid) return false;
  const role = String(thread.participantRole ?? "customer").toLowerCase();
  if (role === "rider") return o.riderId === uid;
  if (role === "vendor") return o.restaurantId === uid || o.parentId === uid;
  return o.customerUid === uid;
}

const FV = admin.firestore.FieldValue;

// A reply that takes longer than this is abandoned for the fallback, so the
// user is never left looking at a typing indicator.
const AI_TIMEOUT_MS = 25_000;

/**
 * Fields that open a fresh escalation. The SLA clock restarts: a thread
 * escalated a second time used to keep the first cycle's firstResponseAt and
 * slaBreached, so slaSweep never flagged it again and the inbox showed no
 * timer.
 */
function escalationPatch(): Record<string, unknown> {
  return {
    status: "escalated",
    escalatedAt: FV.serverTimestamp(),
    unreadForAdmin: FV.increment(1),
    firstResponseAt: FV.delete(),
    firstResponseSecs: FV.delete(),
    slaBreached: false,
    slaBreachedAt: FV.delete(),
  };
}

/**
 * Load the thread, creating it if the message got there first. Rules let a
 * user post into support_threads/{theirUid} before the thread doc exists (an
 * offline app queues the message; a failed create was swallowed), and the bot
 * used to return without a word. Order threads ({uid}_{orderId}) can't get
 * here: their message rule reads the parent thread.
 */
async function loadOrCreateThread(
  threadRef: FirebaseFirestore.DocumentReference,
  threadId: string,
): Promise<ThreadData | null> {
  const snap = await threadRef.get();
  if (snap.exists) return snap.data() as ThreadData;
  if (threadId.includes("_")) return null;
  const db = admin.firestore();
  const [restaurant, rider, hotel, user] = await Promise.all([
    db.collection("restaurants").doc(threadId).get(),
    db.collection("delivery_users").doc(threadId).get(),
    db.collection("hotels").doc(threadId).get(),
    admin.auth().getUser(threadId).catch(() => null),
  ]);
  if (!user) return null;
  const thread: ThreadData = {
    participantUid: threadId,
    participantRole: inferRole({
      restaurant: restaurant.exists,
      rider: rider.exists,
      hotel: hotel.exists,
    }),
    participantName:
      user.displayName?.trim() || user.email?.split("@")[0] || user.phoneNumber || "User",
    status: "bot",
  };
  await threadRef.set(
    {
      ...thread,
      participantPhone: user.phoneNumber ?? "",
      unreadForAdmin: 0,
      unreadForUser: 0,
      createdAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
    },
    { merge: true },
  );
  return thread;
}

/** Whether a customer currently holds Kada Gold (priority support). */
async function isGoldMember(uid: string): Promise<boolean> {
  try {
    const snap = await admin.firestore().collection("customer_users").doc(uid).get();
    const u = snap.data() || {};
    const goldUntilMs =
      u.goldUntil instanceof admin.firestore.Timestamp
        ? u.goldUntil.toMillis()
        : Number(u.goldUntil) || 0;
    return u.isGold === true && goldUntilMs > Date.now();
  } catch (err) {
    console.error("Failed to check Kada Gold VIP status for priority support:", err);
    return false;
  }
}

/**
 * Kada Assist's first responder. Every user message gets an answer — from a
 * deterministic fast path (cancel, human handoff, order status) or Gemini +
 * RAG — unless a person from the team is already in the chat. While a chat
 * waits for a human the AI keeps helping instead of going silent.
 *
 * The server also owns the thread's bookkeeping (preview, ordering, unread,
 * reopening a closed chat). The apps used to do it after sending, racing this
 * trigger: a reopened chat whose status flip hadn't landed yet got no answer
 * and stayed "resolved", out of every agent's queue.
 */
export const onSupportMessageCreated = onDocumentCreated(
  {
    document: "support_threads/{threadId}/messages/{messageId}",
    secrets: [GEMINI_API_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET],
    // Sized explicitly, not by the fleet default. At the default (one
    // instance, one request at a time) two people messaging together queued
    // behind each other's Gemini call. Each reply mostly awaits Gemini and
    // Firestore, so one instance can interleave many.
    ...HOT_PATH,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data() as {
      text?: string;
      sender?: string;
      imageUrl?: string;
      audioUrl?: string;
      mediaUrl?: string;
      mediaType?: string;
    };
    // Only react to messages the *user* sent.
    if ((msg.sender ?? "") !== "user") return;

    const threadId = event.params.threadId as string;
    const db = admin.firestore();
    const threadRef = db.collection("support_threads").doc(threadId);
    const thread = await loadOrCreateThread(threadRef, threadId);
    if (!thread) return;

    const plan = planForUserMessage(thread.status);
    const waiting = plan.kind === "ai" && plan.waitingForHuman;
    await threadRef.update({
      lastMessage: messagePreview(msg),
      lastSender: "user",
      lastMessageAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
      // A person is (or is about to be) reading this chat.
      ...(plan.kind === "human" || waiting ? { unreadForAdmin: FV.increment(1) } : {}),
      ...(plan.kind === "ai" && plan.reopen
        ? { status: "bot", awaitingCsat: false, pendingAction: FV.delete() }
        : {}),
    });
    if (plan.kind === "human") return;
    if (plan.reopen) {
      thread.status = "bot";
      thread.pendingAction = undefined;
    }

    // Quick replies offered to the user; "Talk to a human" is pointless while
    // one is already on the way.
    const human = waiting ? [] : ["Talk to a human"];

    /** Post a bot message and update the thread in one write. */
    const say = async (
      text: string,
      opts: { actions?: string[]; patch?: Record<string, unknown>; extra?: Record<string, unknown> } = {},
    ) => {
      const now = FV.serverTimestamp();
      const batch = db.batch();
      batch.set(threadRef.collection("messages").doc(), {
        text,
        sender: "bot",
        senderName: "Kada Assist",
        ...(opts.actions?.length ? { suggestedActions: opts.actions } : {}),
        ...(opts.extra ?? {}),
        createdAt: now,
      });
      batch.update(threadRef, {
        lastMessage: text,
        lastSender: "bot",
        lastMessageAt: now,
        updatedAt: now,
        unreadForUser: FV.increment(1),
        ...(opts.patch ?? {}),
      });
      await batch.commit();
    };

    /**
     * Hand the chat to a person. A chat already waiting for one keeps its
     * place in the queue and its SLA clock, and agents aren't alerted twice.
     */
    const handOff = async (
      reason: string,
      analysis: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      if (waiting) return {};
      await notifyAdminsOfEscalation(threadId, thread, reason, analysis);
      return escalationPatch();
    };

    // ── Deterministic fast paths ─────────────────────────────────────────
    const textLower = (msg.text || "").trim().toLowerCase();

    // 0. Cancel an order, in chat.
    //
    // The same path as the Cancel button on the order (cancelOrderForCustomer),
    // so the window check, the refund and the audit event are identical. The
    // bot NEVER cancels on the first ask: it states what happens, then waits
    // for a yes.
    const pending = thread.pendingAction;
    const isCustomer = String(thread.participantRole ?? "customer").toLowerCase() === "customer";
    const wantsCancel =
      isCustomer &&
      /\bcancel\b/.test(textLower) &&
      (textLower.includes("order") || textLower.includes("it"));
    const saidYes = ["yes", "yes, cancel it", "yes cancel it", "confirm", "cancel it", "go ahead"]
      .includes(textLower);
    const saidNo = ["no", "no, keep it", "keep it", "don't cancel", "dont cancel", "stop"]
      .includes(textLower);

    if (pending?.type === "cancel_order" && pending.orderId && (saidYes || saidNo)) {
      await threadRef.update({ pendingAction: FV.delete() });
      if (saidNo) {
        await say("Alright — your order stays. Anything else I can help with?", {
          actions: ["Track Order", ...human],
        });
        return;
      }
      try {
        const res = await cancelOrderForCustomer(
          String(thread.participantUid),
          pending.orderId,
          "Cancelled by customer via Kada Assist",
        );
        const refunded = res.refund?.amount ?? 0;
        await say(
          refunded > 0
            ? `Done — your order is cancelled and ₹${refunded} is on its way back to how you paid. Refunds usually land in 5–7 working days.`
            : "Done — your order is cancelled. You haven't been charged.",
          { actions: ["Order something else", ...human] },
        );
      } catch (err) {
        const message =
          (err as { message?: string })?.message ||
          "I couldn't cancel it just now.";
        const patch = await handOff(`Cancel failed: ${message}`, {
          intent: "Cancellation",
          urgency: "high",
        });
        await say(`${message} I've passed this to our team so a person can help.`, { patch });
      }
      return;
    }

    if (wantsCancel) {
      const orderId = thread.orderId;
      if (!orderId) {
        await say(
          "Which order would you like to cancel? Open the order and tap Help there, and I'll have it right in front of me.",
          { actions: human },
        );
        return;
      }
      const orderSnap = await db.collection("orders").doc(orderId).get();
      const order = orderSnap.data() || {};
      if (!orderSnap.exists || !orderVisibleTo(order, thread)) {
        await say("I couldn't find that order on your account.", { actions: human });
        return;
      }
      const problem = customerCancelProblem(order);
      if (problem) {
        const patch = await handOff(`Cancellation refused: ${problem}`, {
          intent: "Cancellation",
          urgency: "high",
        });
        await say(`${problem} I've let our team know so someone can look at it with you.`, { patch });
        return;
      }
      const refundAmt = refundAmountRupees(order);
      await say(
        refundAmt > 0
          ? `I can cancel this order now — the restaurant hasn't started it. You'd get the full ₹${refundAmt} back to how you paid. Shall I cancel it?`
          : "I can cancel this order now — the restaurant hasn't started it, and you haven't been charged. Shall I cancel it?",
        {
          actions: ["Yes, cancel it", "No, keep it"],
          patch: { pendingAction: { type: "cancel_order", orderId } },
        },
      );
      return;
    }

    // 1. "Talk to a human", however it's phrased.
    if (wantsHuman(msg.text)) {
      if (waiting) {
        await say(
          "You're already in the queue — a person from our team has been alerted and will reply right here. I can keep helping in the meantime.",
        );
        return;
      }
      const aiAnalysis = {
        intent: "Direct Human Escalation",
        sentiment: "neutral",
        urgency: "medium",
        language: "en",
        confidenceScore: 1.0,
        summary: `User explicitly requested human support: ${msg.text}`,
        suggestedActions: ["Assign Agent", "View Order"],
      };
      const patch = await handOff(msg.text || "Human requested", aiAnalysis);
      await say(
        "I've flagged your request for our human support team. A specialist has been alerted and will take over this chat shortly.",
        { actions: ["Check Order Status", "Help Topics"], patch: { ...patch, aiAnalysis } },
      );
      return;
    }

    // 2. Order status, straight from the order.
    const isOrderQuery =
      (textLower.includes("where is my order") ||
        textLower.includes("order status") ||
        textLower.includes("track order") ||
        textLower.includes("check order status") ||
        textLower.includes("when will my food arrive") ||
        textLower.includes("delivery partner location")) &&
      !!thread.orderId;

    if (isOrderQuery) {
      try {
        const orderSnap = await db.collection("orders").doc(thread.orderId!).get();
        if (orderSnap.exists && orderVisibleTo(orderSnap.data() || {}, thread)) {
          const o = orderSnap.data() || {};
          const orderStatus = (o.status || "confirmed").toString().toLowerCase();
          const restName = o.restaurantName || o.outletName || "the restaurant";
          const eta = o.estimatedDeliveryTime || o.deliveryTime || "25-35 mins";

          let statusMsg = `Your order from ${restName} is currently ${orderStatus.replace(/_/g, " ")}.`;
          if (orderStatus === "preparing" || orderStatus === "cooking") {
            statusMsg = `The kitchen at ${restName} is currently preparing your food. Estimated delivery is around ${eta}.`;
          } else if (orderStatus === "picked_up" || orderStatus === "out_for_delivery") {
            statusMsg = `Your order has been picked up from ${restName} and is on its way to you!`;
          } else if (orderStatus === "delivered") {
            statusMsg = `Your order from ${restName} was marked as delivered. Please check your delivery location.`;
          }

          await say(statusMsg, {
            actions: ["Track Order", "Cancel my order", ...human],
            extra: { actionType: "open_order", actionPayload: { orderId: thread.orderId } },
          });
          return;
        }
      } catch (err) {
        console.error("Fast-path order status failed, falling back to LLM:", err);
      }
    }

    // Every reply below is a Gemini call; a message loop shouldn't be free.
    const quota = await allowCall(`support_ai_${thread.participantUid ?? threadId}`, 30, 10 * 60_000);
    if (!quota.allowed) {
      await say(
        waiting
          ? "You're sending messages very quickly. A person from our team has your messages and will reply here."
          : "You're sending messages very quickly. Give me a moment, or tap “Talk to a human” to reach our team.",
        { actions: human },
      );
      return;
    }

    const role = (thread.participantRole ?? "customer").toLowerCase();
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    // History, the linked order, the knowledge base and VIP status don't
    // depend on each other — fetch them together, not one after another.
    const [histSnap, orderSnap, articles, gold] = await Promise.all([
      threadRef.collection("messages").orderBy("createdAt", "desc").limit(HISTORY_LIMIT).get(),
      thread.orderId ? db.collection("orders").doc(thread.orderId).get() : Promise.resolve(null),
      retrieveRelevantArticles(db, ai, { query: msg.text || "", role, topK: 3 }).catch((err) => {
        console.error("RAG KB retrieval failed:", err);
        return [];
      }),
      role === "customer" && thread.participantUid
        ? isGoldMember(thread.participantUid)
        : Promise.resolve(false),
    ]);

    const history = histSnap.docs
      .map((d) => d.data() as { text?: string; sender?: string; imageUrl?: string; audioUrl?: string })
      .reverse();
    const transcript = history
      .map((m) => {
        const who = m.sender === "user" ? "User" : m.sender === "admin" ? "Human agent" : "Kada Assist";
        return `${who}: ${m.text || (m.imageUrl ? "[Image]" : m.audioUrl ? "[Voice Note]" : "")}`;
      })
      .join("\n");

    const kbContext =
      articles.length > 0
        ? articles.map((a) => `### ${a.title}\n${a.content}`).join("\n\n")
        : "No specific articles retrieved.";

    let orderContext = "No active order linked.";
    if (orderSnap && orderSnap.exists && orderVisibleTo(orderSnap.data() || {}, thread)) {
      const o = orderSnap.data() || {};
      orderContext = JSON.stringify({
        orderId: thread.orderId,
        status: o.status || "Unknown",
        total: o.total || o.totalAmount || 0,
        restaurantName: o.restaurantName || o.outletName || "Restaurant",
        itemsCount: Array.isArray(o.items) ? o.items.length : 0,
        paymentMethod: o.paymentMethod || "Online",
      });
    }

    let reply = "Thanks for reaching out! I'm connecting you with a specialized support agent who will assist you right away.";
    let escalate = true;
    let aiAnalysis: any = {
      intent: "Support Escalation",
      sentiment: "neutral",
      urgency: "medium",
      language: "en",
      confidenceScore: 0.5,
      summary: `User (${role}) needs human support: ${msg.text || "Attached media"}`,
      suggestedActions: ["Talk to a human", "Check Order Status"],
    };

    try {
      const contents: any[] = [];

      // Handle image or voice media
      const mediaAttachment = msg.imageUrl || msg.audioUrl || msg.mediaUrl;
      if (mediaAttachment) {
        try {
          // Only our own Storage uploads, bounded in size and time. This used
          // to fetch any URL a client wrote on the message.
          if (!isOwnStorageUrl(mediaAttachment)) throw new Error("attachment is not a Kada upload");
          const res = await fetch(mediaAttachment, { signal: AbortSignal.timeout(10_000) });
          const declared = Number(res.headers.get("content-length") ?? 0);
          if (!res.ok || declared > MAX_MEDIA_BYTES) {
            throw new Error(`attachment rejected (status ${res.status}, ${declared} bytes)`);
          }
          const buf = await res.arrayBuffer();
          if (buf.byteLength > MAX_MEDIA_BYTES) throw new Error("attachment too large");
          const base64Data = Buffer.from(buf).toString("base64");
          const mimeType = res.headers.get("content-type") || (msg.audioUrl ? "audio/mp3" : "image/jpeg");
          contents.push({
            inlineData: {
              data: base64Data,
              mimeType,
            },
          });
        } catch (e) {
          console.error("Failed to fetch attached media for Gemini:", e);
        }
      }

      const chatState = waiting
        ? `=== CHAT STATE ===\nThe user asked for a human agent, who has been alerted and will join this chat. Keep helping with anything you can answer meanwhile. Do not say you are escalating or transferring again.\n\n`
        : "";

      contents.push({
        text:
          `=== RETRIEVED KNOWLEDGE BASE ARTICLES ===\n${kbContext}\n\n` +
          `=== LINKED ORDER CONTEXT ===\n${orderContext}\n\n` +
          chatState +
          `=== CONVERSATION HISTORY ===\n${transcript}\n\n` +
          `Latest user message: "${msg.text || ""}"${mediaAttachment ? " (User attached media/voice)" : ""}\n\n` +
          `Generate response and analysis as strict JSON.`,
      });

      // Role-specific addendum. Hosts get hospitality SOPs instead of the
      // food-order capabilities, so Kada Assist serves all four apps from one brain.
      let systemInstruction = SYSTEM_PROMPT.replace("{ROLE}", role);
      if (role === "host") {
        systemInstruction +=
          `\n\n### KadaStay Host Context (this user is a hotel/homestay HOST):\n` +
          `Help them run their property — revenue & pricing, occupancy, bookings, check-in/out, ` +
          `housekeeping, guests & complaints, payouts & settlements, ratings/reviews, and staff. ` +
          `The food-order / rider capabilities above do NOT apply; use hospitality SOPs. ` +
          `Escalate for payout disputes, guest safety incidents, chargebacks, or account issues.`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction,
          temperature: 0.3,
          responseMimeType: "application/json",
          // 2.5 Flash thinks before answering by default, which added seconds
          // to every reply. A KB-grounded support answer doesn't need it.
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
        },
      });

      const parsed = parseModelJson(response.text) as
        | { reply?: unknown; escalate?: unknown; aiAnalysis?: unknown }
        | null;
      if (!parsed || typeof parsed !== "object") throw new Error("model reply was not JSON");
      if (typeof parsed.reply === "string" && parsed.reply.trim()) {
        reply = parsed.reply.trim();
      }
      escalate = parsed.escalate === true;
      if (parsed.aiAnalysis && typeof parsed.aiAnalysis === "object") {
        aiAnalysis = { ...aiAnalysis, ...parsed.aiAnalysis };
      }

      // Enforce smart escalation rules overrides
      if (aiAnalysis.sentiment === "angry" || ["emergency", "high"].includes(String(aiAnalysis.urgency).toLowerCase())) {
        escalate = true;
      }
      const sensitiveIntents = ["refund dispute", "abuse report", "harassment", "safety issue", "payment failure", "account compromise", "legal issue"];
      if (sensitiveIntents.some((i) => String(aiAnalysis.intent).toLowerCase().includes(i))) {
        escalate = true;
      }
    } catch (err) {
      console.error("Kada Assist AI generation failed:", err);
      reply = waiting
        ? "I couldn't look that up just now — a person from our team has your message and will reply right here."
        : "I want to make sure this gets handled properly right now, so I've flagged our human support team to jump in and assist you shortly.";
      escalate = true;
    }

    // Kada Gold members get priority support.
    if (gold) {
      aiAnalysis.urgency = "high";
      aiAnalysis.summary = `[⭐️ Kada Gold VIP] ${aiAnalysis.summary || ""}`;
      if (escalate && !waiting) {
        reply += "\n\nAs a Kada Gold VIP member, your ticket has been routed to our priority support desk.";
      }
    }

    const actions = cleanSuggestedActions(aiAnalysis.suggestedActions).filter(
      (a) => !(waiting && wantsHuman(a)),
    );
    const patch = escalate ? await handOff(msg.text || "Media attached", aiAnalysis) : {};
    await say(reply, { actions, patch: { ...patch, aiAnalysis } });
  }
);

const HOST_SYSTEM_PROMPT = `You are "Kada Assist", the AI hospitality assistant inside the Kada Stay Host app, for hotel and homestay owners in Kerala, India (currency is ₹). You help hosts run their property: revenue and pricing, occupancy, bookings, check-in/out, housekeeping, guests and complaints, payouts, ratings/reviews, and staff. Be warm, concise and practical — 2 to 5 sentences, or clear numbered steps when walking through a task. If the host writes in Malayalam, Hindi, Tamil, Kannada or Arabic, reply fluently in that language. Ground your answer in the retrieved Knowledge Base articles below and do not invent Kada Stay policies. If you genuinely cannot help, suggest contacting Kada support.`;

/**
 * Kada Stay host assistant — RAG-grounded Gemini reply on every host message.
 * Mirrors onSupportMessageCreated but for the host app's per-hotel thread at
 * `hotels/{hotelId}/assist_threads/{threadId}/messages`. Replies use sender
 * 'assist' (matching the host app), and the `sender !== 'user'` guard prevents
 * the bot's own reply from re-triggering the function.
 */
export const onHostAssistMessageCreated = onDocumentCreated(
  {
    document: "hotels/{hotelId}/assist_threads/{threadId}/messages/{messageId}",
    secrets: [GEMINI_API_KEY],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data() as { text?: string; sender?: string };
    if ((msg.sender ?? "") !== "user") return;
    if (!(msg.text || "").trim()) return;

    const { hotelId, threadId } = event.params as {
      hotelId: string;
      threadId: string;
    };
    const messagesRef = admin
      .firestore()
      .collection("hotels")
      .doc(hotelId)
      .collection("assist_threads")
      .doc(threadId)
      .collection("messages");

    // Recent history for context.
    const histSnap = await messagesRef
      .orderBy("createdAt", "desc")
      .limit(HISTORY_LIMIT)
      .get();
    const history = histSnap.docs
      .map((d) => d.data() as { text?: string; sender?: string })
      .reverse();
    const transcript = history
      .map((m) => `${m.sender === "user" ? "Host" : "Kada Assist"}: ${m.text || ""}`)
      .join("\n");

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    // RAG retrieval — host + shared ('all') articles.
    let kbContext = "No specific articles retrieved.";
    try {
      const articles = await retrieveRelevantArticles(admin.firestore(), ai, {
        query: msg.text || "",
        role: "host",
        topK: 3,
      });
      if (articles.length > 0) {
        kbContext = articles.map((a) => `### ${a.title}\n${a.content}`).join("\n\n");
      }
    } catch (err) {
      console.error("Host assist RAG retrieval failed:", err);
    }

    const wantsHuman = /\b(human|agent|person|manager|customer care|call me)\b/i.test(msg.text || "");
    let reply = wantsHuman
      ? "I've passed this to the Kada team. Someone will follow up on this property shortly."
      : "I'm here to help you run your property — ask me about pricing, occupancy, bookings, guests or payouts.";
    if (!wantsHuman) try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            text:
              `=== RETRIEVED KNOWLEDGE BASE ARTICLES ===\n${kbContext}\n\n` +
              `=== CONVERSATION HISTORY ===\n${transcript}\n\n` +
              `Latest host message: "${msg.text || ""}"\n\nReply as the hospitality assistant.`,
          },
        ],
        config: {
          systemInstruction: HOST_SYSTEM_PROMPT,
          temperature: 0.4,
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
        },
      });
      const text = response.text;
      if (text && text.trim()) reply = text.trim();
    } catch (err) {
      console.error("Host assist AI generation failed:", err);
    }

    await messagesRef.add({
      text: reply,
      sender: "assist",
      senderName: "Kada Assist",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (wantsHuman) {
      const threadRef = messagesRef.parent;
      if (threadRef) {
        await threadRef.set(
          {
            status: "escalated",
            escalatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastMessage: reply,
            unreadForAdmin: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      await admin.firestore().collection("admin_notifications").add({
        type: "support_escalation",
        title: "Host asked for a person",
        body: (msg.text || "").slice(0, 120),
        hotelId,
        threadId,
        participantRole: "host",
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);

/** Explicit "talk to a human" button in any app. */
export const escalateSupportThread = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const threadId = (request.data?.threadId ?? "").toString() || uid;

  const db = admin.firestore();
  const threadRef = db.collection("support_threads").doc(threadId);
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) throw new HttpsError("not-found", "Thread not found.");
  const thread = threadSnap.data() as ThreadData;
  if (thread.participantUid !== uid && !isAdminCaller(request)) {
    throw new HttpsError("permission-denied", "Not your thread.");
  }

  // Already with, or waiting for, a person: a second tap must not post
  // another handoff message, alert agents again or restart the SLA clock.
  const status = String(thread.status ?? "bot");
  if (status === "escalated" || status === "open") return { ok: true, already: true };

  await notifyAdminsOfEscalation(threadId, thread, "User requested a human agent.", { intent: "Human Request", urgency: "high" });
  const now = FV.serverTimestamp();
  const batch = db.batch();
  batch.set(threadRef.collection("messages").doc(), {
    text: "You're being connected to a human agent. Someone will be with you shortly — I'll keep helping here in the meantime.",
    sender: "bot",
    senderName: "Kada Assist",
    createdAt: now,
  });
  batch.update(threadRef, {
    ...escalationPatch(),
    pendingAction: FV.delete(),
    lastMessage: "Connecting to a human agent…",
    lastSender: "bot",
    lastMessageAt: now,
    updatedAt: now,
    unreadForUser: FV.increment(1),
  });
  await batch.commit();
  return { ok: true };
});

/** Admin (or the user) resolves the thread. */
export const resolveSupportThread = onCall(async (request) => {
  const uid = request.auth?.uid;
  const email = request.auth?.token?.email as string | undefined;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const threadId = (request.data?.threadId ?? "").toString() || uid;

  // Same gate as every other admin callable. This one used to accept an
  // allowlisted email without checking it was verified, and refused the
  // support_agent / support_manager staff roles the inbox is built for.
  const isAdmin = isAdminCaller(request);
  const db = admin.firestore();
  const threadRef = db.collection("support_threads").doc(threadId);
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) throw new HttpsError("not-found", "Thread not found.");
  const thread = threadSnap.data() as ThreadData;
  if (!isAdmin && thread.participantUid !== uid) {
    throw new HttpsError("permission-denied", "Not allowed.");
  }
  if (thread.status === "resolved") return { ok: true, already: true };

  // A thread is one rolling conversation, so each resolution asks for its own
  // rating. Before, a chat rated once showed "Thanks for rating us" forever
  // and rateSupportThread refused every later rating. The previous rating is
  // kept in csatHistory.
  const previous =
    typeof thread.csatRating === "number"
      ? { rating: thread.csatRating, comment: thread.csatComment ?? null, at: thread.csatAt ?? null }
      : null;

  const now = FV.serverTimestamp();
  const closing = "Glad we could help! This chat is now resolved. How would you rate your support experience?";
  const batch = db.batch();
  // Invite a CSAT rating: post a closing bot message and flag the thread so the
  // app shows the star-rating prompt (cleared once the user rates).
  batch.set(threadRef.collection("messages").doc(), {
    text: closing,
    sender: "bot",
    senderName: "Kada Assist",
    kind: "csat_request",
    createdAt: now,
  });
  batch.update(threadRef, {
    status: "resolved",
    resolvedAt: now,
    resolvedBy: isAdmin ? (email ?? "admin") : "user",
    awaitingCsat: true,
    pendingAction: FV.delete(),
    lastMessage: closing,
    lastSender: "bot",
    lastMessageAt: now,
    unreadForAdmin: 0,
    unreadForUser: FV.increment(1),
    updatedAt: now,
    csatRating: FV.delete(),
    csatComment: FV.delete(),
    csatAt: FV.delete(),
    ...(previous ? { csatHistory: FV.arrayUnion(previous) } : {}),
  });
  await batch.commit();
  return { ok: true };
});

/**
 * CSAT — the participant rates a resolved support thread (1–5 + optional note).
 * Only the thread's own user may rate, only after it's resolved, and only once.
 */
export const rateSupportThread = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const threadId = (request.data?.threadId ?? "").toString() || uid;
  const rating = Math.round(Number(request.data?.rating));
  const comment = (request.data?.comment ?? "").toString().trim().slice(0, 500);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new HttpsError("invalid-argument", "Rating must be 1–5.");
  }

  const threadRef = admin.firestore().collection("support_threads").doc(threadId);
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) throw new HttpsError("not-found", "Thread not found.");
  const thread = threadSnap.data() as ThreadData;
  if (thread.participantUid !== uid) {
    throw new HttpsError("permission-denied", "Not your thread.");
  }
  if ((thread.status ?? "") !== "resolved") {
    throw new HttpsError("failed-precondition", "You can only rate a resolved chat.");
  }
  if (typeof thread.csatRating === "number") {
    throw new HttpsError("failed-precondition", "You already rated this chat.");
  }

  await threadRef.update({
    csatRating: rating,
    csatComment: comment || null,
    csatAt: admin.firestore.FieldValue.serverTimestamp(),
    awaitingCsat: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/**
 * Push the participant a notification when a HUMAN agent replies to their
 * support thread. `onSupportMessageCreated` only reacts to sender=='user', so
 * without this an agent reply merely bumps `unreadForUser` with no push — a user
 * who closed the app after escalating would never learn a human answered.
 * Covers all four roles: customers, riders and vendors (token array on the
 * profile doc) and hosts (single token at fcm_tokens/{uid}). Also captures the
 * SLA first-response time on the first human reply.
 */
export const onSupportAgentReply = onDocumentCreated(
  { document: "support_threads/{threadId}/messages/{messageId}" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data() as { text?: string; sender?: string; imageUrl?: string };
    if ((msg.sender ?? "") !== "admin") return; // only human-agent replies

    const threadId = event.params.threadId as string;
    const db = admin.firestore();
    const threadSnap = await db.collection("support_threads").doc(threadId).get();
    if (!threadSnap.exists) return;
    const thread = threadSnap.data() as ThreadData;
    const uid = thread.participantUid;
    if (!uid) return;

    // ── SLA: the first human reply stops the first-response clock ────────────
    // Record it once (per thread) so the console + analytics can measure
    // first-response time, and clear any breach flag slaSweep may have raised.
    if (thread.escalatedAt && !thread.firstResponseAt) {
      const escalatedMs = thread.escalatedAt.toMillis?.() ?? 0;
      const secs = escalatedMs ? Math.max(0, Math.round((Date.now() - escalatedMs) / 1000)) : null;
      try {
        await db.collection("support_threads").doc(threadId).update({
          firstResponseAt: admin.firestore.FieldValue.serverTimestamp(),
          firstResponseSecs: secs,
          slaBreached: false,
        });
      } catch (err) {
        console.error("SLA first-response capture failed:", err);
      }
    }

    const role = (thread.participantRole ?? "customer").toLowerCase();
    // Every participant role is token-pushable: customers/riders/vendors keep a
    // `fcmTokens` array on their profile doc; hosts keep one token at
    // `fcm_tokens/{uid}`.
    const coll =
      role === "rider" ? "delivery_users" :
      role === "customer" ? "customer_users" :
      role === "vendor" ? "restaurants" : null;
    if (!coll && role !== "host") return;

    const raw = (msg.text ?? "").trim();
    const body = raw
      ? (raw.length > 120 ? `${raw.slice(0, 117)}…` : raw)
      : (msg.imageUrl ? "📷 Sent you an image" : "You have a new reply");
    const title = "Kada Support replied";

    // Customer inbox (matches the app's AppNotification schema). Riders get the
    // push only — their inbox schema differs.
    if (coll === "customer_users") {
      try {
        await db.collection("customer_users").doc(uid).collection("notifications").add({
          title,
          body,
          read: false,
          type: "support",
          orderId: thread.orderId ?? null,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error("support reply inbox write failed:", err);
      }
    }

    // FCM push to the participant's devices.
    try {
      let tokens: string[] = [];
      if (role === "host") {
        // KadaStay hosts store one token per user at fcm_tokens/{uid}.
        const tSnap = await db.collection("fcm_tokens").doc(uid).get();
        const t = tSnap.data()?.token;
        if (typeof t === "string" && t) tokens = [t];
      } else if (coll) {
        const userSnap = await db.collection(coll).doc(uid).get();
        const tokensRaw = userSnap.data()?.fcmTokens;
        tokens = Array.isArray(tokensRaw)
          ? tokensRaw.filter((t) => typeof t === "string" && t)
          : [];
      }
      if (tokens.length === 0) return;
      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { type: "support", threadId },
        apns: { payload: { aps: { sound: "default", badge: 1 } } },
        android: {
          priority: "high",
          notification: { channelId: "high_importance_channel", sound: "default" },
        },
      });
    } catch (err) {
      console.error("support reply push failed:", err);
    }
  }
);

/**
 * SLA sweep — flags escalated threads that blew the first-response target with
 * no human reply, and raises a single Command Center alert per breach so aging
 * conversations surface themselves instead of rotting in the inbox. Runs every
 * 5 minutes. Queries only status=='escalated' (a small set) and filters age in
 * code to avoid needing a composite index.
 */
export const slaSweep = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Asia/Kolkata" },
  async () => {
    const db = admin.firestore();
    const snap = await db
      .collection("support_threads")
      .where("status", "==", "escalated")
      .limit(300)
      .get();

    const cutoffMs = Date.now() - SLA_FIRST_RESPONSE_MINS * 60_000;
    let flagged = 0;
    for (const doc of snap.docs) {
      const t = doc.data() as ThreadData;
      if (t.firstResponseAt) continue; // already answered by a human
      if (t.slaBreached === true) continue; // already flagged
      const escalatedMs = t.escalatedAt?.toMillis?.() ?? 0;
      if (!escalatedMs || escalatedMs > cutoffMs) continue; // not old enough yet
      const waitedMins = Math.round((Date.now() - escalatedMs) / 60_000);

      await doc.ref.update({
        slaBreached: true,
        slaBreachedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection("admin_notifications").add({
        type: "support_sla_breach",
        title: `⏱️ SLA breach — ${t.participantRole || "user"} waiting ${waitedMins}m`,
        body: `${t.participantName ?? "A user"} has had no human reply for ${waitedMins} minutes.`,
        threadId: doc.id,
        participantRole: t.participantRole ?? "customer",
        urgency: "high",
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      flagged++;
    }
    if (flagged) console.log(`slaSweep flagged ${flagged} breached threads`);
  }
);

// Default canned replies ("macros") an agent can insert in one click. Seeded
// once; afterwards managed from the admin console (support_macros collection).
const DEFAULT_MACROS: { title: string; category: string; text: string }[] = [
  { title: "Greeting", category: "General", text: "Hi! This is Kada Support. Thanks for reaching out — I'm looking into this for you right now." },
  { title: "Refund initiated", category: "Refunds", text: "I've initiated your refund. It will reflect in your original payment method within 5–7 business days. Is there anything else I can help with?" },
  { title: "Order delayed", category: "Delivery", text: "Apologies for the delay on your order. I've checked with the rider and it's on the way — thanks for your patience." },
  { title: "Need order ID", category: "General", text: "Could you please share the order ID (starts with #) so I can pull up the details?" },
  { title: "Payout timeline", category: "Payouts", text: "Payouts are settled to your registered bank account within 24–48 hours of the cycle close. I've verified yours is in the queue." },
  { title: "Escalating to specialist", category: "General", text: "I'm escalating this to a specialist who can resolve it fully. They'll follow up here shortly — thanks for bearing with us." },
  { title: "Closing", category: "General", text: "Glad I could help! I'll go ahead and mark this resolved. Feel free to reach out anytime. 🙏" },
];

/** Seed the default support macros once (admin-only, idempotent). */
export const seedSupportMacros = onCall(async (request) => {
  const email = request.auth?.token?.email as string | undefined;
  if (!isAdminCaller(request)) throw new HttpsError("permission-denied", "Admins only.");

  const db = admin.firestore();
  const existing = await db.collection("support_macros").limit(1).get();
  if (!existing.empty) return { ok: true, seeded: 0, note: "already seeded" };

  const batch = db.batch();
  for (const m of DEFAULT_MACROS) {
    const ref = db.collection("support_macros").doc();
    batch.set(ref, {
      ...m,
      createdBy: email ?? "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { ok: true, seeded: DEFAULT_MACROS.length };
});

/** Write an admin_notifications doc so the admin panel surfaces the escalation. */
async function notifyAdminsOfEscalation(
  threadId: string,
  thread: ThreadData,
  lastUserMessage: string,
  aiAnalysis?: any
): Promise<void> {
  try {
    await admin.firestore().collection("admin_notifications").add({
      type: "support_escalation",
      title: `[${aiAnalysis?.urgency || "high"}] Support needs human (${thread.participantRole || "customer"})`,
      body: `${thread.participantName ?? "A user"}: ${lastUserMessage.slice(0, 120)}`,
      threadId,
      participantRole: thread.participantRole ?? "customer",
      orderId: thread.orderId ?? null,
      intent: aiAnalysis?.intent || "Escalation",
      urgency: aiAnalysis?.urgency || "high",
      summary: aiAnalysis?.summary || lastUserMessage.slice(0, 120),
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("Failed to write escalation notification:", err);
  }
}
