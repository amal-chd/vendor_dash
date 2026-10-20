import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { HOT_PATH } from "./options";

/**
 * Normalizes a date string (YYYY-MM-DD) to a standard format for comparison
 */
function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Checks if a room is available for the given date range.
 * This checks the `availability` subcollection for any blocked dates or fully booked nights.
 */
export const checkAvailability = onCall({ ...HOT_PATH }, async (request) => {
  const { hotelId, roomId, checkIn, checkOut } = request.data;

  if (!hotelId || !roomId || !checkIn || !checkOut) {
    throw new HttpsError("invalid-argument", "Missing required parameters.");
  }

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  
  if (checkInDate >= checkOutDate) {
    throw new HttpsError("invalid-argument", "Check-out must be after check-in.");
  }

  const db = admin.firestore();
  
  // We need to check every night from checkIn up to (but not including) checkOut
  const nightsToCheck = [];
  const current = new Date(checkInDate);
  while (current < checkOutDate) {
    nightsToCheck.push(toDateString(current));
    current.setDate(current.getDate() + 1);
  }

  // Get the room document to check inventory
  const roomSnap = await db.doc(`hotels/${hotelId}/rooms/${roomId}`).get();
  if (!roomSnap.exists) {
    throw new HttpsError("not-found", "Room not found.");
  }
  const inventory = roomSnap.data()?.inventory || 1;

  // Check the availability subcollection for any overrides or bookings
  // Assuming doc ID is the YYYY-MM-DD string
  const availRef = db.collection(`hotels/${hotelId}/rooms/${roomId}/availability`);
  
  for (const dateStr of nightsToCheck) {
    const docSnap = await availRef.doc(dateStr).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      if (data?.isBlocked) {
        return { available: false, reason: `Blocked on ${dateStr}` };
      }
      
      const booked = data?.bookedCount || 0;
      if (booked >= inventory) {
        return { available: false, reason: `Fully booked on ${dateStr}` };
      }
    }
  }

  return { available: true };
});

/**
 * Calculates pricing for a given stay.
 */
export const calculatePricing = onCall({ ...HOT_PATH }, async (request) => {
  const { hotelId, roomId, checkIn, checkOut, guests } = request.data;

  if (!hotelId || !roomId || !checkIn || !checkOut) {
    throw new HttpsError("invalid-argument", "Missing required parameters.");
  }

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));
  
  if (nights <= 0) {
    throw new HttpsError("invalid-argument", "Check-out must be after check-in.");
  }

  const db = admin.firestore();
  const roomSnap = await db.doc(`hotels/${hotelId}/rooms/${roomId}`).get();
  
  if (!roomSnap.exists) {
    throw new HttpsError("not-found", "Room not found.");
  }
  
  const roomData = roomSnap.data() || {};
  const basePrice = roomData.price || 1000;
  
  // Iterate nights to apply custom date pricing
  let totalBase = 0;
  const current = new Date(checkInDate);
  const availRef = db.collection(`hotels/${hotelId}/rooms/${roomId}/availability`);
  
  for (let i = 0; i < nights; i++) {
    const dateStr = toDateString(current);
    const docSnap = await availRef.doc(dateStr).get();
    let nightlyPrice = basePrice;
    
    if (docSnap.exists && docSnap.data()?.price) {
      nightlyPrice = docSnap.data()!.price;
    }
    
    totalBase += nightlyPrice;
    current.setDate(current.getDate() + 1);
  }

  const cleaningFee = roomData.cleaningFee || 450;
  const serviceFee = Math.round(totalBase * 0.12);
  const grandTotal = totalBase + cleaningFee + serviceFee;

  return {
    nights,
    baseTotal: totalBase,
    cleaningFee,
    serviceFee,
    grandTotal,
    currency: "INR"
  };
});
