import {
  Clock, CalendarClock, Hourglass, GitBranch, Split, Mail, Smartphone, Tag, Sunset, CircleStop,
  type LucideIcon,
} from "lucide-react";
import { comms, type SegmentField } from "./commsApi";
import type { Condition } from "./ConditionsEditor";

/**
 * Admin-side shapes for journeys. Mirrors functions/src/comms/journeyModel.ts —
 * the server validates everything again; these only drive the builder.
 */

export type StepType =
  | "wait" | "wait_until" | "wait_event" | "branch" | "split"
  | "email" | "push" | "tag" | "sunset" | "exit";

export interface Step {
  id: string;
  type: StepType;
  label?: string;
  next?: string | null;
  minutes?: number;
  field?: string;
  offsetMinutes?: number;
  event?: string;
  timeoutMinutes?: number;
  timeoutNext?: string | null;
  conditions?: Condition[];
  yes?: string | null;
  no?: string | null;
  percent?: number;
  a?: string | null;
  b?: string | null;
  templateKey?: string;
  title?: string;
  body?: string;
  tag?: string;
}

export interface JourneyStats {
  entered?: number; active?: number; completed?: number; converted?: number; exited?: number;
  holdoutEntered?: number; holdoutConverted?: number; revenue?: number; holdoutRevenue?: number;
}

export interface Journey {
  id: string;
  name: string;
  description?: string;
  app: "customer" | "vendor" | "delivery" | "host" | "all";
  userType: string | null;
  status: "draft" | "live" | "paused" | "archived";
  entry: { type: "event" | "segment"; event?: string; conditions?: Condition[] };
  startStepId: string;
  steps: Step[];
  goal: { event: string; withinDays: number } | null;
  exitOnGoal: boolean;
  exitEvents: string[];
  reentry: { mode: "once" | "cooldown" | "always"; days?: number };
  holdoutPercent: number;
  onlyOptedIn: boolean;
  libraryKey?: string | null;
  stats?: JourneyStats;
  stepStats?: Record<string, Record<string, number>>;
  emailStats?: Record<string, number>;
  scan?: { lastFinishedAt?: number; lastEntered?: number; cursor?: string | null };
  version?: number;
  updatedAt?: { toMillis?: () => number };
  updatedBy?: string;
}

export interface JourneyEvent { key: string; label: string; app: string; hasValue?: boolean }
export interface LibraryJourney {
  key: string; title: string; why: string; stage: string; templates: string[];
  def: Omit<Journey, "id" | "status">;
}
export interface JourneyCatalog { events: JourneyEvent[]; library: LibraryJourney[]; segmentFields: SegmentField[] }

let catalogPromise: Promise<JourneyCatalog> | null = null;
export function loadJourneyCatalog(): Promise<JourneyCatalog> {
  return (catalogPromise ||= comms<JourneyCatalog>("journeyCatalog").catch((e) => { catalogPromise = null; throw e; }));
}

export const STEP_META: Record<StepType, { label: string; icon: LucideIcon; tone: string; hint: string }> = {
  wait: { label: "Wait", icon: Clock, tone: "text-slate-600 bg-slate-500/10", hint: "Pause for a fixed time" },
  wait_until: { label: "Wait until a date", icon: CalendarClock, tone: "text-slate-600 bg-slate-500/10", hint: "e.g. a day before check-in" },
  wait_event: { label: "Wait for an event", icon: Hourglass, tone: "text-amber-700 bg-amber-500/10", hint: "Branch on whether it happens in time" },
  branch: { label: "If / else", icon: GitBranch, tone: "text-indigo-700 bg-indigo-500/10", hint: "Split by who they are" },
  split: { label: "A/B split", icon: Split, tone: "text-fuchsia-700 bg-fuchsia-500/10", hint: "Random, stable per person" },
  email: { label: "Send email", icon: Mail, tone: "text-sky-700 bg-sky-500/10", hint: "Through the normal consent-safe pipeline" },
  push: { label: "Send push", icon: Smartphone, tone: "text-violet-700 bg-violet-500/10", hint: "Customer app devices" },
  tag: { label: "Add tag", icon: Tag, tone: "text-teal-700 bg-teal-500/10", hint: "Label the profile for later segments" },
  sunset: { label: "Stop marketing email", icon: Sunset, tone: "text-rose-700 bg-rose-500/10", hint: "Sunset policy: turn their marketing off" },
  exit: { label: "End", icon: CircleStop, tone: "text-zinc-600 bg-zinc-500/10", hint: "Leave the journey" },
};

