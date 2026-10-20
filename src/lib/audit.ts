import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

/**
 * Audit trail (spec §37). Every sensitive admin action should record who did
 * what, when, to which entity, and the before/after + reason. Events are written
 * to `audit_events`, which rules make append-only (create allowed, update/delete
 * denied) so the trail is immutable.
 */
export interface AuditInput {
  action: string; // machine key, e.g. "REFUND_ISSUED", "VENDOR_SUSPENDED"
  entity?: string; // "order" | "vendor" | "rider" | "settlement" | …
  entityId?: string;
  description?: string; // human-readable summary
  before?: unknown;
  after?: unknown;
  reason?: string;
  approvedBy?: string;
  details?: unknown;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const u = auth.currentUser;
    await addDoc(collection(db, "audit_events"), {
      ...input,
      actorUid: u?.uid ?? null,
      actorEmail: u?.email ?? null,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    // Non-fatal — never let an audit write break the action it records; surface
    // for observability instead.
    console.error("writeAudit failed", e);
  }
}
