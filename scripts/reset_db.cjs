#!/usr/bin/env node
/**
 * Production database reset for kada-restaurant-os-v1.
 *
 * Rebuild of the plan drawn up on 2026-09-16: keep penguin, its Top Bakes
 * outlets and Amal Fried Chicken; remove every other restaurant and the
 * transactional data around them.
 *
 * THIS PROJECT HAS NO BACKUPS AND PITR IS DISABLED — deletes cannot be undone.
 * The script therefore writes a full JSON backup of everything it is about to
 * remove before removing anything.
 *
 *   node scripts/reset_db.cjs                 # dry run, deletes nothing
 *   CONFIRM=kada-restaurant-os-v1 node scripts/reset_db.cjs --apply
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS, or gcloud application-default.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

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
    /* not a git checkout */
  }
  candidates.push("firebase-admin");
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* next */
    }
  }
  console.error("firebase-admin not found. Run `npm install` inside functions/.");
  process.exit(1);
}

const admin = loadAdmin();
const PROJECT_ID = "kada-restaurant-os-v1";
const APPLY = process.argv.includes("--apply");

// Restaurants that survive the reset.
const KEEP = new Set([
  "yXURWJA1hFTehvmVTvshdz9bEkA2", // penguin
  "8n16NfeV4pSDdcynh31LK8vT7ri2", // Top Bakes outlet
  "DBV6eTNc0jH7dKmmlNQm", // Top Bakes outlet
  "ydVu5c1MrkQEHeTr36h3VjoKQ8g2", // Top Bakes outlet
  "fjB3ClSALZaZbyJHiKFINh758R42", // Amal Fried Chicken
  "4hWf1s7M6vRhmpB0zbMQ0EvwVkn1", // Ibnu Cafe — active test vendor account
]);

// Orders are wiped except for these restaurants, so the live test account
// keeps a working history.
const KEEP_ORDERS_FOR = new Set(["4hWf1s7M6vRhmpB0zbMQ0EvwVkn1"]);

// Collections keyed by a restaurant: rows for non-kept restaurants go, and so
// do orphans whose restaurant no longer exists.
const RESTAURANT_SCOPED = [
  "menu",
  "inventory",
  "inventory_logs",
  "staff",
  "tables",
  "menu_ads",
  "platform_ads",
  "campaigns",
  "user_sessions",
  "expenses",
];

// Collections whose DOCUMENT ID identifies the restaurant rather than a field.
// Missing these leaves orphans behind: vendor_health is keyed by the restaurant
// id itself, partner_contact/partner_private by `vendor_<restaurantId>` (their
// `rider_*` rows belong to riders, which are kept).
const DOC_ID_KEYED = [
  { col: "vendor_health", idOf: (rid) => rid },
  { col: "partner_contact", idOf: (rid) => `vendor_${rid}` },
  { col: "partner_private", idOf: (rid) => `vendor_${rid}` },
];

// Emptied completely — transactional history.
const WIPE_WHOLE = [
  "orders",
  "order_secrets",
  "group_orders",
  "reservations",
  "stay_bookings",
  "platform_refunds",
  "gateway_settlements",
  "wallet_topups",
  "gift_cards",
  "donations",
  "referral_events",
  "referrals",
  "admin_notifications",
  "pricing_recon_runs",
  "pricing_quotes",
  "order_placements",
];

const backup = { project: PROJECT_ID, takenAt: new Date().toISOString(), docs: {} };
let total = 0;

function stash(key, docs) {
  if (!docs.length) return;
  backup.docs[key] = (backup.docs[key] || []).concat(
    docs.map((d) => ({ path: d.ref.path, data: d.data() }))
  );
}

