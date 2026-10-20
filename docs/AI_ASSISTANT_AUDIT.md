# Kada Assist — AI Assistant Ecosystem Audit

**Scope:** engineering + product + AI + security + UX + production-readiness audit of the "Kada Assist" AI support assistant across every app and backend service. Traced real journeys: client → Firestore → Cloud Function trigger → Gemini + RAG → knowledge base → reply → escalation → admin.

**Status legend:** PASS · FIXED · NEEDS ATTENTION · BLOCKED

---

## 0. Production-readiness verdict

The assistant is **substantially built and architecturally sound** — this is not a stub. It has RAG-grounded Gemini replies, role-aware prompts, multi-language, AI escalation analysis, media (image/voice) understanding, VIP routing, an admin agent/ticket workflow, and analytics. It is **NOT yet production-grade** primarily because of: one **critical data-leak** (now fixed), an **admin/agent auth model that can't scale past 2 hardcoded accounts**, **no rate limiting / abuse control** on the AI trigger, and **RAG that won't scale** past a few hundred KB articles. Verdict: **NEEDS ATTENTION** — safe to run at small scale after deploying the security fix; needs the items below before high scale.

## 1. Applications & surface audited

| Surface | Assistant present | Files |
|---|---|---|
| Customer app | ✅ (AI + human) | `services/support_chat_service.dart`, `screens/support/support_chat_screen.dart`, `kada/kada_stay_chat_screen.dart` |
| Vendor app | ✅ | `services/support_chat_service.dart`, `screens/support/support_chat_screen.dart` |
| Rider app | ✅ | `services/support_chat_service.dart`, `screens/support/support_chat_screen.dart` |
| Host (KadaStay) app | ✅ (AI only, no human escalation) | `core/services/host_assist_service.dart`, `features/assist/...host_assist_screen.dart` |
| Admin panel | ✅ (agent console) | `SupportChatsPage`, `SupportPage`, `SupportKnowledgeBasePage`, `SupportAnalyticsPage` |
| **Customer web** | ❌ **none** | — |
| Vendor web / Kada Dine web | ❌ none | — |
| Backend | ✅ | `functions/src/support.ts`, `rag.ts`, `support_kb.ts`, `ai.ts`, agent/ticket callables in `admin_operations.ts` |

**Data model:** `support_threads/{uid}` + `messages` subcollection (customer/vendor/rider); `hotels/{id}/assist_threads/{threadId}/messages` (host); `knowledge_base_articles` (RAG source); `admin_notifications` (escalation surfacing).

## 2. Findings by severity

### 🔴 CRITICAL
- **C1 — Guest support conversations were world-readable — FIXED.** `firestore.rules` allowed `threadId == 'guest_user'` with **no auth check** on read/create/update of the thread *and* messages. Signed-out users fall back to the shared `support_threads/guest_user` bucket when anonymous auth fails (`support_chat_service.dart:86`), so any person (even unauthenticated) could read every guest's support messages — names, order IDs, complaints. **Fixed:** removed the `guest_user` clauses (now fails closed) and constrained message `create` so non-admin owners can only post `sender == 'user'` (no spoofing bot/agent replies). ⚠️ **Requires `firebase deploy --only firestore:rules`.**

### 🟠 HIGH
- **H1 — Admin/agent auth can't scale — NEEDS ATTENTION.** `isAdmin()` in rules = **two hardcoded emails** (`thekada@gmail.com`, `thekadaapp@gmail.com`) + `email_verified`; the `admin`/agent custom claim is **never set by any function** (grep-confirmed). So the whole agent/ticket workflow (`assignAgentToThread`, teams, ownership) has no real multi-agent identity — you cannot onboard support agents without editing code. *Fix:* introduce a `support_agent`/`admin` custom claim set by a super-admin callable, and drive rules + admin UI off the claim (mirror the pattern already used for the `rider` claim in `admin_operations.ts:411`).
- **H2 — No rate limiting / abuse control on the AI trigger — NEEDS ATTENTION.** `onSupportMessageCreated` calls Gemini embed + generate on **every** user message with no per-user throttle. A user (or script) can spam messages → unbounded Gemini cost + potential DoS. *Fix:* per-thread token-bucket (e.g. N messages / minute) enforced in the trigger + rules `create` rate guard; cap message length.
- **H3 — RAG does not scale & has no chunking — NEEDS ATTENTION.** `rag.ts` re-fetches **all** published articles (`limit(300)`) into memory on **every** query and cosine-ranks them — Firestore read cost = KB-size × query-volume, silently ignores article #301+, and embeds only the first **2000 chars** of each article (long docs lose recall; full content is also injected uncaptured). *Fix:* chunk articles on write, cache embeddings in memory/Redis or move to a managed vector store (Vertex Vector Search / pgvector), and paginate/pre-filter candidates.

