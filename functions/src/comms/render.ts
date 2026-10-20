/**
 * Safe template rendering. Supports only `{{variable}}` substitution (and
 * `{{{variable}}}` for pre-trusted raw HTML such as the unsubscribe link).
 * There is NO expression evaluation, loops, or code execution — a rendered
 * template can never run arbitrary logic, which keeps admin-authored templates
 * safe even if an editor account is compromised.
 */

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lookup(vars: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[k]
          : undefined,
      vars
    );
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * Render a template body. `raw` controls escaping: HTML bodies escape values
 * (except `{{{triple}}}` which are trusted), text bodies never escape.
 */
export function render(
  template: string,
  vars: Record<string, unknown>,
  opts: { html: boolean } = { html: true }
): string {
  if (!template) return "";
  // Triple-brace: trusted raw (unsubscribe/preferences URLs we build ourselves).
  let out = template.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_m, p1) =>
    stringify(lookup(vars, p1))
  );
  // Double-brace: normal value, escaped in HTML mode.
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, p1) => {
    const val = stringify(lookup(vars, p1));
    return opts.html ? escapeHtml(val) : val;
  });
  return out;
}

/** Extract the distinct `{{var}}` names a template references (for the editor). */
export function extractVariables(template: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\{?\s*([\w.]+)\s*\}?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) set.add(m[1]);
  return [...set];
}

/** Wrap body HTML in a minimal, email-client-safe responsive shell. */
export function wrapHtml(opts: {
  bodyHtml: string;
  preheader?: string;
  footerHtml?: string;
}): string {
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(
        opts.preheader
      )}</div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e9f0">
<tr><td style="padding:22px 28px;border-bottom:1px solid #eef1f6">
<span style="font-size:20px;font-weight:800;color:#2563eb;letter-spacing:-0.3px">The Kada</span>
</td></tr>
<tr><td style="padding:28px">${opts.bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #eef1f6;font-size:12px;color:#64748b;line-height:1.6">
${opts.footerHtml ?? ""}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
