import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_PROFILES_BY_ID } from "../pages/admin/marketing/brandProfiles";
import { SOCIAL_PROMPT_BOOK } from "../pages/admin/marketing/socialStudioPlan";
import { getPromptBookImportPlan, parsePromptBookJson, toSocialDraft, type PromptBook } from "../pages/admin/marketing/socialStudioImport";
import { createPosterPrompt } from "../pages/admin/marketing/socialStudioPrompt";

const starter = parsePromptBookJson(JSON.stringify(SOCIAL_PROMPT_BOOK));

describe("Social Studio prompt book", () => {
  it("ships a valid 30-day KadaVerse book with product-specific brand assignments", () => {
    expect(starter.posts).toHaveLength(30);
    expect(new Set(starter.posts.map((post) => post.day)).size).toBe(30);
    expect(starter.posts.some((post) => post.brandProfileId === "kada-dine")).toBe(true);
    expect(starter.posts.some((post) => post.brandProfileId === "the-kada")).toBe(true);
  });

  it("rejects malformed JSON, unsupported versions and incomplete briefs before import", () => {
    expect(() => parsePromptBookJson("not-json")).toThrow(/valid JSON/i);
    expect(() => parsePromptBookJson(JSON.stringify({ ...starter, schemaVersion: 2 }))).toThrow(/not supported/i);
    const broken = structuredClone(starter) as PromptBook;
    broken.posts[0].headline = "";
    expect(() => parsePromptBookJson(JSON.stringify(broken))).toThrow(/headline.*empty/i);
  });

  it("rejects duplicate entry IDs and duplicate days", () => {
    const duplicateId = structuredClone(starter) as PromptBook;
    duplicateId.posts[1].id = duplicateId.posts[0].id;
    expect(() => parsePromptBookJson(JSON.stringify(duplicateId))).toThrow(/duplicate post id/i);
    const duplicateDay = structuredClone(starter) as PromptBook;
    duplicateDay.posts[1].day = duplicateDay.posts[0].day;
    expect(() => parsePromptBookJson(JSON.stringify(duplicateDay))).toThrow(/duplicate day/i);
  });

  it("skips previously imported book entries while allowing a different book to use the same day", () => {
    const first = getPromptBookImportPlan(starter, [{ planId: starter.id, planDay: 1 }]);
    expect(first.pending).toHaveLength(29);
    expect(first.skipped.map((post) => post.day)).toEqual([1]);
    const anotherBook = { ...starter, id: "another-campaign" };
    expect(getPromptBookImportPlan(anotherBook, [{ planId: starter.id, planDay: 1 }]).pending).toHaveLength(30);
  });

  it("converts a brief into an isolated draft with the right product profile", () => {
    const brief = starter.posts.find((post) => post.title === "Kada Dine")!;
    const draft = toSocialDraft(brief, starter.id);
    expect(draft).toMatchObject({ planId: starter.id, planDay: brief.day, brandProfileId: "kada-dine", status: "draft", destinations: {} });
    expect(draft.caption).toContain(brief.ctaNote);
    expect(draft.imagePrompt).toBe("");
    expect(draft.dailyPrompt).toBe(brief.dailyPrompt);
  });

  it("builds the full image prompt from the selected profile, guardrails and exact copy", () => {
    const profile = DEFAULT_BRAND_PROFILES_BY_ID["kada-dine"];
    const prompt = createPosterPrompt({
      headline: "One POS for the floor and kitchen.",
      support: "Billing · QR ordering · Kitchen display",
      cta: "See Kada Dine",
      audience: "restaurant owners",
      dailyPrompt: "Use the supplied POS screenshot.",
    }, profile);
    expect(prompt).toContain("Kada Dine");
    expect(prompt).toContain(profile.palette.accent);
    expect(prompt).toContain(profile.claims);
    expect(prompt).toContain(profile.wordsAvoid);
    expect(prompt).toContain(profile.website);
    expect(prompt).toContain("Headline: “One POS for the floor and kitchen.”");
    expect(prompt).toContain("Use the supplied POS screenshot.");
    expect(prompt).toContain("do not invent one");
  });
});
