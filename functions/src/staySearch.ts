import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { HOT_PATH } from "./options";
import { isBookable, publicStay } from "./stayRecommendations";

const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/**
 * Stay search. Public (no sign-in), so it returns listing fields only, for
 * bookable properties, at most 50. Filters run server-side on those fields.
 */
export const searchStays = onCall({ ...HOT_PATH }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const filters = (data.filters ?? null) as {
    destination?: string;
    minPrice?: number;
    maxPrice?: number;
    propertyTypes?: string[];
    amenities?: string[];
  } | null;
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  const radiusKm = Math.min(200, Math.max(0, Number(data.radiusKm) || 0));

  const db = admin.firestore();
  const destination = typeof filters?.destination === "string" ? filters.destination.slice(0, 100) : "";
  const query = destination && destination !== "Anywhere"
    ? db.collection("hotels").where("destination", "==", destination).limit(100)
    : db.collection("hotels").where("onboarding.state", "==", "active").limit(200);
  const snapshot = await query.get();

  let stays = snapshot.docs.filter(isBookable).map(publicStay);

  if (Number.isFinite(lat) && Number.isFinite(lng) && radiusKm > 0) {
    stays = stays.filter((s) => {
      const sLat = Number(s.lat);
      const sLng = Number(s.lng);
      return Number.isFinite(sLat) && Number.isFinite(sLng) && km(lat, lng, sLat, sLng) <= radiusKm;
    });
  }

  if (filters) {
    const token = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    stays = stays.filter((stay) => {
      const price = Number(stay.price ?? stay.startingPrice ?? stay.pricePerNight);
      if (filters.minPrice && price < filters.minPrice) return false;
      if (filters.maxPrice && price > filters.maxPrice) return false;

      const types = Array.isArray(filters.propertyTypes) ? filters.propertyTypes.map(String) : [];
      if (types.length > 0) {
        const type = String(stay.subtitle ?? stay.propertyType ?? "");
        if (!types.some((t) => type.includes(t))) return false;
      }

      // Amenities — keys and display names both match (wifi / Wifi / Wi-Fi)
      const wanted = Array.isArray(filters.amenities) ? filters.amenities.map(String) : [];
      if (wanted.length > 0) {
        const have = (Array.isArray(stay.amenities) ? stay.amenities.map(String) : []).map(token);
        if (!wanted.every((a) => have.includes(token(a)))) return false;
      }
      return true;
    });
  }

  return { stays: stays.slice(0, 50) };
});
