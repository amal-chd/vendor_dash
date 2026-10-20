#!/usr/bin/env node
/**
 * Kada Assist — support-chat load-test harness.
 *
 * Simulates N concurrent users, each of whom signs in anonymously, opens a
 * support thread, sends one message, and waits for the server bot's first reply
 * (the `onSupportMessageCreated` Cloud Function). It measures end-to-end
 * time-to-first-bot-reply and reports throughput + p50/p95/p99 latency + errors.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  RUN AGAINST STAGING OR THE FIRESTORE EMULATOR ONLY.
 *     Every simulated message triggers a real Gemini generation (cost) and
 *     writes a real support thread. This script REFUSES to run against the known
 *     production project unless you pass --force-prod (don't).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Requirements: the `firebase` web SDK (already a dependency of the web app).
 *
 * Usage (staging project):
 *   FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=... FIREBASE_PROJECT_ID=... \
 *   node scripts/loadtest_support.mjs --users 200 --ramp 20 --timeout 30
 *
 * Usage (Firestore emulator — no Gemini, tests write/trigger throughput only):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=demo-kada \
 *   FIREBASE_API_KEY=demo FIREBASE_AUTH_DOMAIN=demo node scripts/loadtest_support.mjs --users 500
 *
 * Flags:
 *   --users N      number of concurrent virtual users        (default 100)
 *   --ramp  N      start this many new users per second       (default 25)
 *   --timeout N    seconds to wait for a bot reply per user   (default 40)
 *   --message "…"  the message each virtual user sends
 *   --force-prod   allow running against the production project (discouraged)
 */

import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  connectAuthEmulator,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  connectFirestoreEmulator,
} from "firebase/firestore";

const PROD_PROJECT_ID = "kada-restaurant-os-v1";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const USERS = Number(arg("users", 100));
const RAMP = Number(arg("ramp", 25));
const TIMEOUT_MS = Number(arg("timeout", 40)) * 1000;
const MESSAGE = String(arg("message", "Where is my order? It's late."));
const FORCE_PROD = arg("force-prod", false) === true;

const cfg = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
};
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!cfg.projectId) {
  console.error("Set FIREBASE_PROJECT_ID (and FIREBASE_API_KEY / FIREBASE_AUTH_DOMAIN for a real project).");
  process.exit(1);
}
if (cfg.projectId === PROD_PROJECT_ID && !emulatorHost && !FORCE_PROD) {
  console.error(`Refusing to load-test the PRODUCTION project (${PROD_PROJECT_ID}). Use a staging project or the emulator. Pass --force-prod to override (not recommended).`);
  process.exit(1);
}

const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);
if (emulatorHost) {
  const [h, p] = emulatorHost.split(":");
  connectFirestoreEmulator(db, h, Number(p));
  try { connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099"}`); } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

/** One virtual user: sign in, open thread, send message, await first bot reply. */
async function runUser(i) {
  const t0 = Date.now();
  try {
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;
    const threadRef = doc(db, "support_threads", uid);
    await setDoc(threadRef, {
      participantUid: uid,
      participantRole: "customer",
      participantName: `LoadTest ${i}`,
      status: "bot",
      lastMessage: "",
      lastSender: "bot",
      lastMessageAt: serverTimestamp(),
      unreadForAdmin: 0,
      unreadForUser: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      loadTest: true,
    }, { merge: true });

    const sentAt = Date.now();
    await addDoc(collection(threadRef, "messages"), {
      text: MESSAGE,
      sender: "user",
      senderName: "You",
      createdAt: serverTimestamp(),
      loadTest: true,
    });

    // Wait for the first bot reply.
    const latency = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unsub(); reject(new Error("timeout")); }, TIMEOUT_MS);
      const unsub = onSnapshot(collection(threadRef, "messages"), (snap) => {
        const bot = snap.docs.find((d) => (d.data().sender || "") === "bot");
        if (bot) {
          clearTimeout(timer);
          unsub();
          resolve(Date.now() - sentAt);
        }
      }, (err) => { clearTimeout(timer); reject(err); });
    });

    return { ok: true, latency, total: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.message, total: Date.now() - t0 };
  }
}

(async () => {
  console.log(`▶ Support load test — ${USERS} users, ramp ${RAMP}/s, timeout ${TIMEOUT_MS / 1000}s, project ${cfg.projectId}${emulatorHost ? " (emulator)" : ""}`);
  const started = Date.now();
  const tasks = [];
  for (let i = 0; i < USERS; i++) {
    tasks.push(runUser(i));
    if ((i + 1) % RAMP === 0) await sleep(1000);
  }
  const results = await Promise.all(tasks);
  const wall = (Date.now() - started) / 1000;

  const ok = results.filter((r) => r.ok);
  const lat = ok.map((r) => r.latency);
  const fails = results.length - ok.length;

  console.log("\n── Results ─────────────────────────────");
  console.log(`Users:          ${results.length}`);
  console.log(`Bot replied:    ${ok.length}`);
  console.log(`Failed/timeout: ${fails}`);
  console.log(`Wall time:      ${wall.toFixed(1)}s`);
  console.log(`Throughput:     ${(ok.length / wall).toFixed(1)} replies/s`);
  if (lat.length) {
    console.log(`Latency p50:    ${pct(lat, 50)} ms`);
    console.log(`Latency p95:    ${pct(lat, 95)} ms`);
    console.log(`Latency p99:    ${pct(lat, 99)} ms`);
    console.log(`Latency max:    ${Math.max(...lat)} ms`);
  }
  console.log("────────────────────────────────────────");
  console.log("NOTE: clean up load-test threads afterwards (they carry loadTest: true).");
  process.exit(0);
})();
