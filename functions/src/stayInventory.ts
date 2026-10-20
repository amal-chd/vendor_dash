import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

/**
 * Room-night inventory for stays.
 *
 * The availability model already existed — `hotels/{h}/rooms/{r}/availability/{YYYY-MM-DD}`
 * with `isBlocked` and `bookedCount`, against the room's `inventory` — and
 * `checkAvailability` read it. But nothing ever WROTE `bookedCount`, and
 * `createStayBooking` never consulted availability at all. So a host could
 * block a date and still receive a booking for it, and the same room-night
 * could be sold to any number of guests: every booking saw an empty counter.
 *
 * Claiming nights inside the booking transaction is what makes it correct.
 * Two guests booking the same night now contend on the same availability
 * documents, so Firestore serialises them and the second one loses.
 *
 * Failure direction matters here: if a cancellation path ever forgets to
 * release, the nights stay marked as sold and the room looks busier than it is.
 * That refuses revenue, which is recoverable; the opposite — double-selling a
 * room — ends with two guests at one door.
 */

const MAX_NIGHTS = 370;

/** Nights occupied by a stay: check-in through the night before check-out. */
export function nightsBetween(checkIn: Date, checkOut: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate()));
  const end = new Date(Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate()));
  while (cur < end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (out.length > MAX_NIGHTS) break;
  }
  return out;
}

function availabilityRef(
  db: admin.firestore.Firestore,
  hotelId: string,
  roomId: string,
  night: string,
): admin.firestore.DocumentReference {
  return db.collection("hotels").doc(hotelId).collection("rooms").doc(roomId).collection("availability").doc(night);
}

export interface NightState {
  night: string;
  isBlocked: boolean;
  bookedCount: number;
}

/** Reads the nights' current state. Call inside a transaction, before writes. */
export async function readNights(
  tx: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  hotelId: string,
  roomId: string,
  nights: string[],
): Promise<NightState[]> {
  if (!nights.length) return [];
  const refs = nights.map((n) => availabilityRef(db, hotelId, roomId, n));
  const snaps = await Promise.all(refs.map((r) => tx.get(r)));
  return snaps.map((s, i) => ({
    night: nights[i],
    isBlocked: s.data()?.isBlocked === true,
    bookedCount: Number(s.data()?.bookedCount) || 0,
  }));
}

/**
 * Throws if any night is blocked or already sold out, otherwise writes the
 * incremented counts. `states` must come from readNights in the same
 * transaction — Firestore forbids reading after writing.
 */
export function claimNights(
  tx: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  hotelId: string,
  roomId: string,
  states: NightState[],
  inventory: number,
): void {
  const limit = Math.max(1, Math.trunc(inventory) || 1);

  const blocked = states.find((s) => s.isBlocked);
  if (blocked) {
    throw new HttpsError("failed-precondition", `The host has closed ${blocked.night}. Pick different dates.`);
  }
  const full = states.find((s) => s.bookedCount >= limit);
  if (full) {
    throw new HttpsError("failed-precondition", `${full.night} is fully booked. Pick different dates.`);
  }

  for (const s of states) {
    tx.set(
      availabilityRef(db, hotelId, roomId, s.night),
      { bookedCount: s.bookedCount + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
}

/**
 * Gives nights back when a booking is cancelled or expires.
 *
 * Uses an increment rather than a read-modify-write so it is safe to call from
 * a transaction that never read these documents, and floors at zero so a
 * double-release cannot drive the counter negative and make a room look
 * permanently free.
 */
export function releaseNights(
  tx: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  hotelId: string,
  roomId: string,
  states: NightState[],
): void {
  for (const s of states) {
    tx.set(
      availabilityRef(db, hotelId, roomId, s.night),
      { bookedCount: Math.max(0, s.bookedCount - 1), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
}

/**
 * Statuses in which a booking no longer occupies its room-nights.
 * `pending_payment` is NOT one of them: nights are claimed when the booking is
 * created, before the guest pays, which is what stops two people paying for
 * the same room at once.
 */
const CLOSED_STATUSES = new Set([
  "cancelled",
  "canceled",
  "expired",
  "rejected",
  "declined",
  "no_show",
  "noshow",
]);

export function isClosedBookingStatus(status: unknown): boolean {
  return CLOSED_STATUSES.has(String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"));
}

/**
 * Should a status change hand the room-nights back?
 *
 * Only on the transition INTO a closed status, and only once per booking.
 * `releaseNights` decrements from a value it read, so releasing the same
 * booking twice takes a night from 2 → 1 → 0 and frees a DIFFERENT guest's
 * room. The `alreadyReleased` marker is what makes a re-fired trigger, a
 * retried admin click and a host acting at the same moment all safe.
 */
export function shouldReleaseNights(args: {
  before: unknown;
  after: unknown;
  alreadyReleased: boolean;
}): boolean {
  if (args.alreadyReleased) return false;
  if (!isClosedBookingStatus(args.after)) return false;
  return !isClosedBookingStatus(args.before);
}
