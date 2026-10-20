import {
  GoogleAuthProvider,
  OAuthProvider,
  User,
  signOut,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { clearLocalSessionId } from "@/lib/sessions";

export interface RestaurantProfileDraft {
  name?: string;
  email?: string;
  supportEmail?: string;
  phone?: string;
  state?: string;
  district?: string;
  address?: string;
  hours?: string;
  managerName?: string;
  ownerId?: string;
  subscriptionStatus?: string;
  subscriptionType?: string;
  isBlocked?: boolean;
  isOutlet?: boolean;
  parentId?: string;
  countryCode?: string;
  dialCode?: string;
  currencyCode?: string;
  currencySymbol?: string;
  timezone?: string;
  locale?: string;
  taxConfiguration?: any[];
}

export const ADMIN_EMAILS = ["thekada@gmail.com", "thekadaapp@gmail.com"];

export function isAdminEmail(email?: string | null) {
  return Boolean(email && ADMIN_EMAILS.includes(email.toLowerCase()));
}

export async function signInWithGoogleWeb() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export async function signInWithAppleWeb() {
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  return signInWithPopup(auth, provider);
}

export async function getRestaurantProfile(uid: string) {
  try {
    const snapshot = await getDoc(doc(db, "restaurants", uid));
    if (!snapshot.exists()) return null;
    return snapshot.data() as RestaurantProfileDraft;
  } catch (error) {
    console.error("Failed to get restaurant profile:", error);
    return null;
  }
}


export const MESS_SIGNUP_INTENT_KEY = "kada_signup_account_type"; // "mess" | "restaurant"

export function setSignupIntent(intent: "restaurant" | "mess") {
  try {
    localStorage.setItem(MESS_SIGNUP_INTENT_KEY, intent);
  } catch {
    /* ignore */
  }
}

export function getSignupIntent(): "restaurant" | "mess" | null {
  try {
    return (localStorage.getItem(MESS_SIGNUP_INTENT_KEY) as "restaurant" | "mess") || null;
  } catch {
    return null;
  }
}

export function clearSignupIntent() {
  try {
    localStorage.removeItem(MESS_SIGNUP_INTENT_KEY);
  } catch {
    /* ignore */
  }
}

export async function getMessKitchenProfile(uid: string) {
  try {
    const snapshot = await getDoc(doc(db, "mess_kitchens", uid));
    if (!snapshot || !snapshot.exists || !snapshot.exists()) return null;
    return snapshot.data();
  } catch (error) {
    console.error("Failed to get mess kitchen profile:", error);
    return null;
  }
}

export async function resolvePostAuthPath(user: User) {
  if (isAdminEmail(user.email)) return "/portal-select";
  try {
    const token = await user.getIdTokenResult();
    // Platform admins pick which console to open (admin, vendor dashboard, stay).
    if (token.claims.platformAdmin === true) return "/portal-select";
    if (token.claims.staff === true) return "/dashboard";
  } catch {
    /* ignore */
  }

  const intent = getSignupIntent();

  // 1. If explicit mess intent is set, check or create mess kitchen profile
  if (intent === "mess") {
    const messProfile = await getMessKitchenProfile(user.uid);
    if (!messProfile) {
      const now = new Date();
      await setDoc(doc(db, "mess_kitchens", user.uid), {
        name: user.displayName || "My Mess Kitchen",
        ownerName: user.displayName || "Kitchen Owner",
        ownerId: user.uid,
        phone: user.phoneNumber || "",
        email: user.email || "",
        address: "",
        mealsServed: ["lunch", "dinner"],
        dietType: "both",
        fulfilmentModes: ["delivery"],
        messProfile: {
          meals: ["lunch", "dinner"],
          diet: ["veg", "nonveg"],
          fulfilment: ["delivery"],
        },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        onboardingVersion: "mess_web_v1",
      });
      clearSignupIntent();
      return "/setup?type=mess";
    }

    clearSignupIntent();
    const obState = (messProfile as any)?.onboarding?.state;
    if (!obState || ["started", "incomplete", "action_required"].includes(obState)) {
      return "/setup?type=mess";
    }
    return "/mess/dashboard";
  }
  
  // 2. Check existing restaurant profile
  const profile = await getRestaurantProfile(user.uid);
  if (profile) {
    // Existing restaurant profile: check centralized onboarding engine state
    const obState = (profile as any)?.onboarding?.state;
    if (obState) {
      if (["started", "incomplete", "action_required"].includes(obState)) {
        return "/setup";
      }
      return "/dashboard";
    }

    // Legacy fallback
    if (!(profile as any).onboardingComplete) {
      return "/setup";
    }

    return "/dashboard";
  }

  // 3. Not a restaurant — check if user is an existing mess kitchen
  const messProfile = await getMessKitchenProfile(user.uid);
  if (messProfile) {
    const obState = (messProfile as any)?.onboarding?.state;
    if (!obState || ["started", "incomplete", "action_required"].includes(obState)) {
      return "/setup?type=mess";
    }
    return "/mess/dashboard";
  }

  // 4. Brand new user without intent: create default restaurant profile
  const newProfile = {
    name: user.displayName || 'New Restaurant',
    email: user.email || '',
    subscriptionStatus: 'pending',
    subscriptionType: 'starter',
    isBlocked: false,
    isOutlet: false,
    countryCode: "IN",
    dialCode: "+91",
    currencyCode: "INR",
    currencySymbol: "₹",
    timezone: "Asia/Kolkata",
    locale: "en-IN",
    onboardingComplete: false,
    onboardingStep: "registered",
    taxConfiguration: [
      { name: "GST", type: "compound", rate: 5, enabled: true, inclusive: false }
    ]
  };
  try {
    const now = new Date();
    await setDoc(doc(db, "restaurants", user.uid), {
      ...newProfile,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  } catch (e) {
    console.error("Failed to auto-create profile:", e);
  }
  // New user → send to setup wizard
  return "/setup";
}

export async function signOutWeb(user?: User | null) {
  const activeUser = user ?? auth.currentUser;
  if (activeUser?.uid) {
    clearLocalSessionId(activeUser.uid);
  }
  await signOut(auth);
}

