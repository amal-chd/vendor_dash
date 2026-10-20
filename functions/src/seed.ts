import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FOOD_STUDIO_PRESETS } from "./food_studio_presets";

/**
 * Demo data for The Kada — a premium, image-rich sample set clustered around
 * Edachira / Kakkanad (Kochi) so restaurants fall inside the customer app's
 * 7km discovery radius. Everything is flagged `isDemo: true` so a single admin
 * toggle can seed or wipe it. Each restaurant gets a DISTINCT, cuisine-matched
 * cover image, and every dish carries its own related food photo.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Standard base-32 geohash — must match the apps' GeoUtils.encode. */
function geohash(lat: number, lon: number, precision = 9): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let hash = "";
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  while (hash.length < precision) {
    if (evenBit) {
      const lonMid = (lonMin + lonMax) / 2;
      if (lon >= lonMid) { idx = idx * 2 + 1; lonMin = lonMid; }
      else { idx = idx * 2; lonMax = lonMid; }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) { idx = idx * 2 + 1; latMin = latMid; }
      else { idx = idx * 2; latMax = latMid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

// Stable Unsplash photos (hot-linkable, resized).
const IMG = (id: string, w = 800) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&auto=format&fit=crop&q=70`;

const FOOD: Record<string, string> = {
  biryani: IMG("1563379091339-03b21ab4a4f8"),
  biryaniPot: IMG("1642821373181-696a54913e93"),
  burger: IMG("1568901346375-23c9450c58cd"),
  pizza: IMG("1513104890138-7c749659a591"),
  shawarma: IMG("1615870216519-2f9fa575fa5c"),
  chicken: IMG("1626082927389-6cd097cee6a6"),
  fishCurry: IMG("1631292784640-2b24be784d5d"),
  grilledFish: IMG("1580476262798-bddd9f4b7369"),
  prawns: IMG("1625944230945-1b7dd3b949ab"),
  paneer: IMG("1631452180519-c014fe946bc7"),
  noodles: IMG("1585032226651-759b368d7246"),
  dosa: IMG("1630383249896-424e482df921"),
  meals: IMG("1567337710282-00832b415979"),
  parotta: IMG("1610192244261-3f33de3f55e4"),
  iceCream: IMG("1563805042-7684c019e1cb"),
  wrap: IMG("1626700051175-6818013e1d4f"),
  fries: IMG("1573080496219-bb080dd4f877"),
  juice: IMG("1600271886742-f049cd451bba"),
  coffee: IMG("1509042239860-f550ce710b93"),
  cake: IMG("1578985545062-69928b1d9587"),
  sandwich: IMG("1528735602780-2552fd46c7af"),
  pasta: IMG("1621996346565-e3dbc646d9a9"),
  salad: IMG("1512621776951-a57141f2eefd"),
  mojito: IMG("1551024709-8f23befc6f87"),
  steak: IMG("1546964124-0cce460f38ef"),
  tikka: IMG("1599487488170-d11ec9c172f0"),
  
  // -- NEW PRODUCT IMAGES --
  momo: IMG("1625220194771-7ebdea0b70b9"),
  sushi: IMG("1579871494447-08e1fc560839"),
  tacos: IMG("1565299585323-38d6b0865b47"),
  pancake: IMG("1506084868230-bb9d95c24759"),
  curry: IMG("1565557623262-b51c2513a641"),
  soup: IMG("1547592180-85f1dda482cd"),
  friedRice: IMG("1603133872878-684f208fb84b"),
  donut: IMG("1551024601-bec78aea704b"),
  croissant: IMG("1555507015-d6565f4c2810"),
  tea: IMG("1594631252845-5eab1ce8098c"),
  milkshake: IMG("1572490142747-398ba0fe9a85"),
  bbqRibs: IMG("1529193591184-b1d58069ecdd"),
  samosa: IMG("1601050690597-df0568f70950"),
  friedChicken: IMG("1626645738113-ac2354c5ee4c"),
  nachos: IMG("1513456852971-a5d9f750c950"),
};

// Distinct, cuisine-matched cover images per restaurant.
const COVER: Record<string, string> = {
  spice: IMG("1517248135467-4c7edcad34c4", 1000), // warm fine-dining hall
  biryaniHouse: IMG("1600891964092-4316c288032e", 1000), // rustic indian spread
  grill: IMG("1544025162-d76694265947", 1000), // grilled meats
  coastal: IMG("1559339352-11d035aa65de", 1000), // seafood restaurant
  marari: IMG("1414235077428-338989a2e8c0", 1000), // plated fine dining
  cafe: IMG("1554118811-1e0d58224f24", 1000), // cozy cafe
};

const INTERIOR = [
  IMG("1552566626-52f8b828add9", 1000),
  IMG("1517248135467-4c7edcad34c4", 1000),
  IMG("1466978913421-dad2ebd01d17", 1000),
  IMG("1592861956120-e524fc739696", 1000),
];

interface Dish {
  name: string;
  price: number;
  category: string;
  image: string;
  isVeg: boolean;
  recommended?: boolean;
  desc: string;
}

const keralaMenu = (d: number): Dish[] => [
  { name: "Chicken Dum Biryani", price: 220 + d, category: "Biryani", image: FOOD.biryani, isVeg: false, recommended: true, desc: "Slow-cooked long-grain rice layered with marinated chicken and warm spices." },
  { name: "Mutton Biryani", price: 300 + d, category: "Biryani", image: FOOD.biryaniPot, isVeg: false, desc: "Fragrant dum biryani with tender mutton and fried onions." },
  { name: "Kerala Beef Fry", price: 260 + d, category: "Main Course", image: FOOD.fishCurry, isVeg: false, desc: "Slow-roasted beef with coconut slivers, curry leaves and black pepper." },
  { name: "Classic Chicken Shawarma", price: 140 + d, category: "Rolls & Wraps", image: FOOD.shawarma, isVeg: false, recommended: true, desc: "Juicy grilled chicken, garlic mayo and pickles in a soft kuboos wrap." },
  { name: "Spicy Mutton Curry", price: 290 + d, category: "Main Course", image: FOOD.curry, isVeg: false, recommended: true, desc: "Rich and fiery mutton curry cooked with roasted coconut and spices." },
  { name: "Vegetable Samosa (2 pc)", price: 60 + d, category: "Snacks", image: FOOD.samosa, isVeg: true, desc: "Crispy pastry filled with spiced potatoes and peas." },
  { name: "Paneer Butter Masala", price: 200 + d, category: "Main Course", image: FOOD.paneer, isVeg: true, recommended: true, desc: "Cottage cheese in a rich, creamy tomato-cashew gravy." },
  { name: "Ghee Roast Dosa", price: 110 + d, category: "Breakfast", image: FOOD.dosa, isVeg: true, desc: "Crispy golden dosa roasted in ghee, with sambar & chutney." },
  { name: "Kerala Veg Meals", price: 130 + d, category: "Meals", image: FOOD.meals, isVeg: true, desc: "Rice with sambar, avial, thoran, pickle and payasam on a banana leaf." },
  { name: "Malabar Parotta (2 pc)", price: 40 + d, category: "Breads", image: FOOD.parotta, isVeg: true, desc: "Flaky, layered Malabar parotta — perfect with any curry." },
  { name: "Tender Coconut Ice Cream", price: 90 + d, category: "Desserts", image: FOOD.iceCream, isVeg: true, desc: "Creamy tender-coconut ice cream with real coconut bits." },
  { name: "Kada Special Tea", price: 30 + d, category: "Beverages", image: FOOD.tea, isVeg: true, desc: "Strong, cardamom-infused Indian milk tea." },
];

const grillMenu = (d: number): Dish[] => [
  { name: "Smoky BBQ Beef Burger", price: 240 + d, category: "Burgers", image: FOOD.burger, isVeg: false, recommended: true, desc: "Char-grilled patty, smoked cheese, caramelised onions." },
  { name: "Peri Peri Grilled Chicken", price: 320 + d, category: "Grill", image: FOOD.chicken, isVeg: false, recommended: true, desc: "Half chicken flame-grilled in fiery peri peri." },
  { name: "Crispy Fried Chicken (4 pc)", price: 280 + d, category: "Fried Chicken", image: FOOD.friedChicken, isVeg: false, recommended: true, desc: "Golden, crunchy fried chicken pieces served with garlic dip." },
  { name: "BBQ Pork Ribs", price: 450 + d, category: "Grill", image: FOOD.bbqRibs, isVeg: false, desc: "Slow-cooked ribs glazed in our signature sticky BBQ sauce." },
  { name: "Chicken Tikka Platter", price: 290 + d, category: "Starters", image: FOOD.tikka, isVeg: false, desc: "Char-grilled tikka with mint chutney and onion rings." },
  { name: "Loaded Cheese Fries", price: 160 + d, category: "Sides", image: FOOD.fries, isVeg: true, desc: "Crispy fries smothered in cheese sauce and jalapeños." },
  { name: "Cheesy Nachos Grande", price: 210 + d, category: "Sides", image: FOOD.nachos, isVeg: true, desc: "Tortilla chips loaded with melted cheese, jalapeños, and salsa." },
  { name: "Grilled Veg Wrap", price: 150 + d, category: "Rolls & Wraps", image: FOOD.wrap, isVeg: true, desc: "Grilled vegetables and hummus in a toasted tortilla." },
  { name: "Classic Margherita Pizza", price: 260 + d, category: "Pizza", image: FOOD.pizza, isVeg: true, recommended: true, desc: "Wood-fired base, San Marzano tomato and mozzarella." },
  { name: "Virgin Mojito", price: 120 + d, category: "Beverages", image: FOOD.mojito, isVeg: true, desc: "Muddled mint, lime and soda over crushed ice." },
  { name: "Thick Vanilla Milkshake", price: 150 + d, category: "Beverages", image: FOOD.milkshake, isVeg: true, desc: "Classic vanilla milkshake topped with whipped cream." },
  { name: "Chocolate Lava Cake", price: 140 + d, category: "Desserts", image: FOOD.cake, isVeg: true, desc: "Warm molten chocolate cake with vanilla ice cream." },
];

const cafeMenu = (d: number): Dish[] => [
  { name: "Signature Cold Brew", price: 180 + d, category: "Coffee", image: FOOD.coffee, isVeg: true, recommended: true, desc: "16-hour slow-steeped cold brew, smooth and bold." },
  { name: "Classic Cappuccino", price: 130 + d, category: "Coffee", image: FOOD.coffee, isVeg: true, desc: "Double shot with velvety steamed-milk foam." },
  { name: "Butter Croissant", price: 120 + d, category: "Pastries", image: FOOD.croissant, isVeg: true, recommended: true, desc: "Flaky, buttery, freshly baked French croissant." },
  { name: "Glazed Chocolate Donut", price: 90 + d, category: "Pastries", image: FOOD.donut, isVeg: true, desc: "Soft donut with rich chocolate glaze and sprinkles." },
  { name: "Fluffy Buttermilk Pancakes", price: 220 + d, category: "Breakfast", image: FOOD.pancake, isVeg: true, desc: "Stack of 3 pancakes with maple syrup and butter." },
  { name: "Grilled Chicken Sandwich", price: 210 + d, category: "Sandwiches", image: FOOD.sandwich, isVeg: false, recommended: true, desc: "Herb chicken, cheddar and greens in sourdough." },
  { name: "Alfredo Pasta", price: 260 + d, category: "Pasta", image: FOOD.pasta, isVeg: true, desc: "Creamy parmesan alfredo with garlic and herbs." },
  { name: "Garden Fresh Salad", price: 190 + d, category: "Healthy", image: FOOD.salad, isVeg: true, desc: "Seasonal greens, cherry tomato, feta and vinaigrette." },
  { name: "Belgian Waffle", price: 170 + d, category: "Desserts", image: FOOD.cake, isVeg: true, desc: "Crisp waffle with maple syrup and berries." },
  { name: "Fresh Orange Juice", price: 110 + d, category: "Beverages", image: FOOD.juice, isVeg: true, desc: "Cold-pressed, no sugar added." },
];

const coastalMenu = (d: number): Dish[] => [
  { name: "Karimeen Pollichathu", price: 340 + d, category: "Seafood", image: FOOD.grilledFish, isVeg: false, recommended: true, desc: "Pearl spot fish baked in banana leaf with Kerala masala." },
  { name: "Butter Garlic Prawns", price: 380 + d, category: "Seafood", image: FOOD.prawns, isVeg: false, recommended: true, desc: "Tiger prawns tossed in butter, garlic and pepper." },
  { name: "Fish Curry Meals", price: 200 + d, category: "Meals", image: FOOD.fishCurry, isVeg: false, desc: "Kerala-style fish curry with rice and sides." },
  { name: "Chilli Fish", price: 260 + d, category: "Chinese", image: FOOD.grilledFish, isVeg: false, desc: "Indo-Chinese crispy fish in spicy chilli sauce." },
  { name: "Veg Hakka Noodles", price: 150 + d, category: "Chinese", image: FOOD.noodles, isVeg: true, desc: "Wok-tossed noodles with fresh vegetables." },
  { name: "Chicken Fried Rice", price: 190 + d, category: "Chinese", image: FOOD.friedRice, isVeg: false, desc: "Classic wok-fried rice with egg and chicken." },
  { name: "Chicken Momos (6 pc)", price: 140 + d, category: "Starters", image: FOOD.momo, isVeg: false, desc: "Steamed dumplings served with spicy tomato chutney." },
  { name: "Paneer Butter Masala", price: 200 + d, category: "Main Course", image: FOOD.paneer, isVeg: true, desc: "Creamy tomato-cashew paneer gravy." },
  { name: "Tender Coconut Ice Cream", price: 90 + d, category: "Desserts", image: FOOD.iceCream, isVeg: true, desc: "Creamy tender-coconut ice cream." },
];

const fineMenu = (d: number): Dish[] => [
  { name: "Char-grilled Tenderloin Steak", price: 620 + d, category: "Mains", image: FOOD.steak, isVeg: false, recommended: true, desc: "Grass-fed tenderloin, red-wine jus, truffle mash." },
  { name: "Grilled Jumbo Prawns", price: 540 + d, category: "Seafood", image: FOOD.prawns, isVeg: false, recommended: true, desc: "Butter-basted prawns with lemon and herbs." },
  { name: "Assorted Sushi Platter", price: 890 + d, category: "Starters", image: FOOD.sushi, isVeg: false, recommended: true, desc: "Chef's selection of nigiri, sashimi, and maki rolls." },
  { name: "Truffle Alfredo Pasta", price: 380 + d, category: "Pasta", image: FOOD.pasta, isVeg: true, desc: "Fresh fettuccine, parmesan cream and truffle oil." },
  { name: "Mezze & Hummus Platter", price: 320 + d, category: "Starters", image: FOOD.salad, isVeg: true, desc: "Hummus, muhammara, olives and warm pita." },
  { name: "French Onion Soup", price: 280 + d, category: "Soups", image: FOOD.soup, isVeg: true, desc: "Caramelized onions, rich beef broth, gruyere crouton." },
  { name: "Baja Fish Tacos", price: 360 + d, category: "Mains", image: FOOD.tacos, isVeg: false, desc: "Crispy battered fish, slaw, pico de gallo, lime crema." },
  { name: "Wood-fired Margherita", price: 340 + d, category: "Pizza", image: FOOD.pizza, isVeg: true, desc: "Slow-proofed dough, buffalo mozzarella and basil." },
  { name: "Classic Mojito", price: 190 + d, category: "Beverages", image: FOOD.mojito, isVeg: true, desc: "Mint, lime and soda, elegantly balanced." },
  { name: "Molten Chocolate Fondant", price: 260 + d, category: "Desserts", image: FOOD.cake, isVeg: true, desc: "Warm dark-chocolate fondant, salted-caramel gelato." },
];

interface DemoRestaurant {
  id: string; name: string; cuisine: string; lat: number; lng: number;
  rating: number; count: number; cover: string; menu: (d: number) => Dish[];
  delta: number; dining: boolean; costForTwo: number; hours: string;
  highlights?: string;
}

const RESTAURANTS: DemoRestaurant[] = [
  { id: "demo_edachira_1", name: "Spice Route Kitchen", cuisine: "Kerala · Biryani · Arabian", lat: 10.0092, lng: 76.3606, rating: 4.6, count: 1240, cover: COVER.spice, menu: keralaMenu, delta: 0, dining: true, costForTwo: 900, hours: "11:00 AM – 11:30 PM", highlights: "A modern Malabar kitchen famous for dum biryani, Arabian grills and warm hospitality — a favourite for both family dinners and quick Infopark lunches." },
  { id: "demo_edachira_2", name: "Infopark Biryani House", cuisine: "Biryani · North Indian", lat: 10.0074, lng: 76.3582, rating: 4.4, count: 860, cover: COVER.biryaniHouse, menu: keralaMenu, delta: 10, dining: false, costForTwo: 600, hours: "11:30 AM – 11:00 PM" },
  { id: "demo_edachira_3", name: "The Grill Yard", cuisine: "Grill · Burgers · Fast Food", lat: 10.0103, lng: 76.3621, rating: 4.7, count: 2010, cover: COVER.grill, menu: grillMenu, delta: 20, dining: true, costForTwo: 800, hours: "12:00 PM – 12:00 AM", highlights: "Smoky flame-grills, gourmet burgers and a lively courtyard vibe. Live screening on match nights and a bar menu that keeps the evenings going." },
  { id: "demo_edachira_4", name: "Coastal Curry Co.", cuisine: "Seafood · Kerala · Chinese", lat: 10.0066, lng: 76.3557, rating: 4.3, count: 540, cover: COVER.coastal, menu: coastalMenu, delta: -10, dining: false, costForTwo: 750, hours: "11:00 AM – 10:30 PM" },
  { id: "demo_edachira_5", name: "Marari Pearl — Courtyard Dining", cuisine: "Continental · Seafood · Fine Dining", lat: 10.0115, lng: 76.3595, rating: 4.8, count: 1580, cover: COVER.marari, menu: fineMenu, delta: 30, dining: true, costForTwo: 2500, hours: "12:30 PM – 11:30 PM", highlights: "An elegant courtyard fine-dining destination — char-grilled steaks, fresh seafood and a curated bar. Perfect for date nights and celebrations." },
  { id: "demo_edachira_6", name: "Cafe Mocha Lounge", cuisine: "Cafe · Continental · Desserts", lat: 10.0081, lng: 76.3629, rating: 4.5, count: 970, cover: COVER.cafe, menu: cafeMenu, delta: 0, dining: true, costForTwo: 700, hours: "8:00 AM – 11:00 PM", highlights: "A cosy all-day cafe for cold brews, hearty sandwiches and desserts. Free Wi-Fi and quiet corners make it a work-and-chill favourite." },
];

const DINING_FACILITIES = [
  "Lunch", "Dinner", "Serves alcohol", "Valet parking",
  "Table reservation recommended", "Family friendly", "Free Wifi", "Card accepted",
];

function diningExtras(r: DemoRestaurant) {
  return {
    dineInHighlights: r.highlights || "",
    dineInGallery: [r.cover, INTERIOR[0], INTERIOR[1], INTERIOR[2]],
    facilities: DINING_FACILITIES,
    dineInFeatures: ["Premium dining", "Family friendly", "Cozy cafes"],
    dineInOffer: "Flat 15% OFF on the total bill",
    preBookOffer: "Flat 25% OFF ON PRE-BOOK TABLE",
    preBookCashback: 250,
    maxGuestsPerBooking: 20,
    bookingRules:
      "1. Please arrive within 15 minutes of your slot.\n2. Parties larger than 12 must call the restaurant directly.\n3. Offers apply on dine-in bills only.",
    buffets: [
      { name: "Weekend Breakfast Buffet", period: "Breakfast", price: 550, note: "Sat & Sun" },
      { name: "Lunch Buffet", period: "Lunch", price: 899, note: "All you can eat" },
    ],
    dineOffers: [
      { label: "FLAT 25% OFF", discountPct: 25, period: "Breakfast", startTime: "9:30 AM", slotsLeft: 20, coverCharge: 10 },
      { label: "FLAT 15% OFF", discountPct: 15, period: "Dinner", startTime: "7:00 PM", slotsLeft: 12, coverCharge: 0 },
    ],
  };
}

function assertAdmin(request: any): void {
  const email = (request.auth?.token?.email || "").toLowerCase();
  // Only a VERIFIED email may match the allowlist: email + password sign-up
  // mints tokens carrying any typed address with email_verified=false. Same
  // fix as assertAdmin in admin_operations.ts.
  const verified = request.auth?.token?.email_verified === true;
  const isAdmin =
    (verified && ["thekada@gmail.com", "thekadaapp@gmail.com"].includes(email)) ||
    request.auth?.token?.admin === true;
  if (!request.auth?.uid || !isAdmin) {
    throw new HttpsError("permission-denied", "Admin sign-in required.");
  }
}

/** Seeds (or refreshes) the image-rich demo dataset and flips demoMode on. */
export const seedDemoData = onCall(async (request) => {
  assertAdmin(request);
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const summary = { restaurants: 0, menuItems: 0, promos: 0, ads: 0 };

  for (const r of RESTAURANTS) {
    await db.collection("restaurants").doc(r.id).set({
      name: r.name,
      address: `${r.name}, Edachira, Kakkanad, Kochi, Kerala 682030`,
      cuisine: r.cuisine,
      location: { lat: r.lat, lng: r.lng },
      geohash: geohash(r.lat, r.lng),
      logoUrl: r.cover,
      phone: "+91 98470 12345",
      currency: "Indian Rupee (INR)",
      hours: r.hours,
      costForTwo: r.costForTwo,
      enableTax: true,
      taxPercentage: 5,
      taxMethod: "exclusive",
      taxLabel: "GST",
      enableReservations: r.dining,
      ...(r.dining ? diningExtras(r) : {}),
      ratingAvg: r.rating,
      ratingCount: r.count,
      isBlocked: false,
      isDeleted: false,
      isOutlet: false,
      isDemo: true,
      subscriptionStatus: "active",
      updatedAt: now,
      createdAt: now,
    }, { merge: true });
    summary.restaurants++;

    const items = r.menu(r.delta);
    // Replace this restaurant's demo menu wholesale so re-seeding stays clean.
    const existing = await db.collection("menu")
      .where("restaurantId", "==", r.id).where("isDemo", "==", true).get();
    const batch = db.batch();
    existing.docs.forEach((d) => batch.delete(d.ref));
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const ref = db.collection("menu").doc(`${r.id}_item_${i}`);
      batch.set(ref, {
        restaurantId: r.id,
        name: it.name,
        price: it.price,
        category: it.category,
        imageUrl: it.image,
        description: it.desc,
        isVeg: it.isVeg,
        isAvailable: true,
        isRecommended: it.recommended === true,
        isDemo: true,
        updatedAt: now,
        createdAt: now,
      });
      summary.menuItems++;
    }
    await batch.commit();
  }

  // ── Promos ────────────────────────────────────────────────────────────────
  const promos = [
    { id: "demo_promo_welcome", code: "WELCOME50", title: "50% OFF up to ₹100", description: "On your first order", discountType: "percentage", discountValue: 50, maxDiscount: 100, minOrder: 149 },
    { id: "demo_promo_flat", code: "KADA75", title: "Flat ₹75 OFF", description: "On orders above ₹299", discountType: "flat", discountValue: 75, minOrder: 299 },
    { id: "demo_promo_dine", code: "DINE250", title: "Flat ₹250 OFF on dining", description: "Pre-book a table & save", discountType: "flat", discountValue: 250, minOrder: 999 },
  ];
  for (const p of promos) {
    await db.collection("promos").doc(p.id).set({
      ...p, isActive: true, isDemo: true, updatedAt: now, createdAt: now,
    }, { merge: true });
    summary.promos++;
  }

  // ── Ads ───────────────────────────────────────────────────────────────────
  const ads = [
    { id: "demo_ad_banner_1", type: "banner", title: "Flat 50% OFF", subtitle: "On your first order from Edachira's best kitchens", tag: "WELCOME50", imageUrl: FOOD.biryani, searchQuery: "biryani", restaurantId: "", priority: 100 },
    { id: "demo_ad_banner_2", type: "banner", title: "Grill Night", subtitle: "Smoky burgers & grills, delivered hot", tag: "SPONSORED", imageUrl: FOOD.burger, searchQuery: "", restaurantId: "demo_edachira_3", priority: 90 },
    { id: "demo_ad_banner_3", type: "banner", title: "Fine Dining, ₹250 OFF", subtitle: "Pre-book a courtyard table at Marari Pearl", tag: "DINE250", imageUrl: COVER.marari, searchQuery: "", restaurantId: "demo_edachira_5", priority: 85 },
    { id: "demo_ad_sponsor_1", type: "sponsored_restaurant", title: "", subtitle: "", tag: "AD", imageUrl: "", searchQuery: "", restaurantId: "demo_edachira_1", priority: 80 },
    { id: "demo_ad_sponsor_2", type: "sponsored_restaurant", title: "", subtitle: "", tag: "AD", imageUrl: "", searchQuery: "", restaurantId: "demo_edachira_3", priority: 70 },
  ];
  for (const a of ads) {
    await db.collection("platform_ads").doc(a.id).set({
      ...a, isActive: true, isDemo: true, impressions: 0, clicks: 0,
      updatedAt: now, createdAt: now,
    }, { merge: true });
    summary.ads++;
  }

  // ── Seed Food Studio Presets (300 presets) ────────────────────────────────
  let presetBatch = db.batch();
  let presetCount = 0;
  for (const p of FOOD_STUDIO_PRESETS) {
    presetBatch.set(db.collection("food_studio_presets").doc(p.id), {
      ...p,
      isDemo: true,
      verified: true,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });
    presetCount++;
    if (presetCount % 400 === 0) {
      await presetBatch.commit();
      presetBatch = db.batch();
    }
  }
  if (presetCount % 400 !== 0) {
    await presetBatch.commit();
  }

  await db.collection("config").doc("platform").set(
    { demoMode: true, demoSeededAt: now }, { merge: true });

  return { ok: true, ...summary, foodPresets: presetCount };
});

/** Seeds or refreshes all 270+ studio food presets into Firestore. */
export const syncFoodStudioPresets = onCall(async (request) => {
  assertAdmin(request);
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  let batch = db.batch();
  let count = 0;
  for (const p of FOOD_STUDIO_PRESETS) {
    batch.set(db.collection("food_studio_presets").doc(p.id), {
      ...p,
      verified: true,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (count % 400 !== 0) {
    await batch.commit();
  }
  return { ok: true, count };
});

/** Wipes every `isDemo: true` document and flips demoMode off. */
export const clearDemoData = onCall(async (request) => {
  assertAdmin(request);
  const db = admin.firestore();
  const collections = ["restaurants", "menu", "promos", "platform_ads"];
  const removed: Record<string, number> = {};

  for (const col of collections) {
    const snap = await db.collection(col).where("isDemo", "==", true).get();
    removed[col] = snap.size;
    // Delete in chunks of 400 to stay under batch limits.
    let batch = db.batch();
    let n = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (n % 400 !== 0) await batch.commit();
  }

  await db.collection("config").doc("platform").set(
    { demoMode: false }, { merge: true });

  return { ok: true, removed };
});
