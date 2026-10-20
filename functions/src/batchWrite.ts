import * as admin from "firebase-admin";

/**
 * Firestore rejects a batch with more than 500 writes.
 *
 * The dangerous shape is a cron that batches an unlimited query result: it
 * works for months on small data, then one day the collection crosses the
 * limit and the commit is rejected — so NOTHING is written, not even the first
 * 500. The job fails whole, and a cron that throws is indistinguishable from a
 * cron with nothing to do, so nobody finds out until someone asks why
 * subscriptions stopped expiring.
 *
 * Chunking keeps each commit legal and makes partial progress durable: if the
 * tenth chunk fails, the first nine are already written and the next run picks
 * up the rest (these sweeps are written to be re-runnable).
 */

/** Firestore's hard ceiling, with headroom. */
const MAX_WRITES_PER_BATCH = 450;

/**
 * @param writesPerDoc how many writes `mutate` performs per document. The chunk
 *   is sized in WRITES, not documents: a caller that also mirrors each row into
 *   an audit log does two writes per document, so 400 documents would be 800
 *   writes and would be rejected just the same.
 */
export async function commitInChunks<T>(
  docs: T[],
  mutate: (batch: admin.firestore.WriteBatch, doc: T) => void,
  writesPerDoc = 1,
): Promise<number> {
  const db = admin.firestore();
  const chunkSize = Math.max(1, Math.floor(MAX_WRITES_PER_BATCH / Math.max(1, writesPerDoc)));
  let written = 0;

  for (let i = 0; i < docs.length; i += chunkSize) {
    const slice = docs.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const doc of slice) mutate(batch, doc);
    await batch.commit();
    written += slice.length;
  }

  return written;
}
