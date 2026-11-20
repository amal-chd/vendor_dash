import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Loader2, Navigation, CheckCircle2 } from "lucide-react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast } from "sonner";
import { adminActionToast } from "@/lib/admin-ops";
import { useAdminScope } from "@/hooks/useAdminScope";
import { ROLE_COLLECTION, type PartnerRole } from "@/lib/onboarding";
import { LocationMapView } from "@/components/common/LocationMapView";
import { haversineKm, centroidOf, pointInPolygon } from "@/lib/leaflet";

interface AssignZoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partner: {
    role: PartnerRole;
    partnerId: string;
    name: string;
    zoneId?: string | null;
    zoneName?: string | null;
    location?: { lat: number; lng: number } | null;
    address?: string | null;
  } | null;
  onAssigned?: () => void;
}

export function AssignZoneDialog({
  open,
  onOpenChange,
  partner,
  onAssigned,
}: AssignZoneDialogProps) {
  const { zones } = useAdminScope();
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [reason, setReason] = useState("Assigned by admin during onboarding");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (partner?.zoneId) {
      setSelectedZoneId(partner.zoneId);
    } else {
      setSelectedZoneId(zones[0]?.id || "");
    }
  }, [partner, zones]);

  const selectedZone = useMemo(() => {
    return zones.find((z) => z.id === selectedZoneId) || null;
  }, [zones, selectedZoneId]);

  // Spatial relation between partner and selected zone
  const spatialInfo = useMemo(() => {
    if (!partner?.location || !selectedZone?.polygon || selectedZone.polygon.length < 3) {
      return null;
    }
    const inside = pointInPolygon(partner.location, selectedZone.polygon);
    const center = centroidOf(selectedZone.polygon);
    const distKm = haversineKm(partner.location, center);
    return { inside, distKm };
  }, [partner?.location, selectedZone]);

  if (!partner) return null;

  const handleAssign = async () => {
    if (!selectedZoneId) {
      toast.error("Please select a service zone");
      return;
    }
    const zoneObj = zones.find((z) => z.id === selectedZoneId);
    const zoneName = zoneObj?.name || selectedZoneId;

    setSubmitting(true);
    try {
      const collectionName = ROLE_COLLECTION[partner.role] || "restaurants";
      await updateDoc(doc(db, collectionName, partner.partnerId), {
        zoneId: selectedZoneId,
        zoneName,
        marketId: zoneObj?.marketId || null,
        zoneAssignment: "manual",
        "onboarding.zoneId": selectedZoneId,
        "onboarding.zoneName": zoneName,
        "onboarding.marketId": zoneObj?.marketId || null,
        updatedAt: serverTimestamp(),
      }).catch((err) => console.warn("Direct zone write skipped:", err));

      await adminActionToast(
        "overrideOnboardingZone",
        {
          role: partner.role,
          partnerId: partner.partnerId,
          zoneId: selectedZoneId,
          zoneName,
          marketId: zoneObj?.marketId || "",
          reason: reason.trim() || "Manual zone assignment by ops reviewer",
        },
        `Service zone "${zoneName}" assigned to ${partner.name}!`,
      );
      onAssigned?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error("Assign zone error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const zoneDisplays = zones.map((z) => ({
    id: z.id,
    name: z.name || z.id,
    polygon: z.polygon || [],
    color: z.colour,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-600" />
            Assign Service Zone
          </DialogTitle>
          <DialogDescription className="text-xs">
            Set the operating delivery or fulfillment territory for{" "}
            <strong className="text-foreground">{partner.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-1">
          {/* Interactive Zone Map */}
          <LocationMapView
            lat={partner.location?.lat}
            lng={partner.location?.lng}
            title={partner.name}
            address={partner.address || undefined}
            zoneName={partner.zoneName}
            zonePolygons={zoneDisplays}
            selectedZoneId={selectedZoneId}
            height={220}
          />

          {/* Spatial Match Indicator */}
          {spatialInfo && (
            <div
              className={`rounded-lg p-2.5 text-xs border flex items-center justify-between ${
                spatialInfo.inside
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30"
                  : "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30"
              }`}
            >
              <div className="flex items-center gap-2">
                {spatialInfo.inside ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                ) : (
                  <Navigation className="h-4 w-4 text-amber-600 shrink-0" />
                )}
                <span className="font-medium">
                  {spatialInfo.inside
                    ? "Store pin is inside this zone polygon"
                    : `Store pin is outside polygon (~${spatialInfo.distKm.toFixed(1)} km from center)`}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Select Service Zone</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring/30"
              value={selectedZoneId}
              onChange={(e) => setSelectedZoneId(e.target.value)}
            >
              <option value="">— Select a Zone —</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name || z.id}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Selecting a zone highlights its delivery polygon on the map above.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Audit Justification Note</Label>
            <Textarea
              className="text-xs"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Geocoded to Kochi West cluster per store address verification"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleAssign}
            disabled={!selectedZoneId || submitting}
            className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save & Assign Zone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
