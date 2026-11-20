import { inferBrandProfileId } from "./brandProfiles";

export type PromptBrief = {
  id: string;
  day: number;
  title: string;
  category: string;
  audience: string;
  goal: string;
  headline: string;
  support: string;
  cta: string;
  caption: string;
  ctaNote?: string;
  visualDirection: string;
  dailyPrompt: string;
  brandProfileId?: string;
};

export type PromptBook = {
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  canvas?: { width: number; height: number; aspectRatio: string };
  platforms?: string[];
  posts: PromptBrief[];
};

export type ExistingPromptPost = { planId?: string; planDay?: number };

const LIMITS: Record<keyof Omit<PromptBrief, "id" | "day" | "brandProfileId">, number> = {
  title: 160,
  category: 80,
  audience: 500,
  goal: 500,
  headline: 180,
  support: 300,
  cta: 120,
  caption: 5000,
  ctaNote: 600,
  visualDirection: 2400,
  dailyPrompt: 5000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string, max: number, required = true) {
  if (value === undefined || value === null) {
    if (!required) return "";
    throw new Error(`Prompt book is missing “${field}”.`);
  }
  if (typeof value !== "string") throw new Error(`“${field}” must be text.`);
  const clean = value.trim();
  if (required && !clean) throw new Error(`“${field}” cannot be empty.`);
  if (clean.length > max) throw new Error(`“${field}” exceeds ${max} characters.`);
  return clean;
}

function parseBrief(value: unknown, index: number): PromptBrief {
  const label = `Post ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const id = text(value.id, `${label} id`, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error(`${label} id may contain letters, numbers, dots, underscores and hyphens.`);
  if (!Number.isInteger(value.day) || Number(value.day) < 1 || Number(value.day) > 365) throw new Error(`${label} needs a day number from 1 to 365.`);
  const optional = (key: "ctaNote") => text(value[key], `${label} ${key}`, LIMITS[key], false);
  const brandProfileId = typeof value.brandProfileId === "string" ? value.brandProfileId.trim().slice(0, 100) : undefined;
  return {
    id,
    day: Number(value.day),
    title: text(value.title, `${label} title`, LIMITS.title),
    category: text(value.category, `${label} category`, LIMITS.category),
    audience: text(value.audience, `${label} audience`, LIMITS.audience),
    goal: text(value.goal, `${label} goal`, LIMITS.goal),
    headline: text(value.headline, `${label} headline`, LIMITS.headline),
    support: text(value.support, `${label} support`, LIMITS.support, false),
    cta: text(value.cta, `${label} CTA`, LIMITS.cta, false),
    caption: text(value.caption, `${label} caption`, LIMITS.caption),
    ctaNote: optional("ctaNote"),
    visualDirection: text(value.visualDirection, `${label} visual direction`, LIMITS.visualDirection),
    dailyPrompt: text(value.dailyPrompt, `${label} image prompt`, LIMITS.dailyPrompt),
    ...(brandProfileId ? { brandProfileId } : {}),
  };
}

export function parsePromptBookJson(source: string): PromptBook {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("This file is not valid JSON. Download the prompt-book template to check its format.");
  }
  if (!isRecord(value)) throw new Error("A prompt book must be a JSON object.");
  if (value.schemaVersion !== 1) throw new Error("This prompt-book version is not supported. Expected schemaVersion 1.");
  const id = text(value.id, "prompt book id", 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error("Prompt book id may contain letters, numbers, dots, underscores and hyphens.");
  const title = text(value.title, "prompt book title", 160);
  if (!Array.isArray(value.posts) || value.posts.length === 0 || value.posts.length > 100) {
    throw new Error("A prompt book must contain between 1 and 100 posts.");
  }
  const posts = value.posts.map(parseBrief);
  const ids = new Set<string>();
  const days = new Set<number>();
  for (const post of posts) {
    if (ids.has(post.id)) throw new Error(`Duplicate post id “${post.id}” in prompt book.`);
    if (days.has(post.day)) throw new Error(`Duplicate day ${post.day} in prompt book. Give every post a unique day.`);
    ids.add(post.id);
    days.add(post.day);
  }
  const description = value.description === undefined ? undefined : text(value.description, "description", 1000, false);
  return { schemaVersion: 1, id, title, ...(description ? { description } : {}), posts };
}

export function promptBookKey(planId: string, day: number) {
  return `${planId}:${day}`;
}

export function getPromptBookImportPlan(book: PromptBook, existing: ExistingPromptPost[]) {
  const imported = new Set(existing.map((post) => promptBookKey(post.planId || "kadaverse-30-day-social-v1", post.planDay ?? -1)));
  const skipped = book.posts.filter((post) => imported.has(promptBookKey(book.id, post.day)));
  const pending = book.posts.filter((post) => !imported.has(promptBookKey(book.id, post.day)));
  return { pending, skipped };
}

export function toSocialDraft(brief: PromptBrief, planId: string) {
  const caption = [brief.caption, brief.ctaNote].filter(Boolean).join("\n\n");
  return {
    planId,
    planDay: brief.day,
    title: `Day ${String(brief.day).padStart(2, "0")} · ${brief.title}`,
    category: brief.category,
    audience: brief.audience,
    goal: brief.goal,
    headline: brief.headline,
    support: brief.support,
    cta: brief.cta,
    caption,
    captions: { instagram: caption, facebook: caption, linkedin: caption },
    imagePrompt: "",
    dailyPrompt: brief.dailyPrompt,
    visualDirection: brief.visualDirection,
    brandProfileId: inferBrandProfileId(brief.title, brief.brandProfileId),
    assetPath: "",
    assetName: "",
    referenceAssets: [],
    destinations: {},
    status: "draft" as const,
    scheduledAt: null,
  };
}
