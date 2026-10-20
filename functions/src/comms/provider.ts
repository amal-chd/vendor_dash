/**
 * Email provider abstraction. Resend (HTTP API) is the production path for
 * scale + deliverability + webhooks; Gmail/SMTP via nodemailer is the fallback
 * (reuses the already-configured GMAIL_APP_PASSWORD). Selection is by env, so
 * dev/staging/prod can differ without code changes. Credentials come ONLY from
 * secrets/env — never the client.
 */

import nodemailer from "nodemailer";
import { EmailProviderResult } from "./types";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface SenderIdentity {
  address: string;
  name: string;
  replyTo?: string;
}

/** Admin settings win over env, so the Email → Settings form is what customers see. */
export function fromIdentity(settings?: {
  fromName?: string;
  fromAddress?: string;
  replyTo?: string;
}): SenderIdentity {
  const replyTo = (settings?.replyTo || process.env.MAIL_REPLY_TO || "").trim();
  return {
    address: (settings?.fromAddress || process.env.MAIL_FROM_ADDRESS || "no-reply@thekada.in").trim(),
    name: (settings?.fromName || process.env.MAIL_FROM_NAME || "The Kada").trim(),
    replyTo: replyTo || undefined,
  };
}

/** Resend API key, treating empty/placeholder values as unconfigured. */
export function resendKey(): string {
  const k = (process.env.RESEND_API_KEY || "").trim();
  return k && k !== "DISABLED" ? k : "";
}

/** Which provider to use. Defaults to resend when a key is present, else smtp. */
export function activeProvider(): "resend" | "smtp" {
  const explicit = (process.env.EMAIL_PROVIDER || "").toLowerCase();
  if (explicit === "resend" || explicit === "smtp") return explicit;
  return resendKey() ? "resend" : "smtp";
}

async function sendViaResend(msg: OutgoingEmail, from: SenderIdentity): Promise<EmailProviderResult> {
  const key = resendKey();
  if (!key) {
    return { ok: false, provider: "resend", error: "RESEND_API_KEY not set", permanent: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${from.name} <${from.address}>`,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        reply_to: from.replyTo,
        headers: msg.headers,
        tags: msg.tags
          ? Object.entries(msg.tags).map(([name, value]) => ({ name, value }))
          : undefined,
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { id?: string };
      return { ok: true, provider: "resend", messageId: body.id };
    }
    const errText = await res.text();
    // 4xx (bad request / invalid recipient) is permanent; 429/5xx are retryable.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    return { ok: false, provider: "resend", error: `${res.status} ${errText}`, permanent };
  } catch (e) {
    return { ok: false, provider: "resend", error: String(e), permanent: false };
  }
}

let _transporter: nodemailer.Transporter | null = null;
function smtpTransport(): nodemailer.Transporter {
  if (_transporter) return _transporter;
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USERNAME || "thekadaapp@gmail.com";
  const pass = process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD || "";
  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return _transporter;
}

async function sendViaSmtp(msg: OutgoingEmail, from: SenderIdentity): Promise<EmailProviderResult> {
  try {
    const info = await smtpTransport().sendMail({
      from: `"${from.name}" <${from.address}>`,
      to: msg.to,
      replyTo: from.replyTo,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: msg.headers,
    });
    return { ok: true, provider: "smtp", messageId: info.messageId };
  } catch (e) {
    const err = e as { responseCode?: number; message?: string };
    // 5xx SMTP codes are permanent rejections; 4xx are transient.
    const permanent = !!err.responseCode && err.responseCode >= 500;
    return { ok: false, provider: "smtp", error: err.message || String(e), permanent };
  }
}

/** Dispatch via the active provider. */
export async function deliver(
  msg: OutgoingEmail,
  settings?: { fromName?: string; fromAddress?: string; replyTo?: string }
): Promise<EmailProviderResult> {
  const from = fromIdentity(settings);
  return activeProvider() === "resend" ? sendViaResend(msg, from) : sendViaSmtp(msg, from);
}
