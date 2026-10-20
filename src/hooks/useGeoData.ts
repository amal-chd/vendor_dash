import { useEffect, useState } from "react";

/**
 * `country-state-city` ships the entire world dataset (~8.6 MB raw / ~2.3 MB
 * gzip) in a single module — overwhelmingly the city list. Importing it
 * statically forces every page that needs a country/state/city picker to
 * download that payload before it can render. This hook defers the import so
 * the page paints immediately and the geo data streams in afterwards.
 *
 * The module is cached across hook instances so navigating between the
 * Settings / Outlets / Restaurants pickers only downloads it once.
 *
 * Returns `null` while loading; callers should guard with `geo?.Country...`.
 */
type CSCModule = typeof import("country-state-city");

let cached: CSCModule | null = null;
let inflight: Promise<CSCModule> | null = null;

export function useGeoData(): CSCModule | null {
  const [geo, setGeo] = useState<CSCModule | null>(cached);

  useEffect(() => {
    if (cached) {
      setGeo(cached);
      return;
    }
    if (!inflight) {
      inflight = import("country-state-city").then((m) => {
        cached = m;
        return m;
      });
    }
    let active = true;
    inflight.then((m) => {
      if (active) setGeo(m);
    });
    return () => {
      active = false;
    };
  }, []);

  return geo;
}
