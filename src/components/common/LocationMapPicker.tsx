import { useEffect, useRef, useState, useCallback } from "react";
import { loadLeaflet } from "@/lib/leaflet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, LocateFixed, Loader2, MapPin, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface LocationData {
  lat: number;
  lng: number;
  address?: string;
  district?: string;
  state?: string;
  pincode?: string;
}

interface LocationMapPickerProps {
  value?: {
    lat?: number | null;
    lng?: number | null;
    address?: string;
    district?: string;
    state?: string;
    pincode?: string;
  };
  onChange?: (loc: {
    lat: number;
    lng: number;
    address: string;
    district: string;
    state: string;
    pincode: string;
  }) => void;
  editable?: boolean;
  height?: string | number;
  className?: string;
  isMess?: boolean;
}

interface SearchResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: {
    road?: string;
    building?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    state_district?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

export function LocationMapPicker({
  value,
  onChange,
  editable = true,
  height = 280,
  className,
  isMess = false,
}: LocationMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  const [loadingMap, setLoadingMap] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [locating, setLocating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fallback default coordinates: Kerala / Kochi center
  const currentLat = typeof value?.lat === "number" && !isNaN(value.lat) ? value.lat : 9.9312;
  const currentLng = typeof value?.lng === "number" && !isNaN(value.lng) ? value.lng : 76.2673;
  const hasCoordinates = typeof value?.lat === "number" && typeof value?.lng === "number";

  // Reverse geocodes coordinates to street, district, state, pincode
  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
        );
        if (!res.ok) return null;
        const data: SearchResult = await res.json();
        const addr = data.address || {};

        // Build clean 1-line address
        const parts: string[] = [];
        if (data.name && data.name !== addr.road) parts.push(data.name);
        if (addr.building) parts.push(addr.building);
        if (addr.road) parts.push(addr.road);
        if (addr.neighbourhood || addr.suburb) parts.push(addr.neighbourhood || addr.suburb || "");

        const derivedAddress = parts.filter(Boolean).join(", ") || data.display_name.split(",").slice(0, 3).join(", ");
        const derivedDistrict = addr.city || addr.town || addr.village || addr.state_district || addr.county || "";
        const derivedState = addr.state || "Kerala";
        const derivedPincode = addr.postcode || "";

        return {
          address: derivedAddress,
          district: derivedDistrict,
          state: derivedState,
          pincode: derivedPincode,
        };
      } catch (e) {
        console.warn("[LocationMapPicker] Reverse geocoding error:", e);
        return null;
      }
    },
    []
  );

  // Notify parent of location changes
  const applyCoordinates = useCallback(
    async (lat: number, lng: number, overrideFields?: Partial<LocationData>) => {
      let fields = overrideFields;
      if (!fields || !fields.address) {
        const geo = await reverseGeocode(lat, lng);
        if (geo) {
          fields = {
            ...geo,
            ...overrideFields,
          };
        }
      }

      onChange?.({
        lat,
        lng,
        address: fields?.address ?? value?.address ?? "",
        district: fields?.district ?? value?.district ?? "",
        state: fields?.state ?? value?.state ?? "Kerala",
        pincode: fields?.pincode ?? value?.pincode ?? "",
      });
    },
    [onChange, reverseGeocode, value?.address, value?.district, value?.state, value?.pincode]
  );

  // Initialize Leaflet Map
  useEffect(() => {
    let active = true;

    loadLeaflet()
      .then((L) => {
        if (!active || !containerRef.current || mapRef.current) return;
        LRef.current = L;

        // Custom styled pin icon
        const pinIcon = L.divIcon({
          className: "",
          html: `<div style="
            background: #2563eb;
            width: 34px;
            height: 34px;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 3px solid #ffffff;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <span style="transform: rotate(45deg); font-size: 16px; line-height: 1;">📍</span>
          </div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 34],
          popupAnchor: [0, -32],
        });

        const initialZoom = hasCoordinates ? 15 : 11;
        const map = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: false,
        }).setView([currentLat, currentLng], initialZoom);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(map);

        const marker = L.marker([currentLat, currentLng], {
          icon: pinIcon,
          draggable: editable,
        }).addTo(map);

        if (editable) {
          marker.on("dragend", async () => {
            const pos = marker.getLatLng();
            await applyCoordinates(pos.lat, pos.lng);
          });

          map.on("click", async (e: any) => {
            const { lat, lng } = e.latlng;
            marker.setLatLng([lat, lng]);
            map.panTo([lat, lng], { animate: true });
            await applyCoordinates(lat, lng);
          });
        }

        markerRef.current = marker;
        mapRef.current = map;
        setLoadingMap(false);

        // Invalidate map size after initial render in dialog
        setTimeout(() => {
          map.invalidateSize();
        }, 200);
      })
      .catch((err) => {
        if (!active) return;
        setMapError(err?.message || "Failed to load map.");
        setLoadingMap(false);
      });

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update marker position if coordinates change externally
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    if (typeof value?.lat === "number" && typeof value?.lng === "number") {
      const cur = markerRef.current.getLatLng();
      if (Math.abs(cur.lat - value.lat) > 0.00001 || Math.abs(cur.lng - value.lng) > 0.00001) {
        markerRef.current.setLatLng([value.lat, value.lng]);
        mapRef.current.setView([value.lat, value.lng], mapRef.current.getZoom());
      }
    }
  }, [value?.lat, value?.lng]);

  // Debounced Place Search (OpenStreetMap Nominatim)
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 3) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery.trim()
        )}&addressdetails=1&countrycodes=in&limit=6`;
        const res = await fetch(url);
        if (res.ok) {
          const data: SearchResult[] = await res.json();
          setSearchResults(data);
          setShowDropdown(true);
        }
      } catch (err) {
        console.warn("[LocationMapPicker] Search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Select search result
  const handleSelectResult = async (item: SearchResult) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    if (isNaN(lat) || isNaN(lng)) return;

    setShowDropdown(false);
    setSearchQuery(item.name || item.display_name.split(",")[0]);

    if (mapRef.current && markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], 16, { animate: true });
    }

    const addr = item.address || {};
    const parts: string[] = [];
    if (item.name && item.name !== addr.road) parts.push(item.name);
    if (addr.building) parts.push(addr.building);
    if (addr.road) parts.push(addr.road);
    if (addr.neighbourhood || addr.suburb) parts.push(addr.neighbourhood || addr.suburb || "");

    const address = parts.filter(Boolean).join(", ") || item.display_name.split(",").slice(0, 3).join(", ");
    const district = addr.city || addr.town || addr.village || addr.state_district || addr.county || "";
    const state = addr.state || "Kerala";
    const pincode = addr.postcode || "";

    await applyCoordinates(lat, lng, { address, district, state, pincode });
  };

  // Auto-detect browser GPS position
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setLocating(false);

        if (mapRef.current && markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
          mapRef.current.setView([lat, lng], 16, { animate: true });
        }

        toast.success("Location detected from device GPS!");
        await applyCoordinates(lat, lng);
      },
      (err) => {
        setLocating(false);
        toast.error(
          err.code === 1
            ? "Location permission denied. Please allow location access or search your address."
            : "Could not obtain GPS location. Please search your place on the map."
        );
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const copyCoordinates = () => {
    if (!hasCoordinates) return;
    navigator.clipboard.writeText(`${value?.lat}, ${value?.lng}`);
    setCopied(true);
    toast.success("Coordinates copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      {editable && (
        <div className="relative z-20 flex items-center gap-2">
          {/* Place Search Bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => {
                if (searchResults.length > 0) setShowDropdown(true);
              }}
              placeholder={isMess ? "Search kitchen area, road, landmark, city…" : "Search restaurant area, road, landmark, city…"}
              className="pl-9 pr-9 h-9 text-xs"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
            )}

            {/* Autocomplete Suggestions Dropdown */}
            {showDropdown && searchResults.length > 0 && (
              <div
                className="absolute left-0 right-0 top-10 mt-1 max-h-60 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg z-50 text-xs"
                onMouseDown={(e) => e.preventDefault()}
              >
                {searchResults.map((item) => (
                  <button
                    key={item.place_id}
                    type="button"
                    onClick={() => handleSelectResult(item)}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-accent flex items-start gap-2.5 transition-colors"
                  >
                    <MapPin className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">
                        {item.name || item.display_name.split(",")[0]}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">{item.display_name}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Locate Me GPS Button */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={locating}
            onClick={handleLocateMe}
            className="h-9 px-3 shrink-0 text-xs font-semibold bg-white text-blue-700 border-blue-200 hover:bg-blue-50"
          >
            {locating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <LocateFixed className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
                Locate Me
              </>
            )}
          </Button>
        </div>
      )}

      {/* Interactive Map Box */}
      <div className="relative rounded-xl overflow-hidden border border-border shadow-sm bg-slate-100">
        <div
          ref={containerRef}
          style={{ height: typeof height === "number" ? `${height}px` : height }}
          className="w-full z-10"
        />

        {loadingMap && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 z-20">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Loading interactive map…
            </div>
          </div>
        )}

        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-rose-50/90 p-4 text-center z-20">
            <p className="text-xs text-rose-700 font-medium">{mapError}</p>
          </div>
        )}

        {/* Overlay Helper Bar */}
        {editable && !loadingMap && !mapError && (
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-20">
            <span className="bg-white/95 backdrop-blur px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-700 shadow-sm border border-slate-200/80">
              💡 Drag or tap map to position your entrance pin
            </span>
          </div>
        )}

        {/* Coordinates readout footer badge */}
        {hasCoordinates && (
          <div className="absolute bottom-2 left-2 z-20 bg-black/75 backdrop-blur text-white px-2.5 py-1 rounded-md text-[11px] font-mono flex items-center gap-2 shadow-sm">
            <span>
              {value?.lat?.toFixed(5)}, {value?.lng?.toFixed(5)}
            </span>
            <button
              type="button"
              onClick={copyCoordinates}
              className="text-white/80 hover:text-white"
              title="Copy Coordinates"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
