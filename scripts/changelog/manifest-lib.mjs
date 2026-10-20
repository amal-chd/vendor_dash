// Pure helpers for the release manifest. No I/O, so they can be unit-tested
// from functions/test/changelogAuto.test.ts.

/**
 * Which surfaces a set of changed paths touches. The changelog writer uses
 * this to decide who a note is for, so it is based on where code runs, not
 * on how the repo happens to be organised.
 */
export function areaForFile(raw) {
  const f = String(raw).replace(/\\/g, "/");
  return areasForFiles([f])[0] ?? null;
}

/**
 * Up to [perArea] changed file names per surface, e.g.
 * { admin: ["RefundsPage.tsx"], "dine-web": ["KitchenPage.tsx"] } — so the
 * note writer knows WHICH part of a mixed commit each audience actually sees.
 */
export function filesBySurface(files, perArea = 6) {
  const out = {};
  for (const raw of files ?? []) {
    const area = areaForFile(raw);
    if (!area) continue;
    const name = String(raw).split("/").pop();
    const list = (out[area] ??= []);
    if (list.length < perArea && !list.includes(name)) list.push(name);
  }
  return out;
}

export function areasForFiles(files) {
  const areas = new Set();
  for (const raw of files ?? []) {
    const f = String(raw).replace(/\\/g, "/");
    // Mobile apps: code here reaches people only after a store release.
    if (f.startsWith("customer_mobile_app/")) areas.add("customer-app");
    else if (f.startsWith("vendor_mobile_app/")) areas.add("dine-app");
    else if (f.startsWith("delivery_mobile_app/")) areas.add("rider-app");
    else if (f.startsWith("host_app/")) areas.add("host-app");
    // Everything below is live as soon as it is deployed.
    else if (/^src\/(pages|components)\/admin\//.test(f) || f === "src/components/AdminLayout.tsx") areas.add("admin");
    else if (/^src\/pages\/(public|marketing)\//.test(f) || f.startsWith("public/")) areas.add("website");
    else if (f.startsWith("src/")) areas.add("dine-web");
    else if (f.startsWith("functions/") || /^(firestore|storage)\.rules$/.test(f) || f === "firestore.indexes.json") areas.add("backend");
  }
  return [...areas].sort();
}

/**
 * Parse `git log` output produced with the RECORD/FIELD separators below and
 * `--name-only`. Each record: sha, subject, body, author date, then file list.
 */
export const FIELD = "\u001f";
export const RECORD = "\u001e";

export function parseGitLog(output) {
  const commits = [];
  for (const chunk of String(output ?? "").split(RECORD)) {
    const text = chunk.replace(/^\n+/, "");
    if (!text.trim()) continue;
    const parts = text.split(FIELD);
    if (parts.length < 4) continue;
    const [sha, subject, body, rest] = parts;
    const [date, ...fileLines] = rest.split("\n");
    const files = fileLines.map((l) => l.trim()).filter(Boolean);
    commits.push({
      sha: sha.trim(),
      subject: subject.trim(),
      body: body.trim().slice(0, 1500),
      date: date.trim(),
      areas: areasForFiles(files),
      surfaces: filesBySurface(files),
    });
  }
  return commits;
}
