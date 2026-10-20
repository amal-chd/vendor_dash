/** Canonical Stay amenity catalog — admin edits `stay_amenities`; hosts & guests consume it. */

export const AMENITY_CATEGORIES = [
  "Essentials",
  "Kitchen",
  "Bathroom",
  "Features",
  "Outdoor",
  "Views",
  "Safety",
] as const;

export type AmenityCategory = (typeof AMENITY_CATEGORIES)[number] | string;

export type StayAmenitySeed = {
  key: string;
  name: string;
  category: AmenityCategory;
  iconName: string;
  sortOrder: number;
};

/** Stable keys used on hotel `amenities` arrays. */
export const DEFAULT_STAY_AMENITIES: StayAmenitySeed[] = [
  { key: "wifi", name: "Wifi", category: "Essentials", iconName: "wifi", sortOrder: 10 },
  { key: "ac", name: "Air conditioning", category: "Essentials", iconName: "wind", sortOrder: 20 },
  { key: "tv", name: "TV", category: "Essentials", iconName: "tv", sortOrder: 30 },
  { key: "workspace", name: "Dedicated workspace", category: "Essentials", iconName: "laptop", sortOrder: 40 },
  { key: "hot_water", name: "Hot water", category: "Bathroom", iconName: "droplets", sortOrder: 50 },
  { key: "washing_machine", name: "Washing machine", category: "Essentials", iconName: "shirt", sortOrder: 60 },
  { key: "kitchen", name: "Kitchen", category: "Kitchen", iconName: "utensils", sortOrder: 70 },
  { key: "breakfast", name: "Breakfast", category: "Kitchen", iconName: "coffee", sortOrder: 80 },
  { key: "parking", name: "Free parking", category: "Features", iconName: "car", sortOrder: 90 },
  { key: "pool", name: "Pool", category: "Features", iconName: "waves", sortOrder: 100 },
  { key: "gym", name: "Gym", category: "Features", iconName: "dumbbell", sortOrder: 110 },
  { key: "pet_friendly", name: "Pet friendly", category: "Features", iconName: "paw-print", sortOrder: 120 },
  { key: "balcony", name: "Balcony", category: "Outdoor", iconName: "home", sortOrder: 130 },
  { key: "bonfire", name: "Bonfire", category: "Outdoor", iconName: "flame", sortOrder: 140 },
  { key: "sea_view", name: "Sea view", category: "Views", iconName: "waves", sortOrder: 150 },
  { key: "mountain_view", name: "Mountain view", category: "Views", iconName: "mountain", sortOrder: 160 },
  { key: "valley_view", name: "Valley view", category: "Views", iconName: "mountain", sortOrder: 170 },
  { key: "lake_view", name: "Lake view", category: "Views", iconName: "waves", sortOrder: 180 },
  { key: "fire_extinguisher", name: "Fire extinguisher", category: "Safety", iconName: "flame", sortOrder: 190 },
  { key: "first_aid", name: "First aid kit", category: "Safety", iconName: "heart-pulse", sortOrder: 200 },
];

export const AMENITY_ICON_KEYS = [
  "wifi",
  "wind",
  "tv",
  "laptop",
  "droplets",
  "shirt",
  "utensils",
  "coffee",
  "car",
  "waves",
  "dumbbell",
  "paw-print",
  "home",
  "flame",
  "mountain",
  "heart-pulse",
  "parking-circle",
  "sparkles",
] as const;

export function slugifyAmenityKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

/** "Wifi", "wifi", "Wi-Fi", "pet_friendly", "Pet friendly" → same token. */
export function normalizeAmenityToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^wifi$/, "wifi");
}

export function listingHasAmenity(listingAmenities: unknown, required: string): boolean {
  if (!Array.isArray(listingAmenities)) return false;
  const need = normalizeAmenityToken(required);
  if (!need) return false;
  return listingAmenities.some((a) => normalizeAmenityToken(String(a)) === need);
}
