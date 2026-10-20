/**
 * Kada Communications — public function surface. `functions/src/index.ts`
 * re-exports this barrel so all comms Cloud Functions deploy together.
 *
 * Also exports `enqueueEmail` so any other server-side producer (vendor/rider
 * approval, subscription, support) can queue email the same safe way.
 */

// Queue worker + retry sweep
export { onEmailEventCreated, retryFailedEmails } from "./queue";
// Public producer API for other functions
export { enqueueEmail } from "./queue";

// Transactional producers
export { onOrderEmail } from "./producers";

// Public preference center / unsubscribe (token-authenticated)
export { getEmailPreferences, updateEmailPreferences, unsubscribeAll } from "./preferences";

// Admin (role-gated)
export { sendTestEmail, commsBackfillProfiles, commsOverview } from "./admin";
export { seedEmailTemplates } from "./templates";

// Provider webhooks
export { resendWebhook } from "./webhooks";

// Marketing campaigns
export { sendCampaign, processCampaigns } from "./campaigns";
