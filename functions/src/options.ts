import { setGlobalOptions } from "firebase-functions/v2";

/**
 * Where every function runs. It has to match the Firestore database's
 * location: Firestore triggers can only run next to the database, and a
 * function far from its data pays an ocean round trip per read.
 *
 * Flipped to asia-south1 (Mumbai) at the 2026-10-01 cutover, along with
 * kFunctionsRegion in the four apps and the two web clients. NOTE: the
 * Firestore (default) database is still in nam5, so functions currently pay a
 * transpacific round trip per read — finish the database move, or move these
 * back, but do not leave them split.
 */
export const FUNCTIONS_REGION = "asia-south1";

// Bound every function's scaling so the summed Cloud Run CPU reservation stays
// under the asia-south1 "total allowable CPU per project per region" quota,
// which counts max instances × vCPU across ~110 functions. This module is
// imported FIRST in index.ts so the options apply to functions defined in the
// re-exported modules (ES modules evaluate imports in source order).
//
// Long tail (admin, crons, onboarding, campaigns, triggers): one instance, one
// request each. Cloud Run requires concurrency: 1 when CPU < 1.
//
// Dropped 0.5 -> 0.25 on 2026-10-13, because 0.5 did not fit. The quota counts
// cpu x maxInstances summed over EVERY service, whether or not it is serving.
// Measured that day: 212 services reserving 164.5 vCPU against a ceiling of
// about 139.5. The excess does not degrade gracefully — the region refuses to
// start the revisions that do not fit, and which ones lose is arbitrary. Over a
// day it took down, among others, createRazorpayOrder, verifyRazorpayPayment,
// vendorTransitionOrder and adminPlatformAction: no checkout, no payment
// capture, no way for a restaurant to accept an order.
//
// At 0.25 the same 212 services reserve 98.2 vCPU, leaving ~40 of headroom —
// which matters because a deploy briefly holds BOTH the old and new revision,
// so a fully-packed region cannot even deploy its way out of trouble.
//
// HOT_PATH below keeps a full vCPU; this only shrinks the long tail, which was
// at zero while it did not fit, so a quarter-vCPU cold start is strictly better
// than not running. Raising the regional quota would let both go back up.
setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 1, cpu: 0.25, concurrency: 1 });

/**
 * The critical path customers, riders and restaurants wait on during a rush:
 * checkout pricing, order placement, payments and wallet, cancellation, order
 * status, delivery stages, Stay search/quote/booking, the payment webhook.
 *
 * At the default above each of these served at most 2 requests at a time, so
 * a burst of users queued and then failed. Here: two 1-vCPU instances taking
 * 40 requests each = 80 in flight per endpoint (handlers mostly await
 * Firestore/HTTP, which Node interleaves), for 2 vCPU of quota — about what
 * these functions reserved before at 0.5 vCPU × 3–10 instances.
 */
export const HOT_PATH = { cpu: 1, memory: "512MiB", concurrency: 40, maxInstances: 1 } as const;
