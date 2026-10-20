/**
 * Tamper-proof preference tokens. An unsubscribe / preferences link embeds a
 * signed token — NOT a raw user id — so the link works without login yet cannot
 * be forged or enumerated. Payload is HMAC-signed with a server secret.
 */

import * as crypto from "crypto";
import { WEB_BASE_URL, PREFERENCES_PATH } from "./types";

interface TokenPayload {
  uid: string;
  email: string;
  iat: number;
}

function secret(): string {
  return (
    process.env.COMMS_TOKEN_SECRET ||
    process.env.GMAIL_APP_PASSWORD || // fallback so links still work pre-config
    "kada-comms-dev-secret"
  );
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function createPreferenceToken(uid: string, email: string): string {
  const payload: TokenPayload = { uid, email, iat: Date.now() };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyPreferenceToken(token: string): TokenPayload | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
    // constant-time compare
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    return JSON.parse(b64urlDecode(body).toString()) as TokenPayload;
  } catch {
    return null;
  }
}

export function preferencesUrl(uid: string, email: string): string {
  return `${WEB_BASE_URL}${PREFERENCES_PATH}/${encodeURIComponent(
    createPreferenceToken(uid, email)
  )}`;
}

/** One-click list-unsubscribe target (same token, `?unsub=1`). */
export function unsubscribeUrl(uid: string, email: string): string {
  return `${preferencesUrl(uid, email)}?unsub=1`;
}
