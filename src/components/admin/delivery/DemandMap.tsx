import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Flame } from "lucide-react";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

async function loadLeaflet() {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.L) return resolve(w.L);
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(w.L));
      existing.addEventListener("error", reject);
      if (w.L) resolve(w.L);
      return;
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve(w.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export function DemandMap() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zones, setZones] = useState<any[]>([]);

  // Init map once Leaflet is loaded.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L: any) => {
        if (cancelled || !mapEl.current || mapRef.current) return;
        LRef.current = L;
        const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView(
          [10.0, 76.3], // Kochi, Kerala default
          11,
        );
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setReady(true);
      })
      .catch(() => setError("Could not load the map. Check your connection."));
    return () => {
      cancelled = true;
    };
  }, []);

  // Stream demand zones
  useEffect(() => {
    const q = query(collection(db, "demand_zones"));
    return onSnapshot(q, (snap) => {
      const list: any[] = [];
      snap.forEach((d) => {
        const data: any = d.data();
        const lat = num(data.lat);
        const lng = num(data.lng);
        if (lat == null || lng == null) return;
        list.push({
          id: d.id,
          name: data.name || "Unknown Zone",
          lat,
          lng,
          radiusKm: num(data.radiusKm) || 2,
          surgeMultiplier: num(data.surgeMultiplier) || 1,
          demand: data.demand || "normal",
          active: data.active !== false,
          activeOrders: data.activeOrders || 0,
          availableRiders: data.availableRiders || 0,
        });
      });
      setZones(list);
    }, (err) => console.error("[DemandMap] q listener failed", err));
  }, []);

  // Redraw zones whenever data or the map changes.
  useEffect(() => {
    const L = LRef.current;
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!ready || !L || !layer || !map) return;
    layer.clearLayers();

    const bounds: any[] = [];
    for (const z of zones) {
      if (!z.active) continue;
      bounds.push([z.lat, z.lng]);
      
      let color = "#3b82f6"; // blue (normal/low)
      if (z.demand === "extreme") color = "#e11d48"; // red
      else if (z.demand === "high") color = "#f59e0b"; // amber
      
      const surgeDisplay = z.surgeMultiplier > 1 ? `<strong style="color: #e11d48">${z.surgeMultiplier}x SURGE</strong>` : "No surge";

      L.circle([z.lat, z.lng], {
        color: color,
        fillColor: color,
        fillOpacity: 0.3,
        radius: z.radiusKm * 1000,
        weight: 2
      })
        .bindPopup(
          `<b>${z.name}</b><br/>
           <span style="text-transform:capitalize;font-weight:700;color:${color}">${z.demand} Demand</span><br/>
           Orders: ${z.activeOrders} | Riders: ${z.availableRiders}<br/>
           ${surgeDisplay}`
        )
        .addTo(layer);
    }
    
    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      } catch {
        /* single point — keep default zoom */
      }
    }
  }, [ready, zones]);

  return (
    <div className="rounded-2xl border border-border/60 overflow-hidden bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
          </span>
          <h3 className="text-sm font-bold">Live Demand Heatmap</h3>
        </div>
      </div>
      <div className="relative z-0">
        <div ref={mapEl} className="z-0" style={{ height: 420, width: "100%" }} />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-muted/30">
            Loading live map…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-rose-600 bg-muted/30 px-6 text-center">
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border/60 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Low/Normal Demand</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> High Demand</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> Extreme Demand</span>
      </div>
    </div>
  );
}
