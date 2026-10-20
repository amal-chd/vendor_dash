import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import { enforceRateLimit } from "./rateLimit";
import { HOT_PATH } from "./options";
import { getRestaurantLocalDetails, getRestaurantDayRangeUtc, formatMoney, _getCurrencyCode, getTimezoneOffset } from "./utils";

export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// Ensure to call `.value()` when using the secret inside the function execution
// const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

export const generateMenuFromPromptOrImage = onCall(
  { secrets: [GEMINI_API_KEY] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new Error("unauthenticated");
    }

    const { prompt, base64Image, mimeType } = request.data;
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    const systemInstruction = `Extract menu items from the prompt or image. Return a JSON array only.
Format:
[{"name":"string","price":number,"category":"string","isVeg":boolean,"desc":"string|null","spiceLevel":"none|mild|medium|hot|extra-hot|null","variants":[{"name":"string","price":number}]|null,"addons":[{"name":"string","price":number}]|null}]
- category from: Starters, Soups, Salads, Main Course, Breads, Rice & Biryani, Noodles & Pasta, Seafood, Grill & BBQ, Combos, Sides, Beverages, Desserts.
- price: INR rupees (no symbols). Use the primary size (Full or base portion) price as the base "price".
- isVeg: detect from green/red square symbols or dish name.

### PRICING INTELLIGENCE & SCALING RULES FOR VARIANTS/SIZES:
If an item has multiple sizes (Half/Full, Quarter/Half/Full, S/M/L) or portions/combos/family packs:
1. Estimate prices intelligently based on the base price. Never use random or inconsistent pricing.
2. Variant Math scaling (using base Full/primary version price as 100%):
   - Quarter Portion: 30% to 35% of Full price (round to nearest ₹5 or ₹10).
   - Half Portion: 55% to 60% of Full price (round to nearest ₹5 or ₹10).
   - Three-Quarter Portion: 75% to 80% of Full price.
   - Combo / Meal Variant: 1.4x to 1.5x of the base item price (e.g. adding standard drink/fries).
   - Family Pack: 1.8x to 1.9x of the base item price.
   - S/M/L Portions: If Medium is base, Small is 75-80% of Medium, Large is 125-135% of Medium.
3. Examples: If Full price is ₹400, Half is ₹220-₹240, Quarter is ₹120-₹140.

### STANDARDIZED ADD-ON & EXTRAS PRICING RULES:
For commonly used add-ons and extras, ALWAYS use fixed, standardized pricing ranges instead of arbitrary AI-generated values:
- Extra Cheese / Cheese Slice / Cheese Dip: ₹20 to ₹40.
- Extra Mayo / Garlic Paste / Dips / Sauces: ₹10 to ₹20.
- Roti / Kuboos / Extra Bread / Paratha / Bhatura: ₹10 to ₹30.
- Extra Egg / Egg addition: ₹15 to ₹20.
- Extra Chicken / Mutton / Meat topping / Patty: ₹60 to ₹100.
- Ice Cream / Extra Scoop: ₹30 to ₹50.
- French Fries / Salad (Add-on size): ₹50 to ₹80.
- Gravy / Salna / Curry: ₹20 to ₹40.
For other custom extras, price strictly between ₹15 and ₹100 depending on value.

- IMPORTANT: Create the menu strictly like a normal professional person would. NEVER generate fancy, emotional, luxury, branded, promotional, exaggerated, or decorative food names. NEVER add words like "Special", "Royal", "King", "Premium", "Ultimate", "Classic", "Signature", "Authentic", "Fiery", "Garden", "Creamy", "Crispy", "Spiced", "Flame", "Smoky", "Smooky" unless explicitly present in the original menu. Keep names direct, clean, and POS-friendly.
- Do not wrap the JSON output in markdown block.
`;

    const contents: any[] = [];
    if (base64Image && mimeType) {
      contents.push({
        inlineData: {
          data: base64Image,
          mimeType,
        },
      });
    }
    
    if (prompt) {
      contents.push({ text: prompt });
    } else {
      contents.push({ text: "Extract menu items from this image." });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    try {
      const text = response.text;
      return { result: text ? JSON.parse(text) : [] };
    } catch (err: any) {
      console.error("Failed to parse Gemini response", err);
      throw new Error("Failed to parse AI response: " + err.message);
    }
  }
);

