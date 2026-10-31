import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBYYVtgpvq_Esn7NpLftweuZ0AzsdfHqTk",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "kada-restaurant-os-v1",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:434348622340:web:0f651dcfce5714c2aa2b51",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "kada-restaurant-os-v1.firebasestorage.app",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "kada-restaurant-os-v1.firebaseapp.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "434348622340",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Enable Offline Persistence for Advanced POS Resiliency with multi-tab support
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const storage = getStorage(app);
/**
 * Region of every Kada Cloud Function. It has to match the Firestore
 * database's region (Firestore triggers only run next to the database). The
 * database is moving from nam5 (US) to asia-south1 (Mumbai): flip this at the
 * cutover, together with FUNCTIONS_REGION in functions/src/options.ts and
 * kFunctionsRegion in the four apps - not before.
 */
export const FUNCTIONS_REGION = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "asia-south1";
export const functions = getFunctions(app, FUNCTIONS_REGION);
// Firebase Cloud Messaging is initialized lazily in useNotifications (dashboard
// only) so the messaging SDK is not pulled into the initial bundle on the
// landing / marketing / public pages that never use push notifications.
export default app;
