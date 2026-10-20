import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Phone, Mail, MessageSquare, Copy, Check, ExternalLink } from "lucide-react";
import { useState } from "react";

interface VendorContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    city?: string;
  } | null;
}

export function VendorContactDialog({
  open,
  onOpenChange,
  vendor,
}: VendorContactDialogProps) {
  const [copied, setCopied] = useState(false);

  if (!vendor) return null;

  const rawPhone = (vendor.phone || "").replace(/[^0-9]/g, "");
  const formattedPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;

  const handleCopyInfo = () => {
    const text = [
      `Vendor: ${vendor.name}`,
      `Email: ${vendor.email || "—"}`,
      `Phone: ${vendor.phone || "—"}`,
      `City: ${vendor.city || "—"}`,
      `ID: ${vendor.id}`,
    ].join("\n");

    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Vendor contact information copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    if (!rawPhone) {
      toast.error("No phone number available for WhatsApp");
      return;
    }
    const msg = encodeURIComponent(`Hello ${vendor.name}, this is Kada Partner Support. How can we assist you today?`);
    window.open(`https://wa.me/${formattedPhone}?text=${msg}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Contact {vendor.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Connect directly with the restaurant owner or manager
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 py-2">
          {/* WhatsApp */}
          <Button
            variant="outline"
            className="w-full justify-between h-11 border-emerald-500/30 hover:bg-emerald-50 hover:text-emerald-700 text-xs font-semibold"
            onClick={handleWhatsApp}
            disabled={!vendor.phone}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div className="text-left">
                <div>WhatsApp Message</div>
                <div className="text-[10px] text-muted-foreground font-normal">{vendor.phone || "No phone"}</div>
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>

          {/* Phone Call */}
          <a
            href={vendor.phone ? `tel:${vendor.phone}` : undefined}
            className={`w-full flex items-center justify-between h-11 px-4 rounded-md border border-input bg-background hover:bg-muted text-xs font-semibold ${!vendor.phone ? "pointer-events-none opacity-50" : ""}`}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-600">
                <Phone className="h-4 w-4" />
              </div>
              <div className="text-left">
                <div>Voice Call</div>
                <div className="text-[10px] text-muted-foreground font-normal">{vendor.phone || "No phone"}</div>
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>

          {/* Email */}
          <a
            href={vendor.email ? `mailto:${vendor.email}?subject=Kada%20Partner%20Support` : undefined}
            className={`w-full flex items-center justify-between h-11 px-4 rounded-md border border-input bg-background hover:bg-muted text-xs font-semibold ${!vendor.email ? "pointer-events-none opacity-50" : ""}`}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-600">
                <Mail className="h-4 w-4" />
              </div>
              <div className="text-left">
                <div>Send Email</div>
                <div className="text-[10px] text-muted-foreground font-normal">{vendor.email || "No email"}</div>
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>

          {/* Copy info */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground hover:text-foreground gap-1.5"
            onClick={handleCopyInfo}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied All Info" : "Copy Contact Info"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
