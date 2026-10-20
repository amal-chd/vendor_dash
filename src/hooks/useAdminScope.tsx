import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useLiveCollection } from "@/hooks/useLiveCollection";

/**
 * The admin console's universal scope: which city and zone everything is
 * filtered to.
 *
 * Every list, KPI and chart reads this, so switching to "Fort Kochi" once
 * scopes vendors, riders, orders and finance together instead of re-picking a
 * filter on each page. It is deliberately global rather than per-page state —
 * the whole point is that the operator holds one place in their head.
 *
 * Persisted to localStorage so a refresh (or a link opened tomorrow) keeps the
 * operator where they were. Reads are wrapped because storage throws outright
 * in some privacy modes.
 */

export interface Market {
  id: string;
  name?: string;
  city?: string;
  state?: string;
  status?: string;
}

export interface Zone {
  id: string;
  marketId?: string;
  name?: string;
  colour?: string;
  active?: boolean;
  areaSqKm?: number;
  polygon?: Array<{ lat: number; lng: number }>;
}

interface ScopeValue {
  marketId: string;
  zoneId: string;
  setMarket: (id: string) => void;
  setZone: (id: string) => void;
  clear: () => void;
  /** True when neither filter is set — used to skip pointless client filtering. */
  isAll: boolean;

  markets: Market[];
  zones: Zone[];
  /** Zones inside the selected city, or all of them when no city is picked. */
  scopedZones: Zone[];
  loading: boolean;

  /** Human label for the current scope, e.g. "Kochi · Fort Kochi". */
  label: string;

  /**
   * Does a record belong to the current scope? Records with no zone stamped
   * yet (a vendor who has not set a location) are shown under "All" only —
   * hiding them everywhere would make coverage gaps invisible, which is
   * exactly the problem zones exist to surface.
   */
  matches: (row: { zoneId?: string | null; marketId?: string | null }) => boolean;
}

const Ctx = createContext<ScopeValue | null>(null);

const LS_MARKET = "kada_admin_scope_market";
const LS_ZONE = "kada_admin_scope_zone";

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked — scope just won't persist */
  }
}

export function AdminScopeProvider({ children }: { children: ReactNode }) {
  const [marketId, setMarketId] = useState<string>(() => read(LS_MARKET));
  const [zoneId, setZoneId] = useState<string>(() => read(LS_ZONE));

  const { rows: markets, loading: marketsLoading } = useLiveCollection<Market>("markets");
  const { rows: zones, loading: zonesLoading } = useLiveCollection<Zone>("zones", {
    orderByField: "name",
    orderDir: "asc",
  });

  useEffect(() => write(LS_MARKET, marketId), [marketId]);
  useEffect(() => write(LS_ZONE, zoneId), [zoneId]);

  // A stored id can outlive the record it points at (a city renamed away, a
  // zone deleted). Drop it rather than filtering everything down to nothing.
  useEffect(() => {
    if (marketId && !marketsLoading && !markets.some((m) => m.id === marketId)) {
      setMarketId("");
    }
  }, [marketId, markets, marketsLoading]);
  useEffect(() => {
    if (zoneId && !zonesLoading && !zones.some((z) => z.id === zoneId)) setZoneId("");
  }, [zoneId, zones, zonesLoading]);

  const setMarket = useCallback((id: string) => {
    setMarketId(id);
    // Changing city invalidates a zone that belongs to the old one.
    setZoneId("");
  }, []);

  const setZone = useCallback(
    (id: string) => {
      setZoneId(id);
      // Picking a zone implies its city, so the two never disagree.
      const z = zones.find((x) => x.id === id);
      if (z?.marketId) setMarketId(z.marketId);
    },
    [zones],
  );

  const clear = useCallback(() => {
    setMarketId("");
    setZoneId("");
  }, []);

  const scopedZones = useMemo(
    () => (marketId ? zones.filter((z) => z.marketId === marketId) : zones),
    [zones, marketId],
  );

  const label = useMemo(() => {
    const m = markets.find((x) => x.id === marketId);
    const z = zones.find((x) => x.id === zoneId);
    if (z) return `${m?.name || m?.city || "City"} · ${z.name || "Zone"}`;
    if (m) return m.name || m.city || "City";
    return "All areas";
  }, [markets, zones, marketId, zoneId]);

  const matches = useCallback(
    (row: { zoneId?: string | null; marketId?: string | null }) => {
      if (zoneId) return row.zoneId === zoneId;
      if (marketId) return row.marketId === marketId;
      return true;
    },
    [marketId, zoneId],
  );

  const value = useMemo<ScopeValue>(
    () => ({
      marketId,
      zoneId,
      setMarket,
      setZone,
      clear,
      isAll: !marketId && !zoneId,
      markets,
      zones,
      scopedZones,
      loading: marketsLoading || zonesLoading,
      label,
      matches,
    }),
    [
      marketId,
      zoneId,
      setMarket,
      setZone,
      clear,
      markets,
      zones,
      scopedZones,
      marketsLoading,
      zonesLoading,
      label,
      matches,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Read the current city/zone scope.
 *
 * Returns a permissive fallback outside the provider so a page rendered on its
 * own (a test, a standalone route) shows everything rather than crashing.
 */
export function useAdminScope(): ScopeValue {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  return {
    marketId: "",
    zoneId: "",
    setMarket: () => {},
    setZone: () => {},
    clear: () => {},
    isAll: true,
    markets: [],
    zones: [],
    scopedZones: [],
    loading: false,
    label: "All areas",
    matches: () => true,
  };
}

/** Filter any zone-stamped list down to the current scope. */
export function useScoped<T extends { zoneId?: string | null; marketId?: string | null }>(
  rows: T[],
): T[] {
  const { matches, isAll } = useAdminScope();
  return useMemo(() => (isAll ? rows : rows.filter(matches)), [rows, matches, isAll]);
}
