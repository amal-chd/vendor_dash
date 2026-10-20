import { describe, it, expect } from "vitest";
import {
  DEFAULT_AUTO_SETTINGS,
  FIRST_RUN_WINDOW_DAYS,
  SECURITY_HINT_RE,
  buildAutoPrompt,
  commitKey,
  commitsForTarget,
  decideAutoPolicy,
  freshCommits,
  isNoiseCommit,
  mergeSeen,
  parseAutoNotes,
  type GeneratedNote,
  type KeyedCommit,
  type ManifestCommit,
} from "../src/changelog/auto";
// @ts-expect-error — plain ESM helper shared with the deploy hook, no types.
import { areasForFiles, parseGitLog, FIELD, RECORD } from "../../scripts/changelog/manifest-lib.mjs";

const NOW = Date.parse("2026-09-17T10:00:00+05:30");
const DAY = 86_400_000;

const commit = (subject: string, daysAgo = 1, areas: string[] = ["dine-web"], body = ""): ManifestCommit => ({
  sha: Math.random().toString(16).slice(2).padEnd(40, "0"),
  subject,
  body,
  date: new Date(NOW - daysAgo * DAY).toISOString(),
  areas,
});
const keyed = (c: ManifestCommit): KeyedCommit => ({ ...c, key: commitKey(c) });

const note = (over: Partial<GeneratedNote> = {}): GeneratedNote => ({
  audiences: ["vendor"],
  type: "improved",
  title: "Faster menu editing",
  summary: "Menu changes now save as you type.",
  body: "- Saves as you type",
  public: false,
  sensitive: false,
  commitKeys: [],
  ...over,
});

describe("manifest", () => {
  it("maps files to the surface where the code runs", () => {
    expect(
      areasForFiles([
        "customer_mobile_app/lib/main.dart",
        "vendor_mobile_app/lib/x.dart",
        "delivery_mobile_app/lib/x.dart",
        "host_app/lib/x.dart",
        "src/pages/admin/Foo.tsx",
        "src/components/AdminLayout.tsx",
        "src/pages/public/ChangelogPublicPage.tsx",
        "src/pages/dashboard/Menu.tsx",
        "functions/src/zones.ts",
        "firestore.rules",
      ]),
    ).toEqual(["admin", "backend", "customer-app", "dine-app", "dine-web", "host-app", "rider-app", "website"]);
    expect(areasForFiles(["README.md", "vite.config.ts"])).toEqual([]);
  });

  it("parses git log records, including multi-line bodies", () => {
    const out =
      `${RECORD}aaa${FIELD}feat(rider): offline sync${FIELD}Line one\nLine two\n${FIELD}2026-09-05T10:00:00+05:30\n\ndelivery_mobile_app/lib/a.dart\nfunctions/src/b.ts\n` +
      `${RECORD}bbb${FIELD}fix: typo${FIELD}${FIELD}2026-09-04T10:00:00+05:30\n\nsrc/pages/public/Home.tsx\n`;
    const commits = parseGitLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      sha: "aaa",
      subject: "feat(rider): offline sync",
      body: "Line one\nLine two",
      date: "2026-09-05T10:00:00+05:30",
      areas: ["backend", "rider-app"],
    });
    expect(commits[1].areas).toEqual(["website"]);
    expect(commits[0].surfaces).toEqual({ "rider-app": ["a.dart"], backend: ["b.ts"] });
  });

  it("tells the note writer which files are on which surface", () => {
    const c = keyed({ ...commit("fix(web): refunds + kitchen", 1, ["admin", "dine-web"]), surfaces: { admin: ["RefundsPage.tsx"], "dine-web": ["KitchenPage.tsx"] } });
    const { system, user } = buildAutoPrompt([c]);
    expect(user).toContain("admin: RefundsPage.tsx");
    expect(system).toMatch(/admin console is for audience "admin" ONLY/);
  });
});

