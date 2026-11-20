import { useEffect, useRef, useState } from "react";
import { loadLeaflet, type LatLng } from "@/lib/leaflet";
import { MapPin, ExternalLink, Copy, Check, Navigation } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface ZoneDisplay {
  id: string;
  name: string;
  polygon: LatLng[];
  color?: string;
}

interface LocationMapViewProps {
  lat?: number | null;
  lng?: number | null;
  title?: string;
  address?: string;
  zoneName?: string | null;
  zonePolygons?: ZoneDisplay[];
  selectedZoneId?: string | null;
  height?: string | number;
  className?: string;
  zoom?: number;
}

export function LocationMapView({
  lat,
  lng,
  title,
  address,
  zoneName,
  zonePolygons = [],
  selectedZoneId,
  height = 220,
  className,
  zoom = 14,
}: LocationMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const zoneLayerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  const [copied, setCopied] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const hasCoords = typeof lat === "number" && typeof lng === "number" && !isNaN(lat) && !isNaN(lng);

  useEffect(() => {
    let active = true;

    loadLeaflet()
      .then((L) => {
        if (!active || !containerRef.current || mapRef.current) return;
        LRef.current = L;

        const centerLat = hasCoords ? lat! : 9.9312;
        const centerLng = hasCoords ? lng! : 76.2673;

        const map = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: false,
          scrollWheelZoom: false,
        }).setView([centerLat, centerLng], hasCoords ? zoom : 11);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(map);

        const zoneLayer = L.layerGroup().addTo(map);
        zoneLayerRef.current = zoneLayer;

        if (hasCoords) {
          const pinIcon = L.divIcon({
            className: "",
            html: `<div style="
              background: #ef4444;
              width: 32px;
              height: 32px;
              border-radius: 50% 50% 50% 0;
              transform: rotate(-45deg);
              border: 2.5px solid #ffffff;
              box-shadow: 0 3px 8px rgba(0,0,0,0.35);
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              <span style="transform: rotate(45deg); font-size: 15px; line-height: 1;">📍</span>
            </div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -30],
          });

          const popupContent = `
            <div style="font-family: inherit; font-size: 12px; line-height: 1.4; min-width: 140px;">
              <strong style="color: #0f172a; font-size: 13px;">${title || "Location"}</strong>
              ${address ? `<div style="color: #475569; margin-top: 3px;">${address}</div>` : ""}
              ${zoneName ? `<div style="color: #2563eb; font-weight: 600; margin-top: 4px;">Zone: ${zoneName}</div>` : ""}
              <div style="color: #94a3b8; font-size: 11px; margin-top: 4px; font-family: monospace;">${lat!.toFixed(5)}, ${lng!.toFixed(5)}</div>
            </div>
          `;

          const marker = L.marker([lat!, lng!], { icon: pinIcon })
            .bindPopup(popupContent)
            .addTo(map);

          markerRef.current = marker;
        }

        mapRef.current = map;
        setMapReady(true);

        setTimeout(() => {
          map.invalidateSize();
        }, 200);
      })
      .catch((err) => {
        console.warn("[LocationMapView] Failed to init leaflet:", err);
      });

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update marker position & popup if lat/lng change
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!map || !L || !mapReady) return;

    if (hasCoords) {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat!, lng!]);
      } else {
        const pinIcon = L.divIcon({
          className: "",
          html: `<div style="
            background: #ef4444;
            width: 32px;
            height: 32px;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 2.5px solid #ffffff;
            box-shadow: 0 3px 8px rgba(0,0,0,0.35);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <span style="transform: rotate(45deg); font-size: 15px; line-height: 1;">📍</span>
          </div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -30],
        });

        markerRef.current = L.marker([lat!, lng!], { icon: pinIcon }).addTo(map);
      }

      const popupContent = `
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4; min-width: 140px;">
          <strong style="color: #0f172a; font-size: 13px;">${title || "Location"}</strong>
          ${address ? `<div style="color: #475569; margin-top: 3px;">${address}</div>` : ""}
          ${zoneName ? `<div style="color: #2563eb; font-weight: 600; margin-top: 4px;">Zone: ${zoneName}</div>` : ""}
          <div style="color: #94a3b8; font-size: 11px; margin-top: 4px; font-family: monospace;">${lat!.toFixed(5)}, ${lng!.toFixed(5)}</div>
        </div>
      `;
      markerRef.current.setPopupContent(popupContent);

      map.setView([lat!, lng!], zoom);
    }
  }, [lat, lng, title, address, zoneName, hasCoords, mapReady, zoom]);

  // Render zones polygons on map
  useEffect(() => {
    const L = LRef.current;
    const layer = zoneLayerRef.current;
    const map = mapRef.current;
    if (!map || !L || !layer || !mapReady) return;

    layer.clearLayers();

    if (!zonePolygons || zonePolygons.length === 0) return;

    const bounds: any[] = [];
    if (hasCoords) {
      bounds.push([lat!, lng!]);
    }

    zonePolygons.forEach((z) => {
      if (!z.polygon || z.polygon.length < 3) return;

      const isSelected = z.id === selectedZoneId;
      const color = isSelected ? "#2563eb" : z.color || "#64748b";
      const latlngs = z.polygon.map((p) => [p.lat, p.lng]);

      if (isSelected) {
        latlngs.forEach((pt) => bounds.push(pt));
      }

      const poly = L.polygon(latlngs, {
        color: color,
        weight: isSelected ? 3 : 1.5,
        fillColor: color,
        fillOpacity: isSelected ? 0.25 : 0.08,
      });

      poly.bindTooltip(z.name, {
        sticky: true,
        className: "text-xs font-semibold px-2 py-1 rounded shadow-sm",
      });

      poly.addTo(layer);
    });

    if (bounds.length > 0 && selectedZoneId) {
      try {
        map.fitBounds(bounds, { padding: [25, 25], maxZoom: 15 });
      } catch {
        // ignore bounds fit error
      }
    }
  }, [zonePolygons, selectedZoneId, hasCoords, lat, lng, mapReady]);

  const copyCoords = () => {
    if (!hasCoords) return;
    navigator.clipboard.writeText(`${lat}, ${lng}`);
    setCopied(true);
    toast.success("Coordinates copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const googleMapsUrl = hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : null;

  return (
    <div className={cn("relative rounded-xl overflow-hidden border border-border shadow-sm bg-slate-100", className)}>
      <div
        ref={containerRef}
        style={{ height: typeof height === "number" ? `${height}px` : height }}
        className="w-full"
      />

      {!hasCoords && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/90 p-4 text-center z-20">
          <MapPin className="h-6 w-6 text-muted-foreground/60 mb-1.5" />
          <p className="text-xs font-semibold text-slate-700">No GPS coordinates recorded</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Partner has not dropped a location pin yet.
          </p>
        </div>
      )}

      {hasCoords && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
          <button
            type="button"
            onClick={copyCoords}
            className="h-7 px-2 rounded-md bg-white/95 backdrop-blur border border-slate-200 text-slate-700 text-[11px] font-medium flex items-center gap-1 shadow-sm hover:bg-slate-50 transition-colors"
            title="Copy Latitude & Longitude"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? "Copied" : "Coords"}</span>
          </button>
          {googleMapsUrl && (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-7 px-2 rounded-md bg-white/95 backdrop-blur border border-slate-200 text-blue-700 text-[11px] font-semibold flex items-center gap-1 shadow-sm hover:bg-blue-50 transition-colors"
              title="Open location in Google Maps"
            >
              <Navigation className="h-3 w-3 text-blue-600" />
              <span>Google Maps</span>
              <ExternalLink className="h-2.5 w-2.5 opacity-60" />
            </a>
          )}
        </div>
      )}

      {hasCoords && (
        <div className="absolute bottom-2 left-2 z-20 bg-black/75 backdrop-blur text-white px-2.5 py-1 rounded-md text-[11px] font-mono shadow-sm">
          {lat?.toFixed(5)}, {lng?.toFixed(5)}
        </div>
      )}
    </div>
  );
}
