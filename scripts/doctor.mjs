#!/usr/bin/env node
/**
 * Kada doctor — catches the failure classes this project has actually hit.
 *
 * Every check below exists because something broke in production or shipped
 * broken to TestFlight, and in every case the failure was SILENT: the build
 * stayed green and nothing surfaced until a user hit it.
 *
 *   node scripts/doctor.mjs            # offline checks (fast, no credentials)
 *   node scripts/doctor.mjs --online   # adds checks that query Firebase
 *   node scripts/doctor.mjs --json     # machine-readable, for CI
 *
 * Exit code 1 if any check FAILS. Warnings do not fail the run.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Since the 2026-10 split the apps and websites live beside this project
// (The Kada/Mobile Apps, The Kada/Websites); a monorepo checkout keeps them
// inside it. Look inside first, then beside.
const KADA = join(ROOT, "..", "..");
const appDir = (a) =>
  existsSync(join(ROOT, a)) ? join(ROOT, a) : join(KADA, "Mobile Apps", a === "host_app" ? "host_mobile_app" : a);
const webDir = (w) => (existsSync(join(ROOT, w)) ? join(ROOT, w) : join(KADA, "Websites", w));
const ONLINE = process.argv.includes("--online");
const JSON_OUT = process.argv.includes("--json");

// The doctor gates `firebase deploy` (see firebase.json predeploy). That is the
// point — the admin panel once shipped calling a region that no longer hosted
// its functions. But a guard that cannot be bypassed becomes the outage during
// a real incident, so leave a deliberate, visible door open.
if (process.env.KADA_SKIP_DOCTOR === "1") {
  console.warn("[doctor] skipped: KADA_SKIP_DOCTOR=1 — you are deploying unchecked.");
  process.exit(0);
}

const APPS = ["customer_mobile_app", "vendor_mobile_app", "delivery_mobile_app", "host_app"];
const MAPS_APPS = ["customer_mobile_app", "vendor_mobile_app", "delivery_mobile_app"];
const FUNCTIONS_REGION = "asia-south1";
/** Cloud Functions drops Node 20 on this date. */
const NODE20_EOL = "2026-10-30";

const results = [];
const record = (status, name, detail, fix) => results.push({ status, name, detail, fix });
const pass = (name, detail) => record("pass", name, detail);
const fail = (name, detail, fix) => record("fail", name, detail, fix);
const warn = (name, detail, fix) => record("warn", name, detail, fix);

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts });
  } catch (e) {
    return e.stdout ?? "";
  }
}

/** Recursively collect files under dir matching a predicate. */
function walk(dir, test, out = [], depth = 0) {
  if (depth > 12 || !existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "build", "dist", ".dart_tool", "Pods", "lib"].includes(entry.name) && entry.isDirectory()) {
      // functions/lib is compiled output; app lib/ is source, so only skip
      // "lib" when it sits directly under functions/.
      if (entry.name !== "lib" || dir.endsWith("functions")) continue;
    }
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, test, out, depth + 1);
    else if (test(p)) out.push(p);
  }
  return out;
}

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const plist = (p) => {
  const out = sh("python3", ["-c", `import plistlib,json,sys;print(json.dumps(plistlib.load(open(sys.argv[1],'rb')),default=str))`, p]);
  try { return JSON.parse(out); } catch { return null; }
};