### 🟡 MEDIUM
- **M1 — Role-based KB access not enforced at the rules layer.** `knowledge_base_articles` read rule = `isAdmin() || status == 'published'` — **any** user can read **any** published article regardless of its `role` field. RAG scopes by role in retrieval, but a direct Firestore query bypasses that. Vendor/rider SOPs marked "published" are readable by customers. *Fix:* rule `allow read: if isAdmin() || (status=='published' && (role=='all' || role==<caller role>))`, or keep KB non-sensitive by policy.
- **M2 — Owner can update any thread field.** `allow update: if isThreadOwner()` lets a user set their own `status`/`assignedAgentUid`/`aiAnalysis`/`unreadForAdmin`, bypassing the escalate/resolve callables and SLA. *Fix:* restrict owner updates to a safe field set (`orderId`, `unreadForUser`, message-read markers) via `affectedKeys().hasOnly([...])`. (Left unchanged pending a check of the client's reopen/read-reset writes to avoid breakage.)
- **M3 — Host assistant has no human escalation.** `onHostAssistMessageCreated` only generates a reply — no `escalate`, no ticket, no "talk to human". Hosts cannot reach a person through Assist. *Fix:* add the escalation branch + admin notification, mirroring `onSupportMessageCreated`.
- **M4 — No streaming.** Replies are generated server-side in a Firestore trigger and appear as a whole message (client shows a typing indicator, then the full reply). Acceptable UX, but not token-streaming; long replies feel slow. *By design / optional.*
- **M5 — Customer web & Kada Dine web have no assistant.** Web users have no Kada Assist at all. *Fix:* reuse the same `support_threads` model + a thin React chat client.

### 🟢 LOW / by-design (PASS-with-notes)
- L1 — `sender` now validated on create (FIXED with C1).
- L2 — Graceful AI-failure fallback **PASS** (`support.ts:237` → apologetic reply + auto-escalate to human).
- L3 — Escalation override rules **PASS** (angry/high-urgency/sensitive-intent force escalate; VIP routing).
- L4 — Multi-language **PASS** (system prompt handles ml/hi/ta/kn/ar).
- L5 — Handoff context **PASS** (aiAnalysis summary/intent/sentiment/urgency written to thread for the agent).

## 3. Area-by-area status (the 21 requested areas)

| # | Area | Status | Note |
|---|---|---|---|
| 1 | Ecosystem audit | PASS | Mapped; customer/vendor web = gap (M5) |
| 2 | Knowledge base | NEEDS ATTENTION | RAG works but no chunking/cache/scale (H3); role not rules-enforced (M1) |
| 3 | AI response quality | PASS | Role-aware, grounded, anti-hallucination prompt, media, order context |
| 4 | Conversation & chat | NEEDS ATTENTION | Persistence/ordering OK; no streaming (M4); verify offline/retry per client |
| 5 | Talk-to-human | PASS (mobile) / NEEDS ATTENTION (host) | Escalation + context transfer good; host missing (M3) |
| 6 | Human-support admin | PASS | assign/convert-to-ticket/agent-copilot/teams/SLA exist; gated by H1 |
| 7 | Context & personalization | PASS | Order + role + VIP context injected |
| 8 | Permissions & security | FIXED (critical) / NEEDS ATTENTION | C1 fixed; H1, M1, M2, H2 remain |
| 9 | AI tool & backend arch | PASS-with-notes | Gemini 2.5-flash, JSON mode, fallback; no explicit timeout/cost caps |
| 10 | Performance & scale | NEEDS ATTENTION | RAG read-amplification (H3); no cache/queue |
| 11 | Reliability & failure | PASS-with-notes | AI/RAG/order failures degrade gracefully; add rate-limit (H2) |
| 12 | UI/UX | NOT RE-AUDITED THIS PASS | Chat UIs exist per app; a dedicated UX pass is recommended |
| 13 | Action-oriented UX | PARTIAL | `suggestedActions` returned by AI; wire them to real in-app actions |
| 14 | Voice | PASS-with-notes | Voice notes analyzed by Gemini (`support.ts` inlineData); same backend as text ✅ |
| 15 | Notifications | PASS | `admin_notifications` on escalation; unread counters both sides |
| 16 | Analytics & observability | PARTIAL | `SupportAnalyticsPage` + aiAnalysis exist; add cost/latency/CSAT/knowledge-gap metrics |
| 17 | Testing | BLOCKED | No assistant test suite; needs unit/integration/e2e (recommend build-out) |
| 18 | Cross-app consistency | NEEDS ATTENTION | 3 mobile clients consistent; host diverges (no escalation); web absent |
| 19 | Admin controls | PASS-with-notes | KB CRUD + analytics in admin; add feature toggles/model config/rate limits |
| 20 | Production readiness | NEEDS ATTENTION | After C1 deploy + H1/H2/H3 |
| 21 | This report | PASS | — |

## 4. Fixed in this pass
- **C1 (critical):** closed the `guest_user` world-readable support-thread hole and blocked client `sender` spoofing (`firestore.rules`). **Deploy required.**

## 5. Remaining blockers / recommended next steps (priority order)
1. **Deploy** the rules fix: `firebase deploy --only firestore:rules`.
2. **H1 — Agent identity:** add a `support_agent` custom claim + super-admin management callable; drive rules & admin UI off it. (Unblocks a real support team.)
3. **H2 — Rate limiting** on `onSupportMessageCreated` (per-user/thread) + message-length cap. (Cost & abuse safety.)
4. **H3 — RAG scale:** chunk-on-write + embedding cache, then a managed vector store before large KB/traffic.
5. **M1/M2** rules tightening (role-scoped KB read; restrict owner thread-field updates).
6. **M3** host escalation; **M5** web assistant.
7. **#17** assistant test suite (auth, permissions incl. cross-user isolation, escalation, RAG grounding/fallback, failure paths).
8. **#16/#19** analytics (AI cost, latency, resolution/escalation rate, CSAT, knowledge gaps) + admin feature toggles / model config.

---
*This is a foundation audit: the critical leak is fixed; the remaining items are scoped, prioritized, and safe to implement incrementally without a rewrite.*
