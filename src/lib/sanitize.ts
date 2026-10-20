import DOMPurify from "dompurify";

/**
 * Sanitize untrusted HTML to prevent XSS attacks.
 *
 * Uses DOMPurify which strips dangerous tags (script, iframe, object, etc.),
 * event-handler attributes (onclick, onerror, etc.) and javascript: URIs while
 * preserving safe formatting tags.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    // Allow standard formatting + layout tags used in blog / email content
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr", "blockquote", "pre", "code",
      "ul", "ol", "li",
      "a", "strong", "em", "b", "i", "u", "s", "sub", "sup", "mark",
      "img", "figure", "figcaption",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td",
      "div", "span", "section", "article",
    ],
    ALLOWED_ATTR: [
      "href", "target", "rel", "src", "alt", "title", "width", "height",
      "class", "id", "style", "colspan", "rowspan",
    ],
    // Force links to open safely
    ADD_ATTR: ["target"],
  });
}
