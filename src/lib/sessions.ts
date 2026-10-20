import { collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

function randomId() {
  // Prefer crypto when available.
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  }
}

function getOrCreateSessionId(restaurantId: string) {
  const key = `kada:sessionId:${restaurantId}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const next = randomId();
    localStorage.setItem(key, next);
    return next;
  } catch {
    return randomId();
  }
}

export type UserSession = {
  id: string;
  restaurantId: string;
  sessionId: string;
  createdAt?: any;
  lastSeen?: any;
  userAgent?: string;
  platform?: string;
  timeZone?: string;
};

export async function ensureUserSession(restaurantId: string) {
  const sessionId = getOrCreateSessionId(restaurantId);
  const id = `${restaurantId}_${sessionId}`;
  const timeZone =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  const ref = doc(collection(db, "user_sessions"), id);
  await setDoc(
    ref,
    {
      restaurantId,
      sessionId,
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      platform: typeof navigator !== "undefined" ? (navigator.platform || "") : "",
      timeZone,
    },
    { merge: true }
  );

  return { id, restaurantId, sessionId };
}

export async function heartbeatUserSession(restaurantId: string) {
  const sessionId = getOrCreateSessionId(restaurantId);
  const id = `${restaurantId}_${sessionId}`;
  const ref = doc(collection(db, "user_sessions"), id);
  await updateDoc(ref, { lastSeen: serverTimestamp() });
}

export function getLocalSessionId(restaurantId: string) {
  return getOrCreateSessionId(restaurantId);
}

export function clearLocalSessionId(restaurantId: string) {
  const key = `kada:sessionId:${restaurantId}`;
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures so sign-out can continue.
  }
}
