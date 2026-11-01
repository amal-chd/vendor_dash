import { sendPasswordResetEmail } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "./firebase";

/**
 * Kada's own password reset email (the `requestPasswordReset` function: Kada
 * styling, a link to www.thekada.in/auth/action). Firebase's built-in email is
 * locked on this project and says "Kada Dine" to every user, so it is only
 * the fallback for when the function can't be reached. Resolves the same way
 * whether or not the address has an account.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const clean = email.trim();
  try {
    await httpsCallable(functions, "requestPasswordReset")({ email: clean });
  } catch (err) {
    if ((err as { code?: string }).code === "functions/invalid-argument") throw err;
    try {
      await sendPasswordResetEmail(auth, clean);
    } catch (fallbackErr) {
      if ((fallbackErr as { code?: string }).code !== "auth/user-not-found") throw fallbackErr;
    }
  }
}

/** Friendly copy for a failed reset request. */
export function resetErrorMessage(err: unknown): string {
  const code = (err as { code?: string }).code || "";
  if (code.includes("invalid")) return "That email address doesn't look right.";
  if (code.includes("network")) return "You're offline. Check your connection and try again.";
  if (code.includes("too-many")) return "Too many attempts. Please wait a few minutes and try again.";
  return "We couldn't send the email right now. Please try again in a minute.";
}
