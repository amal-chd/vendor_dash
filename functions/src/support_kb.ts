import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import { embedArticle, retrieveRelevantArticles, invalidateKbCache } from "./rag";
import { SEED_ARTICLES } from "./kb_seed_data";
import { parseModelJson } from "./supportFlow";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

function assertAdmin(request: any): void {
  const email = (request.auth?.token?.email || "").toLowerCase();
  // Only a VERIFIED email may match the allowlist: email + password sign-up
  // mints tokens carrying any typed address with email_verified=false. Same
  // fix as assertAdmin in admin_operations.ts. A staff role is a custom claim
  // granted by an admin, so it carries its own trust.
  const verified = request.auth?.token?.email_verified === true;
  const role = String(request.auth?.token?.adminRole ?? "");
  const staff = [
    "super_admin", "platform_admin", "ops_manager", "finance_manager",
    "support_manager", "support_agent", "vendor_manager", "delivery_manager",
    "stay_manager", "marketing_manager", "analytics", "developer", "auditor",
  ];
  const isAdmin =
    (verified && ["thekada@gmail.com", "thekadaapp@gmail.com"].includes(email)) ||
    request.auth?.token?.admin === true ||
    request.auth?.token?.platformAdmin === true ||
    staff.includes(role);
  if (!request.auth?.uid || !isAdmin) {
    throw new HttpsError("permission-denied", "Admin sign-in required.");
  }
}

/**
 * Knowledge Base Article CRUD & Semantic Management
 */
// One-click seeding of the starter Knowledge Base for all three apps. Embeds
// each article for semantic RAG and is idempotent (skips articles already
// seeded, matched by `seedKey`), so it is safe to run more than once.
export const seedKnowledgeBase = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
  assertAdmin(request);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const col = admin.firestore().collection("knowledge_base_articles");

  let created = 0;
  let skipped = 0;
  for (const a of SEED_ARTICLES) {
    const existing = await col.where("seedKey", "==", a.seedKey).limit(1).get();
    if (!existing.empty) {
      skipped++;
      continue;
    }
    const embedded = await embedArticle(ai, a.title, a.content);
    const now = admin.firestore.FieldValue.serverTimestamp();
    await col.add({
      title: a.title,
      content: a.content,
      category: a.category,
      role: a.role,
      tags: a.tags,
      status: "published",
      embedding: embedded.embedding,
      chunks: embedded.chunks,
      embeddedAt: now,
      version: 1,
      authorEmail: request.auth?.token?.email || "seed",
      seedKey: a.seedKey,
      createdAt: now,
      updatedAt: now,
    });
    created++;
  }

  return { ok: true, created, skipped, total: SEED_ARTICLES.length };
});

export const createKbArticle = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
  assertAdmin(request);
  const { title, content, category, role, tags, status } = request.data || {};
  if (!title || !content) {
    throw new HttpsError("invalid-argument", "Title and content are required.");
  }

  // Embed for semantic RAG retrieval.
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const embedded = await embedArticle(ai, String(title), String(content));

  const now = admin.firestore.FieldValue.serverTimestamp();
  const docRef = await admin.firestore().collection("knowledge_base_articles").add({
    title: String(title).trim(),
    content: String(content).trim(),
    category: String(category || "FAQs").trim(),
    role: String(role || "all").toLowerCase(), // 'all' | 'customer' | 'vendor' | 'rider'
    tags: Array.isArray(tags) ? tags.map((t: any) => String(t).toLowerCase()) : [],
    status: ["draft", "published", "archived"].includes(status) ? status : "published",
    embedding: embedded.embedding,
    chunks: embedded.chunks,
    embeddedAt: now,
    version: 1,
    authorEmail: request.auth?.token?.email || "admin",
    createdAt: now,
    updatedAt: now,
  });

  // Save version history
  await docRef.collection("versions").add({
    version: 1,
    title: String(title).trim(),
    content: String(content).trim(),
    updatedBy: request.auth?.token?.email || "admin",
    createdAt: now,
  });

  invalidateKbCache(); // published set changed — refresh the RAG cache now
  return { id: docRef.id, ok: true };
});

