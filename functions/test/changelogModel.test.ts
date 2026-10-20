import { describe, it, expect } from "vitest";
import {
  normaliseEntry,
  nextStatus,
  deriveVisibility,
  slugify,
  canPublish,
  canAuthor,
  verbNeedsPublishRights,
  type TransitionContext,
} from "../src/changelog/model";

const valid = (over: Record<string, unknown> = {}) => ({
  title: "Faster checkout",
  summary: "Checkout now confirms in under a second.",
  body: "## What changed\n\nWe cut two round-trips.",
  type: "improved",
  audiences: ["customer"],
  ...over,
});

describe("normaliseEntry", () => {
  it("accepts a minimal valid entry and parses its body", () => {
    const e = normaliseEntry(valid());
    expect(e.title).toBe("Faster checkout");
    expect(e.slug).toBe("faster-checkout");
    expect(e.blocks[0]).toMatchObject({ t: "h2" });
    expect(e.visibility).toBe("external");
  });

  it("rejects a missing title or summary with a readable message", () => {
    expect(() => normaliseEntry(valid({ title: "" }))).toThrow(/title/);
    expect(() => normaliseEntry(valid({ summary: "short" }))).toThrow(/summary/);
  });

  it("rejects an unknown type", () => {
    expect(() => normaliseEntry(valid({ type: "misc" }))).toThrow(/type/);
  });

  // An entry with no audience and not on the website is invisible to
  // everyone — almost certainly a form mistake, not an intent.
  it("refuses an entry nobody could see", () => {
    expect(() => normaliseEntry(valid({ audiences: [] }))).toThrow(/audience/);
    expect(() => normaliseEntry(valid({ audiences: [], public: true }))).not.toThrow();
  });

  it("drops unknown audiences and keeps canonical order", () => {
    const e = normaliseEntry(valid({ audiences: ["rider", "martian", "customer"] }));
    expect(e.audiences).toEqual(["customer", "rider"]);
  });

  it("validates the version format", () => {
    expect(normaliseEntry(valid({ version: "v2.4.1" })).version).toBe("2.4.1");
    expect(normaliseEntry(valid({ version: "2.4.1-beta.2" })).version).toBe("2.4.1-beta.2");
    expect(() => normaliseEntry(valid({ version: "latest" }))).toThrow(/Version/);
  });

  it("requires a safe CTA link and a label", () => {
    expect(normaliseEntry(valid({ cta: { label: "Try it", url: "kada://checkout" } })).cta).toEqual({
      label: "Try it",
      url: "kada://checkout",
    });
    expect(() => normaliseEntry(valid({ cta: { label: "Go", url: "javascript:x" } }))).toThrow(/link/);
    expect(() => normaliseEntry(valid({ cta: { label: "", url: "https://kada.in" } }))).toThrow(/label/);
  });

  it("requires an https cover image", () => {
    expect(() => normaliseEntry(valid({ coverImage: { url: "http://x.test/a.png" } }))).toThrow(/https/);
  });

  // A blocking acknowledgement on a bug fix would interrupt every user for
  // nothing; it is reserved for changes that alter how people work.
  it("only allows acknowledgement on breaking, deprecated or security notes", () => {
    expect(normaliseEntry(valid({ type: "fixed", requiresAck: true })).requiresAck).toBe(false);
    expect(normaliseEntry(valid({ type: "breaking", requiresAck: true })).requiresAck).toBe(true);
  });

  it("normalises tags", () => {
    const e = normaliseEntry(valid({ tags: ["Checkout", "checkout", "  Payments!! ", ""] }));
    expect(e.tags).toEqual(["checkout", "payments"]);
  });
});

describe("deriveVisibility", () => {
  // Security rules hide `internal` entries from non-admins, so this decides
  // whether an ops-only note can leak into an app.
  it("marks admin-only, non-public notes internal", () => {
    expect(deriveVisibility(["admin"], false)).toBe("internal");
  });
  it("marks anything a partner or customer sees external", () => {
    expect(deriveVisibility(["admin", "vendor"], false)).toBe("external");
    expect(deriveVisibility([], true)).toBe("external");
    expect(deriveVisibility(["admin"], true)).toBe("external");
  });
});

describe("slugify", () => {
  it("produces URL-safe slugs", () => {
    expect(slugify("Kada Gold — 2x points!")).toBe("kada-gold-2x-points");
    expect(slugify("Café au lait")).toBe("cafe-au-lait");
    expect(slugify("!!!")).toBe("update");
  });
});

describe("nextStatus", () => {
  const now = Date.parse("2026-09-15T10:00:00Z");
  const ctx = (over: Partial<TransitionContext> = {}): TransitionContext => ({
    now,
    requireReview: false,
    actorIsAuthor: true,
    actorCanOverride: false,
    ...over,
  });

  it("walks the happy path", () => {
    expect(nextStatus("draft", "submit", ctx())).toBe("in_review");
    expect(nextStatus("in_review", "publish", ctx())).toBe("published");
    expect(nextStatus("published", "archive", ctx())).toBe("archived");
    expect(nextStatus("archived", "restore", ctx())).toBe("draft");
  });

  it("refuses transitions that don't apply to the current status", () => {
    expect(() => nextStatus("published", "submit", ctx())).toThrow(/published/);
    expect(() => nextStatus("draft", "unschedule", ctx())).toThrow();
  });

  it("requires a future publish time to schedule", () => {
    expect(() => nextStatus("draft", "schedule", ctx({ publishAt: now - 1000 }))).toThrow(/future/);
    expect(() => nextStatus("draft", "schedule", ctx({ publishAt: now + 30_000 }))).toThrow(/future/);
    expect(nextStatus("draft", "schedule", ctx({ publishAt: now + 3_600_000 }))).toBe("scheduled");
  });

  describe("with review required", () => {
    const review = (over: Partial<TransitionContext> = {}) => ctx({ requireReview: true, ...over });

    it("blocks publishing straight from draft", () => {
      expect(() => nextStatus("draft", "publish", review())).toThrow(/Submit it for review/);
    });

    // The whole point of maker-checker: the person who wrote it can't approve it.
    it("blocks the author from approving their own update", () => {
      expect(() => nextStatus("in_review", "publish", review({ actorIsAuthor: true }))).toThrow(
        /other than the author/,
      );
    });

    it("lets a different reviewer approve", () => {
      expect(nextStatus("in_review", "publish", review({ actorIsAuthor: false }))).toBe("published");
    });

    it("lets a super admin override for an urgent note", () => {
      expect(nextStatus("draft", "publish", review({ actorCanOverride: true }))).toBe("published");
    });

    // A scheduled entry already passed review when it was scheduled; the
    // scheduler going live later must not be re-blocked by the author check.
    it("does not re-check review when a scheduled entry goes live", () => {
      expect(nextStatus("scheduled", "publish", review({ actorIsAuthor: true }))).toBe("published");
    });
  });
});

describe("permissions", () => {
  it("separates writing from publishing", () => {
    expect(canAuthor("developer")).toBe(true);
    expect(canPublish("developer")).toBe(false);
    expect(canPublish("marketing_manager")).toBe(true);
    expect(canAuthor("auditor")).toBe(false);
  });

  it("treats anything that changes what readers see as a publish action", () => {
    expect(verbNeedsPublishRights("publish")).toBe(true);
    expect(verbNeedsPublishRights("archive")).toBe(true);
    expect(verbNeedsPublishRights("submit")).toBe(false);
  });
});