describe("choosing commits", () => {
  it("keys a change by author date + subject, so a rebased copy is the same change", () => {
    const a = commit("feat: zones");
    const rebased = { ...a, sha: "f".repeat(40) };
    expect(commitKey(a)).toBe(commitKey(rebased));
    expect(commitKey(a)).not.toBe(commitKey({ ...a, subject: "feat: zones v2" }));
  });

  it("skips housekeeping commits", () => {
    for (const s of ["chore(host): regen", "ci: cache", "docs: readme", "test: more", "refactor(web)!: split", "Merge branch 'x'", "wip", "build: bump"]) {
      expect(isNoiseCommit({ subject: s }), s).toBe(true);
    }
    for (const s of ["feat(rider): offline sync", "fix: order totals", "perf: faster menu"]) {
      expect(isNoiseCommit({ subject: s }), s).toBe(false);
    }
  });

  it("keeps only recent, unseen, meaningful commits, once each", () => {
    const recent = commit("feat: new thing", 2);
    const old = commit("feat: ancient", 30);
    const seen = commit("fix: already announced", 1);
    const noise = commit("chore: bump", 1);
    const dupe = { ...recent, sha: "d".repeat(40) };
    const out = freshCommits([recent, old, seen, noise, dupe], { [commitKey(seen)]: NOW }, NOW);
    expect(out.map((c) => c.subject)).toEqual(["feat: new thing"]);
  });

  it("announces only what the deploy shipped", () => {
    const api = commit("feat: api", 1, ["backend"]);
    const webOnly = commit("feat: dashboard", 1, ["dine-web"]);
    const both = commit("feat: both", 1, ["backend", "admin"]);
    const appOnly = commit("feat: app", 1, ["rider-app"]);
    const config = commit("fix: vite config", 1, []);
    const all = [api, webOnly, both, appOnly, config];
    expect(commitsForTarget(all, "functions").map((c) => c.subject)).toEqual(["feat: api", "feat: both", "feat: app"]);
    expect(commitsForTarget(all, "hosting").map((c) => c.subject)).toEqual(["feat: dashboard", "feat: both", "feat: app"]);
    expect(commitsForTarget(all, "deploy")).toHaveLength(5);
  });

  it("looks back only a week on the very first run", () => {
    const tenDays = commit("feat: ten days ago", 10);
    expect(freshCommits([tenDays], {}, NOW, FIRST_RUN_WINDOW_DAYS)).toHaveLength(0);
    expect(freshCommits([tenDays], {}, NOW)).toHaveLength(1);
  });

  it("remembers handled commits long enough and forgets old ones", () => {
    const merged = mergeSeen({ stale: NOW - 90 * DAY, kept: NOW - 5 * DAY }, [{ key: "new", date: new Date(NOW - 20 * DAY).toISOString() }], NOW);
    expect(Object.keys(merged).sort()).toEqual(["kept", "new"]);
    // Retention counts from when it was handled, not when it was written.
    expect(merged.new).toBe(NOW);
  });
});

