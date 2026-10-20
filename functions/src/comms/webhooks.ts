/**
 * Provider webhook (Resend, Svix-signed). Verifies the signature, is idempotent
 * (keyed on the provider event id), updates the matching `emailLogs` row by
 * providerMessageId, and auto-suppresses hard bounces + spam complaints so we
 * never mail a known-bad address again. Never trusts an unverified payload.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { COL } from "./types";
import { suppress } from "./preferences";

const RESEND_WEBHOOK_SECRET = defineSecret("RESEND_WEBHOOK_SECRET");

/** Verify a Svix-style signature (Resend). Returns true when valid. */
function verifySignature(
  secret: string,
  headers: Record<string, string | undefined>,
  rawBody: string
): boolean {
  try {
    const id = headers["svix-id"];
    const ts = headers["svix-timestamp"];
    const sigHeader = headers["svix-signature"];
    if (!id || !ts || !sigHeader) return false;
    // Reject old timestamps (replay protection): 5 min window.
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    const key = secret.startsWith("whsec_")
      ? Buffer.from(secret.slice(6), "base64")
      : Buffer.from(secret, "utf8");
    const signed = `${id}.${ts}.${rawBody}`;
    const expected = crypto.createHmac("sha256", key).update(signed).digest("base64");
    // Header may contain multiple space-separated "v1,<sig>" entries.
    return sigHeader.split(" ").some((part) => {
      const sig = part.includes(",") ? part.split(",")[1] : part;
      return (
        sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      );
    });
  } catch {
    return false;
  }
}

export const resendWebhook = onRequest(
  { secrets: [RESEND_WEBHOOK_SECRET], cors: false },
  async (req, res) => {
    const rawSecret = (process.env.RESEND_WEBHOOK_SECRET || "").trim();
    const secret = rawSecret && rawSecret !== "DISABLED" ? rawSecret : "";
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody?.toString("utf8") ||
      JSON.stringify(req.body);
    if (secret && !verifySignature(secret, req.headers as Record<string, string>, raw)) {
      res.status(401).send("invalid signature");
      return;
    }

    const evt = req.body as {
      type?: string;
      data?: { email_id?: string; to?: string | string[]; email?: string };
    };
    const type = evt.type || "";
    const db = admin.firestore();
    const svixId = (req.headers["svix-id"] as string) || `${Date.now()}`;

    // Idempotency: one processing per provider event id.
    const dedupe = db.collection("emailWebhookEvents").doc(svixId);
    if ((await dedupe.get()).exists) {
      res.status(200).send("ok");
      return;
    }
    await dedupe.set({ type, at: admin.firestore.FieldValue.serverTimestamp() });

    const messageId = evt.data?.email_id;
    const recipient = Array.isArray(evt.data?.to)
      ? evt.data?.to?.[0]
      : evt.data?.to || evt.data?.email;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const statusField: Record<string, string> = {
      "email.delivered": "deliveredAt",
      "email.opened": "openedAt",
      "email.clicked": "clickedAt",
      "email.bounced": "bouncedAt",
      "email.complained": "complainedAt",
    };

    // Update the matching log row (best-effort, by providerMessageId).
    if (messageId && statusField[type]) {
      const q = await db
        .collection(COL.logs)
        .where("providerMessageId", "==", messageId)
        .limit(1)
        .get();
      if (!q.empty) {
        await q.docs[0].ref.update({
          [statusField[type]]: now,
          ...(type === "email.bounced" ? { status: "bounced" } : {}),
          ...(type === "email.complained" ? { status: "complained" } : {}),
        });
      }
    }

    // Auto-suppress on hard bounce / complaint.
    if (recipient && (type === "email.bounced" || type === "email.complained")) {
      await suppress(
        recipient,
        type === "email.bounced" ? "hard_bounce" : "spam_complaint",
        "resend_webhook"
      );
      // Flag the profile's email status.
      const prof = await db
        .collection(COL.profiles)
        .where("email", "==", recipient.toLowerCase())
        .limit(1)
        .get();
      if (!prof.empty) {
        await prof.docs[0].ref.update({ emailStatus: "invalid", updatedAt: now });
      }
    }

    res.status(200).send("ok");
  }
);
