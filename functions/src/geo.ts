import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { HOT_PATH } from "./options";
import { enforceRateLimit } from "./rateLimit";

/**
 * Server-side proxy for the Google Maps *web service* APIs.
 *
 * The Maps SDKs (the map view itself) use a key that can be locked to an iOS
 * bundle id or an Android package + signing certificate, so shipping that key
 * inside the app is fine. The web services used here — Places autocomplete,
 * Place details, Geocoding and Directions — ignore those app restrictions and
 * accept only IP restrictions, which a phone cannot satisfy. A key embedded in
 * the binary for these calls can therefore be extracted and spent against the
 * project by anyone.
 *
 * So the powerful key lives here as a secret and never ships. Apps call
 * `geoLookup` instead, which is:
 *   - authenticated: every caller is a signed-in user,
 *   - rate limited per uid, so one stolen account cannot run up the bill,
 *   - one function rather than four, because the us-central1 CPU quota counts
 *     max instances x vCPU across every function in the project (see options.ts).
 *
 * Set the secret once:
 *   firebase functions:secrets:set GOOGLE_MAPS_SERVER_KEY
 */
const GOOGLE_MAPS_SERVER_KEY = defineSecret("GOOGLE_MAPS_SERVER_KEY");

const BASE = "https://maps.googleapis.com/maps/api";

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new HttpsError("unavailable", `Places lookup failed (${res.status}).`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Google returns its own error states in the body with HTTP 200. */
function assertGoogleOk(data: Record<string, unknown>, op: string): void {
  const status = String(data.status ?? "");
  if (status === "OK" || status === "ZERO_RESULTS") return;
  // error_message names the real cause (key restricted, billing disabled,
  // quota). Log it for us; hand the caller something neutral.
  console.error(`geoLookup ${op} -> ${status}: ${data.error_message ?? ""}`);
  if (status === "OVER_QUERY_LIMIT") {
    throw new HttpsError("resource-exhausted", "Location search is busy. Try again shortly.");
  }
  throw new HttpsError("unavailable", "Location search is unavailable right now.");
}

export const geoLookup = onCall(
  { ...HOT_PATH, secrets: [GOOGLE_MAPS_SERVER_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to search for a location.");
    }

    const op = String(request.data?.op ?? "");
    const key = GOOGLE_MAPS_SERVER_KEY.value();
    if (!key) {
      // Deployed without the secret: say so plainly instead of calling Google
      // with an empty key and reporting a confusing REQUEST_DENIED.
      throw new HttpsError("failed-precondition", "Location search is not configured.");
    }

    // Autocomplete fires per keystroke (debounced client-side), so it gets a
    // larger budget than the one-shot lookups.
    await enforceRateLimit(
      `geo:${op}:${uid}`,
      op === "autocomplete" ? 60 : 30,
      60_000,
      "Too many location lookups.",
    );

    switch (op) {
      case "autocomplete": {
        const input = String(request.data?.input ?? "").trim();
        if (input.length < 2) return { predictions: [] };
        // components=country:in matches the old client-side India bias.
        const sessionToken = String(request.data?.sessionToken ?? "");
        const url =
          `${BASE}/place/autocomplete/json?input=${encodeURIComponent(input)}` +
          `&components=country:in` +
          (sessionToken ? `&sessiontoken=${encodeURIComponent(sessionToken)}` : "") +
          `&key=${key}`;
        const data = await fetchJson(url);
        assertGoogleOk(data, op);
        return { predictions: data.predictions ?? [] };
      }

      case "details": {
        const placeId = String(request.data?.placeId ?? "").trim();
        if (!placeId) throw new HttpsError("invalid-argument", "placeId is required.");
        const url =
          `${BASE}/place/details/json?place_id=${encodeURIComponent(placeId)}` +
          `&fields=geometry&key=${key}`;
        const data = await fetchJson(url);
        assertGoogleOk(data, op);
        const loc = (data.result as any)?.geometry?.location;
        return loc ? { lat: loc.lat, lng: loc.lng } : {};
      }

      case "geocode": {
        const address = String(request.data?.address ?? "").trim();
        if (!address) throw new HttpsError("invalid-argument", "address is required.");
        const url = `${BASE}/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
        const data = await fetchJson(url);
        assertGoogleOk(data, op);
        const loc = (data.results as any[])?.[0]?.geometry?.location;
        return loc ? { lat: loc.lat, lng: loc.lng } : {};
      }

      case "directions": {
        const origin = String(request.data?.origin ?? "").trim();
        const destination = String(request.data?.destination ?? "").trim();
        if (!origin || !destination) {
          throw new HttpsError("invalid-argument", "origin and destination are required.");
        }
        const url =
          `${BASE}/directions/json?origin=${encodeURIComponent(origin)}` +
          `&destination=${encodeURIComponent(destination)}&mode=driving&key=${key}`;
        const data = await fetchJson(url);
        assertGoogleOk(data, op);
        const route = (data.routes as any[])?.[0];
        return {
          // The rider app only needs the encoded polyline and the leg summary.
          polyline: route?.overview_polyline?.points ?? "",
          distanceMeters: route?.legs?.[0]?.distance?.value ?? null,
          durationSeconds: route?.legs?.[0]?.duration?.value ?? null,
        };
      }

      default:
        throw new HttpsError("invalid-argument", `Unknown op "${op}".`);
    }
  },
);
