import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as ngeohash from "ngeohash";

// Ensures geohash is updated whenever lat/lng changes
export const indexHotelGeohash = onDocumentWritten(
  "hotels/{hotelId}",
  async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) {
      return; // Document deleted, nothing to do
    }

    const data = after.data();
    const lat = data?.lat;
    const lng = data?.lng;

    if (lat === undefined || lng === undefined) {
      return;
    }

    const newGeohash = ngeohash.encode(lat, lng, 10);
    if (data?.geohash !== newGeohash) {
      await after.ref.update({ geohash: newGeohash });
      console.log(`Updated geohash for hotel ${event.params.hotelId} to ${newGeohash}`);
    }
  }
);
