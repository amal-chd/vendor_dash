import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Shared reads for the Marketing workspace. Every channel already keeps its
 * own collection (email, push, CRM, coupons, ads); this file turns them into
 * one feed so the overview and the planner see the same plan — nothing here
 * writes to another channel's data.
 */

export type MarketingSource = "plan" | "email" | "push" | "crm" | "coupon" | "ad";

export interface MarketingEvent {
  id: string;
  source: MarketingSource;
  title: string;
  start: Date;
  end?: Date | null;
  status: string;
  /** Where the admin goes to act on it. */
  href: string;
}

export const SOURCE_META: Record<MarketingSource, { label: string; dot: string; chip: string }> = {
  plan: { label: "Plan", dot: "bg-indigo-500", chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20" },
  email: { label: "Email", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20" },
  push: { label: "Push", dot: "bg-violet-500", chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20" },
  crm: { label: "In-app", dot: "bg-teal-500", chip: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20" },
  coupon: { label: "Coupon", dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" },
  ad: { label: "Ad", dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20" },
};

type Stamp = { toDate?: () => Date; toMillis?: () => number; seconds?: number } | number | string | Date | null | undefined;

export function toDate(v: Stamp): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.toMillis === "function") return new Date(v.toMillis());
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  return null;
}

// Marketing plans: briefs the team writes before anything is built.
export const PLAN_COLLECTION = "marketing_plans";
export const LINK_COLLECTION = "marketing_links";
export const BRAND_DOC = ["marketing_settings", "brand"] as const;

export const PLAN_STATUSES = [
  { key: "idea", label: "Idea" },
  { key: "planned", label: "Planned" },
  { key: "approved", label: "Approved" },
  { key: "live", label: "Live" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number]["key"];

export const PLAN_GOALS = [
  { key: "acquire", label: "Acquire new customers" },
  { key: "activate", label: "First order" },
  { key: "retain", label: "Repeat orders" },
  { key: "winback", label: "Win back lapsed" },
  { key: "aov", label: "Bigger baskets" },
  { key: "awareness", label: "Awareness / launch" },
  { key: "partner", label: "Partner growth" },
] as const;

export const PLAN_CHANNELS = ["email", "push", "in-app", "coupon", "ads", "banner", "social", "offline"] as const;

export interface MarketingPlan {
  id: string;
  name: string;
  goal: string;
  status: PlanStatus;
  channels: string[];
  audience: string;
  kpi: string;
  target?: number | null;
  budget?: number | null;
  spent?: number | null;
  owner?: string;
  notes?: string;
  utmCampaign?: string;
  startAt?: Stamp;
  endAt?: Stamp;
  createdAt?: Stamp;
  createdBy?: string;
}

async function rows(path: string, cap = 300): Promise<Record<string, unknown>[]> {
  try {
    const snap = await getDocs(query(collection(db, path), limit(cap)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    // One channel the admin can't read must not blank the whole calendar.
    return [];
  }
}

const str = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/** Every dated marketing activity, across channels, sorted by start. */
export async function loadMarketingEvents(): Promise<MarketingEvent[]> {
  const [plans, email, push, crm, promos, ads] = await Promise.all([
    rows(PLAN_COLLECTION),
    rows("emailCampaigns"),
    rows("notification_campaigns"),
    rows("crm_campaigns"),
    rows("promos"),
    rows("platform_ads"),
  ]);
  const out: MarketingEvent[] = [];

  for (const p of plans) {
    const start = toDate(p.startAt as Stamp) ?? toDate(p.createdAt as Stamp);
    if (!start) continue;
    out.push({
      id: `plan:${p.id}`, source: "plan", title: str(p.name, "Untitled plan"), start,
      end: toDate(p.endAt as Stamp), status: str(p.status, "idea"), href: "/admin/growth?tab=planner",
    });
  }
  for (const c of email) {
    // Autopilot drafts carry their intended send time; show that, not when they were drafted.
    const planned = (c.autopilot as { sendAt?: number } | undefined)?.sendAt;
    const start = toDate(c.scheduledAt as Stamp) ?? toDate(c.completedAt as Stamp) ?? (planned ? new Date(planned) : null) ?? toDate(c.createdAt as Stamp);
    if (!start) continue;
    out.push({
      id: `email:${c.id}`, source: "email", title: str(c.name, "Email campaign"), start,
      status: str(c.status, "draft"), href: "/admin/growth?tab=email&section=campaigns",
    });
  }
  for (const c of push) {
    const start = toDate(c.scheduledAt as Stamp) ?? toDate(c.sentAt as Stamp) ?? toDate(c.createdAt as Stamp);
    if (!start) continue;
    out.push({
      id: `push:${c.id}`, source: "push", title: str(c.name ?? c.title, "Push campaign"), start,
      status: str(c.status, "draft"), href: "/admin/growth?tab=notifications",
    });
  }
  for (const c of crm) {
    const start = toDate(c.createdAt as Stamp);
    if (!start) continue;
    out.push({
      id: `crm:${c.id}`, source: "crm", title: str(c.name ?? c.title, "In-app campaign"), start,
      status: str(c.status, "sent"), href: "/admin/customers?tab=segments",
    });
  }
  for (const p of promos) {
    // A coupon has no start date in its schema — its end is what needs planning.
    const end = toDate(p.expiresAt as Stamp);
    if (!end) continue;
    out.push({
      id: `coupon:${p.id}`, source: "coupon", title: `${str(p.code, p.id as string)} ends`, start: end,
      status: p.active === false ? "paused" : end.getTime() < Date.now() ? "expired" : "active",
      href: "/admin/growth?tab=promos",
    });
  }
  for (const a of ads) {
    const end = toDate(a.endAt as Stamp);
    if (!end) continue;
    out.push({
      id: `ad:${a.id}`, source: "ad", title: `${str(a.title, "Ad")} ends`, start: end,
      status: a.active === false ? "paused" : end.getTime() < Date.now() ? "ended" : "live",
      href: "/admin/growth?tab=ads",
    });
  }
  return out.sort((x, y) => x.start.getTime() - y.start.getTime());
}

export const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Lowercase, hyphenated — the one UTM spelling every report groups by. */
export function utmSlug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