// ---------------------------------------------------------------------------
// 1. Region drift.
// The admin panel shipped calling us-central1 after the functions moved to
// Mumbai, so every admin callable (refunds, payouts, settlements, onboarding
// approvals) failed in production while the build stayed green. The vendor
// app had the same bug in the aggregator webhook URL it hands to partners.
// ---------------------------------------------------------------------------
function checkRegionDrift() {
  const dartFiles = APPS.flatMap((a) => walk(join(appDir(a), "lib"), (p) => p.endsWith(".dart")));
  const webFiles = [
    ...walk(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p)),
    ...walk(join(webDir("customer_web"), "src"), (p) => /\.(ts|tsx)$/.test(p)),
  ];

  const stale = [];
  for (const f of [...dartFiles, ...webFiles]) {
    const body = read(f);
    body.split("\n").forEach((line, i) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
      if (line.includes("us-central1")) stale.push(`${f.replace(ROOT + "/", "")}:${i + 1}`);
    });
  }

  // A callable built without an explicit region silently targets us-central1.
  const defaulted = [];
  for (const f of dartFiles) {
    read(f).split("\n").forEach((line, i) => {
      const t = line.trim();
      // Skip comments: functions_region.dart documents the very antipattern it
      // exists to replace, and a false FAIL here blocks every deploy.
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (/FirebaseFunctions\.instance\b/.test(line) && !line.includes("instanceFor")) {
        defaulted.push(`${f.replace(ROOT + "/", "")}:${i + 1}`);
      }
    });
  }

  if (stale.length || defaulted.length) {
    fail(
      "region drift",
      [
        stale.length ? `${stale.length} reference(s) to us-central1: ${stale.slice(0, 4).join(", ")}` : "",
        defaulted.length ? `${defaulted.length} callable(s) using the default region: ${defaulted.slice(0, 4).join(", ")}` : "",
      ].filter(Boolean).join(" | "),
      `Functions run in ${FUNCTIONS_REGION}. Use FirebaseFunctions.instanceFor(region: '${FUNCTIONS_REGION}') and build URLs with that region.`,
    );
  } else {
    pass("region drift", `no client code targets a region other than ${FUNCTIONS_REGION}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Xcode Cloud post-clone scripts must be executable IN GIT.
// All three were committed 100644, so Xcode Cloud skipped them silently:
// Flutter never ran, Generated.xcconfig never appeared, and the build died
// with "module 'cloud_firestore' not found". core.fileMode is false here, so
// chmod on disk does not reach git — it needs git update-index --chmod=+x.
// ---------------------------------------------------------------------------
function checkCiScriptMode() {
  const lines = sh("git", ["ls-files", "-s"]).split("\n").filter((l) => l.includes("ci_post_clone.sh"));
  if (!lines.length) return warn("ci_post_clone mode", "no ci_post_clone.sh tracked");
  const bad = lines.filter((l) => !l.startsWith("100755")).map((l) => l.split("\t")[1]);
  bad.length
    ? fail("ci_post_clone mode", `not executable in git: ${bad.join(", ")}`,
        `git update-index --chmod=+x ${bad.join(" ")}`)
    : pass("ci_post_clone mode", `${lines.length} script(s), all 100755`);
}

// ---------------------------------------------------------------------------
// 3. UIScene adoption, and the delegate class actually existing.
// iOS 27 terminates apps built against its SDK that have not adopted the
// UIScene lifecycle — 100% launch crash, every TestFlight report identical.
// A later merge then left the plist naming FlutterSceneDelegate while the
// AppDelegate defined its own SceneDelegate: that builds and launches fine
// but silently drops the firebase_auth URL forwarding.
// ---------------------------------------------------------------------------
function checkSceneLifecycle() {
  const problems = [];
  for (const app of APPS) {
    const infoPath = join(appDir(app), "ios/Runner/Info.plist");
    const delegatePath = join(appDir(app), "ios/Runner/AppDelegate.swift");
    if (!existsSync(infoPath)) continue;
    const info = plist(infoPath);
    const cfg = info?.UIApplicationSceneManifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication?.[0];
    if (!cfg) { problems.push(`${app}: no UIApplicationSceneManifest (iOS 27 will kill it at launch)`); continue; }

    const declared = String(cfg.UISceneDelegateClassName ?? "");
    const src = read(delegatePath);
    const definesOwn = /class\s+SceneDelegate\s*:/.test(src);
    if (declared.includes("$(PRODUCT_MODULE_NAME)") && !definesOwn) {
      problems.push(`${app}: plist names a custom SceneDelegate but AppDelegate.swift defines none`);
    }
    if (declared === "FlutterSceneDelegate" && definesOwn) {
      problems.push(`${app}: defines a SceneDelegate subclass the plist never instantiates (its overrides are dead)`);
    }
    if (src && !/didInitializeImplicitFlutterEngine/.test(src)) {
      problems.push(`${app}: plugins are not registered in didInitializeImplicitFlutterEngine — under scenes they register against an engine that does not exist yet`);
    }
  }
  problems.length
    ? fail("UIScene lifecycle", problems.join(" | "), "See docs/RELEASE_AND_SYNC.md §3.")
    : pass("UIScene lifecycle", `${APPS.length} apps adopt UIScene with a matching delegate`);
}

// ---------------------------------------------------------------------------
// 4. Secrets in the repo.
// A live Razorpay key_id/key_secret sat in rzp-key.csv from September. Maps
// keys were hardcoded in three AppDelegates and three manifests.
// Firebase client config (firebase_options.dart, src/lib/firebase.ts) is
// deliberately public and is excluded.
// ---------------------------------------------------------------------------
function checkSecrets() {
  const tracked = sh("git", ["ls-files"]).split("\n").filter(Boolean);
  const hits = [];

  for (const rel of tracked) {
    if (/firebase_options\.dart|src\/lib\/firebase\.ts|GoogleService-Info\.plist|google-services\.json|\.example$|docs\//.test(rel)) continue;
    if (!/\.(dart|swift|ts|tsx|js|cjs|mjs|json|csv|xml|kts|gradle|sh|ya?ml|plist)$/.test(rel)) continue;
    const body = read(join(ROOT, rel));
    if (!body) continue;
    if (/rzp_live_[A-Za-z0-9]{10,}|sk_live_[A-Za-z0-9]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(body)) {
      hits.push(`${rel} (live credential)`);
    }
    // Maps keys belong in Secrets.xcconfig / manifest placeholders, not source.
    if (/(AndroidManifest\.xml|AppDelegate\.swift)$/.test(rel) && /AIzaSy[A-Za-z0-9_-]{20,}/.test(body)) {
      hits.push(`${rel} (hardcoded Maps key)`);
    }
  }

  const sensitiveNames = tracked.filter((f) => /(^|\/)\.env($|\.)|\.p12$|\.p8$|\.mobileprovision$|service.?account.*\.json$/i.test(f) && !f.endsWith(".example"));
  hits.push(...sensitiveNames.map((f) => `${f} (sensitive file tracked)`));

  hits.length
    ? fail("secrets", hits.join(", "), "Remove from git AND rotate — history keeps the old value.")
    : pass("secrets", "no live credentials or hardcoded Maps keys in tracked source");
}

// ---------------------------------------------------------------------------
// 5. Write-only config flags.
// "Demo mode on/off is not working" turned out to be a switch whose flag
// nothing read: config/platform.demoMode was only ever written. Same class as
// the profile toggles found in the truthfulness audit.
// ---------------------------------------------------------------------------
function checkDeadFlags() {
  const settings = read(join(ROOT, "src/pages/admin/PlatformSettingsPage.tsx"));
  const block = settings.match(/const DEFAULTS = \{([\s\S]*?)\n\};/);
  if (!block) return warn("dead config flags", "could not parse PlatformSettingsPage DEFAULTS");

  const keys = [...block[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  const haystack = [
    ...APPS.flatMap((a) => walk(join(appDir(a), "lib"), (p) => p.endsWith(".dart"))),
    ...walk(join(ROOT, "functions/src"), (p) => p.endsWith(".ts")),
    ...walk(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p) && !p.includes("PlatformSettingsPage")),
    ...walk(join(webDir("customer_web"), "src"), (p) => /\.(ts|tsx)$/.test(p)),
  ].map(read).join("\n");

  const dead = keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(haystack));
  dead.length
    ? fail("dead config flags", `written by the admin UI but read nowhere: ${dead.join(", ")}`,
        "Either wire the flag up or delete the control — a switch that does nothing is worse than no switch.")
    : pass("dead config flags", `${keys.length} platform flags all have readers`);
}

// ---------------------------------------------------------------------------
// 6. Cloud Functions runtime deadline.
// ---------------------------------------------------------------------------
function checkNodeRuntime() {
  const pkg = JSON.parse(read(join(ROOT, "functions/package.json")) || "{}");
  const node = String(pkg.engines?.node ?? "");
  const major = parseInt(node.replace(/[^0-9]/g, ""), 10);
  const daysLeft = Math.round((new Date(NODE20_EOL) - new Date()) / 86400000);
  if (!major) return warn("functions runtime", "functions/package.json declares no engines.node");
  if (major < 22) {
    fail("functions runtime", `engines.node is "${node}"; Node 20 is decommissioned on ${NODE20_EOL} (${daysLeft} days)`,
      'Set "node": "22" and redeploy — each function only moves on its next deploy.');
  } else {
    pass("functions runtime", `engines.node = ${node}`);
  }
}

// ---------------------------------------------------------------------------
// 7. iOS deployment target must be explicit.
// "$(RECOMMENDED_IPHONEOS_DEPLOYMENT_TARGET)" silently became 17.0 under
// Xcode 27, dropping every iOS 15/16 device without anyone choosing that.
// ---------------------------------------------------------------------------
function checkDeploymentTarget() {
  const bad = [];
  for (const app of APPS) {
    const p = join(appDir(app), "ios/Runner.xcodeproj/project.pbxproj");
    const body = read(p);
    if (!body) continue;
    for (const m of body.matchAll(/isa = XCBuildConfiguration;[\s\S]*?\n\t\t\};/g)) {
      const b = m[0];
      if (!b.includes("RECOMMENDED_IPHONEOS_DEPLOYMENT_TARGET")) continue;
      const bid = b.match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/)?.[1] ?? "";
      if (bid && !bid.endsWith(".RunnerTests")) bad.push(`${app} (${bid})`);
    }
  }
  bad.length
    ? fail("iOS deployment target", `app targets follow Xcode's recommendation, which drifts upward: ${[...new Set(bad)].join(", ")}`,
        "Pin IPHONEOS_DEPLOYMENT_TARGET explicitly so the supported-device floor is a decision, not a side effect.")
    : pass("iOS deployment target", "all shipping app targets pin an explicit version");
}

