import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";

const email = process.env.KADA_ADMIN_EMAIL;
const password = process.env.KADA_ADMIN_PASSWORD;

if (!email || !password) {
  console.error("Missing KADA_ADMIN_EMAIL or KADA_ADMIN_PASSWORD");
  process.exit(1);
}

const app = initializeApp({
  projectId: "kada-restaurant-os-v1",
  appId: "1:434348622340:web:0f651dcfce5714c2aa2b51",
  storageBucket: "kada-restaurant-os-v1.firebasestorage.app",
  apiKey: "AIzaSyBYYVtgpvq_Esn7NpLftweuZ0AzsdfHqTk",
  authDomain: "kada-restaurant-os-v1.firebaseapp.com",
  messagingSenderId: "434348622340",
  projectNumber: "434348622340",
});

const auth = getAuth(app);
const db = getFirestore(app);

const formatDoc = (doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    status: data.status,
    createdAtIso: data.createdAtIso ?? null,
    source: data.source ?? null,
    name: data.name ?? data.restaurantName ?? null,
    email: data.email ?? null,
  };
};

const run = async () => {
  await signInWithEmailAndPassword(auth, email, password);
  console.log(`Signed in as ${auth.currentUser?.email ?? "unknown"}`);

  const contactSnap = await getDocs(
    query(collection(db, "contact_requests"), orderBy("createdAt", "desc"), limit(5)),
  );
  const demoSnap = await getDocs(
    query(collection(db, "demo_requests"), orderBy("createdAt", "desc"), limit(5)),
  );

  console.log("contact_requests", contactSnap.size);
  console.log(JSON.stringify(contactSnap.docs.map(formatDoc), null, 2));
  console.log("demo_requests", demoSnap.size);
  console.log(JSON.stringify(demoSnap.docs.map(formatDoc), null, 2));
};

run().catch((error) => {
  console.error("VERIFY_FAILED");
  console.error(error?.code ?? error?.message ?? error);
  process.exit(1);
});