export const optimizeMenuItem = onCall(
  { secrets: [GEMINI_API_KEY] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new Error("unauthenticated");
    }

    const { name, currentDesc, category, ingredients, restaurantId, price, variants, addons } = request.data;
    if (!name) throw new Error("Missing item name");

    const basePrice = Number(price) || 0;
    const existingVariants = Array.isArray(variants) ? variants : [];
    const existingAddons = Array.isArray(addons) ? addons : [];

    let menuContext = "No existing menu available.";
    if (restaurantId) {
      try {
        const menuSnap = await admin.firestore()
          .collection("menu")
          .where("restaurantId", "==", restaurantId)
          .limit(100)
          .get();
          
        if (!menuSnap.empty) {
          const names = menuSnap.docs.map(d => {
            const data = d.data();
            const vList = (data.variants || []).map((v: any) => v.name).join(", ");
            const aList = (data.addons || []).map((a: any) => a.name).join(", ");
            return `${data.name} (Variants: ${vList || 'none'}, Addons: ${aList || 'none'})`;
          });
          menuContext = names.join("\\n");
        }
      } catch (err) {
        console.error("Failed to fetch menu context", err);
      }
    }
    
    console.log(`[AI Optimize] Context for ${name}:`, menuContext);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    const prompt = `Optimize the following menu item for a restaurant menu.
Name: ${name}
Base Price: ${basePrice || "None provided"}
Current Description: ${currentDesc || "None"}
Category: ${category || "Unknown"}
Ingredients: ${ingredients || "Unknown"}
Existing Variants: ${JSON.stringify(existingVariants)}
Existing Addons: ${JSON.stringify(existingAddons)}

Existing Menu Context (use this to infer common variants and addons for this restaurant):
${menuContext}

Based on the item details and existing menu context, optimize the item and output its parameters.

### CRITICAL PRICING INTELLIGENCE, SCALING & HEURISTICS RULES:
1. **Estimate & Scaling Math**: If the item has variants (like Half/Full, Quarter/Half/Full, S/M/L) or if variants are logical for it, calculate prices mathematically using the base price (treated as 100% / Full):
   - Quarter Portion: 30% to 35% of Full price (rounded to nearest ₹5 or ₹10).
   - Half Portion: 55% to 60% of Full price (rounded to nearest ₹5 or ₹10).
   - Three-Quarter Portion: 75% to 80% of Full price.
   - Combo / Meal Variant: 1.4x to 1.5x of base item price.
   - Family Pack: 1.8x to 1.9x of base item price.
   - S/M/L Portions: If Medium is base, Small is 75-80% of Medium, Large is 125-135% of Medium.
2. **Missing Variants Completion**: If this item is typically sold in multiple sizes (e.g. Alfahm, Tandoori Chicken, Shawarma, Kebab, Biryani, Indian Gravies) but only a single price is provided without variants, AUTOMATICALLY generate Quarter, Half, Full size variants using the base price as the reference.
3. **Standardized Add-on pricing**: If addons exist or are suggested, overwrite unstable AI prices with strict fixed bands:
   - Extra Cheese / Cheese Slice / Cheese Dip: ₹20 to ₹40.
   - Extra Mayo / Garlic Paste / Dips / Sauces: ₹10 to ₹20.
   - Roti / Kuboos / Extra Bread / Paratha / Bhatura: ₹10 to ₹30.
   - Extra Egg / Egg addition: ₹15 to ₹20.
   - Extra Chicken / Mutton / Meat topping / Patty: ₹60 to ₹100.
   - Ice Cream / Extra Scoop: ₹30 to ₹50.
   - French Fries / Salad (Add-on size): ₹50 to ₹80.
   - Gravy / Salna / Curry: ₹20 to ₹40.
   - For all other custom extras, price strictly between ₹15 and ₹100.
4. **Duplicate & Anomaly Check**:
   - Merge duplicate variants or addons case-insensitively (e.g., if there are multiple "Half" or "Cheese" entries).
   - Resolve conflicting prices (e.g. if Half is priced higher than Full, reverse or fix them strictly using the math guidelines above).
   - Flag and clean up abnormal pricing patterns.

IMPORTANT: NEVER generate fancy, emotional, luxury, branded, promotional, exaggerated, or decorative food names. NEVER add words like "Special", "Royal", "King", "Premium", "Ultimate", "Classic", "Signature", "Authentic", "Fiery", "Garden", "Creamy", "Crispy", "Spiced", "Flame", "Smoky", "Smooky" unless explicitly present in the original menu name. Keep names direct, clean, and POS-friendly.

Return a JSON object with the following fields:
{
  "optimizedName": "Direct standardized item name without fancy adjectives (max 40 chars)",
  "optimizedDescription": "A mouth-watering description (max 150 chars)",
  "isVeg": boolean,
  "allergens": ["list", "of", "allergens"],
  "dietaryTags": ["list", "of", "tags", "e.g., Gluten-Free"],
  "variants": [{"name": "Variant Name", "price": number}],
  "addons": [{"name": "Addon Name", "price": number}]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    try {
      const text = response.text;
      return { result: text ? JSON.parse(text) : null };
    } catch (err: any) {
      console.error("Failed to parse Gemini response", err);
      throw new Error("Failed to parse AI response: " + err.message);
    }
  }
);

export const analyzeDailyOperations = onSchedule(
  {
    schedule: "0 * * * *", // Run hourly
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 300, // Gemini might take a bit
  },
  async () => {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    // Fetch all active restaurants
    const restaurantsSnap = await admin.firestore().collection("restaurants").where("isActive", "==", true).get();

    const now = new Date();

    for (const rDoc of restaurantsSnap.docs) {
      const restaurantId = rDoc.id;
      const data = rDoc.data();

      // Check if AI insights are enabled for this restaurant
      if (data?.aiSettings?.enableInsights === false) {
        continue;
      }

      const timeZone = data?.timezone || "Asia/Kolkata";
      const { hour, dateString } = getRestaurantLocalDetails(now, timeZone);

      // Only execute at hour 2 (2:00 AM) local time
      if (hour !== 2) continue;

      // Prevent double insights run for the same date
      if (data?.lastDailyInsightsDate === dateString) continue;

      // Compute yesterday in restaurant's local timezone
      const localNow = new Date(now.getTime() + getTimezoneOffset(timeZone, now));
      const yesterday = new Date(localNow);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const yyyy = yesterday.getUTCFullYear();
      const mm = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(yesterday.getUTCDate()).padStart(2, "0");
      const yesterdayDateString = `${yyyy}-${mm}-${dd}`;

      try {
        const { startUtc, endUtc } = getRestaurantDayRangeUtc(yesterdayDateString, timeZone);

        // Fetch yesterday's orders
        const ordersSnap = await admin
          .firestore()
          .collection("orders")
          .where("restaurantId", "==", restaurantId)
          .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(startUtc))
          .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(endUtc))
          .get();

        const orders = ordersSnap.docs.map((d) => d.data());
        
        // Basic aggregation to feed the prompt
        let totalRevenue = 0;
        const totalOrders = orders.length;
        const itemCounts: Record<string, number> = {};
        
        orders.forEach((o) => {
          if (o.status !== "cancelled") {
            totalRevenue += Number(o.total || o.totalAmount || 0);
            const items = Array.isArray(o.items) ? o.items : [];
            items.forEach((it: any) => {
               const name = (it?.name ?? it?.title ?? "Unknown").toString();
               const qty = Number(it?.quantity ?? it?.qty ?? 1);
               itemCounts[name] = (itemCounts[name] || 0) + qty;
            });
          }
        });

        const topItems = Object.entries(itemCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, qty]) => `${name}: ${qty} sold`)
          .join(", ");

        const worstItems = Object.entries(itemCounts)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 3)
          .map(([name, qty]) => `${name}: ${qty} sold`)
          .join(", ");

        if (totalOrders === 0) continue; // Not enough data

        const currencyCode = data?.currencyCode || (data?.currency ? _getCurrencyCode(data.currency) : "INR");
        const formattedRevenue = formatMoney(totalRevenue, currencyCode);

        const prompt = `Analyze the daily operational data for a restaurant.
Date: ${yesterdayDateString}
Total Orders: ${totalOrders}
Total Revenue: ${formattedRevenue}
Top Selling Items: ${topItems}
Lowest Selling Items: ${worstItems}

Provide 3 concise, actionable AI insights (max 100 chars each) for the restaurant owner to improve revenue, optimize the menu, or improve operations.
Format as JSON:
{"insights": [{"title": "Short title", "description": "Actionable insight", "type": "menu_engineering|pricing|stock", "actionableItem": "Name of item (optional)"}]}
`;
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
             temperature: 0.2,
             responseMimeType: "application/json",
          }
        });

        const resText = response.text;
        const parsed = resText ? JSON.parse(resText) : null;

        if (parsed && Array.isArray(parsed.insights)) {
           const batch = admin.firestore().batch();
           parsed.insights.forEach((insight: any) => {
              const docRef = admin.firestore().collection("restaurants").doc(restaurantId).collection("ai_insights").doc();
              batch.set(docRef, {
                 ...insight,
                 createdAt: admin.firestore.FieldValue.serverTimestamp(),
                 isRead: false
              });
           });
            await batch.commit();
            // Update the last processed daily insights date
            await admin.firestore().collection("restaurants").doc(restaurantId).update({
               lastDailyInsightsDate: dateString
            });
         }
      } catch (err) {
        console.error("Failed to generate AI insight for restaurant", restaurantId, err);
      }
    }
  }
);

export const getAiRecommendations = onCall(
  { ...HOT_PATH, secrets: [GEMINI_API_KEY] },
  async (request) => {
    // Allows public access for QR menu, but requires a restaurantId
    const { restaurantId, cartItems } = request.data;
    if (!restaurantId) throw new Error("Missing restaurantId");
    // Public (QR menu, no sign-in) and every call is a Gemini request: bound it
    // per network address and per restaurant so it can't be looped for cost.
    const ip = String(request.rawRequest?.ip ?? "unknown");
    await enforceRateLimit(`ai_reco_ip_${ip}`, 30, 10 * 60_000);
    await enforceRateLimit(`ai_reco_restaurant_${String(restaurantId)}`, 600, 60 * 60_000);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    // Fetch popular items from public_analytics to give Gemini context
    let popularContext = "";
    try {
      const popDoc = await admin.firestore().collection("restaurants").doc(restaurantId).collection("public_analytics").doc("popular").get();
      if (popDoc.exists) {
        const popData = popDoc.data();
        if (popData && Array.isArray(popData.items)) {
          popularContext = "Popular Items:\n" + popData.items.map((it: any) => `- ${it.name}`).join("\n");
        }
      }
    } catch(e) {
       console.error("Failed to fetch popular context", e);
    }

    const cartContext = Array.isArray(cartItems) 
      ? cartItems.map((it: any) => `${it.name || "Unknown item"} (Qty: ${it.quantity || 1})`).join(", ")
      : "Empty cart";

    const prompt = `You are an AI recommendation engine for a restaurant.
The customer has the following items in their cart:
${cartContext}

${popularContext}

Suggest 3 items that pair well with the customer's cart or are popular upsells. 
Return ONLY a JSON array of strings (item names): ["Item 1", "Item 2", "Item 3"]`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    try {
      const text = response.text;
      return { recommendations: text ? JSON.parse(text) : [] };
    } catch (err: any) {
      console.error("Failed to parse Gemini response", err);
      return { recommendations: [] };
    }
  }
);

export const generateRecipe = onCall(
  { secrets: [GEMINI_API_KEY] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in to generate a recipe.");
    }

    const { menuItemName, inventoryItems } = request.data ?? {};
    if (!menuItemName) throw new HttpsError("invalid-argument", "Choose a menu item first.");

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    const inventoryList = Array.isArray(inventoryItems) && inventoryItems.length > 0
      ? inventoryItems.join(", ")
      : "No existing inventory items provided.";

    const prompt = `You are a professional chef. Create a recipe for the menu item: "${menuItemName}".
Available existing inventory items: ${inventoryList}

Your goal is to map the ingredients primarily to the "Available existing inventory items" if there is a match (e.g. if the recipe needs "salt" and the inventory has "Salt (1kg)", use "Salt (1kg)"). If an ingredient is absolutely required but not in the inventory, you can invent a simple name for it.

Provide realistic quantities for a SINGLE serving of this dish.
Use standard units (e.g., "g", "ml", "pcs", "tsp", "tbsp").

Return ONLY a JSON array of objects with the exact keys:
[
  {
    "inventoryItemName": "Name of the ingredient",
    "quantity": 100,
    "unit": "g"
  }
]`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    try {
      const text = response.text;
      return { result: text ? JSON.parse(text) : [] };
    } catch (err: any) {
      console.error("Failed to parse Gemini recipe response", err);
      throw new Error("Failed to parse AI response: " + err.message);
    }
  }
);

export const smartAiSearch = onCall(
  { ...HOT_PATH, secrets: [GEMINI_API_KEY] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new Error("unauthenticated");
    }
    await enforceRateLimit(`ai_search_${request.auth.uid}`, 20, 10 * 60_000);

    const prompt = (request.data.prompt || "").toString();
    const localHour = Number(request.data.localHour);
    const hasHour = Number.isFinite(localHour) && localHour >= 0 && localHour <= 23;
    const mealContext = hasHour
      ? localHour < 11
        ? "It is morning — lean toward breakfast, coffee, light bites."
        : localHour < 16
          ? "It is around lunchtime — everyday meals, thalis, quick bites."
          : localHour < 21
            ? "It is evening/dinner time — mains, family meals, biryani, grills."
            : "It is late night — snacks, desserts, comfort food, places open now."
      : "";
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    const systemInstruction = `You are "Kada AI", the culinary concierge for The Kada, a food-delivery app in Kerala, India (currency ₹). A customer describes a craving, mood, occasion, budget or dish in natural language (any language, including Malayalam/Hindi transliterations and common misspellings).
${mealContext}

Interpret intent generously:
- Occasions/moods: "party"/"for 6" → shareable/family packs; "date night" → premium; "hangover"/"comfort" → hearty/spicy; "quick office lunch" → fast everyday meals; "healthy"/"light" → salads, veg bowls.
- Correct obvious misspellings in searchQuery to the canonical dish name (e.g. "biriyani"/"briyani" → "biryani", "shwarma" → "shawarma", "panner" → "paneer", "coffe" → "coffee").
- "surprise me" → pick one appealing popular dish for the current meal time; put it in searchQuery.

Return ONLY a strict JSON object (no markdown) with these exact keys:
{
  "cuisine": string (broad category e.g. "pizza","burger","biryani","chinese","dessert","south indian","arabian", or ""),
  "isVeg": boolean (true only if they ask for veg/vegetarian/vegan),
  "isTopRated": boolean (true if they ask for best/top/highly-rated/good),
  "maxPrice": number (default 9999; "cheap"/"budget" → 300; "under N" → N),
  "searchQuery": string (canonical dish/keyword; corrected spelling; empty if cuisine already covers it),
  "aiMessage": string (warm, 1 sentence, references what you understood, e.g. "Great pick — here are top-rated biryanis near you!")
}`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      });

      const text = response.text || "{}";
      return JSON.parse(text);
    } catch (err: any) {
      console.error("Failed to process AI Smart Search", err);
      // Fallback mock if Gemini fails
      return {
        cuisine: "",
        isVeg: false,
        isTopRated: false,
        maxPrice: 9999,
        searchQuery: prompt,
        aiMessage: "Here is what I found for you!"
      };
    }
  }
);
