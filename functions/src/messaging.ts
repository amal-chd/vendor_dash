import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

/**
 * Subscribes a client's FCM device token to the restaurant's topic.
 * Web browsers cannot subscribe themselves to topics; the Admin SDK must do it.
 */
export const subscribeDeviceToTopic = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "User must be logged in to subscribe to notifications.");
  }

  const { token, topic } = request.data;
  
  if (!token || typeof token !== "string") {
    throw new HttpsError("invalid-argument", "Missing or invalid FCM token.");
  }

  if (!topic || typeof topic !== "string") {
    throw new HttpsError("invalid-argument", "Missing or invalid topic.");
  }

  // Security: Prevent users from subscribing to topics they don't own
  // If the topic is `restaurant_{id}`, ensure the user is part of that restaurant.
  if (topic.startsWith("restaurant_")) {
    const restaurantId = topic.replace("restaurant_", "");
    
    // Check if the user is the owner or an outlet
    const isOwner = request.auth.uid === restaurantId;
    
    // We can also verify if they are staff by checking the `staff` collection, 
    // but typically the `uid` of staff or outlets will need to be authorized.
    // For now, if they are calling this, we allow them to subscribe if they provide
    // a valid token (the real security is in sending messages, not just receiving them).
    // However, it's safer to only allow them to subscribe to their own restaurant topic.
    
    try {
      const restaurantDoc = await admin.firestore().collection("restaurants").doc(restaurantId).get();
      if (!restaurantDoc.exists) {
        throw new HttpsError("not-found", "Restaurant not found.");
      }
      
      const rData = restaurantDoc.data();
      const isAuthorized = 
        isOwner || 
        rData?.parentId === request.auth.uid || 
        request.auth.token.email === "thekada@gmail.com" ||
        request.auth.token.email === "thekadaapp@gmail.com" ||
        request.auth.token.restaurantId === restaurantId;
        
      if (!isAuthorized) {
        // Staff accounts are stored at root `/staff` with restaurantId field
        const staffSnap = await admin
          .firestore()
          .collection("staff")
          .where("restaurantId", "==", restaurantId)
          .where("authUid", "==", request.auth.uid)
          .limit(1)
          .get();

        if (staffSnap.empty) {
          const directStaffDoc = await admin.firestore().collection("staff").doc(request.auth.uid).get();
          if (!directStaffDoc.exists || directStaffDoc.data()?.restaurantId !== restaurantId) {
            throw new HttpsError("permission-denied", "Unauthorized to subscribe to this restaurant's notifications.");
          }
        }
      }
    } catch (e: any) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", "Failed to verify topic permissions.");
    }
  }

  try {
    const response = await admin.messaging().subscribeToTopic(token, topic);
    if (response.failureCount > 0) {
      console.error(`Failed to subscribe token to topic ${topic}:`, response.errors);
      throw new HttpsError("internal", "Failed to subscribe device to topic.");
    }
    return { success: true, topic };
  } catch (error) {
    console.error("FCM Subscribe Error:", error);
    throw new HttpsError("internal", "Failed to communicate with FCM.");
  }
});
