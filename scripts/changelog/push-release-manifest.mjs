#!/usr/bin/env node
// Runs after every successful `firebase deploy` of functions or hosting (see
// the postdeploy hooks in firebase.json). Sends the recent commits of the tree
// that was just deployed to Firestore; the changelog scheduler turns the ones
// it hasn't announced yet into release notes (functions/src/changelog/autoRun.ts).
//
// It must never break a deploy. Every failure prints one line and exits 0.
//
//   node scripts/changelog/push-release-manifest.mjs <target>
//   node scripts/changelog/push-release-manifest.mjs --dry-run   # show what would be sent
//   KADA_CHANGELOG_SKIP=1 firebase deploy …     # opt out for one deploy

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FIELD, RECORD, parseGitLog } from "./manifest-lib.mjs";

const PROJECT = "kada-restaurant-os-v1";
const LOOKBACK_DAYS = 21;
const MAX_COMMITS = 150;
const TIMEOUT_MS = 20_000;

const say = (msg) => console.log(`[changelog] ${msg}`);

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const target = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "deploy";
  if (process.env.KADA_CHANGELOG_SKIP === "1") return say("skipped (KADA_CHANGELOG_SKIP=1)");

  const project = process.env.GCLOUD_PROJECT ?? PROJECT;
  if (project !== PROJECT) return say(`skipped — ${project} is not the production project`);

  const projectDir = process.env.PROJECT_DIR ?? process.cwd();
  const git = (...args) => execFileSync("git", args, { cwd: projectDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

  let head, branch, log;
  try {
    head = git("rev-parse", "HEAD").trim();
    branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
    log = git(
      "log",
      `--since=${LOOKBACK_DAYS}.days`,
      "--no-merges",
      `-n`,
      String(MAX_COMMITS),
      `--format=${RECORD}%H${FIELD}%s${FIELD}%b${FIELD}%aI`,
      "--name-only",
    );
  } catch {
    return say("skipped — not a git checkout");
  }

  const commits = parseGitLog(log);
  if (!commits.length) return say("no recent commits to report");

  const token = await accessToken(projectDir);
  if (!token) return say("skipped — couldn't reuse the Firebase CLI login");

  if (dryRun) {
    for (const c of commits.slice(0, 15)) say(`  ${c.date.slice(0, 10)} [${c.areas.join(",") || "-"}] ${c.subject}`);
    return say(`dry run: would queue ${commits.length} commits from ${branch}@${head.slice(0, 7)} (CLI login OK)`);
  }

  const body = {
    fields: {
      headSha: { stringValue: head },
      branch: { stringValue: branch },
      target: { stringValue: target },
      status: { stringValue: "pending" },
      attempts: { integerValue: "0" },
      commitCount: { integerValue: String(commits.length) },
      commitsJson: { stringValue: JSON.stringify(commits) },
      createdAt: { timestampValue: new Date().toISOString() },
    },
  };

  // Keyed by commit + target: redeploying the same commit records nothing new,
  // while a functions deploy and a hosting deploy each announce what they shipped.
  const releaseId = `${head.slice(0, 12)}-${target.replace(/[^a-z]/g, "")}`;
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/changelog_releases` +
    `?documentId=${releaseId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 409) return say(`${releaseId} already queued`);
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
    return say(`couldn't queue release notes (HTTP ${res.status}) ${text}`);
  }
  say(`queued ${commits.length} commits from ${branch}@${head.slice(0, 7)} — notes appear in Admin › Growth › Changelog within ~5 minutes`);
}

/**
 * Borrow the access token of whoever is logged in to the Firebase CLI —
 * the same identity that just deployed. No key file, nothing to configure.
 */
async function accessToken(projectDir) {
  const root = firebaseToolsRoot();
  if (!root) return null;
  const require = createRequire(join(root, "package.json"));
  const { getProjectDefaultAccount } = require("./lib/auth.js");
  const { requireAuth } = require("./lib/requireAuth.js");
  const apiv2 = require("./lib/apiv2.js");

  const account = getProjectDefaultAccount(projectDir);
  const options = { projectRoot: projectDir, user: account?.user, tokens: account?.tokens };
  await requireAuth(options);
  return await apiv2.getAccessToken();
}

function firebaseToolsRoot() {
  const candidates = [];
  if (process.env.FIREBASE_TOOLS_DIR) candidates.push(process.env.FIREBASE_TOOLS_DIR);
  try {
    const bin = execFileSync("sh", ["-c", "command -v firebase"], { encoding: "utf8" }).trim();
    // …/firebase-tools/lib/bin/firebase.js
    if (bin) candidates.push(resolve(dirname(realpathSync(bin)), "..", ".."));
  } catch {
    /* not on PATH */
  }
  return candidates.find((dir) => existsSync(join(dir, "lib", "requireAuth.js"))) ?? null;
}

main().catch((e) => say(`couldn't queue release notes: ${String(e?.message ?? e).slice(0, 200)}`));
