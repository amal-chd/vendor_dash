/**
 * ─────────────────────────────────────────────────────────────────────────
 * Changelog markdown → blocks.
 *
 * Release notes are written in a small, documented markdown subset and parsed
 * ONCE, on the server, into a block tree stored alongside the source. Every
 * reader — the admin preview, the public website and the four Flutter apps —
 * renders blocks and never parses markdown itself.
 *
 * Why not ship markdown to the clients: none of the five codebases has a
 * markdown library, and four separate parsers would each disagree about some
 * edge case, so the same note would render differently per app. Rendering a
 * tree is trivial and identical everywhere. It also removes the injection
 * surface: there is no raw-HTML block, and link schemes are allow-listed here,
 * so a client can render an `href` without re-validating it.
 *
 * Supported syntax (anything else is plain paragraph text):
 *   ## Heading / ### Subheading     (a single `#` is treated as `##`)
 *   - item / * item                 bulleted list
 *   1. item                         numbered list
 *   > quote
 *   ---                             divider
 *   ![alt](https://…)               image, on its own line, https only
 *   **bold**  *italic*  _italic_  `code`  [text](url)
 *   \* \_ \` \[                     escape a marker
 *
 * THIS FILE IS MIRRORED at src/lib/changelogMarkdown.ts so the admin editor
 * can preview live while typing. A test fails if the two drift apart — edit
 * both together.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface Span {
  /** Text content. */
  x: string;
  /** Bold. */
  b?: true;
  /** Italic. */
  i?: true;
  /** Inline code. */
  c?: true;
  /** Link target — already allow-listed, safe to render as-is. */
  href?: string;
}

export type Block =
  | { t: "h2" | "h3" | "p" | "quote"; s: Span[] }
  // Each item is an object, not a bare array: Firestore rejects arrays
  // nested directly inside arrays, which made any note with a list unsaveable.
  | { t: "ul" | "ol"; items: { s: Span[] }[] }
  | { t: "img"; src: string; alt: string }
  | { t: "hr" };

export const MAX_BODY_CHARS = 20_000;
export const MAX_BLOCKS = 300;

/**
 * Allow-list for links. `kada://` is the apps' deep-link scheme; everything
 * else a note could reasonably link to is web or email. `javascript:`,
 * `data:` and friends are dropped — the text survives, the link does not.
 */
