import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

import { resolveZoneForPoint } from "./zones";

/**
 * Stamps the service zone a customer belongs to, from the location they gave
 * at signup (or any later change to their primary address).
 *
 * The app writes `primaryArea` / `primaryLat` / `primaryLng`; the zone itself
 * is decided here so it always comes from the live zone polygons instead of
 * whatever a client believed. Ops, CRM and segments group customers by this.
 */
export const onCustomerProfileLocationChanged = onDocumentWritten(
  { document: "customer_users/{uid}" },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const now = after.data() ?? {};
    const before = event.data?.before?.data() ?? {};

    const lat = Number(now.primaryLat);
    const lng = Number(now.primaryLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const moved =
      Number(before.primaryLat) !== lat || Number(before.primaryLng) !== lng;
    // Nothing to do when the point is unchanged and already stamped. Docs
    // stamped before nearestZoneKm existed are re-resolved once, so the admin
    // stops reading "near Kakkanad" for a customer 2,000 km away.
    const needsDistance = !now.primaryZoneId && now.nearestZoneName && now.nearestZoneKm === undefined;
    if (!moved && now.primaryZoneResolvedAt && !needsDistance) return;

    try {
      const { zone, nearest } = await resolveZoneForPoint({ lat, lng });
      const patch: Record<string, unknown> = {
        primaryZoneId: zone?.id ?? null,
        primaryZoneName: zone?.name ?? null,
        // Outside every zone: keep the closest one so ops can see demand
        // building where Kada does not deliver yet.
        nearestZoneName: zone ? null : (nearest?.[0]?.name ?? null),
        nearestZoneKm: zone || !nearest?.[0] ? null : Math.round(nearest[0].distanceKm),
        primaryZoneResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await after.ref.set(patch, { merge: true });
    } catch (err) {
      logger.error("onCustomerProfileLocationChanged failed", {
        uid: event.params.uid,
        err: (err as Error)?.message,
      });
    }
  },
);
