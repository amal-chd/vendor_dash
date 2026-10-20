/**
 * Audience/segment resolution
 */
import { getFirestore } from "firebase-admin/firestore";
import { NotificationSegment, EntityType } from "./types";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

/**
 * Evaluates a segment and returns the matching user IDs.
 */
export async function evaluateSegment(segment: NotificationSegment): Promise<string[]> {
  try {
    const collectionName = getCollectionForEntity(segment.entityType);
    if (!collectionName) {
      throw new Error(`Invalid entity type for segment: ${segment.entityType}`);
    }

    let query: FirebaseFirestore.Query = db.collection(collectionName);

    // Apply conditions
    for (const condition of segment.conditions) {
       // In a real implementation, you'd parse string dates like '30_days_ago' into Timestamps
       query = query.where(condition.field, condition.operator as any, condition.value);
    }

    // Handle pagination for large audiences if needed (simplified here)
    const snapshot = await query.get();
    
    return snapshot.docs.map(doc => doc.id);
  } catch (error) {
    logger.error(`Error evaluating segment ${segment.id}:`, error);
    return [];
  }
}

/**
 * Gets an estimated count of users in a segment.
 */
export async function getSegmentCount(segment: NotificationSegment): Promise<number> {
   try {
    const collectionName = getCollectionForEntity(segment.entityType);
    if (!collectionName) {
      return 0;
    }

    let query: FirebaseFirestore.Query = db.collection(collectionName);

    for (const condition of segment.conditions) {
       query = query.where(condition.field, condition.operator as any, condition.value);
    }
    
    const countQuery = query.count();
    const snapshot = await countQuery.get();
    
    return snapshot.data().count;
  } catch (error) {
    logger.error(`Error getting segment count for ${segment.id}:`, error);
    return 0;
  }
}

function getCollectionForEntity(entityType: EntityType): string | null {
  switch (entityType) {
    case 'customer': return 'customer_users';
    case 'vendor': return 'restaurants'; // Assuming restaurants acts as vendors
    case 'rider': return 'delivery_users';
    case 'host': return 'communicationProfiles'; // Adjust based on actual data model
    case 'admin': return 'communicationProfiles';
    default: return null;
  }
}
