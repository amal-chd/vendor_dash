import { useEffect, useRef, useState, useCallback } from "react";
import { loadLeaflet, areaSqKm, centroidOf, type LatLng } from "@/lib/leaflet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MousePointer2, Pencil, Undo2, Trash2, Crosshair, Loader2 } from "lucide-react";

export interface ZoneShape {
  id: string;
  name: string;
  colour: string;
  polygon: LatLng[];
  active: boolean;
}

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "vendor" | "rider";
}

interface Props {
  /** The zone being edited. Its ring is the one the user can change. */
  draft: LatLng[];
  onChange: (polygon: LatLng[]) => void;
  /** Other zones, drawn dimmed for context so boundaries can be lined up. */
  others?: ZoneShape[];
  /** Vendor / rider markers, so coverage gaps are visible while drawing. */
  pins?: MapPin[];
  colour?: string;
  centre?: LatLng;
  className?: string;
}

type Mode = "pan" | "draw";

/**
 * Draw and edit a service-area boundary on a map.
 *
 * Built directly on Leaflet primitives rather than Leaflet.draw: the plugin
 * adds a second runtime dependency and a toolbar we would have to restyle
 * anyway, and the interaction we actually need is small — click to add a
 * vertex, drag a handle to move one, click a handle to delete it.
 *
 * The ring is stored open (no repeated closing point); `L.polygon` closes it
 * visually. The server normalises the same way, so what is drawn is what is
 * stored.
 */
