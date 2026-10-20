import React, { useState } from "react";
import { format } from "date-fns";
import { Check, X, Clock, User, ShieldAlert, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/admin/entity360";
import { cn } from "@/lib/utils";

export interface ApprovalRequest {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  description: string;
  requesterEmail: string;
  requesterName?: string;
  approverEmail?: string;
  status: 'requested' | 'pending' | 'approved' | 'rejected' | 'executed';
  reason?: string;
  oldValue?: unknown;
  newValue?: unknown;
  comments?: string;
  createdAt?: Date;
  resolvedAt?: Date;
}

export interface ApprovalPanelProps {
  request: ApprovalRequest;
  onApprove?: (comment: string) => Promise<void> | void;
  onReject?: (reason: string) => Promise<void> | void;
  canApprove?: boolean;
  compact?: boolean;
}

export function ApprovalPanel({
  request,
  onApprove,
  onReject,
  canApprove = false,
  compact = false,
}: ApprovalPanelProps) {
  const [comment, setComment] = useState("");
  const [loadingAction, setLoadingAction] = useState<"approve" | "reject" | null>(null);

  const handleApprove = async () => {
    if (!onApprove) return;
    setLoadingAction("approve");
    try {
      await onApprove(comment);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleReject = async () => {
    if (!onReject) return;
    setLoadingAction("reject");
    try {
      await onReject(comment);
    } finally {
      setLoadingAction(null);
    }
  };

  const getStatusTone = () => {
    switch (request.status) {
      case 'approved':
      case 'executed': return 'success';
      case 'rejected': return 'danger';
      case 'requested':
      case 'pending': return 'warning';
      default: return 'neutral';
    }
  };

  const isPending = request.status === 'requested' || request.status === 'pending';

  return (
    <div className={cn(
      "border border-border rounded-xl bg-card overflow-hidden",
      !compact && "shadow-sm"
    )}>
      <div className="p-4 sm:p-5 border-b border-border/50 bg-secondary/20 flex flex-col sm:flex-row gap-4 justify-between sm:items-start">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary" />
              Approval Request: {request.action}
            </h3>
            <StatusBadge status={request.status.toUpperCase()} tone={getStatusTone()} />
          </div>
          <p className="text-sm text-muted-foreground">{request.description}</p>
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap text-left sm:text-right">
          <div className="flex items-center gap-1.5 justify-start sm:justify-end">
            <Clock className="w-3.5 h-3.5" />
            {request.createdAt ? format(request.createdAt, "MMM d, yyyy HH:mm") : "Unknown time"}
          </div>
          <div className="flex items-center gap-1.5 justify-start sm:justify-end mt-1">
            <User className="w-3.5 h-3.5" />
            {request.requesterName || request.requesterEmail}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-6">
        {request.reason && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Requester Reason</h4>
            <div className="bg-secondary/30 p-3 rounded-md text-sm border border-border/50">
              {request.reason}
            </div>
          </div>
        )}

        {(request.oldValue !== undefined || request.newValue !== undefined) && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Proposed Changes</h4>
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-muted/30 p-4 rounded-lg border border-border/50 text-sm overflow-x-auto">
              <div className="flex-1 min-w-0 bg-background border border-border rounded p-2.5 w-full">
                <div className="text-xs text-muted-foreground mb-1">Current Value</div>
                <pre className="font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all">
                  {request.oldValue ? JSON.stringify(request.oldValue, null, 2) : "None"}
                </pre>
              </div>
              <ArrowRight className="hidden sm:block w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0 bg-primary/5 border border-primary/20 rounded p-2.5 w-full">
                <div className="text-xs text-primary/70 mb-1">New Value</div>
                <pre className="font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all">
                  {request.newValue ? JSON.stringify(request.newValue, null, 2) : "None"}
                </pre>
              </div>
            </div>
          </div>
        )}

        {!isPending && request.comments && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Resolution Comments</h4>
            <div className="bg-secondary/30 p-3 rounded-md text-sm border border-border/50">
              <div className="font-medium mb-1">{request.approverEmail}</div>
              {request.comments}
            </div>
          </div>
        )}
      </div>

      {isPending && canApprove && (
        <div className="p-4 sm:p-5 border-t border-border/50 bg-secondary/10">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Your Action Required</h4>
          <Textarea 
            placeholder="Add a comment or reason (required for rejection)" 
            className="mb-4 text-sm resize-none"
            rows={2}
            value={comment}
            onChange={e => setComment(e.target.value)}
            disabled={loadingAction !== null}
          />
          <div className="flex flex-wrap items-center gap-3 justify-end">
            <Button 
              variant="outline" 
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
              disabled={loadingAction !== null || !comment.trim()}
              onClick={handleReject}
            >
              {loadingAction === "reject" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-2" />}
              Reject Request
            </Button>
            <Button 
              variant="default"
              disabled={loadingAction !== null}
              onClick={handleApprove}
            >
              {loadingAction === "approve" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Approve & Execute
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
