import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import * as crypto from "crypto";

// Generic webhook handler for Zomato and Swiggy
export const aggregatorWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const platform = (req.query.platform as string)?.toLowerCase();
  const uid = req.query.uid as string;

  if (!platform || !uid) {
    res.status(400).send("Missing platform or uid query parameters");
    return;
  }

  const supportedPlatforms = [
    "zomato", "swiggy", "ubereats", "doordash", "deliveroo", "grab", "foodpanda", "talabat"
  ];

  if (!supportedPlatforms.includes(platform)) {
    res.status(400).send("Unsupported platform");
    return;
  }

  try {
    const db = admin.firestore();

    // 1. Fetch integration settings to verify API Key (Webhook Secret)
    const settingsDoc = await db.collection("restaurants").doc(uid).collection("settings").doc("integrations").get();
    
    if (!settingsDoc.exists) {
      res.status(403).send("Integrations not configured");
      return;
    }

    const integrations = settingsDoc.data() || {};
    const platformConfig = integrations[platform] || {};

    if (!platformConfig.enabled) {
      res.status(403).send(`${platform} integration is currently disabled.`);
      return;
    }

    // Mandatory: Webhook secret validation and HMAC signature check
    // Zomato usually sends it as X-Zomato-Signature, Swiggy as X-Swiggy-Signature
    const secret = platformConfig.apiKey || platformConfig.webhookSecret;
    if (!secret) {
      res.status(403).send(`Webhook secret not configured for ${platform}.`);
      return;
    }

    const providedSignature = (req.headers["x-zomato-signature"] || req.headers["x-swiggy-signature"] || req.headers["authorization"] || "") as string;
    if (!providedSignature) {
      res.status(401).send("Missing webhook signature header.");
      return;
    }

    // Compute HMAC-SHA256 of the request body
    const rawBody = typeof req.rawBody === "string" ? req.rawBody : (req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body || {}));
    const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    // Perform verification (allowing direct secret match or HMAC hex match)
    const isDirectMatch = providedSignature === secret;
    const isHmacMatch = providedSignature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature));

    if (!isDirectMatch && !isHmacMatch) {
      console.warn(`[Security] Unauthorized webhook attempt for ${platform} on restaurant ${uid}. Signature mismatch.`);
      res.status(401).send("Unauthorized: Webhook signature verification failed.");
      return;
    }

    // 2. Parse the payload
    const payload = req.body;
    if (!payload) {
      res.status(400).send("Empty payload");
      return;
    }

    // Idempotency / Deduplication Check
    const externalOrderId = payload.orderId?.toString() || payload.order_id?.toString() || payload.id?.toString();
    if (externalOrderId) {
      const dedupeRef = db.collection("restaurants").doc(uid).collection("webhook_logs").doc(`dedupe_${platform}_${externalOrderId}`);
      const dedupeDoc = await dedupeRef.get();
      if (dedupeDoc.exists) {
        res.status(200).json({ success: true, message: "Idempotent acknowledgment: Order already processed.", duplicate: true });
        return;
      }
      await dedupeRef.set({
        platform,
        externalOrderId,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 3. Normalize Order Data
    // Aggregators have wildly different payload structures. 
    // We map them to our internal standard format.
    
    let orderNumber = `EXT-${Date.now().toString().slice(-4)}`;
    let customerName = "Delivery Customer";
    let customerPhone = "";
    let total = 0;
    let items: any[] = [];
    let instructions = "";
    let deliveryAddressText = "";

    if (platform === "zomato") {
      // Zomato mapping
      orderNumber = payload.orderId?.toString() || payload.order_id?.toString() || orderNumber;
      customerName = payload.customer?.name || "Zomato Customer";
      customerPhone = payload.customer?.phone || "";
      total = Number(payload.order_total || payload.total || 0);
      instructions = payload.special_instructions || "";
      deliveryAddressText = payload.delivery_details?.address || "";
      
      const rawItems = payload.order_items || payload.items || [];
      items = rawItems.map((item: any) => ({
        name: item.name || "Item",
        qty: Number(item.quantity || 1),
        price: Number(item.price || item.unit_price || 0),
        instructions: item.remarks || "",
        done: false,
      }));
    } else if (platform === "swiggy") {
      // Swiggy mapping
      orderNumber = payload.order_id?.toString() || orderNumber;
      customerName = payload.customer_name || "Swiggy Customer";
      customerPhone = payload.customer_phone || "";
      total = Number(payload.bill_details?.total_amount || payload.total || 0);
      instructions = payload.comments || "";
      deliveryAddressText = payload.delivery_address?.flat_no || payload.delivery_address?.area || "";

      const rawItems = payload.cart?.items || payload.items || [];
      items = rawItems.map((item: any) => ({
        name: item.item_name || item.name || "Item",
        qty: Number(item.quantity || 1),
        price: Number(item.price || item.unit_price || 0),
        instructions: item.customizations || "",
        done: false,
      }));
    } else {
      // Generic mapping for Uber Eats, DoorDash, Deliveroo, Grab, Foodpanda, Talabat
      orderNumber = payload.id?.toString() || payload.orderId?.toString() || payload.order_id?.toString() || payload.displayId?.toString() || orderNumber;
      
      const customer = payload.customer || payload.eater || payload.consumer || {};
      customerName = customer.name || customer.firstName || `${platform.charAt(0).toUpperCase() + platform.slice(1)} Customer`;
      customerPhone = customer.phone || customer.phoneNumber || payload.phone || "";
      
      total = Number(payload.total || payload.total_value || payload.totalAmount || payload.price?.total || 0);
      // Fallback: If price is in cents, convert. Most standard payloads just send the total.
      if (total > 10000 && platform === "ubereats") total = total / 100; 

      instructions = payload.special_instructions || payload.notes || payload.comments || "";
      deliveryAddressText = payload.delivery_address || payload.destination?.address || "";

      const rawItems = payload.items || payload.cart?.items || payload.orderItems || [];
      items = rawItems.map((item: any) => ({
        name: item.name || item.title || item.item_name || "Item",
        qty: Number(item.quantity || item.count || 1),
        price: Number(item.price || item.unit_price || 0),
        instructions: item.special_instructions || item.notes || item.customizations || "",
        done: false,
      }));
    }

    // 4. Save to Firestore
    const orderData = {
      restaurantId: uid,
      orderNumber: `${platform.toUpperCase().charAt(0)}-${orderNumber}`,
      customerName,
      customerPhone,
      table: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Delivery`,
      total,
      status: "new",
      type: "delivery",
      paymentStatus: "paid", // Aggregator orders are usually prepaid
      paymentMethod: platform,
      source: platform, // zomato or swiggy
      channel: platform,
      items,
      instructions,
      deliveryAddressText,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection("orders").add(orderData);

    // 5. Respond OK to acknowledge receipt
    res.status(200).json({ success: true, message: "Order processed", internal_id: docRef.id });

  } catch (error) {
    console.error(`Error processing ${platform} webhook:`, error);
    res.status(500).send("Internal Server Error");
  }
});