// ---------------------------------------------------------------------------
// 8. Maps key plumbing.
// The key must reach the build from outside the repo, or CI ships a blank map.
// ---------------------------------------------------------------------------
function checkMapsKeyWiring() {
  const problems = [];
  for (const app of MAPS_APPS) {
    const info = plist(join(appDir(app), "ios/Runner/Info.plist"));
    if (info && !info.GMSApiKey) problems.push(`${app}: Info.plist has no GMSApiKey entry`);
    for (const cfg of ["Debug", "Release"]) {
      const body = read(join(appDir(app), `ios/Flutter/${cfg}.xcconfig`));
      if (body && !body.includes("Secrets.xcconfig")) problems.push(`${app}: ${cfg}.xcconfig does not include Secrets.xcconfig`);
    }
    const manifest = read(join(appDir(app), "android/app/src/main/AndroidManifest.xml"));
    if (manifest.includes("com.google.android.geo.API_KEY") && !manifest.includes("${GOOGLE_MAPS_API_KEY}")) {
      problems.push(`${app}: Android manifest does not use the GOOGLE_MAPS_API_KEY placeholder`);
    }

    // The wiring being present is not enough — CI has to REFUSE to build
    // without a value. Secrets.xcconfig is gitignored, so a fresh Xcode Cloud
    // clone has no key; the Info.plist then substitutes an empty GMSApiKey and
    // the SDK declines to initialise ("provideAPIKey: requires non-empty API
    // key"). Every screen with a map then dies on an uncaught NSException.
    // This shipped to TestFlight because the script warned and carried on.
    const ci = read(join(appDir(app), "ios/ci_scripts/ci_post_clone.sh"));
    if (ci && !/GOOGLE_MAPS_API_KEY/.test(ci)) {
      problems.push(`${app}: ci_post_clone.sh never writes Secrets.xcconfig`);
    } else if (ci && !/exit 1/.test(ci.slice(ci.indexOf("GOOGLE_MAPS_API_KEY")))) {
      problems.push(
        `${app}: ci_post_clone.sh continues when GOOGLE_MAPS_API_KEY is unset — that ships a build that crashes on every map`,
      );
    }
  }
  problems.length
    ? fail("maps key wiring", problems.join(" | "), "See docs/RELEASE_AND_SYNC.md §4c.")
    : pass("maps key wiring", "wired in all map-using apps, and CI refuses to build without the key");
}

// ---------------------------------------------------------------------------
// 8b. TestFlight blockers that are not crashes.
// A build can upload fine and still never reach a tester. The rider app was
// the only one missing ITSAppUsesNonExemptEncryption, so every upload parked in
// "Missing Compliance" until someone answered the export questionnaire by hand.
// Push entitlements matter the same way: a Release build signed with the
// development APNs entitlement talks to the APNs sandbox, so production pushes
// silently never arrive.
// ---------------------------------------------------------------------------
function checkTestFlightReadiness() {
  const problems = [];
  for (const app of APPS) {
    const infoPath = join(appDir(app), "ios/Runner/Info.plist");
    if (!existsSync(infoPath)) continue;
    const info = plist(infoPath);
    if (info && info.ITSAppUsesNonExemptEncryption === undefined) {
      problems.push(`${app}: Info.plist has no ITSAppUsesNonExemptEncryption — uploads park in "Missing Compliance"`);
    }

    const pbx = read(join(appDir(app), "ios/Runner.xcodeproj/project.pbxproj"));
    const releaseEnt = join(appDir(app), "ios/Runner/RunnerRelease.entitlements");
    if (existsSync(releaseEnt)) {
      const ent = plist(releaseEnt);
      if (ent && ent["aps-environment"] !== "production") {
        problems.push(`${app}: RunnerRelease.entitlements is not aps-environment=production`);
      }
      if (pbx && !pbx.includes("RunnerRelease.entitlements")) {
        problems.push(`${app}: RunnerRelease.entitlements exists but no build configuration points at it`);
      }
    }
  }
  problems.length
    ? fail("TestFlight readiness", problems.join(" | "), "See docs/RELEASE_AND_SYNC.md §4b.")
    : pass("TestFlight readiness", "export compliance declared and release push entitlements wired");
}

