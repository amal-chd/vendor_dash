import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseChangelogMarkdown as parse,
  parseInline,
  safeHref,
  blocksToPlainText,
  MAX_BLOCKS,
} from "../src/changelog/markdown";

// Release notes render in five places (admin, website, four apps) from the
// blocks this parser produces. A mistake here shows up everywhere at once —
// and a bad link scheme would ship a clickable javascript: URL to every user.

describe("block structure", () => {
  it("returns nothing for empty input", () => {
    expect(parse("")).toEqual([]);
    expect(parse("   \n\n  ")).toEqual([]);
  });

  it("parses headings, treating a lone # as h2", () => {
    expect(parse("## Faster checkout")).toEqual([{ t: "h2", s: [{ x: "Faster checkout" }] }]);
    expect(parse("### Details")[0]).toMatchObject({ t: "h3" });
    expect(parse("# Title")[0]).toMatchObject({ t: "h2" });
  });

  it("joins wrapped lines into one paragraph and splits on blank lines", () => {
    const b = parse("first line\nsecond line\n\nnew paragraph");
    expect(b).toEqual([
      { t: "p", s: [{ x: "first line second line" }] },
      { t: "p", s: [{ x: "new paragraph" }] },
    ]);
  });

  it("groups consecutive bullets into one list", () => {
    const b = parse("- one\n- two\n* three");
    expect(b).toEqual([{ t: "ul", items: [{ s: [{ x: "one" }] }, { s: [{ x: "two" }] }, { s: [{ x: "three" }] }] }]);
  });

  it("separates a bulleted list from a numbered one", () => {
    const b = parse("- a\n1. b\n2. c");
    expect(b.map((x) => x.t)).toEqual(["ul", "ol"]);
  });

  it("continues a wrapped bullet onto the next line", () => {
    const b = parse("- a long bullet\n  that wraps");
    expect(b).toEqual([{ t: "ul", items: [{ s: [{ x: "a long bullet that wraps" }] }] }]);
  });

  it("parses quotes and dividers", () => {
    expect(parse("> heads up\n> still quoting")).toEqual([
      { t: "quote", s: [{ x: "heads up still quoting" }] },
    ]);
    expect(parse("---")).toEqual([{ t: "hr" }]);
  });

  it("keeps https images and drops anything else", () => {
    expect(parse("![Menu](https://cdn.kada.in/a.png)")).toEqual([
      { t: "img", src: "https://cdn.kada.in/a.png", alt: "Menu" },
    ]);
    expect(parse("![x](http://insecure.example/a.png)")).toEqual([]);
    expect(parse("![x](data:image/png;base64,AAAA)")).toEqual([]);
  });

  it("caps the block count so a pasted log can't produce a giant document", () => {
    const huge = Array.from({ length: 1000 }, (_, i) => `para ${i}`).join("\n\n");
    expect(parse(huge)).toHaveLength(MAX_BLOCKS);
  });
});

describe("inline markup", () => {
  it("parses bold, italic and code", () => {
    expect(parseInline("a **b** *c* `d`")).toEqual([
      { x: "a " },
      { x: "b", b: true },
      { x: " " },
      { x: "c", i: true },
      { x: " " },
      { x: "d", c: true },
    ]);
  });

  it("renders a stray marker literally instead of bolding the rest", () => {
    expect(parseInline("5 ** 2 is not bold")).toEqual([{ x: "5 ** 2 is not bold" }]);
    expect(parseInline("price * qty")).toEqual([{ x: "price * qty" }]);
  });

  it("leaves snake_case identifiers alone", () => {
    expect(parseInline("set order_status to ready")).toEqual([{ x: "set order_status to ready" }]);
  });

  it("supports underscore italics at word boundaries", () => {
    expect(parseInline("now _really_ fast")).toEqual([
      { x: "now " },
      { x: "really", i: true },
      { x: " fast" },
    ]);
  });

  it("honours escapes", () => {
    expect(parseInline("\\*not italic\\*")).toEqual([{ x: "*not italic*" }]);
  });

  it("keeps code contents literal", () => {
    expect(parseInline("`**raw**`")).toEqual([{ x: "**raw**", c: true }]);
  });

  it("attaches safe links and carries formatting inside link text", () => {
    expect(parseInline("see [the **new** menu](https://kada.in/menu)")).toEqual([
      { x: "see " },
      { x: "the ", href: "https://kada.in/menu" },
      { x: "new", b: true, href: "https://kada.in/menu" },
      { x: " menu", href: "https://kada.in/menu" },
    ]);
  });

  it("keeps the text but drops the link for an unsafe scheme", () => {
    const spans = parseInline("[click](javascript:alert(1))");
    expect(spans.some((s) => s.href)).toBe(false);
    expect(spans.map((s) => s.x).join("")).toContain("click");
  });
});

describe("safeHref", () => {
  it.each([
    ["https://kada.in/x", true],
    ["http://kada.in/x", true],
    ["mailto:help@kada.in", true],
    ["kada://orders/abc", true],
    ["/pricing", true],
    ["javascript:alert(1)", false],
    ["data:text/html,<b>", false],
    ["vbscript:x", false],
    ["//evil.example", false],
  ])("%s → %s", (url, ok) => {
    expect(Boolean(safeHref(url))).toBe(ok);
  });
});

describe("blocksToPlainText", () => {
  it("flattens formatting for notifications and search", () => {
    const text = blocksToPlainText(parse("## Title\n\nA **bold** move.\n\n- one\n- two"));
    expect(text).toBe("Title\nA bold move.\n• one\n• two");
  });
});

// The admin editor previews live using a copy of this parser. If the copies
// drift, what an editor sees while typing is not what customers receive.
describe("web mirror", () => {
  it("src/lib/changelogMarkdown.ts is identical to the server parser", () => {
    const server = readFileSync(join(__dirname, "..", "src", "changelog", "markdown.ts"), "utf8");
    const web = readFileSync(join(__dirname, "..", "..", "src", "lib", "changelogMarkdown.ts"), "utf8");
    expect(web).toBe(server);
  });
});

describe("Firestore compatibility", () => {
  // Firestore rejects an array directly inside an array ("invalid nested
  // entity"). Lists used to be stored as Span[][], so any note with a bullet
  // list failed to save — manual or automatic.
  const hasNestedArray = (v: unknown): boolean =>
    Array.isArray(v)
      ? v.some((x) => Array.isArray(x) || hasNestedArray(x))
      : v !== null && typeof v === "object"
        ? Object.values(v as Record<string, unknown>).some(hasNestedArray)
        : false;

  it("never produces an array inside an array", () => {
    const b = parse(
      "## Heading\n\n- one **bold**\n- two [link](https://thekada.in)\n\n1. first\n2. second\n\n> quote\n\n![img](https://x.test/a.png)\n\n---",
    );
    expect(b.some((x) => x.t === "ul")).toBe(true);
    expect(b.some((x) => x.t === "ol")).toBe(true);
    expect(hasNestedArray(b)).toBe(false);
  });
});