export const updateKbArticle = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
  assertAdmin(request);
  const { id, title, content, category, role, tags, status } = request.data || {};
  if (!id) {
    throw new HttpsError("invalid-argument", "Article ID required.");
  }

  const docRef = admin.firestore().collection("knowledge_base_articles").doc(String(id));
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Article not found.");
  }

  const prevData = snap.data() || {};
  const newVersion = (Number(prevData.version) || 1) + 1;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const updates: Record<string, any> = {
    version: newVersion,
    updatedAt: now,
  };
  if (title !== undefined) updates.title = String(title).trim();
  if (content !== undefined) updates.content = String(content).trim();
  if (category !== undefined) updates.category = String(category).trim();
  if (role !== undefined) updates.role = String(role).toLowerCase();
  if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags.map((t: any) => String(t).toLowerCase()) : [];
  if (status !== undefined && ["draft", "published", "archived"].includes(status)) updates.status = status;

  // Re-embed when the title or content changed.
  if (title !== undefined || content !== undefined) {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const newTitle = title !== undefined ? String(title) : String(prevData.title || "");
    const newContent = content !== undefined ? String(content) : String(prevData.content || "");
    const embedded = await embedArticle(ai, newTitle, newContent);
    updates.embedding = embedded.embedding;
    updates.chunks = embedded.chunks;
    updates.embeddedAt = now;
  }

  await docRef.update(updates);
  invalidateKbCache(); // article changed — refresh the RAG cache now

  await docRef.collection("versions").add({
    version: newVersion,
    title: updates.title ?? prevData.title ?? "",
    content: updates.content ?? prevData.content ?? "",
    updatedBy: request.auth?.token?.email || "admin",
    createdAt: now,
  });

  return { id, version: newVersion, ok: true };
});

export const searchKbArticles = onCall(async (request) => {
  const { query: searchQuery, role, category } = request.data || {};
  const qStr = String(searchQuery || "").toLowerCase().trim();

  let ref = admin.firestore().collection("knowledge_base_articles").where("status", "==", "published");
  if (category && category !== "all") {
    ref = ref.where("category", "==", category);
  }

  const snap = await ref.limit(100).get();
  const results: any[] = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    const docRole = (d.role || "all").toLowerCase();
    if (role && role !== "all" && docRole !== "all" && docRole !== role.toLowerCase()) {
      continue;
    }

    const title = String(d.title || "").toLowerCase();
    const content = String(d.content || "").toLowerCase();
    const tags = Array.isArray(d.tags) ? d.tags.map((t: any) => String(t).toLowerCase()) : [];

    if (!qStr || title.includes(qStr) || content.includes(qStr) || tags.some((t: string) => t.includes(qStr))) {
      results.push({
        id: doc.id,
        title: d.title,
        content: d.content,
        category: d.category,
        role: d.role,
        tags: d.tags,
        updatedAt: d.updatedAt?.toMillis?.() || Date.now(),
      });
    }
  }

  return { results };
});

/**
 * Team & Queue Management Callables
 */