export const ADDABLE: StepType[] = ["email", "push", "wait", "wait_event", "wait_until", "branch", "split", "tag", "sunset", "exit"];

export function duration(min?: number): string {
  const m = Math.round(Number(min) || 0);
  const a = Math.abs(m);
  const s = a % 1440 === 0 && a ? `${a / 1440} day${a === 1440 ? "" : "s"}` : a % 60 === 0 && a ? `${a / 60} h` : `${a} min`;
  return m < 0 ? `${s} before` : s;
}

export function eventLabel(key: string | undefined, events: JourneyEvent[]): string {
  return events.find((e) => e.key === key)?.label || key || "—";
}

/** Short sentence for a step card. */
export function summarize(s: Step, events: JourneyEvent[], templateName: (k?: string) => string): string {
  switch (s.type) {
    case "wait": return `Wait ${duration(s.minutes)}`;
    case "wait_until": return `Until ${s.offsetMinutes ? `${duration(s.offsetMinutes)} ` : ""}${s.field || "a date"}${s.offsetMinutes && s.offsetMinutes > 0 ? " (after)" : ""}`;
    case "wait_event": return `Up to ${duration(s.timeoutMinutes)} for “${eventLabel(s.event, events)}”`;
    case "branch": return `${(s.conditions || []).length} condition${(s.conditions || []).length === 1 ? "" : "s"}`;
    case "split": return `${s.percent ?? 50}% A · ${100 - (s.percent ?? 50)}% B`;
    case "email": return templateName(s.templateKey);
    case "push": return s.title || "Push";
    case "tag": return `#${s.tag || ""}`;
    case "sunset": return "Marketing email off for this person";
    case "exit": return "Leave the journey";
  }
}

/** The outgoing slots of a step, with their labels, in display order. */
export function slots(s: Step): { key: "next" | "timeoutNext" | "yes" | "no" | "a" | "b"; label: string }[] {
  switch (s.type) {
    case "wait_event": return [{ key: "next", label: "Happened" }, { key: "timeoutNext", label: "Timed out" }];
    case "branch": return [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }];
    case "split": return [{ key: "a", label: "A" }, { key: "b", label: "B" }];
    case "exit": return [];
    default: return [{ key: "next", label: "" }];
  }
}

export function newStepId(steps: Step[], type: StepType): string {
  const base = type.replace(/_/g, "-");
  let i = 1;
  while (steps.some((s) => s.id === `${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function blankStep(type: StepType, id: string, next: string | null): Step {
  switch (type) {
    case "wait": return { id, type, minutes: 1440, next };
    case "wait_until": return { id, type, field: "checkInAt", offsetMinutes: -1440, next };
    case "wait_event": return { id, type, event: "order.placed", timeoutMinutes: 3 * 1440, next, timeoutNext: next };
    case "branch": return { id, type, conditions: [{ field: "minOrders", op: "eq", value: 1 }], yes: next, no: next };
    case "split": return { id, type, percent: 50, a: next, b: next };
    case "email": return { id, type, templateKey: "", next };
    case "push": return { id, type, title: "", body: "", next };
    case "tag": return { id, type, tag: "", next };
    case "sunset": return { id, type, next };
    case "exit": return { id, type };
  }
}

export const JOURNEY_STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  live: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  paused: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  archived: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
};

export const pctOf = (a?: number, b?: number) => (b ? (Number(a || 0) / b) : null);

/** Uplift of the journey over its holdout, in conversion-rate points. */
export function lift(j: Journey): number | null {
  const s = j.stats || {};
  const treated = pctOf(s.converted, Number(s.entered || 0) - Number(s.holdoutEntered || 0));
  const held = pctOf(s.holdoutConverted, s.holdoutEntered);
  return treated === null || held === null || Number(s.holdoutEntered || 0) < 30 ? null : treated - held;
}
