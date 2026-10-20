import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

/**
 * Customer-app module switches, with ONE precedence rule shared with the app
 * (customer_mobile_app PlatformConfigService._rebuild):
 *
 *   config/feature_flags.<flag>  →  config/platform.<legacy field>  →  on
 *
 * Both admin pages that show these switches (Platform Settings and Feature
 * Flags) write config/feature_flags. Before this, the server read only
 * config/platform, so COD could be "off" in the app and still accepted by the
 * server (or the reverse), and switching off the wallet, Gold, gift cards or
 * Stay only hid a button — the callables kept taking money.
 */
export type ModuleFlag = "cashOnDelivery" | "wallet" | "kadaGold" | "giftCards" | "kadaStay" | "tableBooking";

const LEGACY_FIELD: Record<ModuleFlag, string> = {
  cashOnDelivery: "codEnabled",
  wallet: "walletEnabled",
  kadaGold: "goldEnabled",
  giftCards: "giftCardsEnabled",
  kadaStay: "stayEnabled",
  tableBooking: "tableBookingEnabled",
};

/** Pure resolution, for tests and for callers that already hold both docs. */
export function resolveModule(
  flag: ModuleFlag,
  flags: Record<string, unknown> | undefined,
  platform: Record<string, unknown> | undefined,
): boolean {
  const f = flags?.[flag];
  if (typeof f === "boolean") return f;
  const p = platform?.[LEGACY_FIELD[flag]];
  if (typeof p === "boolean") return p;
  return true;
}

let cache: { at: number; flags: Record<string, unknown>; platform: Record<string, unknown> } | null = null;

/** Live value, cached 30 s per instance (a switch takes effect within that). */
export async function moduleEnabled(flag: ModuleFlag): Promise<boolean> {
  if (!cache || Date.now() - cache.at > 30_000) {
    try {
      const db = admin.firestore();
      const [f, p] = await Promise.all([
        db.collection("config").doc("feature_flags").get(),
        db.collection("config").doc("platform").get(),
      ]);
      cache = { at: Date.now(), flags: f.data() ?? {}, platform: p.data() ?? {} };
    } catch {
      // A config read failure must not take a module down.
      return true;
    }
  }
  return resolveModule(flag, cache.flags, cache.platform);
}

export async function assertModuleEnabled(flag: ModuleFlag, message: string): Promise<void> {
  if (!(await moduleEnabled(flag))) throw new HttpsError("failed-precondition", message, { reason: "module_disabled" });
}
