import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Bike, Users } from "lucide-react";

/**
 * Live dispatch map for the admin console — plots online delivery riders and
 * active-delivery customer drops on an OpenStreetMap canvas (Leaflet, loaded
 * from CDN so no build dependency / API key is required). Rider positions come
 * from `delivery_users/{uid}.location`, customer drops from each active order's
 * `deliveryAddress`.
 */

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

const ACTIVE_STAGES = [
  "offered",
  "accepted",
  "assigned",
  "arriving",
  "picked_up",
  "on_the_way",
  "reached",
];

function loadLeaflet(): Promise<any> {
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

interface RiderPin {
  id: string;
  name: string;
  phone: string;
  vehicle: string;
  isBusy: boolean;
  lat: number;
  lng: number;
}
interface DropPin {
  id: string;
  customer: string;
  phone: string;
  address: string;
  status: string;
  rider: string;
  lat: number;
  lng: number;
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export default function DispatchMap() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riders, setRiders] = useState<RiderPin[]>([]);
  const [drops, setDrops] = useState<DropPin[]>([]);

  // Init map once Leaflet is loaded.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
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

  // Ensure map adjusts properly to container resizing
  useEffect(() => {
    if (!ready || !mapEl.current || !mapRef.current) return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.invalidateSize();
    });
    ro.observe(mapEl.current);
    return () => ro.disconnect();
  }, [ready]);

  // Stream online riders with a known location.
  useEffect(() => {
    const q = query(collection(db, "delivery_users"), where("isOnline", "==", true));
    return onSnapshot(q, (snap) => {
      const list: RiderPin[] = [];
      snap.forEach((d) => {
        const data: any = d.data();
        const lat = num(data.location?.lat ?? data.lat);
        const lng = num(data.location?.lng ?? data.lng);
        if (lat == null || lng == null) return;
        list.push({
          id: d.id,
          name: data.name || "Rider",
          phone: data.phone || "",
          vehicle: [data.vehicleType, data.vehicleNumber].filter(Boolean).join(" • "),
          isBusy: !!data.currentOrderId,
          lat,
          lng,
        });
      });
      setRiders(list);
    }, (err) => console.error("[DispatchMap] q listener failed", err));
  }, []);

  // Stream active deliveries with a known drop location.
  useEffect(() => {
    const q = query(collection(db, "orders"), where("deliveryStatus", "in", ACTIVE_STAGES));
    return onSnapshot(q, (snap) => {
      const list: DropPin[] = [];
      snap.forEach((d) => {
        const data: any = d.data();
        const addr = data.deliveryAddress || {};
        const lat = num(addr.lat);
        const lng = num(addr.lng);
        if (lat == null || lng == null) return;
        list.push({
          id: d.id,
          customer: data.customerName || "Customer",
          phone: data.customerPhone || "",
          address: data.deliveryAddressText || [addr.line1, addr.area].filter(Boolean).join(", "),
          status: (data.deliveryStatus || "").replace(/_/g, " "),
          rider: data.riderName || "Unassigned",
          lat,
          lng,
        });
      });
      setDrops(list);
    }, (err) => console.error("[DispatchMap] q listener failed", err));
  }, []);

  // Redraw markers whenever data or the map changes.
  useEffect(() => {
    const L = LRef.current;
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!ready || !L || !layer || !map) return;
    layer.clearLayers();

    const dot = (color: string, glyph: string) =>
      L.divIcon({
        className: "",
        html: `<div style="background:${color};width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);font-size:13px;line-height:1">${glyph}</span></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26],
        popupAnchor: [0, -24],
      });

    const bounds: any[] = [];
    for (const r of riders) {
      bounds.push([r.lat, r.lng]);
      L.marker([r.lat, r.lng], { icon: dot(r.isBusy ? "#2563eb" : "#059669", "🛵") })
        .bindPopup(
          `<b>${r.name}</b><br/>${r.vehicle || "—"}<br/>${r.phone || ""}<br/><span style="color:${r.isBusy ? "#2563eb" : "#059669"};font-weight:700">${r.isBusy ? "On a delivery" : "Available"}</span>`,
        )
        .addTo(layer);
    }
    for (const c of drops) {
      bounds.push([c.lat, c.lng]);
      L.marker([c.lat, c.lng], { icon: dot("#e11d48", "📦") })
        .bindPopup(
          `<b>${c.customer}</b><br/>${c.address || ""}<br/>${c.phone || ""}<br/><span style="text-transform:capitalize;font-weight:700">${c.status}</span> · Rider: ${c.rider}`,
        )
        .addTo(layer);
    }
    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      } catch {
        /* single point — keep default zoom */
      }
    }
  }, [ready, riders, drops]);

  const availableRiders = useMemo(() => riders.filter((r) => !r.isBusy).length, [riders]);

  return (
    <div className="rounded-2xl border border-border/60 overflow-hidden bg-card flex flex-col h-full shadow-sm isolate z-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <h3 className="text-sm font-bold">Live Dispatch Map</h3>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-emerald-600">
            <Bike className="h-3.5 w-3.5" /> {availableRiders} free · {riders.length} online
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-rose-600">
            <Users className="h-3.5 w-3.5" /> {drops.length} active drops
          </span>
        </div>
      </div>
      <div className="relative flex-1 min-h-[420px] isolate z-0">
        <div ref={mapEl} className="w-full h-full min-h-[420px] relative z-0" style={{ width: "100%", height: "100%", minHeight: 420 }} />
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
      <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border/60 text-[11px] text-muted-foreground shrink-0">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Available rider</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> Rider on delivery</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> Customer drop</span>
      </div>
    </div>
  );
}