export const createTeam = onCall(async (request) => {
  assertAdmin(request);
  const { name, department, workingHours, shiftStart, shiftEnd, permissions } = request.data || {};
  if (!name || !department) {
    throw new HttpsError("invalid-argument", "Name and department required.");
  }

  const ref = await admin.firestore().collection("support_teams").add({
    name: String(name).trim(),
    department: String(department).trim(), // 'Customer Support' | 'Vendor Support' | 'Delivery Support' | 'Finance' | 'Technical' | 'Operations'
    workingHours: String(workingHours || "9 AM - 9 PM"),
    shiftStart: String(shiftStart || "09:00"),
    shiftEnd: String(shiftEnd || "21:00"),
    permissions: Array.isArray(permissions) ? permissions : ["reply", "transfer", "resolve"],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: ref.id, ok: true };
});

export const assignAgentToThread = onCall(async (request) => {
  assertAdmin(request);
  const { threadId, agentUid, agentName, department } = request.data || {};
  if (!threadId) {
    throw new HttpsError("invalid-argument", "threadId required.");
  }

  const threadRef = admin.firestore().collection("support_threads").doc(String(threadId));
  await threadRef.update({
    assignedAgentUid: agentUid || request.auth?.uid,
    assignedAgentName: agentName || request.auth?.token?.email?.split("@")[0] || "Agent",
    department: department || "Customer Support",
    status: "open",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

/**
 * Ticketing System Lifecycle & SLA Calculation
 */
export const convertThreadToTicket = onCall(async (request) => {
  assertAdmin(request);
  const { threadId, priority, category, subcategory, subject } = request.data || {};
  if (!threadId) {
    throw new HttpsError("invalid-argument", "threadId required.");
  }

  const threadRef = admin.firestore().collection("support_threads").doc(String(threadId));
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) {
    throw new HttpsError("not-found", "Thread not found.");
  }
  const tData = threadSnap.data() || {};

  // SLA Calculation based on priority
  const prio = (priority || "Medium") as "Urgent" | "High" | "Medium" | "Low";
  const hoursToAdd = prio === "Urgent" ? 0.5 : prio === "High" ? 2 : prio === "Medium" ? 12 : 24;
  const slaDeadline = new Date(Date.now() + hoursToAdd * 3600 * 1000);

  const ticketRef = await admin.firestore().collection("support_tickets").add({
    threadId: String(threadId),
    restaurantId: tData.orderId ? `Order #${tData.orderId}` : tData.participantUid || "Customer",
    restaurantName: tData.participantName || "Guest",
    subject: subject || tData.lastMessage || `Support Ticket from ${tData.participantName || "User"}`,
    priority: prio,
    category: category || "General",
    subcategory: subcategory || "Inquiry",
    status: "Open",
    assignedAgent: tData.assignedAgentName || "Unassigned",
    assignedAgentUid: tData.assignedAgentUid || null,
    slaDeadline: admin.firestore.Timestamp.fromDate(slaDeadline),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    notes: [],
  });

  // Link ticket id back to thread
  await threadRef.update({
    ticketId: ticketRef.id,
    status: "open",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ticketId: ticketRef.id, ok: true };
});

/**
 * Agent AI Assistant Callable
 * Provides real-time AI assistance for human support agents in the Admin Panel.
 */
export const getAgentAiAssistant = onCall(
  { secrets: [GEMINI_API_KEY] },
  async (request) => {
    assertAdmin(request);
    const { action, threadId, draftText, targetTone, targetLanguage } = request.data || {};
    if (!action) {
      throw new HttpsError("invalid-argument", "Action required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    // Load thread context if available
    let conversationTranscript = "";
    let participantRole = "customer";
    if (threadId) {
      const threadSnap = await admin.firestore().collection("support_threads").doc(String(threadId)).get();
      if (threadSnap.exists) {
        participantRole = threadSnap.data()?.participantRole || "customer";
        const msgsSnap = await admin.firestore().collection("support_threads").doc(String(threadId)).collection("messages").orderBy("createdAt", "desc").limit(10).get();
        conversationTranscript = msgsSnap.docs.map((d) => {
          const m = d.data();
          return `${m.sender}: ${m.text || ""}`;
        }).reverse().join("\n");
      }
    }

    let prompt = "";
    const systemInstruction = "You are an enterprise AI assistant helping human customer support agents craft perfect responses.";

    if (action === "suggest_reply") {
      prompt = `Given this conversation with a ${participantRole}:\n${conversationTranscript}\n\nSuggest 3 professional, empathetic, and direct replies that the human support agent can send right now. Return ONLY a JSON array of strings: ["Option 1", "Option 2", "Option 3"]`;
    } else if (action === "improve_grammar") {
      prompt = `Improve the grammar, clarity, and professionalism of this draft reply from a support agent, without changing its core meaning or facts:\n"${draftText}"\nReturn ONLY a JSON object: {"result": "Improved text here"}`;
    } else if (action === "adjust_tone") {
      const tone = targetTone || "Professional & Empathetic";
      prompt = `Rewrite this draft support reply to sound ${tone}:\n"${draftText}"\nReturn ONLY a JSON object: {"result": "Rewritten text here"}`;
    } else if (action === "translate") {
      const lang = targetLanguage || "Malayalam";
      prompt = `Translate this support reply into natural, clear ${lang}:\n"${draftText}"\nReturn ONLY a JSON object: {"result": "Translated text here"}`;
    } else if (action === "summarize") {
      prompt = `Summarize this support conversation concisely into bullet points covering: 1. Customer Issue, 2. Key Facts/Order Info, 3. Current Status/Next Step:\n${conversationTranscript}\nReturn ONLY a JSON object: {"result": "Summary text here"}`;
    } else if (action === "next_best_action") {
      prompt = `Based on this conversation with a ${participantRole}:\n${conversationTranscript}\n\nWhat is the recommended Next Best Action for the human agent? Provide clear guidance (e.g. issue refund, check rider GPS, verify invoice) and relevant policy suggestions. Return ONLY a JSON object: {"action": "Title of action", "details": "Explanation and policy context"}`;
    } else {
      throw new HttpsError("invalid-argument", `Unknown action: ${action}`);
    }

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.3,
          responseMimeType: "application/json",
          // An agent is waiting on this; 2.5 Flash's default thinking pass
          // added seconds without improving a rewrite or a summary.
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: AbortSignal.timeout(25_000),
        },
      });

      const parsed = parseModelJson(response.text);
      if (parsed === null || typeof parsed !== "object") {
        throw new Error("the model did not return JSON");
      }
      if (action === "suggest_reply") {
        // The inbox renders an array. The model sometimes wraps it
        // ({"replies": [...]}), which showed nothing at all.
        const list = Array.isArray(parsed)
          ? parsed
          : Object.values(parsed as Record<string, unknown>).find(Array.isArray) ?? [];
        return (list as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 3);
      }
      return parsed;
    } catch (err: any) {
      console.error("Agent AI Assistant error:", err);
      throw new HttpsError("internal", `AI Assistant failed: ${err.message}`);
    }
  }
);

/**
 * Backfill / rebuild embeddings for existing KB articles (run after enabling
 * semantic RAG, or to re-index everything). Admin-only.
 */
export const reembedKbArticles = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
  assertAdmin(request);
  const onlyMissing = request.data?.onlyMissing === true;
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const db = admin.firestore();

  const snap = await db.collection("knowledge_base_articles").limit(800).get();
  let embedded = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (onlyMissing && Array.isArray(d.chunks) && d.chunks.length > 0) {
      skipped++;
      continue;
    }
    const embeddedArticle = await embedArticle(ai, String(d.title || ""), String(d.content || ""));
    if (embeddedArticle.embedding.length > 0) {
      await doc.ref.update({
        embedding: embeddedArticle.embedding,
        chunks: embeddedArticle.chunks,
        embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      embedded++;
    }
  }
  return { ok: true, embedded, skipped, total: snap.size };
});

/** Preview semantic retrieval for a query — powers the admin "test" box. */
export const previewKbRetrieval = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
  assertAdmin(request);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const results = await retrieveRelevantArticles(admin.firestore(), ai, {
    query: String(request.data?.query || ""),
    role: String(request.data?.role || "all"),
    topK: Number(request.data?.topK) || 5,
    minScore: 0.4,
  });
  return { results };
});