// ---------------------------------------------------------------------------
// 9. Deployed vs source (online).
// Catches the two failure modes the Mumbai migration produced: functions left
// behind in the old region (processScheduledCampaigns ran in BOTH, so every
// scheduled campaign was sent twice) and functions deployed from source that
// no longer exists.
// ---------------------------------------------------------------------------
function checkDeployedFunctions() {
  const out = sh("firebase", ["functions:list"], { stdio: ["ignore", "pipe", "ignore"] });
  if (!out.includes("│")) return warn("deployed functions", "could not read firebase functions:list (not logged in?)");

  const rows = out.split("\n").map((l) => l.split("│").map((c) => c.trim())).filter((c) => c.length > 4 && c[1] && c[1] !== "Function");
  const byName = new Map();
  for (const c of rows) {
    const [, name, , trigger, region, , runtime] = c;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ trigger, region, runtime });
  }

  const dupes = [...byName].filter(([, v]) => new Set(v.map((x) => x.region)).size > 1);
  const strays = [...byName].filter(([, v]) => v.every((x) => x.region && x.region !== FUNCTIONS_REGION));
  const oldRuntime = rows.filter((c) => /nodejs(1[0-9]|20)/.test(c[6] ?? "")).length;

  const msgs = [];
  // A duplicate only double-fires if the copy still has something firing it.
  // A v2 scheduled function is an HTTP function plus a Cloud Scheduler job, and
  // deleting the job leaves the function listed but unable to run — which this
  // check reported as an active double-send for weeks after the real problem
  // was fixed. A false FAIL here is costly: the doctor gates `firebase deploy`,
  // so it blocks releases. Name the duplicate either way, but only fail when a
  // trigger is actually attached in the other region.
  const scheduled = (v) => v.some((x) => /schedul/i.test(x.trigger ?? ""));
  const firing = dupes.filter(([, v]) => {
    const other = v.filter((x) => x.region !== FUNCTIONS_REGION);
    if (!other.length) return false;
    if (!scheduled(other)) return true; // a live trigger/HTTP copy in a dead region
    const jobs = sh("gcloud", [
      "scheduler", "jobs", "list",
      `--location=${other[0].region}`,
      "--format=value(name)",
    ]);
    return jobs.trim().length > 0;
  });
  const inert = dupes.filter((d) => !firing.includes(d));
  if (firing.length) msgs.push(`deployed in TWO regions and still firing in both: ${firing.map(([n]) => n).join(", ")}`);
  if (inert.length) {
    warn("deployed functions (stale copies)",
      `${inert.map(([n]) => n).join(", ")} still listed outside ${FUNCTIONS_REGION} but has no trigger there, so it cannot run`,
      "Tidy it up when convenient: gcloud functions delete <name> --region us-central1 --gen2");
  }
  if (strays.length) msgs.push(`still outside ${FUNCTIONS_REGION}: ${strays.map(([n]) => n).join(", ")}`);
  if (oldRuntime) msgs.push(`${oldRuntime} function(s) still on a Node runtime older than 22`);

  msgs.length
    ? fail("deployed functions", msgs.join(" | "),
        `firebase functions:delete <name> --region us-central1   (and redeploy to refresh runtimes)`)
    : pass("deployed functions", `${byName.size} functions, all in ${FUNCTIONS_REGION} on a supported runtime`);
}

// ---------------------------------------------------------------------------
// 10. Source committed.
// Twice now, code that was live in production existed only in one machine's
// working tree — once because a stash swallowed it, once after a migration.
// ---------------------------------------------------------------------------
function checkWorkingTreeCommitted() {
  const dirty = sh("git", ["status", "--porcelain"]).split("\n").filter(Boolean)
    .filter((l) => !/\.(orig|patch|rej)$/.test(l));
  const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  // A branch with no upstream makes `git rev-list origin/<branch>..HEAD` fail,
  // which previously came back empty and read as "nothing to push" — the exact
  // state this check exists to catch.
  const hasUpstream = sh("git", ["rev-parse", "--verify", `origin/${branch}`]).trim() !== "";
  const ahead = hasUpstream ? sh("git", ["rev-list", "--count", `origin/${branch}..HEAD`]).trim() : "";

  if (dirty.length > 20) {
    warn("source committed", `${dirty.length} uncommitted files — deployed code has twice lived only in a working tree`,
      "git add -A && git commit, then push. Check nothing is deployed from here that is not in git.");
  } else if (dirty.length) {
    warn("source committed", `${dirty.length} uncommitted file(s)`);
  } else if (!hasUpstream) {
    warn("source committed", `branch "${branch}" has no upstream — nothing here is on GitHub yet`,
      `git push -u origin ${branch}`);
  } else if (ahead && ahead !== "0") {
    warn("source committed", `${ahead} commit(s) not pushed to origin/${branch}`);
  } else {
    pass("source committed", "working tree clean and pushed");
  }
}

// ---------------------------------------------------------------------------
// 11. The admin console must not lie to the operator.
//
// Three defect classes the console shipped, all of which left the build green:
//   - a control whose handler only toasts/logs: "Campaign cancelled" while the
//     campaign still sent, "All categories mapped" without looking, a
//     "Contact Rider" button on two invented orders
//   - a live listener with no error callback, so a rules regression or a
//     missing index renders as an empty collection — indistinguishable from
//     "there is nothing here"
//   - module-level mock arrays rendered as fact (an invented ₹42.5L of GMV)
// ---------------------------------------------------------------------------

/** Split a call's argument list, respecting nesting, strings and comments. */
function splitCallArgs(s, open) {
  const args = [];
  let depth = 0, cur = "", i = open;
  for (; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (c === "/" && n === "/") { const e = s.indexOf("\n", i); i = e === -1 ? s.length : e; continue; }
    if (c === "/" && n === "*") { const e = s.indexOf("*/", i); i = e === -1 ? s.length : e + 1; continue; }
    if (c === "'" || c === '"' || c === "`") {
      const q = c; cur += c; i++;
      while (i < s.length && s[i] !== q) { if (s[i] === "\\") { cur += s[i]; i++; } cur += s[i]; i++; }
      cur += s[i]; continue;
    }
    if ("([{".includes(c)) { depth++; if (depth === 1 && c === "(") continue; }
    else if (")]}".includes(c)) { depth--; if (depth === 0) { args.push(cur); return args; } }
    if (depth === 1 && c === ",") { args.push(cur); cur = ""; continue; }
    cur += c;
  }
  return args;
}

