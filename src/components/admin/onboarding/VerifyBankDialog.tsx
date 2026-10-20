import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Building, CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { adminActionToast } from "@/lib/admin-ops";
import { bankStateMeta, type BankVerificationState, type PartnerRole } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

interface VerifyBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partner: {
    role: PartnerRole;
    partnerId: string;
    name: string;
    bankState: BankVerificationState;
    bankMessage?: string;
    raw?: Record<string, any>;
  } | null;
  onVerified?: () => void;
}

export function VerifyBankDialog({
  open,
  onOpenChange,
  partner,
  onVerified,
}: VerifyBankDialogProps) {
  const [mode, setMode] = useState<"verify" | "reject">("verify");
  const [waiveMismatch, setWaiveMismatch] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!partner) return null;

  const bank = (partner.raw?.bank ?? {}) as Record<string, any>;
  const meta = bankStateMeta(partner.bankState);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (mode === "verify") {
        await adminActionToast(
          "setBankVerification",
          {
            role: partner.role,
            partnerId: partner.partnerId,
            to: "verified",
            message: note.trim() || "Manually verified by admin reviewer",
            acceptMismatch: waiveMismatch,
          },
          `Bank account for ${partner.name} verified successfully!`,
        );
      } else {
        if (!note.trim()) {
          toast.error("Please enter a reason for rejecting the bank details");
          setSubmitting(false);
          return;
        }
        await adminActionToast(
          "setBankVerification",
          {
            role: partner.role,
            partnerId: partner.partnerId,
            to: "rejected",
            message: note.trim(),
          },
          `Bank account rejected and sent back for correction.`,
        );
      }
      onVerified?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error("Bank verification error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between pr-4">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Building className="h-4 w-4 text-primary" />
              Bank Account Review
            </DialogTitle>
            <Badge variant="outline" className={cn("text-[10px]", meta.className)}>
              {meta.label}
            </Badge>
          </div>
          <DialogDescription className="text-xs">
            Review and certify settlement bank details for{" "}
            <strong className="text-foreground">{partner.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* Bank Snapshot */}
        <div className="rounded-xl border border-border/70 bg-muted/30 p-3 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Account</p>
              <p className="font-semibold font-mono">{bank.accountMasked || bank.accountNumber || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">IFSC Code</p>
              <p className="font-semibold font-mono">{bank.ifsc || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Bank Name</p>
              <p className="font-medium">{bank.bankName || bank.ifscBank || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Account Holder</p>
              <p className="font-medium">{bank.holderName || bank.accountHolder || "—"}</p>
            </div>
          </div>

          {bank.nameMatch && (
            <div className="pt-2 border-t border-border/50 flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Name Match:</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[9px] px-1.5",
                  bank.nameMatch.matched
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-600 border-rose-500/20"
                )}
              >
                {bank.nameMatch.matched ? "Matched" : "Mismatch Detected"}
              </Badge>
              {typeof bank.nameMatch.score === "number" && (
                <span className="text-[10px] text-muted-foreground">
                  ({Math.round(bank.nameMatch.score * 100)}% similarity)
                </span>
              )}
            </div>
          )}

          {partner.bankMessage && (
            <div className="pt-1 text-[11px] text-muted-foreground italic">
              Note: {partner.bankMessage}
            </div>
          )}
        </div>

        {/* Action Toggle */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === "verify" ? "default" : "outline"}
            size="sm"
            className={cn("flex-1 text-xs gap-1.5", mode === "verify" && "bg-emerald-600 hover:bg-emerald-700")}
            onClick={() => setMode("verify")}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approve & Verify
          </Button>
          <Button
            type="button"
            variant={mode === "reject" ? "destructive" : "outline"}
            size="sm"
            className="flex-1 text-xs gap-1.5"
            onClick={() => setMode("reject")}
          >
            <XCircle className="w-3.5 h-3.5" />
            Reject Details
          </Button>
        </div>

        {/* Mismatch waiver option */}
        {mode === "verify" && bank.nameMatch?.matched === false && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 space-y-1.5 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
            <div className="flex items-start gap-1.5 font-semibold text-amber-800">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Name mismatch waiver required
            </div>
            <p className="text-[11px] leading-relaxed">
              The account holder name does not strictly match the registered legal business name. Check authorization letters before proceeding.
            </p>
            <label className="flex items-center gap-2 pt-1 cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={waiveMismatch}
                onChange={(e) => setWaiveMismatch(e.target.checked)}
                className="rounded border-amber-400"
              />
              <span>Waive name mismatch and approve account</span>
            </label>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">
            {mode === "verify" ? "Reviewer Note (Optional)" : "Rejection Reason (Required)"}
          </Label>
          <Textarea
            className="text-xs"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              mode === "verify"
                ? "e.g. Cross-verified with cancelled cheque copy"
                : "e.g. IFSC code invalid or account holder name mismatch"
            }
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || (mode === "reject" && !note.trim())}
            variant={mode === "verify" ? "default" : "destructive"}
            className={cn(mode === "verify" && "bg-emerald-600 hover:bg-emerald-700")}
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {mode === "verify" ? "Confirm Verification" : "Reject Bank"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
