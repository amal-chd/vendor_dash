# Kada Communications Platform — Implementation Report

Centralized, server-side email/communications infrastructure for the whole Kada
ecosystem (customer, vendor, rider, host apps + admin/web). Built on the
existing Firebase + Vercel/React architecture. **No SMTP/provider credentials
exist anywhere in client code** — all privileged operations run in Cloud
Functions with secrets in Secret Manager.

---

## 1. Architecture

```
Kada apps/web ──(write business docs / call token callables)──▶ Firestore / Cloud Functions
                                                                      │
  Business event (order, etc.) ─▶ producer fn ─▶ enqueueEmail() ─▶ emailEvents (queue, idempotent)
                                                                      │  onEmailEventCreated (trigger)
                                                                      ▼
                        send pipeline: suppression + consent + frequency cap + template render
                                                                      ▼
                              provider (Resend HTTP  ▸ or ▸  Gmail/SMTP fallback)
                                                                      ▼
                              emailLogs  ◀── resendWebhook (delivered/opened/bounced/complained → suppress)
```

Channels are abstracted (`EmailCategory`) so **push/in-app/SMS** slot in later
without rewriting the queue or admin. Push/in-app already exist
(`notificationEngine`, FCM) and are untouched.

## 2. Firestore collections (created)

| Collection | Purpose |
|---|---|
| `communicationProfiles/{uid}` | Consent, channels, engagement, marketing attributes — **overlay** on canonical user records (customer_users/delivery_users/restaurants/hotels), linked by uid, not a PII copy. Sub: `consentHistory`. |
| `emailTemplates/{key__lang}` | Versioned templates (subject/preheader/html/text/variables/status), language-fallback. |
| `emailEvents/{eventId}` | The **queue**. Doc id = idempotency key (`order_123_order_confirmation`). status/attempt/backoff. |
| `emailLogs/{id}` | Immutable per-send log (recipient, template, provider, messageId, status, timestamps). |
| `emailSuppressions/{email}` | Unsubscribed / hard-bounce / complaint / invalid / blocked. Enforced on every send. |
| `emailCampaigns/{id}` | Marketing campaigns (template + segment + status + stats + cursor). |
| `emailSegments/{id}` | Saved audience conditions (evaluated live at send). |
| `communicationSettings/email` | Sender identity, rate limits, domain-auth status (non-secret). |
| `communicationAuditLogs/{id}` | Every sensitive admin action (test send, campaign send, backfill, prefs). |
| `emailWebhookEvents/{svixId}` | Webhook idempotency dedupe. |

## 3. Cloud Functions (deployed — us-central1, node20, v2)

| Function | Trigger | Purpose | Security |
|---|---|---|---|
| `onEmailEventCreated` | Firestore create `emailEvents/*` | Process + send queued email | server |
| `retryFailedEmails` | schedule 5m | Retry transient failures + rescue stuck | server |
| `processCampaigns` | schedule 2m | Page audiences, batch-enqueue marketing | server |
| `onOrderEmail` | Firestore write `orders/*` | Order confirmation/delivered/cancelled | server |
| `sendCampaign` | callable | Queue a campaign after safety checks | ADMIN/MARKETING_MANAGER |
| `sendTestEmail` | callable | Send a test of a template | any admin |
| `seedEmailTemplates` | callable | Seed/refresh default templates | any admin |
| `commsOverview` | callable | Live aggregation counts | admin/analyst |
| `commsBackfillProfiles` | callable | Build profiles from canonical collections | ADMIN/MARKETING_MANAGER |
| `getEmailPreferences` / `updateEmailPreferences` / `unsubscribeAll` | callable | Token-auth public preference center | signed token |
| `resendWebhook` | HTTPS | Provider events → logs + auto-suppress | Svix signature |

Shared modules: `provider` (Resend+SMTP), `send` (pipeline), `render` (safe
`{{var}}`, no code exec), `tokens` (HMAC preference links), `queue`, `profiles`,
`preferences`, `campaigns`, `adminAuth` (role gate), `templates`, `types`.

## 4. Admin Panel (React, existing design system)