async function deleteDocs(db, docs) {
  let batch = db.batch();
  let n = 0;
  for (const d of docs) {
    batch.delete(d.ref);
    if (++n % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (n % 400 !== 0) await batch.commit();
}

async function main() {
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  console.log(`project : ${PROJECT_ID}`);
  console.log(`mode    : ${APPLY ? "APPLY — deletions are permanent" : "DRY RUN — nothing is written"}`);
  if (APPLY && process.env.CONFIRM !== PROJECT_ID) {
    console.error(`\nRefusing to apply without CONFIRM=${PROJECT_ID} in the environment.`);
    process.exit(1);
  }
  console.log("");

  // 1. Restaurants
  const restSnap = await db.collection("restaurants").get();
  const doomed = restSnap.docs.filter((d) => !KEEP.has(d.id));
  const kept = restSnap.docs.filter((d) => KEEP.has(d.id));
  stash("restaurants", doomed);
  total += doomed.length;
  console.log(`restaurants: ${restSnap.size} total — deleting ${doomed.length}, keeping ${kept.length}`);
  kept.forEach((d) => console.log(`    KEEP  ${d.get("name") || "?"}  (${d.id})`));
  const keptIds = new Set(kept.map((d) => d.id));

  // 2. Restaurant-scoped collections (non-kept + orphans)
  console.log("");
  for (const col of RESTAURANT_SCOPED) {
    const snap = await db.collection(col).get();
    if (snap.empty) continue;
    const gone = snap.docs.filter((d) => {
      const rid = d.get("restaurantId") || d.get("restId") || d.get("vendorId");
      return rid ? !keptIds.has(rid) : false;
    });
    if (!gone.length) {
      console.log(`${col}: ${snap.size} rows, none belong to removed restaurants`);
      continue;
    }
    stash(col, gone);
    total += gone.length;
    console.log(`${col}: deleting ${gone.length} of ${snap.size}`);
    if (APPLY) await deleteDocs(db, gone);
  }

  // 2b. Collections keyed by document id
  console.log("");
  const doomedIds = doomed.map((d) => d.id);
  for (const { col, idOf } of DOC_ID_KEYED) {
    const snap = await db.collection(col).get();
    if (snap.empty) continue;
    const wanted = new Set(doomedIds.map(idOf));
    const gone = snap.docs.filter((d) => wanted.has(d.id));
    if (!gone.length) {
      console.log(`${col}: ${snap.size} rows, none belong to removed restaurants`);
      continue;
    }
    stash(col, gone);
    total += gone.length;
    console.log(`${col}: deleting ${gone.length} of ${snap.size} (keyed by doc id)`);
    if (APPLY) await deleteDocs(db, gone);
  }

  // Deleting order_secrets while a delivery is in flight silently disables the
  // handoff OTP for it: the order still says otpRequired, but the secret the
  // rider's code is checked against is gone. Refuse rather than quietly weaken
  // anti-fraud on a live delivery.
  const inFlight = await db
    .collection("orders")
    .where("deliveryStatus", "in", ["assigned", "at_restaurant", "picked_up", "on_the_way", "arrived"])
    .limit(50)
    .get()
    .catch(() => null);
  if (inFlight && !inFlight.empty) {
    console.log("");
    console.log(`WARNING: ${inFlight.size} delivery/deliveries are in flight.`);
    console.log("  Wiping order_secrets would disable their handoff OTP verification.");
    if (APPLY) {
      console.error("  Refusing to apply. Wait for them to finish, or re-run when the fleet is idle.");
      process.exit(1);
    }
  }

  // 3. Whole-collection wipes
  console.log("");
  for (const col of WIPE_WHOLE) {
    const snap = await db.collection(col).get();
    if (snap.empty) continue;
    let docs = snap.docs;
    if (col === "orders") {
      docs = docs.filter((d) => !KEEP_ORDERS_FOR.has(d.get("restaurantId")));
    } else if (col === "order_placements") {
      docs = docs.filter((d) => ![...KEEP_ORDERS_FOR].some((r) => d.id.startsWith(`${r}_`)));
    }
    if (!docs.length) {
      console.log(`${col}: ${snap.size} rows, all retained`);
      continue;
    }
    stash(col, docs);
    total += docs.length;
    console.log(
      docs.length === snap.size
        ? `${col}: deleting all ${snap.size}`
        : `${col}: deleting ${docs.length} of ${snap.size} (retaining kept-restaurant rows)`
    );
    if (APPLY) await deleteDocs(db, docs);
  }

  // 4. hotels/*/bookings
  const hotels = await db.collection("hotels").get();
  for (const h of hotels.docs) {
    const b = await h.ref.collection("bookings").get();
    if (b.empty) continue;
    stash(`hotels/${h.id}/bookings`, b.docs);
    total += b.size;
    console.log(`hotels/${h.id}/bookings: deleting ${b.size}`);
    if (APPLY) await deleteDocs(db, b.docs);
  }

  // Backup before the restaurants themselves go (they are deleted last, so a
  // failure part-way still leaves the restaurant docs in place).
  const backupPath = path.join(
    os.homedir(),
    `kada-db-reset-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  const count = Object.values(backup.docs).reduce((n, a) => n + a.length, 0);
  if (count > 0) {
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log("");
    console.log(`backup written: ${backupPath} (${count} document(s))`);
    console.log("  (contains customer data — keep it out of the repo)");
  }

  // 5. Restaurants last, recursively (subcollections: reviews, menu, etc.)
  if (APPLY && doomed.length) {
    console.log("");
    console.log(`deleting ${doomed.length} restaurants recursively...`);
    for (const d of doomed) await db.recursiveDelete(d.ref);

    // onReviewWritten does set({merge:true}) on the restaurant, so deleting a
    // restaurant's reviews can resurrect it as a ghost document. Sweep again.
    console.log("waiting 120s for review triggers to settle, then re-sweeping ghosts...");
    await new Promise((r) => setTimeout(r, 120000));
    const after = await db.collection("restaurants").get();
    const ghosts = after.docs.filter((d) => !KEEP.has(d.id));
    if (ghosts.length) {
      console.log(`  ${ghosts.length} ghost restaurant(s) recreated — removing`);
      for (const g of ghosts) await db.recursiveDelete(g.ref);
    } else {
      console.log("  no ghosts");
    }
  }

  console.log("");
  console.log(
    APPLY
      ? `Done — ${total} document(s) deleted (plus restaurant subcollections).`
      : `DRY RUN complete — ${total} document(s) would be deleted, plus the subcollections of ${doomed.length} restaurants.`
  );
  if (!APPLY) console.log(`Re-run with: CONFIRM=${PROJECT_ID} node scripts/reset_db.cjs --apply`);
}

main().catch((e) => {
  const msg = String(e && e.message ? e.message : e);
  if (/credential|authenticat|permission|UNAUTHENTICATED|PERMISSION_DENIED/i.test(msg)) {
    console.error(`\nFirestore refused the request: ${msg}\n`);
    console.error("Needs admin credentials: GOOGLE_APPLICATION_CREDENTIALS, or");
    console.error("gcloud auth application-default login");
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});
