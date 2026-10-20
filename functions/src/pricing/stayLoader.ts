/**
 * Builds the Stay engine's input from server data only: the property, the
 * room, host date overrides, the customer and the host's commission. The
 * client sends ids, dates, guests and a coupon code — never a price.
 */
import * as admin from "firebase-admin";
import { readCatalog, commissionForMerchant } from "../planCatalog";
import { effectiveCommissionRate } from "../billingModel";
import { legacyHostRules, legacyStayRules } from "./legacy";
import { loadRuleset } from "./store";
import { rupeesToPaise } from "./money";
import { stateCodeOf } from "./states";
import { MAX_NIGHTS, type StayQuoteInput } from "./stay";
import type { AnyRule } from "./rules";

export interface StayQuoteRequest {
  hotelId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  couponCode: string | null;
  at?: number;
}

type Doc = Record<string, unknown>;
const str = (v: unknown) => (v ?? "").toString().trim();
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function datesBetween(checkIn: string, checkOut: string): string[] {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return [];
  const out: string[] = [];
  for (let t = a; t < b && out.length <= MAX_NIGHTS; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export async function buildStayQuoteInput(
  uid: string | null,
  req: StayQuoteRequest,
): Promise<{
  input: StayQuoteInput;
  rules: AnyRule[];
  problems: string[];
  context: { hotelName: string; imageUrl: string | null; roomId: string; roomNumber: string };
}> {
  const db = admin.firestore();
  const at = req.at ?? Date.now();
  const problems: string[] = [];
  const dates = datesBetween(req.checkIn, req.checkOut);

  const hotelRef = db.collection("hotels").doc(req.hotelId);
  // Customer builds so far book the property, not a room, and the app used its
  // first room. Keep that until the app lets guests choose a room.
  let roomId = req.roomId;
  if (!roomId) {
    const first = await hotelRef.collection("rooms").limit(1).get().catch(() => null);
    roomId = first?.docs[0]?.id ?? "_none";
  }
  const roomRef = hotelRef.collection("rooms").doc(roomId);
  const [hotelSnap, roomSnap, userSnap, pastStays, platformSnap, catalog, baseRules, overrideSnaps] = await Promise.all([
    hotelRef.get(),
    roomRef.get(),
    uid ? db.collection("customer_users").doc(uid).get().catch(() => null) : Promise.resolve(null),
    uid ? db.collection("stay_bookings").where("customerId", "==", uid).limit(3).get().catch(() => null) : Promise.resolve(null),
    db.collection("config").doc("platform").get().catch(() => null),
    readCatalog(),
    loadRuleset(),
    dates.length ? db.getAll(...dates.map((d) => roomRef.collection("availability").doc(d))) : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
  ]);

  const h = (hotelSnap.data() ?? {}) as Doc;
  const room = (roomSnap.data() ?? {}) as Doc;
  if (!hotelSnap.exists) problems.push("This property is no longer available.");
  if (!roomSnap.exists) problems.push("This room is no longer available.");
  if (h.published === false) problems.push("This property isn't taking bookings right now.");
  // Same gate as the booking rules (hotelIsOperational): a property takes
  // bookings only once onboarding has made it active, so it can be paid out.
  const onboardingState = String(((h.onboarding ?? {}) as Doc).state ?? "");
  if (hotelSnap.exists && onboardingState !== "active") problems.push("This property isn't taking bookings yet.");

  // Never invent a price: the old calculator charged ₹1000/night when a room had none.
  const nightly = rupeesToPaise(room.price ?? room.pricePerNight);
  if (roomSnap.exists && nightly <= 0) problems.push("This room doesn't have a price yet. The host needs to set one.");

  const overrides: Record<string, number> = {};
  for (const s of overrideSnaps) {
    const price = s.data()?.price;
    if (s.exists && price != null && num(price) > 0) overrides[s.id] = rupeesToPaise(price);
  }

  const address = (h.address ?? {}) as Doc;
  const propertyState = stateCodeOf(h.stateCode ?? h.state ?? address.state ?? h.gstin ?? h.gstNumber);
  const p = (platformSnap?.data() ?? {}) as Doc;
  const commission = commissionForMerchant(catalog, "stay", h, num(p.defaultHostCommissionPercent, 15));
  const billing = effectiveCommissionRate(h as Doc & { billingModel?: unknown }, commission.rate);
  const maxGuests = Math.max(1, Math.trunc(num(room.maxGuests ?? room.capacity ?? h.maxGuests, 2)));

  const rules: AnyRule[] = [
    ...baseRules,
    ...legacyStayRules({ serviceFeeBps: 1200, defaultCleaningRupees: 450, defaultCommissionPercent: num(p.defaultHostCommissionPercent, 15) }),
    ...legacyHostRules({ id: req.hotelId, commissionPercent: billing.rate }),
  ];

  const completedStays = pastStays?.docs.filter((d) => ["checked_out", "completed"].includes(str(d.data().status))).length ?? 0;
  const u = (userSnap?.data() ?? {}) as Doc;

  const input: StayQuoteInput = {
    at,
    property: {
      id: req.hotelId,
      hostId: str(h.ownerId) || req.hotelId,
      name: str(h.name) || "Stay",
      stateCode: propertyState,
      gstin: str(h.gstin ?? h.gstNumber) || null,
      zoneId: str(h.zoneId) || null,
    },
    room: {
      id: roomId,
      name: str(room.name ?? room.type ?? room.number) || "Room",
      baseNightlyPaise: Math.max(0, nightly),
      maxGuests,
      includedGuests: Math.max(1, Math.trunc(num(room.includedGuests ?? room.baseOccupancy, maxGuests))),
      extraGuestNightlyPaise: room.extraGuestFee != null ? rupeesToPaise(room.extraGuestFee) : null,
      cleaningFeePaise: room.cleaningFee != null ? rupeesToPaise(room.cleaningFee) : null,
    },
    nightlyOverrides: overrides,
    checkIn: req.checkIn,
    checkOut: req.checkOut,
    guests: Math.trunc(num(req.guests, 1)),
    customer: {
      uid: uid ?? "",
      completedStays,
      isNew: (pastStays?.size ?? 0) === 0,
      stateCode: stateCodeOf(u.billingStateCode ?? u.billingState) || propertyState,
    },
    platform: { gstin: str(p.platformGstin) || null, stateCode: stateCodeOf(p.platformStateCode ?? p.platformGstin) || propertyState },
    couponCode: req.couponCode,
    promoUsage: { total: {}, byCustomer: {} },
    hostCommissionWaived: false,
  };
  const imageUrl = Array.isArray(h.images) && h.images.length ? str(h.images[0]) : str(h.imageUrl) || null;
  return {
    input,
    rules,
    problems,
    context: { hotelName: input.property.name, imageUrl, roomId, roomNumber: str(room.number ?? room.roomNumber) },
  };
}
