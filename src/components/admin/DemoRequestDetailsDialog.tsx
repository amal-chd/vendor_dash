import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Mail, Phone, CalendarClock, MapPin, 
  TrendingUp, AlertCircle, Globe, Clock, 
  CheckCircle2, XCircle, Send
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface DemoRequest {
  id: string;
  restaurantName: string;
  email: string;
  phone: string;
  city?: string;
  monthlyRevenue?: string;
  outlets?: string;
  painPoint?: string;
  status?: "new" | "contacted" | "booked" | "closed";
  createdAt?: any;
  createdAtIso?: string;
  source?: string;
}

interface DemoRequestDetailsDialogProps {
  request: DemoRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusUpdate: (id: string, status: NonNullable<DemoRequest["status"]>) => Promise<void>;
}

export function DemoRequestDetailsDialog({
  request,
  open,
  onOpenChange,
  onStatusUpdate
}: DemoRequestDetailsDialogProps) {
  if (!request) return null;

  const buildMailto = () => {
    const subject = encodeURIComponent(`Kada Dine Demo for ${request.restaurantName || "your restaurant"}`);
    const lines = [
      `Hi ${request.restaurantName || "team"},`,
      ``,
      `Thanks for requesting a Kada Dine demo.`,
      `When would you be available for a 15-minute call today or tomorrow?`,
      ``,
      `We will cover: POS billing, QR digital menu, table ordering, KDS/KOT, GST reports, inventory and analytics.`,
      ``,
      `Regards,`,
      `Kada Dine Team`,
    ];
    const body = encodeURIComponent(lines.join("\n"));
    return `mailto:${encodeURIComponent(request.email || "")}?subject=${subject}&body=${body}`;
  };

  const getStatusColor = (status: string = "new") => {
    switch (status) {
      case "new": return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
      case "contacted": return "bg-blue-500/10 text-blue-600 border-blue-500/20";
      case "booked": return "bg-primary/10 text-primary border-primary/20";
      case "closed": return "bg-muted text-muted-foreground border-border/40";
      default: return "bg-muted text-muted-foreground border-border/40";
    }
  };

  const formatDate = () => {
    if (!request.createdAt) return request.createdAtIso || "—";
    try {
      const date = request.createdAt?.toDate ? request.createdAt.toDate() : new Date(request.createdAt);
      return format(date, "MMM d, yyyy • h:mm a");
    } catch (e) {
      return "Invalid Date";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden rounded-2xl border-none shadow-2xl">
        <div className="h-32 bg-primary/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <CalendarClock className="w-32 h-32 rotate-12" />
          </div>
          <div className="absolute inset-0 flex items-center px-8">
            <div className="h-16 w-16 rounded-[1.5rem] bg-card shadow-xl flex items-center justify-center border-2 border-primary/20">
              <span className="text-2xl font-black text-primary">
                {request.restaurantName?.[0]?.toUpperCase() || "R"}
              </span>
            </div>
            <div className="ml-5">
              <h2 className="text-xl font-semibold tracking-tight text-foreground uppercase">
                {request.restaurantName}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={cn("rounded-lg font-semibold uppercase text-[10px] tracking-wide px-2", getStatusColor(request.status))}>
                  {(request.status || "new").toUpperCase()}
                </Badge>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {formatDate()}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8">
          {/* Contact Details */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Mail className="w-3 h-3" />
                  Email Address
                </div>
                <p className="text-sm font-bold text-foreground">{request.email}</p>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Phone className="w-3 h-3" />
                  Phone Number
                </div>
                <p className="text-sm font-bold text-foreground">{request.phone}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="w-3 h-3" />
                  Location / City
                </div>
                <p className="text-sm font-bold text-foreground">{request.city || "Not provided"}</p>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3" />
                  Business Size
                </div>
                <p className="text-sm font-bold text-foreground">{request.monthlyRevenue || (request.outlets ? `${request.outlets} outlets` : "Not provided")}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3 p-5 rounded-3xl bg-muted/30 border border-border/40">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Pain Points / Requirements
            </div>
            <p className="text-sm font-medium text-foreground leading-relaxed">
              {request.painPoint || "The user didn't specify any particular pain points."}
            </p>
          </div>

          <div className="flex flex-col gap-3">
             <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Quick Actions</div>
             <div className="grid grid-cols-3 gap-3">
                <Button 
                  onClick={() => onStatusUpdate(request.id, "contacted")}
                  variant="outline" 
                  disabled={request.status === "contacted"}
                  className="rounded-2xl h-12 flex flex-col items-center justify-center gap-1 font-semibold uppercase text-[9px] tracking-wide border-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  Mark Contacted
                </Button>
                <Button 
                  onClick={() => onStatusUpdate(request.id, "booked")}
                  variant="outline" 
                   disabled={request.status === "booked"}
                  className="rounded-2xl h-12 flex flex-col items-center justify-center gap-1 font-semibold uppercase text-[9px] tracking-wide border-2 text-primary border-primary/20 hover:bg-primary/5 hover:border-primary/40"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Confirm Demo
                </Button>
                <Button 
                  onClick={() => onStatusUpdate(request.id, "closed")}
                  variant="outline" 
                   disabled={request.status === "closed"}
                  className="rounded-2xl h-12 flex flex-col items-center justify-center gap-1 font-semibold uppercase text-[9px] tracking-wide border-2 text-destructive border-destructive/10 hover:bg-destructive/5"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Close lead
                </Button>
             </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button asChild className="flex-1 rounded-2xl h-12 font-semibold uppercase text-[11px] tracking-wider shadow-xl shadow-primary/20">
              <a href={buildMailto()}>
                <Mail className="w-4 h-4 mr-2" />
                Email Response
              </a>
            </Button>
            <Button asChild variant="outline" className="flex-1 rounded-2xl h-12 font-semibold uppercase text-[11px] tracking-wider border-2">
              <a href={`tel:${encodeURIComponent(request.phone.replace(/\s+/g, ""))}`}>
                <Phone className="w-4 h-4 mr-2" />
                Call Lead
              </a>
            </Button>
          </div>

          {request.source && (
            <div className="pt-2 text-center">
               <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
                 Source: {request.source}
               </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
