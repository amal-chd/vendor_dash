/**
 * Kada Assist thread rules, kept free of Firestore so they can be unit-tested.
 *
 * Thread status is one of:
 *   bot        — the AI is handling the chat
 *   escalated  — a human was asked for and nobody has picked it up yet
 *   open       — a person from the team is in the chat
 *   resolved   — closed; the next message reopens it
 *   disconnected — legacy: old app builds set this after 5 idle minutes and
 *                  then hid the composer for good. Treated like resolved.
 */

export type UserMessagePlan =
  /** The AI answers. `reopen` flips a closed chat back to "bot". */
  | { kind: "ai"; reopen: boolean; waitingForHuman: boolean }
  /** A person is handling the chat; the AI stays out of it. */
  | { kind: "human" };

/**
 * What happens when the participant sends a message.
 *
 * An escalated chat used to get no reply at all until an agent turned up, so a
 * user who asked anything after "talk to a human" sat in silence (and nobody
 * answered at night). The AI now keeps helping while they wait; only once a
 * person has joined ("open") does it step aside.
 */
export function planForUserMessage(status: string | undefined | null): UserMessagePlan {
  const s = String(status ?? "bot").toLowerCase();
  if (s === "open") return { kind: "human" };
  if (s === "escalated") return { kind: "ai", reopen: false, waitingForHuman: true };
  return { kind: "ai", reopen: s !== "bot", waitingForHuman: false };
}

/** The inbox preview line for a user message. */
export function messagePreview(msg: {
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  mediaUrl?: string;
  mediaType?: string;
}): string {
  const text = (msg.text ?? "").trim();
  if (text) return text.length > 300 ? `${text.slice(0, 297)}…` : text;
  if (msg.imageUrl || msg.mediaType === "image") return "📷 Image attached";
  if (msg.audioUrl || msg.mediaType === "voice") return "🎤 Voice note";
  return "Attachment";
}

const HUMAN_EXACT = new Set([
  "talk to a human",
  "talk to human",
  "human",
  "human agent",
  "agent",
  "live agent",
  "real person",
  "representative",
  "customer care",
  "customer support",
  "support team",
]);

/** "Talk to a human" and the common ways people phrase it. */
export function wantsHuman(text: string | undefined | null): boolean {
  const t = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "");
  if (!t) return false;
  if (HUMAN_EXACT.has(t)) return true;
  return /^(please\s+)?(i\s+want\s+to\s+|can\s+i\s+|let\s+me\s+)?(talk|speak|chat|connect)(\s+me)?\s+(to|with)\s+(a\s+|an\s+|your\s+)?(human|person|agent|someone|representative|customer care|support)\b/.test(
    t,
  );
}

/**
 * Parse the model's JSON reply. Gemini occasionally wraps JSON in a ```json
 * fence even when asked for application/json; a bare JSON.parse then threw,
 * and the catch escalated a perfectly answerable question to a human.
 */
export function parseModelJson(text: string | undefined | null): unknown {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.search(/[[{]/);
    const end = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Quick replies from the model: strings only, deduplicated, at most four. */
export function cleanSuggestedActions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s || s.length > 60 || out.includes(s)) continue;
    out.push(s);
    if (out.length === 4) break;
  }
  return out;
}

/**
 * The participant's role for a thread whose doc is missing, from which
 * profile the uid owns. Checked in the order the apps were built.
 */
export function inferRole(has: {
  restaurant: boolean;
  rider: boolean;
  hotel: boolean;
}): "vendor" | "rider" | "host" | "customer" {
  if (has.restaurant) return "vendor";
  if (has.rider) return "rider";
  if (has.hotel) return "host";
  return "customer";
}
