import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { AggregateField } from "firebase-admin/firestore";

/**
 * Maintains the denormalized rating aggregate (`ratingAvg`, `ratingCount`) on
 * each restaurant document whenever a customer review under
 * `restaurants/{restaurantId}/reviews/{reviewId}` is created, updated, or
 * deleted. The customer app reads these fields on home/search cards so it never
 * has to scan the reviews subcollection per card. The restaurant detail screen
 * additionally computes a live average from the loaded reviews, so ratings are
 * correct even before this trigger has run.
 */
export const onReviewWritten = onDocumentWritten(
  "restaurants/{restaurantId}/reviews/{reviewId}",
  async (event) => {
    const restaurantId = event.params.restaurantId as string;
    const db = admin.firestore();
    const reviewsRef = db
      .collection("restaurants")
      .doc(restaurantId)
      .collection("reviews");

    try {
      const agg = await reviewsRef
        .aggregate({
          count: AggregateField.count(),
          avg: AggregateField.average("rating"),
        })
        .get();

      const count = agg.data().count ?? 0;
      const avg = agg.data().avg;

      // `set({merge:true})` CREATES the parent when it doesn't exist, so a
      // review left behind by a deleted restaurant resurrected it as a nameless
      // doc — which the customer app then listed as a ghost restaurant with no
      // menu. `update` fails instead, which is the correct outcome: there is no
      // restaurant to keep an aggregate for.
      try {
        await db.collection("restaurants").doc(restaurantId).update({
          ratingCount: count,
          ratingAvg: count > 0 && avg != null ? Math.round(avg * 10) / 10 : null,
        });
      } catch (e) {
        if ((e as { code?: number | string })?.code === 5 ||
            /NOT_FOUND|No document to update/i.test(String((e as Error)?.message))) {
          console.warn(
            `onReviewWritten: restaurant ${restaurantId} no longer exists; leaving its reviews alone`,
          );
          return;
        }
        throw e;
      }
    } catch (e) {
      console.error(`onReviewWritten aggregate failed for ${restaurantId}`, e);
    }
  }
);