export function ZonePolygonEditor({
  draft,
  onChange,
  others = [],
  pins = [],
  colour = "#0F6E6A",
  centre,
  className,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const draftLayer = useRef<any>(null);
  const contextLayer = useRef<any>(null);
  const pinLayer = useRef<any>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("draw");

  // The click handler is re-registered whenever the ring changes, so it needs
  // the newest value without re-creating the map. A ref keeps the map stable.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // ── Map bootstrap (once) ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L: any) => {
        if (cancelled || !elRef.current || mapRef.current) return;
        LRef.current = L;
        const start = centre ?? (draft.length ? centroidOf(draft) : { lat: 9.9312, lng: 76.2673 });
        const map = L.map(elRef.current, {
          zoomControl: true,
          attributionControl: false,
          doubleClickZoom: false, // double-click is "finish drawing", not zoom
        }).setView([start.lat, start.lng], draft.length ? 13 : 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
        contextLayer.current = L.layerGroup().addTo(map);
        pinLayer.current = L.layerGroup().addTo(map);
        draftLayer.current = L.layerGroup().addTo(map);

        map.on("click", (e: any) => {
          if (modeRef.current !== "draw") return;
          const next = [...draftRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }];
          onChangeRef.current(next);
        });

        mapRef.current = map;
        setReady(true);
      })
      .catch((e) => setError(e?.message || "Could not load the map."));
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Deliberately mounts once — later prop changes are handled by the draw
    // effects below, and re-creating the map would lose the user's viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Draft ring + vertex handles ───────────────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const layer = draftLayer.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!draft.length) return;

    const latlngs = draft.map((p) => [p.lat, p.lng]);

    if (draft.length >= 3) {
      L.polygon(latlngs, {
        color: colour,
        weight: 2,
        fillColor: colour,
        fillOpacity: 0.16,
      }).addTo(layer);
    } else {
      L.polyline(latlngs, { color: colour, weight: 2, dashArray: "5,5" }).addTo(layer);
    }

    draft.forEach((p, i) => {
      const handle = L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: colour,
        fillOpacity: 1,
        // Handles must stay grabbable while panning, so they are always
        // interactive regardless of mode.
        interactive: true,
        bubblingMouseEvents: false,
      }).addTo(layer);

      handle.bindTooltip(`Point ${i + 1} — click to remove, drag to move`, {
        direction: "top",
        offset: [0, -8],
      });

      handle.on("click", (e: any) => {
        L.DomEvent.stopPropagation(e);
        // Refuse below three points rather than silently producing an invalid
        // ring the server will reject on save.
        if (draftRef.current.length <= 3) return;
        onChangeRef.current(draftRef.current.filter((_, idx) => idx !== i));
      });

      // Hand-rolled drag: circleMarker has no draggable option.
      handle.on("mousedown", (e: any) => {
        L.DomEvent.stopPropagation(e);
        const map = mapRef.current;
        map.dragging.disable();
        const move = (ev: any) => {
          handle.setLatLng(ev.latlng);
          const next = draftRef.current.map((pt, idx) =>
            idx === i ? { lat: ev.latlng.lat, lng: ev.latlng.lng } : pt,
          );
          onChangeRef.current(next);
        };
        const up = () => {
          map.off("mousemove", move);
          map.off("mouseup", up);
          map.dragging.enable();
        };
        map.on("mousemove", move);
        map.on("mouseup", up);
      });
    });
  }, [draft, ready, colour]);

  // ── Neighbouring zones, dimmed ────────────────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const layer = contextLayer.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    for (const z of others) {
      if (z.polygon.length < 3) continue;
      L.polygon(
        z.polygon.map((p) => [p.lat, p.lng]),
        {
          color: z.colour,
          weight: 1,
          opacity: z.active ? 0.65 : 0.3,
          fillColor: z.colour,
          fillOpacity: z.active ? 0.06 : 0.03,
          dashArray: z.active ? undefined : "4,4",
          interactive: false,
        },
      )
        .addTo(layer)
        .bindTooltip(z.active ? z.name : `${z.name} (paused)`, { sticky: true });
    }
  }, [others, ready]);

  // ── Vendor / rider pins ───────────────────────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const layer = pinLayer.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    for (const p of pins) {
      L.circleMarker([p.lat, p.lng], {
        radius: 4,
        weight: 1,
        color: "#ffffff",
        fillColor: p.kind === "vendor" ? "#B45309" : "#1D4ED8",
        fillOpacity: 0.95,
        interactive: true,
      })
        .addTo(layer)
        .bindTooltip(p.label, { direction: "top", offset: [0, -6] });
    }
  }, [pins, ready]);

  const fit = useCallback(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || draft.length < 2) return;
    map.fitBounds(
      L.latLngBounds(draft.map((p) => [p.lat, p.lng])),
      { padding: [40, 40] },
    );
  }, [draft]);

  const area = draft.length >= 3 ? areaSqKm(draft) : 0;

  return (
    <div className={cn("relative rounded-xl border border-border overflow-hidden bg-muted/20", className)}>
      <div ref={elRef} className="h-[460px] w-full" />

      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-background/90 p-6 text-center">
          <div>
            <p className="text-sm font-semibold text-foreground">Map unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs">{error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-[400] flex flex-col gap-1.5">
        <div className="flex rounded-lg border border-border bg-background/95 backdrop-blur shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setMode("draw")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors",
              mode === "draw" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Pencil className="h-3 w-3" /> Draw
          </button>
          <button
            type="button"
            onClick={() => setMode("pan")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors border-l border-border",
              mode === "pan" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MousePointer2 className="h-3 w-3" /> Pan
          </button>
        </div>

        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 bg-background/95 backdrop-blur"
            disabled={!draft.length}
            onClick={() => onChange(draft.slice(0, -1))}
            title="Remove the last point"
          >
            <Undo2 className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 bg-background/95 backdrop-blur"
            disabled={draft.length < 2}
            onClick={fit}
            title="Zoom to fit the boundary"
          >
            <Crosshair className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 bg-background/95 backdrop-blur text-rose-600 hover:text-rose-600"
            disabled={!draft.length}
            onClick={() => onChange([])}
            title="Clear the boundary"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Readout */}
      <div className="absolute bottom-3 left-3 z-[400] rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Boundary</p>
        <p className="text-xs font-bold text-foreground tabular-nums">
          {draft.length} {draft.length === 1 ? "point" : "points"}
          {area > 0 && <span className="text-muted-foreground font-medium"> · {area.toFixed(1)} km²</span>}
        </p>
        {draft.length > 0 && draft.length < 3 && (
          <p className="mt-0.5 text-[10px] font-medium text-amber-600">
            Needs at least 3 points
          </p>
        )}
      </div>

      {mode === "draw" && draft.length === 0 && ready && (
        <div className="absolute bottom-3 right-3 z-[400] rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-sm max-w-[220px]">
          <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">
            Click on the map to drop each corner of the service area. Drag a point to move it,
            click it to remove it.
          </p>
        </div>
      )}
    </div>
  );
}