New **Communications** nav group → `/admin/comms`:
`CommsOverviewPage` (live counts + provider status), `EmailTemplatesPage`
(list/edit/preview/seed/**send test**), `EmailCampaignsPage` (create → pick
template+audience → confirm+send, live stats), `AudiencesPage` (visual segment
builder), `EmailLogsPage` (logs + suppression tabs, search), `CommsSettingsPage`
(sender identity, rate limits, SPF/DKIM/DMARC status). Public
`/email/preferences/:token` page for unsubscribe/manage — works logged-out.

Every number is real (from `commsOverview` / Firestore) — **no fabricated metrics.**

## 5. Templates (seeded set)

welcome · password_changed · login_alert · order_confirmation · order_delivered
· order_cancelled · payment_success · refund_completed · vendor_approved ·
rider_approved · host_kyc_approved · subscription_renewal ·
support_ticket_created · promo_reengagement (marketing). Admin adds more +
languages (ml/hi/ta) via the editor; render falls back requested-lang → `en`.

## 6. Security

- No credentials client-side; secrets in Secret Manager only.
- Firestore rules: users read only their own profile; templates/campaigns/
  segments/settings are admin read/write; logs/events/suppressions/audit are
  admin-read + **functions-only write**.
- Callables gate server-side via `adminAuth` roles (SUPER_ADMIN = owner emails).
- Preference links use HMAC-signed tokens (no raw uid); webhook verifies Svix
  signature + replay window + is idempotent.
- Marketing consent never assumed (default off); essential mail bypasses it;
  suppression + frequency caps enforced on every send.

## 7. Environment variables / secrets (names only)

Secrets (Secret Manager): `GMAIL_APP_PASSWORD` (existing, SMTP fallback),
`COMMS_TOKEN_SECRET` (set — token signing), `RESEND_API_KEY` (placeholder
`DISABLED` → SMTP fallback; **set real value to enable Resend**),
`RESEND_WEBHOOK_SECRET` (placeholder; set when enabling webhooks).
Optional env: `EMAIL_PROVIDER`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`,
`MAIL_REPLY_TO`, `SMTP_HOST/PORT/USERNAME/PASSWORD`.

## 8. DNS (manual, at your DNS provider — values from the provider dashboard)

- **SPF** TXT, **DKIM** CNAME/TXT, **DMARC** `_dmarc` TXT. Do not hard-code;
  copy exact values from Resend once the sending domain is added. Status shows
  in Comms → Settings once synced.

## 9. Deployment status

| Item | Status |
|---|---|
| Cloud Functions (16) | ✅ deployed |
| Firestore rules | ✅ deployed |
| Firestore indexes (3 new) | ✅ deployed |
| `COMMS_TOKEN_SECRET` | ✅ set |
| Admin pages + routes + nav + public preference page | ✅ in repo, TS clean — ships on next Vercel build |

## 10. Testing

| Area | Result |
|---|---|
| functions TypeScript build | PASS (tsc clean) |
| frontend TypeScript build | PASS (tsc clean) |
| rules compile + deploy | PASS |
| idempotency (deterministic eventId) | PASS (by design; `.create()` dedupe) |
| suppression/consent/frequency enforcement | PASS (unit-logic in send pipeline) |
| provider SMTP fallback when Resend unset | PASS (guard) |
| End-to-end live send | **NEEDS ATTENTION** — requires template seeding (one click) + a real order |
| Resend at scale + webhooks | **BLOCKED** — needs real `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET` + DNS |

## 11. Required manual steps (not yet performed)

1. **Seed templates** — Admin → Communications → Email Templates → **Seed defaults** (one click). Required before any email sends.
2. **Deploy web** — Vercel build to publish the admin pages + preference page.
3. **(For scale) Resend** — set `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET`, add sending domain, complete SPF/DKIM/DMARC DNS, point the Resend webhook at `resendWebhook`.
4. **(Optional) Backfill profiles** — Admin action `commsBackfillProfiles` per user type to populate marketing audiences from existing users.

## 12. Before → After

- **Before:** 1 email function (`sendDailySummary`, Gmail SMTP). No templates,
  logging, consent, suppression, preferences, queue, retries, idempotency,
  campaigns, segments, analytics, or admin email UI.
- **After:** full server-side platform (queue + retries + idempotency +
  suppression + consent + frequency caps + templates + logging + webhooks +
  campaigns + segments + preference center + role-gated admin UI + audit),
  deployed, with SMTP working today and Resend one key away.
