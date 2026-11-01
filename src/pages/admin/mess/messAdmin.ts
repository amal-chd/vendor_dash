import { httpsCallable } from "firebase/functions";
import type { Timestamp } from "firebase/firestore";
import { functions } from "@/lib/firebase";

/**
 * Shared shapes and day rules for the admin Mess workspace. The day rules
 * mirror functions/src/messRules.ts (eatsOn / headcount) so the console, the
 * Dine app and the evening headcount push all count the same plates.
 */

export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];

export interface MessSub {
  id: string;
  customerUid?: string;
  customerName?: string;
  customerPhone?: string;
  customer?: { name?: string; phone?: string; address?: string; note?: string; lat?: number; lng?: number };
  kitchenId?: string;
  kitchenName?: string;
  plan?: { id?: string; name?: string; pricePaise?: number; durationDays?: number; meals?: string[]; vegOnly?: boolean };
  isTrial?: boolean;
  amountPaise?: number;
  paidAmountPaise?: number;
  refundedPaise?: number;
  platformFeePerDayPaise?: number;
  status?: string;
  paymentStatus?: string;
  razorpayPaymentId?: string;
  startDate?: Timestamp;
  endDate?: Timestamp;
  earnUntil?: Timestamp;
  createdAt?: Timestamp;
  cancelledAt?: Timestamp;
  cancelFrom?: string;
  cancelReason?: string;
  cancelledBy?: string;
  skippedDays?: string[];
  skippedMeals?: string[];
  holidayDays?: string[];
  bonusDays?: number;
  skipLog?: Array<{ day: string; skip: boolean; by: string; at: number }>;
  adminLog?: Array<Record<string, unknown> & { action: string; by: string; at: number }>;
  refund?: {
    status?: "pending" | "processing" | "completed" | "failed" | "declined";
    amountPaise?: number;
    unusedDays?: number;
    mode?: string;
    requestedBy?: string;
    requestedAt?: number;
    refundId?: string;
    error?: string;
    declineReason?: string;
    decidedBy?: string;
  };
}

export interface MessKitchen {
  id: string;
  name?: string;
  kitchenName?: string;
  area?: string;
  locality?: string;
  address?: string;
  phone?: string;
  ownerName?: string;
  isBlocked?: boolean;
  feePerCustomerPerDayPaise?: number;
  onboarding?: { state?: string };
  logoUrl?: string;
  coverImage?: string;
  holidays?: string[];
  weeklyMenu?: Record<string, Record<string, string>>;
  messSettings?: { acceptingSubscribers?: boolean; capacity?: Partial<Record<Meal, number>>; skipCutoffHour?: number | null };
  fcmTokens?: string[];
  createdAt?: Timestamp;
  ratingAvg?: number;
  ratingCount?: number;
  ratingBreakdown?: Record<string, number>;
  planSummary?: { count?: number; fromPaise?: number | null; fromPerDayPaise?: number | null; hasTrial?: boolean; meals?: string[] };
  mealTimes?: Record<string, { enabled?: boolean; start?: string; end?: string }>;
  messProfile?: { meals?: string[]; diet?: string[]; fulfilment?: string[] };
  announcement?: { message?: string; at?: number };
}

export interface MessReview {
  id: string;
  kitchenId?: string;
  customerUid?: string;
  customerName?: string;
  rating?: number;
  text?: string;
  tags?: string[];
  reply?: string;
  hidden?: boolean;
  hiddenReason?: string;
  createdAt?: Timestamp;
}

const IST = 5.5 * 3_600_000;
const DAY = 86_400_000;

export function dayKey(d: Date): string {
  return new Date(d.getTime() + IST).toISOString().slice(0, 10);
}
export function dayStart(key: string): Date {
  return new Date(Date.parse(`${key}T00:00:00Z`) - IST);
}
export function addDays(key: string, n: number): string {
  return dayKey(new Date(dayStart(key).getTime() + n * DAY + 3_600_000));
}
export const todayKey = () => dayKey(new Date());

const tsDate = (t?: Timestamp) => (t && typeof t.toDate === "function" ? t.toDate() : null);

export function eatsOn(s: MessSub, key: string): boolean {
  const live = s.status === "active" || (s.status === "cancelled" && !!s.cancelFrom && s.cancelFrom > key);
  const start = tsDate(s.startDate);
  const end = tsDate(s.endDate);
  if (!live || !start || !end) return false;
  const k = dayStart(key).getTime();
  if (k < dayStart(dayKey(start)).getTime() || k >= end.getTime()) return false;
  return !(s.skippedDays ?? []).includes(key) && !(s.holidayDays ?? []).includes(key);
}

/** The meals a subscriber eats on `key`, single-meal skips removed. */
export function mealsOn(s: MessSub, key: string): Meal[] {
  if (!eatsOn(s, key)) return [];
  const off = new Set(s.skippedMeals ?? []);
  return MEALS.filter((m) => (s.plan?.meals ?? []).includes(m) && !off.has(`${key}:${m}`));
}

export function headcount(subs: MessSub[], key: string) {
  const out = { breakfast: 0, lunch: 0, dinner: 0, people: 0, veg: 0 };
  for (const s of subs) {
    const meals: string[] = mealsOn(s, key);
    if (!meals.length) continue;
    let any = false;
    for (const m of MEALS) {
      if (meals.includes(m)) {
        out[m]++;
        any = true;
      }
    }
    if (any) {
      out.people++;
      if (s.plan?.vegOnly) out.veg++;
    }
  }
  return out;
}

/** Days left (including today) on a running plan. */
export function daysLeft(s: MessSub): number {
  const end = tsDate(s.endDate);
  if (!end) return 0;
  return Math.max(0, Math.round((end.getTime() - dayStart(todayKey()).getTime()) / DAY));
}

export const inr = (paise?: number) => `₹${Math.round((paise ?? 0) / 100).toLocaleString("en-IN")}`;
export const fmtDay = (key?: string) =>
  key ? dayStart(key).toLocaleDateString("en-IN", { day: "numeric", month: "short", weekday: "short", timeZone: "Asia/Kolkata" }) : "—";
export const fmtTs = (t?: Timestamp) =>
  tsDate(t)?.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) ?? "—";
export const kitchenName = (k?: MessKitchen) => k?.name || k?.kitchenName || k?.id || "Kitchen";
export const customerName = (s: MessSub) => s.customer?.name || s.customerName || "Customer";
export const customerPhone = (s: MessSub) => s.customer?.phone || s.customerPhone || "";

/** The admin console's one door into mess operations (adminMessAction). */
export async function messAction<T = Record<string, unknown>>(action: string, data: Record<string, unknown>): Promise<T> {
  const res = await httpsCallable(functions, "adminMessAction")({ action, ...data });
  return res.data as T;
}

export const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-600",
  pending_payment: "bg-amber-500",
  cancelled: "bg-rose-600",
  expired: "bg-slate-500",
  abandoned: "bg-slate-400",
};

export const REFUND_TONE: Record<string, string> = {
  pending: "bg-amber-500",
  processing: "bg-blue-600",
  completed: "bg-emerald-600",
  failed: "bg-rose-600",
  declined: "bg-slate-500",
};