export function safeHref(raw: string): string | undefined {
  const url = raw.trim();
  if (/^https?:\/\/[^\s]+$/i.test(url)) return url;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(url)) return url;
  if (/^kada:\/\/[a-z0-9\-/._?=&%]+$/i.test(url)) return url;
  // Site-relative paths (/pricing) are fine on the website and harmless in-app.
  // Not `//host`: a protocol-relative URL leaves the site while looking local.
  if (/^\/(?!\/)[a-z0-9\-/._?=&%#]*$/i.test(url)) return url;
  return undefined;
}

/** Images must be https — no data URIs, no mixed content. */
export function safeImageSrc(raw: string): string | undefined {
  const url = raw.trim();
  return /^https:\/\/[^\s]+$/i.test(url) ? url : undefined;
}

type Flags = { b: boolean; i: boolean };

function pushSpan(out: Span[], text: string, flags: Flags, extra?: Partial<Span>) {
  if (!text) return;
  const span: Span = { x: text };
  if (flags.b) span.b = true;
  if (flags.i) span.i = true;
  if (extra?.c) span.c = true;
  if (extra?.href) span.href = extra.href;

  // Merge with the previous span when nothing but the text differs, so
  // "a **b** c" is three spans and not one span per character run.
  const prev = out[out.length - 1];
  if (
    prev &&
    !prev.c &&
    !span.c &&
    prev.b === span.b &&
    prev.i === span.i &&
    prev.href === span.href
  ) {
    prev.x += span.x;
    return;
  }
  out.push(span);
}

/** True when `ch` may open/close an underscore emphasis (not mid-word). */
function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

/**
 * Parse inline markup. `allowLinks` is false inside link text, so a link can
 * never contain another link.
 */
export function parseInline(src: string, allowLinks = true, base: Flags = { b: false, i: false }): Span[] {
  const out: Span[] = [];
  const flags: Flags = { ...base };
  let buf = "";
  let i = 0;

  const flush = () => {
    pushSpan(out, buf, flags);
    buf = "";
  };

  while (i < src.length) {
    const ch = src[i];

    // Escapes: \* \_ \` \[ \] \\ render the marker literally.
    if (ch === "\\" && i + 1 < src.length && /[*_`[\]\\]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // Inline code wins over everything — its contents are literal.
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        pushSpan(out, src.slice(i + 1, end), { b: false, i: false }, { c: true });
        i = end + 1;
        continue;
      }
    }

    // Links: [text](url)
    if (ch === "[" && allowLinks) {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        flush();
        const href = safeHref(m[2]);
        const inner = parseInline(m[1], false, flags);
        for (const s of inner) {
          if (href && !s.c) s.href = href;
          out.push(s);
        }
        i += m[0].length;
        continue;
      }
    }

    // Bold: **…** — only toggles when a matching close exists, so a stray
    // "**" renders literally instead of bolding the rest of the note.
    if (ch === "*" && src[i + 1] === "*") {
      const opening = !flags.b;
      const closeAt = opening ? src.indexOf("**", i + 2) : i;
      if (!opening || closeAt > i + 2) {
        flush();
        flags.b = !flags.b;
        i += 2;
        continue;
      }
    }

    // Italic: *…* or _…_ (underscores only at word boundaries, so snake_case
    // and file_names stay intact).
    if (ch === "*" || ch === "_") {
      const underscore = ch === "_";
      const boundaryOk = !underscore || !isWordChar(flags.i ? src[i + 1] : src[i - 1]);
      if (boundaryOk) {
        if (flags.i) {
          flush();
          flags.i = false;
          i += 1;
          continue;
        }
        const close = src.indexOf(ch, i + 1);
        const closeBoundary = !underscore || !isWordChar(src[close + 1]);
        if (close > i + 1 && src[i + 1] !== " " && closeBoundary) {
          flush();
          flags.i = true;
          i += 1;
          continue;
        }
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out
    .map((s) => ({ ...s, x: s.x.replace(/\s+/g, " ") }))
    .filter((s) => s.x.length > 0);
}

const H_RE = /^(#{1,3})\s+(.+)$/;
const UL_RE = /^[-*]\s+(.+)$/;
const OL_RE = /^\d{1,3}[.)]\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const IMG_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

/** Parse a note body into blocks. Never throws; oversize input is truncated. */
export function parseChangelogMarkdown(input: string): Block[] {
  const text = (input ?? "").replace(/\r\n?/g, "\n").slice(0, MAX_BODY_CHARS);
  const lines = text.split("\n");
  const blocks: Block[] = [];

  let para: string[] = [];
  let quote: string[] = [];
  let list: { t: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      const s = parseInline(para.join(" ").trim());
      if (s.length) blocks.push({ t: "p", s });
      para = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      const s = parseInline(quote.join(" ").trim());
      if (s.length) blocks.push({ t: "quote", s });
      quote = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items
        .map((it) => parseInline(it.trim()))
        .filter((s) => s.length)
        .map((s) => ({ s }));
      if (items.length) blocks.push({ t: list.t, items });
      list = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    flushList();
  };

  for (const rawLine of lines) {
    if (blocks.length >= MAX_BLOCKS) break;
    const line = rawLine.trim();

    if (!line) {
      flushAll();
      continue;
    }

    if (HR_RE.test(line)) {
      flushAll();
      blocks.push({ t: "hr" });
      continue;
    }

    const img = IMG_RE.exec(line);
    if (img) {
      const src = safeImageSrc(img[2]);
      flushAll();
      // An unsafe image is dropped entirely rather than shown as broken text.
      if (src) blocks.push({ t: "img", src, alt: img[1].trim().slice(0, 200) });
      continue;
    }

    const h = H_RE.exec(line);
    if (h) {
      flushAll();
      const s = parseInline(h[2].trim());
      if (s.length) blocks.push({ t: h[1].length === 3 ? "h3" : "h2", s });
      continue;
    }

    const ul = UL_RE.exec(line);
    const ol = ul ? null : OL_RE.exec(line);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      flushPara();
      flushQuote();
      if (list && list.t !== kind) flushList();
      if (!list) list = { t: kind, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }

    const q = QUOTE_RE.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }

    // A plain line directly under a list item continues that item, which is
    // how people naturally wrap a long bullet.
    if (list && list.items.length && !para.length) {
      list.items[list.items.length - 1] += " " + line;
      continue;
    }

    flushQuote();
    flushList();
    para.push(line);
  }

  flushAll();
  return blocks.slice(0, MAX_BLOCKS);
}

/** Flatten blocks to readable text — push bodies, search, and AI context. */
export function blocksToPlainText(blocks: Block[]): string {
  const spans = (s: Span[]) => s.map((x) => x.x).join("");
  return blocks
    .map((b) => {
      switch (b.t) {
        case "h2":
        case "h3":
        case "p":
        case "quote":
          return spans(b.s);
        case "ul":
        case "ol":
          return b.items.map((it) => `• ${spans(it.s)}`).join("\n");
        case "img":
          return b.alt;
        case "hr":
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}
