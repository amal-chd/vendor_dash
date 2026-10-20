import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Loader2 } from "lucide-react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast } from "sonner";
import { adminActionToast } from "@/lib/admin-ops";
import { useAdminScope } from "@/hooks/useAdminScope";
import { ROLE_COLLECTION, type PartnerRole } from "@/lib/onboarding";

interface AssignZoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partner: {
    role: PartnerRole;
    partnerId: string;
    name: string;
    zoneId?: string | null;
    zoneName?: string | null;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            Assign Service Zone
          </DialogTitle>
          <DialogDescription className="text-xs">
            Set the operating delivery or fulfillment territory for{" "}
            <strong className="text-foreground">{partner.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Select Service Zone</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
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
              Assigning a zone enables order dispatching and customer visibility.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Audit Justification Note</Label>
            <Textarea
              className="text-xs"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Geocoded to Kochi West cluster per store address verification"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleAssign}
            disabled={!selectedZoneId || submitting}
            className="gap-1.5"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save Zone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