describe("publishing policy", () => {
  const web = keyed(commit("feat: bulk menu edit", 1, ["dine-web"]));
  const app = keyed(commit("feat: rider offline sync", 1, ["rider-app"]));

  it("holds a normal note for the configured window, then it goes live on its own", () => {
    const d = decideAutoPolicy(note({ commitKeys: [web.key] }), [web], DEFAULT_AUTO_SETTINGS, NOW);
    expect(d.status).toBe("scheduled");
    expect(d.publishAt).toBe(NOW + 60 * 60_000);
    expect(d.heldReason).toBeNull();
  });

  it("publishes straight away when the hold is 0", () => {
    const d = decideAutoPolicy(note({ commitKeys: [web.key] }), [web], { ...DEFAULT_AUTO_SETTINGS, autoHoldMinutes: 0 }, NOW);
    expect(d).toMatchObject({ status: "published", publishAt: null });
  });

  it("publishes internal-only notes immediately and never publicly", () => {
    const d = decideAutoPolicy(note({ audiences: ["admin"], public: true, commitKeys: [web.key] }), [web], { ...DEFAULT_AUTO_SETTINGS, requireReview: true }, NOW);
    expect(d).toMatchObject({ status: "published", public: false, notifyPush: false });
  });

  it("keeps anything security-flavoured as a draft", () => {
    const holey = keyed(commit("fix(onboarding): close the booking loophole", 1, ["backend"]));
    for (const [n, src] of [
      [note({ commitKeys: [holey.key] }), [holey]],
      [note({ sensitive: true, commitKeys: [web.key] }), [web]],
      [note({ type: "security", commitKeys: [web.key] }), [web]],
      [note({ type: "breaking", commitKeys: [web.key] }), [web]],
    ] as const) {
      const d = decideAutoPolicy(n, [...src], DEFAULT_AUTO_SETTINGS, NOW);
      expect(d.status).toBe("draft");
      expect(d.public).toBe(false);
      expect(d.notifyPush).toBe(false);
      expect(d.heldReason).toBeTruthy();
    }
  });

  it("waits for the store release when only app code changed", () => {
    const d = decideAutoPolicy(note({ audiences: ["rider"], commitKeys: [app.key] }), [app], DEFAULT_AUTO_SETTINGS, NOW);
    expect(d.status).toBe("draft");
    expect(d.heldReason).toMatch(/app update/i);

    const mixed = keyed(commit("feat: rider offline sync", 1, ["rider-app", "backend"]));
    expect(decideAutoPolicy(note({ audiences: ["rider"], commitKeys: [mixed.key] }), [mixed], DEFAULT_AUTO_SETTINGS, NOW).status).toBe("scheduled");
  });

  it("respects review settings", () => {
    const n = note({ commitKeys: [web.key] });
    expect(decideAutoPolicy(n, [web], { ...DEFAULT_AUTO_SETTINGS, requireReview: true }, NOW).status).toBe("in_review");
    expect(decideAutoPolicy(n, [web], { ...DEFAULT_AUTO_SETTINGS, autoPublish: "review" }, NOW).status).toBe("draft");
  });

  it("only puts notes on the website when a public-facing audience sees them", () => {
    expect(decideAutoPolicy(note({ audiences: ["rider"], public: true, commitKeys: [web.key] }), [web], DEFAULT_AUTO_SETTINGS, NOW).public).toBe(false);
    expect(decideAutoPolicy(note({ audiences: ["customer"], public: true, commitKeys: [web.key] }), [web], DEFAULT_AUTO_SETTINGS, NOW).public).toBe(true);
  });

  it("flags the words that usually describe a fixed hole", () => {
    for (const s of ["close create-path hole", "payment bypass", "leaked tokens", "P0 fix", "unauthorized reads", "XSS in menu"]) {
      expect(SECURITY_HINT_RE.test(s), s).toBe(true);
    }
    for (const s of ["faster menu", "offline delivery sync", "holiday hours"]) {
      expect(SECURITY_HINT_RE.test(s), s).toBe(false);
    }
  });
});

describe("model output", () => {
  const c = keyed(commit("feat: bulk menu edit"));

  it("accepts well-formed notes and drops everything else", () => {
    const notes = parseAutoNotes(
      {
        notes: [
          { audiences: ["vendor", "martian"], type: "new", title: "Edit many dishes at once", summary: "Select dishes and change them together.", body: "- Bulk edit", public: true, sensitive: false, commitKeys: [c.key, "made-up"] },
          { audiences: [], type: "new", title: "No audience", summary: "This one has nobody to read it.", commitKeys: [c.key] },
          { audiences: ["vendor"], type: "new", title: "Invented", summary: "Refers to a commit that doesn't exist.", commitKeys: ["nope"] },
          { audiences: ["vendor"], type: "weird", title: "OK", summary: "short" },
          "garbage",
        ],
      },
      new Set([c.key]),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ audiences: ["vendor"], type: "new", commitKeys: [c.key], public: true });
  });

  it("returns nothing for junk", () => {
    expect(parseAutoNotes(null, new Set())).toEqual([]);
    expect(parseAutoNotes({ notes: "x" }, new Set())).toEqual([]);
  });

  it("gives the model keys and plain surfaces, never shas", () => {
    const { user } = buildAutoPrompt([c]);
    expect(user).toContain(c.key);
    expect(user).toContain("web dashboard");
    expect(user).not.toContain(c.sha);
  });
});
