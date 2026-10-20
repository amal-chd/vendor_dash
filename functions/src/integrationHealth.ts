import { onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { assertAdmin } from "./admin_operations";

/**
 * Live probes for the integrations the admin page lists. Each check reports
 * whether the secret is present and, where a cheap authenticated call exists,
 * whether the provider accepts it. Nothing secret is returned.
 */
const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const GOOGLE_MAPS_SERVER_KEY = defineSecret("GOOGLE_MAPS_SERVER_KEY");

function secretValue(read: () => string): string {
  try {
    return read() || "";
  } catch {
    return "";
  }
}

export const probeIntegrations = onCall(
  {
    secrets: [
      RAZORPAY_KEY_ID,
      RAZORPAY_KEY_SECRET,
      GEMINI_API_KEY,
      RESEND_API_KEY,
      GOOGLE_MAPS_SERVER_KEY,
    ],
    timeoutSeconds: 60,
  },
  async (request) => {
    assertAdmin(request);

    const probes: { id: string; ok: boolean; detail: string }[] = [];

    try {
      await (await import("firebase-admin")).default.firestore().collection("config").limit(1).get();
      probes.push({ id: "firebase", ok: true, detail: "Firestore read succeeded." });
    } catch (e) {
      probes.push({ id: "firebase", ok: false, detail: "Firestore read failed." });
    }

    const keyId = secretValue(() => RAZORPAY_KEY_ID.value());
    const keySecret = secretValue(() => RAZORPAY_KEY_SECRET.value());
    if (!keyId || !keySecret) {
      probes.push({ id: "razorpay", ok: false, detail: "RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not set." });
    } else {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
      const res = await fetch("https://api.razorpay.com/v1/orders?count=1", {
        headers: { Authorization: `Basic ${auth}` },
      });
      probes.push({
        id: "razorpay",
        ok: res.ok,
        detail: res.ok ? "Razorpay accepted the key." : `Razorpay rejected the key (${res.status}).`,
      });
    }

    probes.push({
      id: "razorpayx",
      ok: false,
      detail: "Payouts stay off until RAZORPAY_ACCOUNT_NUMBER is set and the payout functions are deployed.",
    });

    const maps = secretValue(() => GOOGLE_MAPS_SERVER_KEY.value());
    probes.push({
      id: "google-maps",
      ok: maps.length > 0,
      detail: maps ? "GOOGLE_MAPS_SERVER_KEY is set." : "GOOGLE_MAPS_SERVER_KEY is not set.",
    });

    const gemini = secretValue(() => GEMINI_API_KEY.value());
    probes.push({
      id: "gemini",
      ok: gemini.length > 0,
      detail: gemini ? "GEMINI_API_KEY is set." : "GEMINI_API_KEY is not set.",
    });

    const resend = secretValue(() => RESEND_API_KEY.value());
    const resendLive = resend.length > 0 && resend !== "DISABLED";
    probes.push({
      id: "resend",
      ok: resendLive,
      detail: resendLive
        ? "RESEND_API_KEY is set."
        : "RESEND_API_KEY is missing or DISABLED, so mail uses SMTP.",
    });

    return { probes, checkedAt: Date.now() };
  },
);