function checkAdminHonesty() {
  const files = [
    ...walk(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p)),
  ];
  const deaf = [];
  const liars = [];
  const mocks = [];

  for (const f of files) {
    const src = read(f);
    const at = (idx) => `${f.replace(ROOT + "/", "")}:${src.slice(0, idx).split("\n").length}`;

    // A listener that cannot report failure.
    for (const m of src.matchAll(/\bonSnapshot\s*\(/g)) {
      const args = splitCallArgs(src, m.index + m[0].length - 1);
      if (args.length < 3) {
        deaf.push(`${at(m.index)} (${args.length} args, no error callback)`);
        continue;
      }
      const err = args[2].trim();
      // A handler that discards the error is as blind as having none.
      if (/^\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|undefined|null|setLoading\(false\))\s*$/.test(err)) {
        deaf.push(`${at(m.index)} (error handler discards it)`);
      }
    }

    // A control that only announces.
    for (const m of src.matchAll(
      /onClick=\{\s*\(\)\s*=>\s*(console\.(log|warn)|alert|toast\.(success|info|message))\(/g,
    )) {
      liars.push(at(m.index));
    }

    // Invented data at module scope.
    for (const m of src.matchAll(/^const\s+(\w*(?:MOCK|DUMMY|SAMPLE|FAKE|PLACEHOLDER)\w*|mock[A-Z]\w*)\s*(?::[^=]+)?=\s*[[{]/gm)) {
      mocks.push(`${at(m.index)} ${m[1]}`);
    }
  }

  const show = (list, n = 4) =>
    list.slice(0, n).join(", ") + (list.length > n ? ` (+${list.length - n} more)` : "");

  if (deaf.length) {
    fail("admin listeners report failure", `${deaf.length} onSnapshot call(s) cannot surface an error: ${show(deaf)}`,
      'Add an error callback: onSnapshot(q, next, (err) => console.error("[Page] source listener failed", err)).');
  } else {
    pass("admin listeners report failure", "every onSnapshot has a live error callback");
  }

  if (liars.length) {
    fail("admin controls do something", `${liars.length} control(s) only log or toast: ${show(liars)}`,
      "Wire the control to its backend, or remove it — a button that reports success it did not achieve is worse than no button.");
  } else {
    pass("admin controls do something", "no toast-only or log-only handlers");
  }

  if (mocks.length) {
    fail("admin shows real data", `${mocks.length} module-level mock constant(s) rendered as fact: ${show(mocks)}`,
      "Derive the figures from Firestore, or show an explicit empty/coming-soon state.");
  } else {
    pass("admin shows real data", "no module-level mock data");
  }
}
// ---------------------------------------------------------------------------
// 12. An admin action that fails must say so.
//
// The console was full of handlers shaped
//     onClick={async () => { await updateDoc(ref, {...}); toast.success("Done"); }}
// When the write is refused — a rules change, a stale doc, no network — the
// throw becomes an unhandled rejection: the success toast never fires, the
// button appears to do nothing, and the operator concludes they mis-clicked.
// Handlers that also set a busy flag left the control disabled for good.
// ---------------------------------------------------------------------------

/** Balanced-brace body of an inline handler starting at the first `{` after i. */
function handlerBody(s, i) {
  const open = s.indexOf("{", i);
  if (open === -1) return "";
  let d = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === "{") d++;
    else if (s[j] === "}") { d--; if (d === 0) return s.slice(open, j + 1); }
  }
  return "";
}

/** Helpers that report their own success AND failure, so awaiting them is safe. */
// confirmDialog / promptDialog are not writes: they only ever resolve (true /
// false, text / null), so awaiting one needs no error path of its own.
const SELF_REPORTING = /\b(runOp|adminActionToast|transitionOrder|runBulkTransition|applyBookingStatus|confirmDialog|promptDialog)\s*\(/;

function checkAdminFeedback() {
  const bad = [];
  for (const f of walk(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p))) {
    // opFeedback.ts documents the defect in a comment; don't flag the example.
    if (f.endsWith("opFeedback.ts")) continue;
    const src = read(f);
    for (const m of src.matchAll(
      /\b(onClick|onCheckedChange|onValueChange|onSubmit|onSelect|onConfirm)=\{\s*async\s*\(/g,
    )) {
      const b = handlerBody(src, m.index + m[0].length);
      const awaits = [...b.matchAll(/\bawait\s+([A-Za-z_$][\w$.]*)\s*\(/g)];
      if (!awaits.length) continue;
      if (/\btry\s*\{/.test(b)) continue;
      // Every await must be accounted for. A body that mixes a bare write with
      // a safe helper is still a silent failure for the bare write — an earlier
      // version of this check exempted the whole body if the helper appeared
      // anywhere in it, and so passed exactly the defect it was added to catch.
      const unguarded = awaits.filter((a) => {
        const call = `${a[1]}(`;
        if (SELF_REPORTING.test(`${a[1]}(`)) return false;
        const tail = b.slice(a.index, a.index + 400);
        return !/\.catch\(/.test(tail) && !call.startsWith("void ");
      });
      if (!unguarded.length) continue;
      bad.push(
        `${f.replace(ROOT + "/", "")}:${src.slice(0, m.index).split("\n").length} ${m[1]} (await ${unguarded[0][1]})`,
      );
    }
  }
  bad.length
    ? fail("admin actions report failure", `${bad.length} handler(s) await a write with no error path: ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? ` (+${bad.length - 4} more)` : ""}`,
        "Wrap it in runOp() from src/lib/opFeedback.ts, or add try/catch — a control that silently does nothing is read as a mis-click.")
    : pass("admin actions report failure", "every inline async handler can report a failed write");
}
// ---------------------------------------------------------------------------
// 13. The console's permission matrix must agree with the server's role table.
//
// Two independently written tables guard the same operations:
// src/lib/rbac.ts maps role → permissions and gates the buttons;
// functions/src/admin_platform.ts maps action → roles and actually enforces.
// They had drifted: the server let platform_admin run refundOrder and
// grantAdmin, while the UI matrix withheld "refund" and "manage_admins" from
// that role, so those buttons were never rendered for it. A hidden button is
// indistinguishable from a feature that doesn't exist, so nothing reported it.
// ---------------------------------------------------------------------------
function checkRbacAgreement() {
  const server = read(join(ROOT, "functions/src/admin_platform.ts"));
  const client = read(join(ROOT, "src/lib/rbac.ts"));

  const serverBlock = server.match(/const ACTION_ROLES: Record<Action, string\[\]> = \{([\s\S]*?)\n\};/);
  const permBlock = client.match(/export const ROLE_PERMISSIONS: Record<Role, Permission\[\]> = \{([\s\S]*?)\n\};/);
  const mapBlock = client.match(/export const ACTION_PERMISSION: Record<string, Permission> = \{([\s\S]*?)\n\};/);
  if (!serverBlock || !permBlock || !mapBlock) {
    return warn("rbac agreement", "could not parse ACTION_ROLES, ROLE_PERMISSIONS or ACTION_PERMISSION");
  }

  const strip = (t) => t.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const listOf = (block, key) => {
    const m = strip(block).match(new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/["'](\w+)["']/g)].map((x) => x[1]) : null;
  };

  const actionRoles = {};
  for (const m of strip(serverBlock[1]).matchAll(/^\s*(\w+)\s*:\s*\[([^\]]*)\]/gm)) {
    actionRoles[m[1]] = [...m[2].matchAll(/["'](\w+)["']/g)].map((x) => x[1]);
  }
  const actionPerm = {};
  for (const m of strip(mapBlock[1]).matchAll(/^\s*(\w+)\s*:\s*["'](\w+)["']/gm)) actionPerm[m[1]] = m[2];

  // ALL expands to every permission, so super_admin always agrees.
  const rolePerms = {};
  for (const m of strip(permBlock[1]).matchAll(/^\s*(\w+)\s*:\s*(ALL|\[([^\]]*)\])/gm)) {
    rolePerms[m[1]] = m[2] === "ALL" ? "*" : [...m[3].matchAll(/["'](\w+)["']/g)].map((x) => x[1]);
  }
  const roleHas = (role, perm) => {
    const p = rolePerms[role];
    return p === "*" ? true : (p ?? []).includes(perm);
  };

  const problems = [];
  const unmapped = [];
  for (const [action, roles] of Object.entries(actionRoles)) {
    const perm = actionPerm[action];
    if (!perm) { unmapped.push(action); continue; }
    for (const role of roles) {
      if (!(role in rolePerms)) { problems.push(`${action}: server allows unknown role "${role}"`); continue; }
      // The server permits it; the UI must not hide it.
      if (!roleHas(role, perm)) {
        problems.push(`${action}: server allows ${role} but the UI withholds "${perm}" from it`);
      }
    }
    // The reverse direction is NOT checked, and that is deliberate. The UI's
    // permissions are coarse — one "suspend" gates suspending a customer, a
    // vendor, a rider and a hotel — so a stay_manager holding "suspend" for
    // properties while the server refuses them setCustomerStatus is correct,
    // not drift. Requiring the two tables to be equal produced 91 "failures"
    // that were all this. The server refusing a click is a visible error with
    // its own message; a capability the server grants and the UI hides is the
    // one that fails silently, so that is what this gates.
  }

  if (unmapped.length) {
    warn("rbac coverage", `${unmapped.length} server action(s) not in ACTION_PERMISSION: ${unmapped.slice(0, 6).join(", ")}`,
      "Add each to ACTION_PERMISSION in src/lib/rbac.ts so its UI gate is checked against the server.");
  }
  problems.length
    ? fail("rbac agreement", `${problems.length} capabilit(ies) the server grants but the UI hides: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ""}`,
        "Make src/lib/rbac.ts match ACTION_ROLES in functions/src/admin_platform.ts — the server is the authority.")
    : pass("rbac agreement", `${Object.keys(actionPerm).length} actions: every role the server permits can reach the control`);
}
// ---------------------------------------------------------------------------
// 14. No dead screens, and no buttons without handlers.
//
// DeliveriesPage.tsx survived the admin restructure as 554 lines nothing
// imported: /admin/deliveries had been repointed at the orders workspace, but
// the file stayed, reading exactly like a live dispatch screen. It was
// convincing enough that an entire round of fixes went into it before anyone
// noticed the screen could not be opened. A page module nothing imports is not
// dead weight, it is a decoy.
//
// The second half catches the other shape the console shipped: a <Button> with
// no onClick, no href and no type=submit. It renders, it looks enabled, and
// clicking it does nothing at all — the "Unassign" control on the live dispatch
// board sat like that while reassignDelivery existed on the server untouched.
// ---------------------------------------------------------------------------
function checkNoDeadScreens() {
  const files = walk(join(ROOT, "src"), (p) => /\.(tsx|ts)$/.test(p));
  const sources = new Map(files.map((f) => [f, read(f)]));

  const orphans = [];
  for (const f of files) {
    if (!/\/pages\//.test(f) || /\/(main|App)\.tsx?$/.test(f)) continue;
    const stem = f.split("/").pop().replace(/\.(tsx|ts)$/, "");
    let referenced = false;
    for (const [g, src] of sources) {
      if (g === f) continue;
      if (new RegExp(`\\b${stem}\\b`).test(src)) { referenced = true; break; }
    }
    if (!referenced) orphans.push(`${f.replace(ROOT + "/", "")} (${sources.get(f).split("\n").length} lines)`);
  }

  // <Button ...> with no handler, href, asChild or submit behaviour.
  //
  // The tag has to be scanned with brace awareness, not a regex. An earlier
  // version used /<Button(\s[^>]*?)?>/ and reported ItemisedRefundDialog's
  // refund button as handler-less: its attributes contain
  // `disabled={busy || !plan || plan.problems.length > 0}`, and that `>` ended
  // the match before onClick was ever seen. A check that cries wolf gets
  // ignored, and this one gates deploys.
  const buttonAttrs = (src, from) => {
    let depth = 0;
    for (let i = from; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === "/" && src[i + 1] === "/") {
        // Skip line comments. A handler commented with an apostrophe —
        // "the segment's filter rules" — otherwise opened a string that ran on
        // and swallowed the closing `>`, so CRMPage's wired button looked bare.
        const e = src.indexOf("\n", i);
        i = e === -1 ? src.length : e;
      } else if (c === "/" && src[i + 1] === "*") {
        const e = src.indexOf("*/", i);
        i = e === -1 ? src.length : e + 1;
      } else if (c === '"' || c === "'" || c === "`") {
        const q = c; i++;
        while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      } else if (c === ">" && depth === 0) return src.slice(from, i);
    }
    return "";
  };

  // A Button handed to a wrapper that owns the click: asChild, a <Link>/<a>, or
  // this repo's ConfirmationDialog `trigger={<Button .../>}` prop.
  const WRAPPED = /(asChild|<Link\b|<a\b)[^>]*>\s*$|trigger=\{\s*$/;

  // The marketing site draws pictures of the product — a phone showing "PAY
  // WITH UPI", a KDS ticket with "BUMP TICKET". Those are illustrations of a
  // control, not controls, so a handler would be wrong. Real CTAs on these
  // pages are <Link>s and are checked like any other.
  const MOCKUP = /\/pages\/(marketing|mobile)\//;

  const inert = [];
  for (const [f, src] of sources) {
    if (MOCKUP.test(f)) continue;
    for (const m of src.matchAll(/<Button(?=[\s>])/g)) {
      const attrs = buttonAttrs(src, m.index + "<Button".length);
      if (/\bonClick|\bhref|\basChild|type=["']submit["']|\bonSelect|\{\.\.\./.test(attrs)) continue;
      // A permanently disabled button is honest: it is showing an unavailable
      // state, not pretending to act (KitchenPage's "Awaiting Selection").
      if (/(^|\s)disabled(\s|=|$)/.test(attrs)) continue;
      const before = src.slice(0, m.index).replace(/\s+$/, "");
      if (WRAPPED.test(before)) continue;
      inert.push(`${f.replace(ROOT + "/", "")}:${src.slice(0, m.index).split("\n").length}`);
    }
  }

  const msgs = [];
  if (orphans.length) msgs.push(`page module(s) nothing imports: ${orphans.join(", ")}`);
  if (inert.length) msgs.push(`${inert.length} <Button> with no handler: ${inert.slice(0, 4).join(", ")}${inert.length > 4 ? ` (+${inert.length - 4} more)` : ""}`);

  msgs.length
    ? fail("no dead screens", msgs.join(" | "),
        "Delete the unreachable page (git keeps it), or route it. Give the button a handler or remove it.")
    : pass("no dead screens", "every page module is reachable and every button has a handler");
}
// ---------------------------------------------------------------------------
// 15. A deployed function is not a working function. (--online)
//
// `firebase functions:list` showed 212 healthy-looking functions on 2026-10-05
// while 40% of the platform was down. Two faults the list cannot see:
//   - 81 services had NO serving revision ("Quota exceeded for total allowable
//     CPU per project per region"): the new revision failed its health check
//     and the previous one had already retired
//   - 104 callables had an EMPTY Cloud Run IAM policy, so Google's front end
//     answered 403 before the container — the function's own auth never ran
//     and nothing reached its logs
// The second is the nastier one: `firebase deploy` sets the allUsers invoker
// when it CREATES a function, but not when it UPDATES one, so redeploying a
// broken callable leaves it broken. See docs/OUTAGE-2026-10-03.md.
// ---------------------------------------------------------------------------
function checkServingRevisions() {
  const svc = sh("gcloud", [
    "run", "services", "list", `--region=${FUNCTIONS_REGION}`,
    "--format=csv[no-heading](metadata.name,status.conditions[0].status," +
      "spec.template.spec.containers[0].resources.limits.cpu," +
      "spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'])",
  ]);
  if (!svc.trim()) {
    return warn("serving revisions", "could not read gcloud run services (not signed in?)",
      "gcloud auth login && gcloud config set project kada-restaurant-os-v1");
  }

  const rows = svc.trim().split("\n").map((l) => l.split(","));
  const cpu = (v) => {
    const t = (v ?? "").trim();
    if (t.endsWith("m")) return Number(t.slice(0, -1)) / 1000;
    return Number(t) || 0;
  };
  const down = rows.filter((r) => r[1] !== "True").map((r) => r[0]);
  const reserved = rows.reduce((n, r) => n + cpu(r[2]) * (Number(r[3]) || 1), 0);
  const serving = rows
    .filter((r) => r[1] === "True")
    .reduce((n, r) => n + cpu(r[2]) * (Number(r[3]) || 1), 0);

  if (down.length) {
    fail("serving revisions", `${down.length}/${rows.length} service(s) have NO serving revision: ${down.slice(0, 5).join(", ")}${down.length > 5 ? ` (+${down.length - 5} more)` : ""}. Reserved ${reserved.toFixed(1)} vCPU, of which ${serving.toFixed(1)} is actually serving`,
      "See docs/OUTAGE-2026-10-03.md — raise the asia-south1 Cloud Run CPU quota, or cut cpu/maxInstances to fit, then redeploy in small batches.");
  } else {
    pass("serving revisions", `${rows.length} services all serving (${reserved.toFixed(1)} vCPU reserved)`);
  }
}

function checkCallableInvokers() {
  const out = sh("firebase", ["functions:list"], { stdio: ["ignore", "pipe", "ignore"] });
  if (!out.includes("│")) return warn("callable invokers", "could not read firebase functions:list");
  const callables = out.split("\n")
    .map((l) => l.split("│").map((c) => c.trim()))
    .filter((c) => c.length > 4 && c[1] && c[1] !== "Function" && (c[3] === "callable" || c[3] === "https"))
    .map((c) => c[1]);
  if (!callables.length) return warn("callable invokers", "no callables parsed from functions:list");

  // One policy read per service is slow, so sample unless asked for all.
  const ALL = process.argv.includes("--all-invokers");
  const sample = ALL ? callables : callables.slice(0, 12);
  const missing = sample.filter((fn) => {
    const pol = sh("gcloud", [
      "run", "services", "get-iam-policy", fn.toLowerCase(),
      `--region=${FUNCTIONS_REGION}`, "--format=value(bindings)",
    ]);
    return !pol.includes("allUsers");
  });

  missing.length
    ? fail("callable invokers", `${missing.length} of ${sample.length} callable(s) checked have no allUsers run.invoker, so every client call gets 403 before the function runs: ${missing.slice(0, 5).join(", ")}`,
        "bash scripts/restore_callable_invokers.sh   (firebase deploy only sets this on CREATE, never on update)")
    : pass("callable invokers", `${sample.length}${ALL ? "" : " sampled"} of ${callables.length} callables can be invoked`);
}
// ---------------------------------------------------------------------------

/**
 * Admin console usability (2026-10-13 audit). Each of these shipped and was
 * fixed in bulk; the checks keep them from creeping back one PR at a time.
 *
 *  - Browser dialogs. window.confirm/prompt block the tab, ignore the theme,
 *    and once let three Customer 360 buttons ask for input and then toast
 *    "Wallet adjusted" without doing anything. Use confirmDialog/promptDialog
 *    from src/components/admin/core/asyncDialogs.tsx.
 *  - Unlabelled icon buttons: a screen reader announces only "button".
 *  - Light-only colours: bg-amber-50 & co. render as glaring patches in dark
 *    mode. Use theme tokens (bg-muted, text-foreground) or add a dark: variant.
 */
function checkAdminUsability() {
  const files = [
    ...walk(join(ROOT, "src", "pages", "admin"), (p) => p.endsWith(".tsx")),
    ...walk(join(ROOT, "src", "components", "admin"), (p) => p.endsWith(".tsx")),
    join(ROOT, "src", "components", "AdminLayout.tsx"),
  ].filter((f) => existsSync(f));
  const rel = (f) => f.replace(ROOT + "/", "");
  const show = (list, n = 4) => list.slice(0, n).join(", ") + (list.length > n ? ` (+${list.length - n} more)` : "");

  const dialogs = [];
  const unlabelled = [];
  const lightOnly = [];
  // Deliberately light surfaces: logo artwork needs a white backing, and the
  // email preview must look like the email a customer receives.
  const LIGHT_OK = [["CustomerBrandLockup.tsx", "bg-white"], ["EmailTemplatesPage.tsx", "bg-white text-black"]];
  const LIGHT = /(?<![\w:/-])(bg-white(?!\/)|bg-(?:red|rose|amber|emerald|green|blue|sky|slate|gray|zinc|orange|violet|purple|yellow|indigo|pink|teal)-(?:50|100)|text-(?:slate|gray|zinc|neutral)-(?:700|800|900))\b/;

  for (const f of files) {
    const src = read(f);
    const code = src.split("\n").map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l)).join("\n");
    const at = (idx) => `${rel(f)}:${src.slice(0, idx).split("\n").length}`;

    if (!f.endsWith("asyncDialogs.tsx")) {
      for (const m of code.matchAll(/(?<![\w.])(?:window\.)?(confirm|alert|prompt)\(/g)) dialogs.push(at(m.index));
    }

    // Opening <Button ...> tags, scanned with brace depth so arrow functions
    // inside props don't end the tag early.
    for (const m of code.matchAll(/<Button\b/g)) {
      let i = m.index + 7, depth = 0, quote = null;
      for (; i < code.length; i++) {
        const c = code[i];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      const tag = code.slice(m.index, i + 1);
      if (!/size=["']icon["']/.test(tag) || /aria-label|title=/.test(tag)) continue;
      const close = code.indexOf("</Button>", i);
      const inner = close > 0 ? code.slice(i, close) : "";
      if (/sr-only|aria-label|title=/.test(inner)) continue;
      unlabelled.push(at(m.index));
    }

    for (const m of code.matchAll(/"[^"\n]*"|`[^`]*`/g)) {
      const lit = m[0];
      if (!LIGHT.test(lit) || lit.includes("dark:")) continue;
      if (LIGHT_OK.some(([file, cls]) => f.endsWith(file) && lit.includes(cls))) continue;
      lightOnly.push(at(m.index));
    }
  }

  dialogs.length
    ? fail("admin uses in-app dialogs", `${dialogs.length} browser confirm/alert/prompt call(s): ${show(dialogs)}`,
        "await confirmDialog({...}) / promptDialog({...}) from src/components/admin/core/asyncDialogs.tsx; toast for alerts.")
    : pass("admin uses in-app dialogs", "no window.confirm / alert / prompt");
  unlabelled.length
    ? fail("admin icon buttons are labelled", `${unlabelled.length} icon-only button(s) a screen reader announces as just "button": ${show(unlabelled)}`,
        'Add aria-label="Delete" (what the button does) to the <Button size="icon">.')
    : pass("admin icon buttons are labelled", "every icon-only button has an accessible name");
  lightOnly.length
    ? fail("admin colours survive dark mode", `${lightOnly.length} light-only colour class string(s): ${show(lightOnly)}`,
        "Use theme tokens (bg-muted, bg-card, text-foreground) or add a dark: variant, e.g. bg-amber-50 dark:bg-amber-500/10.")
    : pass("admin colours survive dark mode", "every light tint has a dark variant or uses a theme token");
}

const CHECKS = [
  ["region drift", checkRegionDrift],
  ["ci_post_clone mode", checkCiScriptMode],
  ["UIScene lifecycle", checkSceneLifecycle],
  ["secrets", checkSecrets],
  ["dead config flags", checkDeadFlags],
  ["functions runtime", checkNodeRuntime],
  ["iOS deployment target", checkDeploymentTarget],
  ["maps key wiring", checkMapsKeyWiring],
  ["TestFlight readiness", checkTestFlightReadiness],
  ["admin console honesty", checkAdminHonesty],
  ["admin actions report failure", checkAdminFeedback],
  ["rbac agreement", checkRbacAgreement],
  ["no dead screens", checkNoDeadScreens],
  ["admin usability", checkAdminUsability],
  ["source committed", checkWorkingTreeCommitted],
];

for (const [name, fn] of CHECKS) {
  try { fn(); } catch (e) { warn(name, `check crashed: ${e.message}`); }
}
if (ONLINE) {
  for (const [name, fn] of [
    ["deployed functions", checkDeployedFunctions],
    ["serving revisions", checkServingRevisions],
    ["callable invokers", checkCallableInvokers],
  ]) {
    try { fn(); } catch (e) { warn(name, `check crashed: ${e.message}`); }
  }
} else {
  record("skip", "deployed functions", "offline run — pass --online to compare deployed functions with source, check serving revisions and invoker bindings");
}

const failed = results.filter((r) => r.status === "fail");
const warned = results.filter((r) => r.status === "warn");

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  const icon = { pass: "PASS", fail: "FAIL", warn: "WARN", skip: "SKIP" };
  console.log("\nKada doctor\n");
  for (const r of results) {
    console.log(`  [${icon[r.status]}] ${r.name}`);
    console.log(`         ${r.detail}`);
    if (r.fix && r.status !== "pass") console.log(`         fix: ${r.fix}`);
  }
  console.log(
    `\n${results.filter((r) => r.status === "pass").length} passed, ${warned.length} warning(s), ${failed.length} failure(s)\n`,
  );
}

process.exit(failed.length ? 1 : 0);
