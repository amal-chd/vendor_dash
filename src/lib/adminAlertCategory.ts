import type { AlertCategory, AlertSeverity } from "@/types/adminNotifications";

/**
 * Sorts a server-written `admin_notifications` doc into the bell's tabs.
 *
 * The backend raises these from many places (Kada Assist escalations and SLA
 * breaches, unverified stay payments, refunds that failed, COD excess, stuck
 * deliveries, pricing drift, cron failures …) with free-form `type` strings.
 * Match on the words in the type so a new alert lands in a sensible tab
 * without a code change here.
 */
const RULES: Array<{ test: RegExp; category: AlertCategory; href: string }> = [
  { test: /support|assist|chat|csat|sla/, category: "support", href: "/admin/support" },
  { test: /refund|payment|payout|settle|razorpay|cod|wallet|pricing|reconcil|finance|invoice|gst/, category: "finance", href: "/admin/finance" },
  { test: /onboard|kyc|bank|partner|vendor_|host_|rider_signup|document|referral/, category: "partners", href: "/admin/onboarding" },
  { test: /review|rating|quality|complaint|fraud|abuse/, category: "quality", href: "/admin/quality" },
];

const CRITICAL = /breach|fail|unverified|fraud|outage|down|stuck|exception|emergency|critical/;
const WARNING = /excess|review|delay|escalat|pending|retry|drift|low/;

export function categorizeAdminNotification(doc: {
  type?: unknown;
  severity?: unknown;
  priority?: unknown;
  href?: unknown;
}): { category: AlertCategory; severity: AlertSeverity; href: string } {
  const type = String(doc.type ?? "").toLowerCase();
  const rule = RULES.find((r) => r.test.test(type));
  const declared = String(doc.severity ?? doc.priority ?? "").toLowerCase();
  const severity: AlertSeverity =
    declared === "critical" || declared === "high" || declared === "urgent"
      ? "critical"
      : declared === "warning" || declared === "medium"
        ? "warning"
        : declared === "info" || declared === "low"
          ? "info"
          : CRITICAL.test(type)
            ? "critical"
            : WARNING.test(type)
              ? "warning"
              : "info";
  const href = typeof doc.href === "string" && doc.href.startsWith("/admin") ? doc.href : rule?.href ?? "/admin";
  return { category: rule?.category ?? "operations", severity, href };
}
