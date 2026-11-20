export const BRAND_PROFILES_COLLECTION = "marketing_brand_profiles";

export type BrandPalette = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
};

export type BrandProfile = {
  id: string;
  name: string;
  section: string;
  description: string;
  audience: string;
  positioning: string;
  voice: string;
  wordsUse: string;
  wordsAvoid: string;
  claims: string;
  offerRules: string;
  logoUrl: string;
  website: string;
  handles: string;
  hashtags: string;
  font: string;
  palette: BrandPalette;
  updatedAt?: { toMillis?: () => number };
  updatedBy?: string;
};

const palette = (primary: string, secondary: string, accent: string, background = "#FCFCFA", text = "#0B1B33"): BrandPalette => ({
  primary, secondary, accent, background, text,
});

/** Editable launch values for the KadaVerse company and its product lines. */
export const DEFAULT_BRAND_PROFILES: BrandProfile[] = [
  {
    id: "kadaverse", name: "KadaVerse", section: "Company", description: "Parent studio, business systems, apps and digital services.",
    audience: "Business owners, founders, operations teams and partners",
    positioning: "KadaVerse is a Kannur-based digital product and software studio building websites, apps and business systems around how people actually work.",
    voice: "Clear, capable, warm and grounded. Speak as a thoughtful technology partner. Explain the value in plain language; avoid hype.",
    wordsUse: "useful, clear, connected, practical, built around your workflow, Kannur",
    wordsAvoid: "guaranteed growth, best in India, effortless, revolutionary, fake urgency, unsupported superlatives",
    claims: "Use only capabilities and outcomes confirmed by KadaVerse. Do not invent client results, delivery timelines, ratings, revenue or adoption metrics.",
    offerRules: "State scope and inclusions plainly. Do not promise a price, deadline, free service or result unless confirmed for this campaign.",
    logoUrl: "", website: "https://thekada.in", handles: "", hashtags: "#KadaVerse #BuiltForBusiness",
    font: "Plus Jakarta Sans or a clean geometric sans-serif", palette: palette("#0B1B33", "#173B76", "#2563EB", "#FCFCFA", "#0B1B33"),
  },
  {
    id: "the-kada", name: "The Kada", section: "Products", description: "Local consumer app for food, dining, stays and related services.",
    audience: "Consumers in supported local service areas",
    positioning: "The Kada brings local food, dining and stays into one app, helping people discover nearby options and use services available in their area.",
    voice: "Friendly, local, helpful and specific. Sound like a neighbour who knows the area. Keep instructions simple.",
    wordsUse: "nearby, local, explore, order, dine, stay, your neighbourhood",
    wordsAvoid: "everywhere, instant, guaranteed delivery, lowest price, fake scarcity, unverified availability",
    claims: "Availability depends on service area and participating businesses. Do not invent restaurant listings, delivery times, discounts, ratings or order counts.",
    offerRules: "Include valid dates, service-area limits, minimum order and redemption conditions whenever a promotion is mentioned.",
    logoUrl: "https://www.thekada.in/favicon.png", website: "https://thekada.in", handles: "", hashtags: "#TheKada #ShopLocal",
    font: "Plus Jakarta Sans", palette: palette("#0F1F4F", "#1E3A8A", "#2563EB", "#F7FAFF", "#0F172A"),
  },
  {
    id: "kada-dine", name: "Kada Dine", section: "Products", description: "Restaurant operations, POS, QR ordering and kitchen workflow tools.",
    audience: "Restaurant owners, managers and hospitality teams",
    positioning: "Kada Dine brings restaurant billing, QR ordering and kitchen workflows into a connected operating system.",
    voice: "Practical, efficient and hospitality-aware. Focus on smoother service and clearer operations without making unverified performance promises.",
    wordsUse: "counter, kitchen, table, orders, restaurant workflow, connected",
    wordsAvoid: "zero errors, instant setup, guaranteed sales, unsupported savings or speed claims",
    claims: "Describe only confirmed modules and screens. Do not invent revenue lift, time saved, customer counts or hardware compatibility.",
    offerRules: "Name the included modules and any setup or hardware conditions before quoting an offer.",
    logoUrl: "", website: "https://thekada.in", handles: "", hashtags: "#KadaDine #RestaurantTech",
    font: "Plus Jakarta Sans", palette: palette("#102943", "#1D536B", "#E98945", "#F7FAF9", "#13232F"),
  },
  {
    id: "sellrapp", name: "SellrApp", section: "Products", description: "Branded storefront and order management for independent sellers.",
    audience: "Small retailers, independent shops and social sellers",
    positioning: "SellrApp gives independent sellers a branded online storefront and one place to follow orders from their selling channels.",
    voice: "Encouraging, entrepreneurial and direct. Respect the seller’s own brand and keep the technology approachable.",
    wordsUse: "your store, your brand, products, orders, storefront, independent seller",
    wordsAvoid: "guaranteed sales, overnight success, passive income, fake conversion numbers",
    claims: "Show only approved SellrApp screens and functions. Never invent seller earnings, order volume or marketplace reach.",
    offerRules: "Explain plan or setup terms clearly. Do not imply that a storefront automatically creates sales.",
    logoUrl: "", website: "https://sellrapp.vercel.app", handles: "", hashtags: "#SellrApp #SmallBusiness",
    font: "Plus Jakarta Sans", palette: palette("#24314C", "#435878", "#E5A92B", "#FFFCF5", "#172235"),
  },
  {
    id: "kada-stay", name: "Kada Stay", section: "Products", description: "Property, booking and guest-service workflows for stays.",
    audience: "Hotels, homestays, hostels, property teams and guests",
    positioning: "Kada Stay connects property discovery and booking with practical tools for hosts and guest service teams.",
    voice: "Welcoming, calm and dependable. Focus on hospitality and clear coordination, not luxury claims.",
    wordsUse: "stay, host, guest, booking, room, service request, hospitality",
    wordsAvoid: "luxury, guaranteed booking, fully booked, five-star, fake property availability",
    claims: "Use real property images and approved host-app screens. Do not invent occupancy, ratings, room features or guest testimonials.",
    offerRules: "Show property-specific availability, dates, taxes and booking conditions only when verified.",
    logoUrl: "", website: "https://thekada.in", handles: "", hashtags: "#KadaStay #HospitalityTech",
    font: "Plus Jakarta Sans", palette: palette("#123B43", "#1F6A68", "#48A99A", "#F4FAF8", "#16333A"),
  },
  {
    id: "kada-delivery", name: "Kada Delivery", section: "Products", description: "Local delivery coordination and rider tools.",
    audience: "Delivery operators, riders, merchants and local customers",
    positioning: "Kada Delivery supports the local order-to-door workflow for merchants, riders and customers in supported areas.",
    voice: "Reliable, energetic and human. Make the people behind delivery visible and avoid absolute speed promises.",
    wordsUse: "delivery, rider, route, local, order status, support",
    wordsAvoid: "instant everywhere, guaranteed in minutes, zero delays, unsupported coverage claims",
    claims: "Do not invent delivery speeds, service areas, rider counts, safety certifications or tracking capabilities.",
    offerRules: "State delivery areas, fees and timing conditions only from current approved information.",
    logoUrl: "", website: "https://thekada.in", handles: "", hashtags: "#KadaDelivery #LocalDelivery",
    font: "Plus Jakarta Sans", palette: palette("#0B3574", "#165BB6", "#39A5E8", "#F4F9FF", "#0E2544"),
  },
  {
    id: "kada-mess", name: "Kada Mess", section: "Products", description: "Meal and mess operations for kitchens and their customers.",
    audience: "Mess operators, kitchens, students and regular meal customers",
    positioning: "Kada Mess helps meal providers organize menus, subscriptions and customer orders with a clearer day-to-day workflow.",
    voice: "Warm, reassuring and community-minded. Make meal information easy to understand.",
    wordsUse: "daily menu, meal plan, kitchen, community, subscription, order",
    wordsAvoid: "health claims, guaranteed nutrition, fake freshness or availability statements",
    claims: "Only use approved menu, ingredient, dietary and delivery details. Never invent nutrition, hygiene certification or meal availability.",
    offerRules: "State plan duration, meal count, delivery area, price and cancellation terms exactly as approved.",
    logoUrl: "", website: "https://thekada.in", handles: "", hashtags: "#KadaMess #MealMadeSimple",
    font: "Plus Jakarta Sans", palette: palette("#1A493D", "#367A5B", "#75B85A", "#F7FBF5", "#183329"),
  },
  {
    id: "kada-ledger", name: "Kada Ledger", section: "Products", description: "Digital ledger and business record-keeping product.",
    audience: "Small businesses and teams that track everyday transactions",
    positioning: "Kada Ledger gives teams a clearer digital place to record and review day-to-day business activity.",
    voice: "Trustworthy, calm and precise. Explain financial workflows in accessible language.",
    wordsUse: "record, track, review, ledger, transactions, visibility",
    wordsAvoid: "financial advice, guaranteed profit, audit-proof, tax compliant unless verified",
    claims: "Do not imply accounting, tax, banking or regulatory compliance unless confirmed for the specific product release.",
    offerRules: "Describe supported records and integrations accurately. Do not publish unverified security or compliance claims.",
    logoUrl: "", website: "https://thekada.in", handles: "", hashtags: "#KadaLedger #BusinessTools",
    font: "Plus Jakarta Sans", palette: palette("#16483F", "#237665", "#42B99A", "#F4FBF9", "#132E2A"),
  },
  {
    id: "kada-partner", name: "KadaVerse Partner App", section: "Products", description: "Partner onboarding and operational app for the KadaVerse ecosystem.",
    audience: "Local businesses and service partners evaluating the platform",
    positioning: "The KadaVerse partner app gives participating businesses a dedicated way to work with the products and services enabled for them.",
    voice: "Respectful, straightforward and supportive. Explain the next step and the partner’s role.",
    wordsUse: "partner, local business, onboarding, support, participation",
    wordsAvoid: "guaranteed customers, guaranteed income, instant approval, unsupported partner benefits",
    claims: "Partner features and eligibility can vary. Use only approved onboarding steps, benefits and service terms.",
    offerRules: "State participation requirements and applicable fees or conditions when provided by the business team.",
    logoUrl: "", website: "https://thekada.in", handles: "", hashtags: "#KadaVerse #LocalPartners",
    font: "Plus Jakarta Sans", palette: palette("#22264F", "#3B4C8A", "#7B6BE8", "#F8F7FF", "#1B1E38"),
  },
];

