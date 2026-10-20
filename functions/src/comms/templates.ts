/**
 * Default email templates. Seeded into `emailTemplates` by `seedEmailTemplates`
 * (idempotent). Admins edit/version/add more from the Admin Panel; these are
 * the production starting set covering the core transactional + one marketing
 * flow. Bodies are inner HTML — the `wrapHtml` shell adds the branded frame.
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { COL, EmailCategory } from "./types";
import { extractVariables } from "./render";
import { assertAdmin } from "./adminAuth";

interface SeedTemplate {
  key: string;
  name: string;
  category: EmailCategory;
  subject: string;
  preheader?: string;
  html: string; // inner body html
  text: string;
}

const btn = (url: string, label: string) =>
  `<a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">${label}</a>`;
const h = (t: string) => `<h1 style="font-size:20px;margin:0 0 12px;color:#0f172a">${t}</h1>`;
const p = (t: string) => `<p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 14px">${t}</p>`;

export const DEFAULT_TEMPLATES: SeedTemplate[] = [
  {
    key: "welcome",
    name: "Welcome",
    category: "authentication",
    subject: "Welcome to The Kada, {{firstName}}!",
    preheader: "Good food, delivered.",
    html: `${h("Welcome to The Kada 👋")}${p("Hi {{firstName}}, your account is ready. Discover restaurants near you, order in a tap, and track every delivery live.")}${p(btn("https://thekada.in", "Start ordering"))}`,
    text: "Welcome to The Kada, {{firstName}}! Your account is ready. Start ordering at https://thekada.in",
  },
  {
    key: "password_changed",
    name: "Password changed",
    category: "authentication",
    subject: "Your Kada password was changed",
    html: `${h("Password changed")}${p("Hi {{firstName}}, your account password was just changed. If this was you, no action is needed.")}${p("If you did not do this, secure your account immediately and contact support.")}`,
    text: "Your Kada password was changed. If this wasn't you, contact support immediately.",
  },
  {
    key: "login_alert",
    name: "New login alert",
    category: "authentication",
    subject: "New sign-in to your Kada account",
    html: `${h("New sign-in detected")}${p("We noticed a new sign-in to your account{{#device}} on {{device}}{{/device}}. If this was you, you can ignore this email.")}${p("If you don't recognise this activity, change your password right away.")}`,
    text: "A new sign-in to your Kada account was detected. If this wasn't you, change your password.",
  },
  {
    key: "order_confirmation",
    name: "Order confirmation",
    category: "orders",
    subject: "Order confirmed · {{orderId}}",
    preheader: "We've received your order.",
    html: `${h("Order confirmed 🎉")}${p("Thanks {{firstName}}! Your order <b>{{orderId}}</b> from <b>{{vendorName}}</b> is confirmed.")}${p("Total: <b>₹{{orderTotal}}</b> · {{itemsCount}} item(s)")}${p(btn("{{{trackUrl}}}", "Track order"))}`,
    text: "Order {{orderId}} from {{vendorName}} confirmed. Total ₹{{orderTotal}}. Track: {{trackUrl}}",
  },
  {
    key: "order_delivered",
    name: "Order delivered",
    category: "orders",
    subject: "Delivered · {{orderId}} — enjoy your meal!",
    html: `${h("Delivered ✅")}${p("Your order <b>{{orderId}}</b> from <b>{{vendorName}}</b> has been delivered. Enjoy!")}${p("A receipt is available in the app. We'd love your rating.")}`,
    text: "Order {{orderId}} from {{vendorName}} delivered. Enjoy your meal!",
  },
  {
    key: "order_cancelled",
    name: "Order cancelled",
    category: "orders",
    subject: "Order {{orderId}} was cancelled",
    html: `${h("Order cancelled")}${p("Your order <b>{{orderId}}</b> has been cancelled. Any amount paid will be refunded to your original payment method within 5–7 business days.")}`,
    text: "Order {{orderId}} cancelled. Refunds (if any) arrive in 5-7 business days.",
  },
  {
    key: "payment_success",
    name: "Payment successful",
    category: "payments",
    subject: "Payment received · ₹{{amount}}",
    html: `${h("Payment successful")}${p("We've received your payment of <b>₹{{amount}}</b>{{#orderId}} for order <b>{{orderId}}</b>{{/orderId}}. Thank you!")}`,
    text: "Payment of ₹{{amount}} received. Thank you.",
  },
  {
    key: "refund_completed",
    name: "Refund completed",
    category: "payments",
    subject: "Refund completed · ₹{{amount}}",
    html: `${h("Refund completed")}${p("Your refund of <b>₹{{amount}}</b> has been processed to your original payment method. It may take a few business days to reflect.")}`,
    text: "Refund of ₹{{amount}} processed to your original payment method.",
  },
  {
    key: "vendor_approved",
    name: "Vendor approved",
    category: "vendor",
    subject: "You're live on Kada, {{vendorName}}! 🎉",
    html: `${h("Your store is approved")}${p("Congratulations {{vendorName}} — your restaurant has been approved and is now live on Kada. Start receiving orders today.")}${p(btn("https://thekada.in", "Open vendor app"))}`,
    text: "{{vendorName}}, your restaurant is approved and live on Kada!",
  },
  {
    key: "rider_approved",
    name: "Rider approved",
    category: "rider",
    subject: "You're approved to deliver with Kada!",
    html: `${h("Welcome to the fleet 🛵")}${p("Hi {{firstName}}, your delivery partner application is approved. Go online in the app to start accepting deliveries and earning.")}`,
    text: "{{firstName}}, you're approved to deliver with Kada. Go online to start earning.",
  },
  {
    key: "host_kyc_approved",
    name: "Host KYC approved",
    category: "host",
    subject: "Your property is verified on Kada Stay",
    html: `${h("Property verified ✅")}${p("Great news {{firstName}} — your property has passed KYC and is verified on Kada Stay. You can now receive bookings and payouts.")}`,
    text: "Your property is verified on Kada Stay. You can now receive bookings and payouts.",
  },
  {
    key: "subscription_renewal",
    name: "Subscription renewal reminder",
    category: "subscriptions",
    subject: "Your Kada {{planName}} renews soon",
    html: `${h("Renewal reminder")}${p("Hi {{firstName}}, your <b>{{planName}}</b> subscription renews on <b>{{renewalDate}}</b>. No action is needed to continue.")}`,
    text: "Your Kada {{planName}} subscription renews on {{renewalDate}}.",
  },
  {
    key: "support_ticket_created",
    name: "Support ticket created",
    category: "support",
    subject: "We got your message · Ticket {{supportTicketId}}",
    html: `${h("We're on it")}${p("Hi {{firstName}}, we've received your support request (<b>{{supportTicketId}}</b>). Our team will reply in this thread shortly.")}`,
    text: "Support ticket {{supportTicketId}} created. We'll reply shortly.",
  },
  {
    key: "promo_reengagement",
    name: "Re-engagement (marketing)",
    category: "marketing",
    subject: "We miss you, {{firstName}} — here's something tasty 🍔",
    preheader: "A little something to bring you back.",
    html: `${h("We miss you!")}${p("It's been a while, {{firstName}}. Your favourites near {{city}} are waiting — and there's a treat on us.")}${p(btn("https://thekada.in", "Order now"))}`,
    text: "We miss you, {{firstName}}! Your favourites near {{city}} are waiting. Order at https://thekada.in",
  },
];

/** Admin: seed/refresh the default templates (idempotent by key__en). */
export const seedEmailTemplates = onCall(async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  let created = 0;
  let updated = 0;
  for (const t of DEFAULT_TEMPLATES) {
    const id = `${t.key}__en`;
    const ref = db.collection(COL.templates).doc(id);
    const exists = (await ref.get()).exists;
    await ref.set(
      {
        key: t.key,
        name: t.name,
        category: t.category,
        subject: t.subject,
        preheader: t.preheader || "",
        html: t.html,
        text: t.text,
        language: "en",
        variables: extractVariables(`${t.subject} ${t.html} ${t.text}`),
        status: "published",
        version: 1,
        isSystem: true,
        updatedAt: now,
        ...(exists ? {} : { createdAt: now }),
      },
      { merge: true }
    );
    if (exists) updated++;
    else created++;
  }
  return { ok: true, created, updated, total: DEFAULT_TEMPLATES.length };
});
