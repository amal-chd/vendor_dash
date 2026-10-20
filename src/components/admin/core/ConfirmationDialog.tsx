import React, { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";

export interface ConfirmationDialogProps {
  // Controlled open state — accepts either naming convention.
  open?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  // Or uncontrolled: pass a trigger and the dialog manages its own open state.
  trigger?: React.ReactNode;

  title: string;
  description?: string;
  consequences?: string[];
  requireReason?: boolean;
  reasonLabel?: string;

  // Confirm button label — either naming.
  confirmLabel?: string;
  confirmText?: string;

  // Destructive styling — any of these.
  variant?: "destructive" | "default" | string;
  confirmVariant?: string;
  isDanger?: boolean;

  loading?: boolean;
  onConfirm: (reason?: string) => void | Promise<void>;
}

export function ConfirmationDialog({
  open,
  isOpen,
  onOpenChange,
  onClose,
  trigger,
  title,
  description,
  consequences,
  requireReason = false,
  reasonLabel = "Reason for action",
  confirmLabel,
  confirmText,
  variant,
  confirmVariant,
  isDanger,
  loading = false,
  onConfirm,
}: ConfirmationDialogProps) {
  const [reason, setReason] = useState("");
  const [internalOpen, setInternalOpen] = useState(false);

  const controlled = open !== undefined || isOpen !== undefined;
  const openState = controlled ? (open ?? isOpen ?? false) : internalOpen;

  const setOpen = (v: boolean) => {
    if (loading) return;
    if (controlled) {
      onOpenChange?.(v);
      if (!v) onClose?.();
    } else {
      setInternalOpen(v);
    }
  };

  const isDestructive =
    isDanger === true ||
    variant === "destructive" ||
    confirmVariant === "destructive" ||
    (variant === undefined && confirmVariant === undefined && isDanger === undefined);

  const label = confirmText ?? confirmLabel ?? "Confirm";

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (requireReason && !reason.trim()) return;
    await onConfirm(requireReason ? reason : undefined);
    if (!loading) {
      setReason("");
      setOpen(false);
    }
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) setReason("");
    setOpen(v);
  };

  return (
    <AlertDialog open={openState} onOpenChange={handleOpenChange}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {isDestructive && <AlertTriangle className="w-5 h-5 text-destructive" />}
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="text-base text-foreground/80 pt-2">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {consequences && consequences.length > 0 && (
          <div className="bg-muted/50 rounded-lg p-4 text-sm mt-2 border border-border/50">
            <h4 className="font-medium text-foreground mb-2">Consequences:</h4>
            <ul className="space-y-1.5">
              {consequences.map((c, i) => (
                <li key={i} className="flex gap-2 text-muted-foreground items-start">
                  <span className="text-foreground shrink-0 mt-0.5">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {requireReason && (
          <div className="space-y-2 mt-2">
            <Label htmlFor="reason" className="text-sm font-medium">
              {reasonLabel} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              placeholder="Please provide a reason..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none h-24"
              disabled={loading}
            />
          </div>
        )}

        <AlertDialogFooter className="mt-6 border-t border-border/40 pt-4 -mx-6 px-6 sm:px-6">
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <Button
            variant={isDestructive ? "destructive" : "default"}
            disabled={loading || (requireReason && !reason.trim())}
            onClick={handleConfirm}
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