export const DEFAULT_BRAND_PROFILES_BY_ID = Object.fromEntries(
  DEFAULT_BRAND_PROFILES.map((profile) => [profile.id, profile]),
) as Record<string, BrandProfile>;

export const BRAND_PROFILE_OPTIONS = DEFAULT_BRAND_PROFILES.map(({ id, name, section }) => ({ id, name, section }));

export function buildBrandProfileMap(savedProfiles: Record<string, Partial<BrandProfile>>, legacyKadaBrand?: Partial<BrandProfile>) {
  const profiles: Record<string, BrandProfile> = { ...DEFAULT_BRAND_PROFILES_BY_ID };
  for (const [id, saved] of Object.entries(savedProfiles)) {
    if (profiles[id]) profiles[id] = { ...profiles[id], ...saved, palette: { ...profiles[id].palette, ...(saved.palette ?? {}) } };
  }
  if (!savedProfiles["the-kada"] && legacyKadaBrand) {
    const { updatedAt: _updatedAt, updatedBy: _updatedBy, ...legacy } = legacyKadaBrand;
    profiles["the-kada"] = { ...profiles["the-kada"], ...legacy };
  }
  return profiles;
}

export function inferBrandProfileId(title: string, explicit?: string) {
  if (explicit && DEFAULT_BRAND_PROFILES_BY_ID[explicit]) return explicit;
  const value = title.toLowerCase();
  if (value.includes("kada dine")) return "kada-dine";
  if (value.includes("sellrapp")) return "sellrapp";
  if (value.includes("kada stay")) return "kada-stay";
  if (value.includes("kada delivery")) return "kada-delivery";
  if (value.includes("kada mess")) return "kada-mess";
  if (value.includes("kada ledger")) return "kada-ledger";
  if (value.includes("partner app")) return "kada-partner";
  if (value.includes("the kada")) return "the-kada";
  return "kadaverse";
}
