/**
 * Geospatial helpers for restaurant discovery.
 *
 * KadaDine restaurants store an optional `location: { lat, lng }` and a
 * `geohash` string (set by the vendor in Settings). The customer delivery app
 * discovers restaurants within a radius by querying a geohash bounding box and
 * then refining with a precise haversine distance. These helpers are the web
 * side of that contract (used when the vendor sets/updates their location); the
 * Flutter customer app mirrors the same encoding so the data is interoperable.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"; // (excludes a, i, l, o)
const EARTH_RADIUS_KM = 6371;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Encode a lat/lng to a geohash of the given precision. Precision 9 (~4.8m)
 * is plenty; we store 9 and query on shorter prefixes for radius bounding.
 */
export function encodeGeohash(lat: number, lng: number, precision = 9): string {
  let isEven = true;
  let bit = 0;
  let ch = 0;
  let geohash = "";
  const latRange: [number, number] = [-90, 90];
  const lngRange: [number, number] = [-180, 180];

  while (geohash.length < precision) {
    if (isEven) {
      const mid = (lngRange[0] + lngRange[1]) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        lngRange[0] = mid;
      } else {
        lngRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        latRange[0] = mid;
      } else {
        latRange[1] = mid;
      }
    }
    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return geohash;
}

/**
 * Geohash prefix length that safely covers the given radius. Each geohash
 * character roughly halves the cell size; these thresholds are the standard
 * conservative cell widths so a prefix query is guaranteed to include all
 * points within `radiusKm` (false positives are then dropped by haversine).
 */
export function geohashPrecisionForRadius(radiusKm: number): number {
  if (radiusKm <= 0.019) return 8;
  if (radiusKm <= 0.076) return 7;
  if (radiusKm <= 0.61) return 6;
  if (radiusKm <= 2.4) return 5;
  if (radiusKm <= 20) return 4;
  if (radiusKm <= 78) return 3;
  if (radiusKm <= 630) return 2;
  return 1;
}

/**
 * The set of geohash prefixes (the centre cell + its 8 neighbours) that cover
 * a circle of `radiusKm` around the point. A Firestore query of the form
 * `where(geohash >= prefix) && where(geohash < prefix + '~')` for each prefix
 * returns all candidates; combine the results and filter by haversine.
 */
export function geohashQueryBounds(
  center: LatLng,
  radiusKm: number,
): Array<[string, string]> {
  const precision = geohashPrecisionForRadius(radiusKm);
  const centerHash = encodeGeohash(center.lat, center.lng, precision);
  const prefixes = new Set<string>([centerHash]);
  // Neighbour cells: nudge by ~one cell width in 8 directions.
  const cellDeg = 360 / 2 ** (2.5 * precision);
  const deltas = [-cellDeg, 0, cellDeg];
  for (const dLat of deltas) {
    for (const dLng of deltas) {
      const lat = clampLat(center.lat + dLat);
      const lng = wrapLng(center.lng + dLng);
      prefixes.add(encodeGeohash(lat, lng, precision));
    }
  }
  return Array.from(prefixes).map((p) => [p, p + "~"]);
}

function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

function wrapLng(lng: number): number {
  if (lng > 180) return lng - 360;
  if (lng < -180) return lng + 360;
  return lng;
}
