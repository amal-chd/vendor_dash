import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { toast } from "sonner";

/**
 * Client for the `commsAdmin` callable — the single, role-checked, audited
 * entry point for every Email workspace action (see
 * functions/src/comms/commsAdmin.ts). Pages read Firestore directly for live
 * lists; anything that changes state goes through here.
 */
export async function comms<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await httpsCallable(functions, "commsAdmin", { timeout: 120_000 })({ action, ...payload });
  return res.data as T;
}

/** Human message from a callable error. */
export function errMessage(e: unknown): string {
  const code = ((e as { code?: string }).code || "").replace(/^functions\//, "");
  if (code === "permission-denied") return "Your admin role can't do that.";
  if (code === "unauthenticated") return "Sign in again to continue.";
  const msg = (e as { message?: string }).message || "";
  return msg && msg !== "internal" ? msg : "Something went wrong. Try again.";
}

/** Run an action with toasts for both outcomes. Returns the result or null. */
export async function commsOp<T = unknown>(
  action: string,
  payload: Record<string, unknown>,
  success?: string,
  busy?: (b: boolean) => void,
): Promise<T | null> {
  busy?.(true);
  try {
    const out = await comms<T>(action, payload);
    if (success) toast.success(success);
    return out;
  } catch (e) {
    toast.error(errMessage(e));
    return null;
  } finally {
    busy?.(false);
  }
}

export interface TriggerDef { key: string; label: string; app: string; producer: string | null; variables: string[] }
export interface SegmentField { key: string; label: string; kind: "userType" | "text" | "number" | "boolean" | "zone" | "market" | "vendor" | "choice"; hint?: string; options?: { value: string; label: string }[] }
export interface Catalog {
  categories: { key: string; marketing: boolean; eyebrow: string }[];
  triggers: TriggerDef[];
  segmentFields: SegmentField[];
  blocks: { key: string; label: string; html: string }[];
  sampleVars: Record<string, unknown>;
  breaker: { minSample: number; maxComplaintRate: number; maxBounceRate: number };
}

let catalogPromise: Promise<Catalog> | null = null;
/** Catalog is static per deploy; fetch once per session. */
export function loadCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = comms<Catalog>("catalog").catch((e) => {
      catalogPromise = null;
      throw e;
    });
  }
  return catalogPromise;
}

export const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`;

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN");

export function when(ms?: number | null | { toMillis?: () => number; toDate?: () => Date }): string {
  const v = typeof ms === "number" ? ms : (ms as { toMillis?: () => number })?.toMillis?.();
  return v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/** Tailwind tone per email/campaign status. */
export const STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  scheduled: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  queued: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  processing: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  sent: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  delivered: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  opened: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  clicked: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  delayed: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  paused: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  skipped: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  failed: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  bounced: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  complained: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  suppressed: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  cancelled: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  published: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  archived: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  running: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};
