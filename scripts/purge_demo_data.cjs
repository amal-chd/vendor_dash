#!/usr/bin/env node
/**
 * Purge the leftover demo dataset from Firestore.
 *
 * Demo mode was removed from the product, but the documents seeded by the old
 * `seedDemoData` callable (everything flagged `isDemo: true`) can still be in
 * the database. Until they are gone they are ordinary restaurant/menu/promo
 * documents, so anything that queries those collections can surface them.
 *
 * Mirrors what the removed `clearDemoData` callable used to do: the same four
 * collections, plus it clears the orphaned `config/platform.demoMode` flag.
 *
 * DRY RUN BY DEFAULT — it only prints what it would delete.
 *   node scripts/purge_demo_data.cjs            # report only, deletes nothing
 *   node scripts/purge_demo_data.cjs --apply    # actually delete
 *
 * Credentials: uses GOOGLE_APPLICATION_CREDENTIALS, or the gcloud/firebase
 * application-default login already on the machine.
 */

const path = require("path");
const { execFileSync } = require("child_process");

// firebase-admin lives in functions/node_modules (same convention as
// scripts/seed_food_studio.cjs). A git worktree has the source but no
// node_modules of its own, so fall back to the main checkout, which is the
// parent of the shared git common dir.
function loadAdmin() {
  const candidates = [
    path.join(__dirname, "../functions/node_modules/firebase-admin"),
    path.join(__dirname, "../node_modules/firebase-admin"),
  ];
  try {
    const commonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();
    const mainRoot = path.dirname(commonDir);
    candidates.push(path.join(mainRoot, "functions/node_modules/firebase-admin"));
    candidates.push(path.join(mainRoot, "node_modules/firebase-admin"));
  } catch {
    // Not a git checkout — the paths above are all we have.
  }
  candidates.push("firebase-admin");

  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* try the next one */
    }
  }
  console.error("firebase-admin not found. Tried:");
  candidates.forEach((c) => console.error(`  ${c}`));
  console.error("\nRun `npm install` inside functions/ and try again.");
  process.exit(1);
}

const admin = loadAdmin();

const COLLECTIONS = ["restaurants", "menu", "promos", "platform_ads"];
const APPLY = process.argv.includes("--apply");
// Orders are NOT flagged isDemo — they are real order documents that happen to
// point at a demo restaurant. Deleting them destroys order history (including
// any paid order), so it is opt-in.
const INCLUDE_ORDERS = process.argv.includes("--include-orders");
const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "kada-restaurant-os-v1";

async function main() {
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  console.log(`project : ${PROJECT_ID}`);
  console.log(`mode    : ${APPLY ? "APPLY (documents will be deleted)" : "DRY RUN (nothing is written)"}`);
  console.log("");

  let grandTotal = 0;
  let demoRestaurantIds = [];
  // Everything about to be deleted is written here first, so a wrong call is
  // recoverable. Kept outside the repo: it contains customer data.
  const backup = { project: PROJECT_ID, takenAt: new Date().toISOString(), docs: {} };
  const record = (col, snap) => {
    backup.docs[col] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  };

  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).where("isDemo", "==", true).get();
    grandTotal += snap.size;
    record(col, snap);
    console.log(`${col}: ${snap.size} demo document(s)`);
    if (col === "restaurants") demoRestaurantIds = snap.docs.map((d) => d.id);

    // Name a few so the operator can sanity-check before applying.
    snap.docs.slice(0, 5).forEach((d) => {
      const name = d.get("name") || d.get("title") || "";
      console.log(`    - ${d.id}${name ? ` (${name})` : ""}`);
    });
    if (snap.size > 5) console.log(`    ... and ${snap.size - 5} more`);

    if (!APPLY || snap.empty) continue;

    // Delete in chunks of 400 to stay under the 500-write batch limit.
    let batch = db.batch();
    let n = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      if (++n % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (n % 400 !== 0) await batch.commit();
    console.log(`    deleted ${snap.size}`);
  }

  // Orders that point at a demo restaurant.
  if (demoRestaurantIds.length) {
    const chunks = [];
    for (let i = 0; i < demoRestaurantIds.length; i += 10) {
      chunks.push(demoRestaurantIds.slice(i, i + 10));
    }
    const orderDocs = [];
    for (const chunk of chunks) {
      const snap = await db.collection("orders").where("restaurantId", "in", chunk).get();
      orderDocs.push(...snap.docs);
    }
    backup.docs.orders = orderDocs.map((d) => ({ id: d.id, data: d.data() }));

    const paid = orderDocs.filter((d) => {
      const o = d.data();
      return String(o.paymentStatus || (o.payment && o.payment.status) || "").toLowerCase() === "paid";
    });
    console.log("");
    console.log(
      `orders referencing demo restaurants: ${orderDocs.length}` +
        (INCLUDE_ORDERS ? "" : "  (kept — pass --include-orders to delete)")
    );
    if (paid.length) {
      console.log(`    ${paid.length} of them are PAID — deleting removes a financial record`);
    }

    if (APPLY && INCLUDE_ORDERS && orderDocs.length) {
      grandTotal += orderDocs.length;
      let batch = db.batch();
      let n = 0;
      for (const d of orderDocs) {
        batch.delete(d.ref);
        if (++n % 400 === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }
      if (n % 400 !== 0) await batch.commit();
      console.log(`    deleted ${orderDocs.length}`);
    } else if (INCLUDE_ORDERS) {
      grandTotal += orderDocs.length;
    }
  }

  const cfgRef = db.collection("config").doc("platform");
  const cfg = await cfgRef.get();
  const hasFlag = cfg.exists && cfg.get("demoMode") !== undefined;
  console.log("");
  console.log(`config/platform.demoMode present: ${hasFlag ? cfg.get("demoMode") : "no"}`);

  if (APPLY && hasFlag) {
    // The flag no longer drives anything; remove it rather than leaving a
    // setting that looks meaningful.
    await cfgRef.update({ demoMode: admin.firestore.FieldValue.delete() });
    console.log("    removed demoMode field");
  }

  const fs = require("fs");
  const os = require("os");
  const backupPath = path.join(
    os.homedir(),
    `kada-demo-purge-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  const backupCount = Object.values(backup.docs).reduce((n, a) => n + a.length, 0);
  if (backupCount > 0) {
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log("");
    console.log(`backup written: ${backupPath} (${backupCount} document(s))`);
    console.log("  (contains customer data — keep it out of the repo)");
  }

  console.log("");
  if (!APPLY) {
    console.log(`DRY RUN complete — ${grandTotal} document(s) would be deleted.`);
    console.log("Re-run with --apply to delete them.");
  } else {
    console.log(`Done — ${grandTotal} document(s) deleted.`);
  }
}

main().catch((e) => {
  const msg = String(e && e.message ? e.message : e);
  if (/credential|authenticat|permission|UNAUTHENTICATED|PERMISSION_DENIED/i.test(msg)) {
    console.error(`\nFirestore refused the request: ${msg}\n`);
    console.error("This script needs admin credentials. Either:");
    console.error("  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json");
    console.error("  (or) gcloud auth application-default login");
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});
