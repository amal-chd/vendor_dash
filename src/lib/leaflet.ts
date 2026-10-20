/**
 * Shared Leaflet loader for the admin console.
 *
 * Leaflet is fetched at runtime rather than bundled: it is only needed on the
 * handful of map screens, and pulling ~150 KB into the main chunk would slow
 * every other page. The promise is memoised, so ten map components mounting at
 * once still produce exactly one script tag and one network fetch.
 *
 * A second CDN is tried if the first fails — the zone editor is the only way
 * to draw a service area, so it must not be one flaky host away from unusable.
 */

const SOURCES = [
  {
    css: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    js: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  },
  {
    css: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
    js: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  },
];

let pending: Promise<any> | null = null;

function injectCss(href: string) {
  if (document.querySelector(`link[data-leaflet="1"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.leaflet = "1";
  document.head.appendChild(link);
}

function injectScript(src: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.L) return resolve(w.L);
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => (w.L ? resolve(w.L) : reject(new Error("Leaflet did not initialise")));
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Resolves with the Leaflet global. Safe to call from any number of places. */
export function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (pending) return pending;

  pending = (async () => {
    let lastError: unknown;
    for (const source of SOURCES) {
      try {
        injectCss(source.css);
        return await injectScript(source.js);
      } catch (e) {
        lastError = e;
      }
    }
    // Let the next caller retry rather than caching the failure forever.
    pending = null;
    throw lastError instanceof Error ? lastError : new Error("Could not load the map library.");
  })();

  return pending;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Mirrors the server's `haversineKm` so admin previews match server quotes. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Point-in-polygon, identical in behaviour to `functions/src/zones.ts`.
 *
 * Duplicated on purpose: the admin coverage preview has to agree with what the
 * server will decide, and a round-trip per pin would make the map unusable.
 * If one changes, change both.
 */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  const { lat: y, lng: x } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat;
    const xi = polygon[i].lng;
    const yj = polygon[j].lat;
    const xj = polygon[j].lng;
    if (yi > y !== yj > y) {
      const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

export function centroidOf(polygon: LatLng[]): LatLng {
  if (!polygon.length) return { lat: 0, lng: 0 };
  const sum = polygon.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / polygon.length, lng: sum.lng / polygon.length };
}

/** Approximate area, matching the server's projection so figures agree. */
export function areaSqKm(polygon: LatLng[]): number {
  if (polygon.length < 3) return 0;
  const c = centroidOf(polygon);
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((c.lat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = (polygon[i].lng - c.lng) * kmPerDegLng;
    const yi = (polygon[i].lat - c.lat) * kmPerDegLat;
    const xj = (polygon[j].lng - c.lng) * kmPerDegLng;
    const yj = (polygon[j].lat - c.lat) * kmPerDegLat;
    sum += xj * yi - xi * yj;
  }
  return Math.abs(sum) / 2;
}
