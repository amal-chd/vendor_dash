import React, { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LucideIcon, ArrowRight, ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tone, StatusBadge, Metric } from "@/components/admin/entity360";
import { cn } from "@/lib/utils";

export interface EntityDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  status?: string;
  statusTone?: Tone;
  metrics?: Metric[];
  detailPath?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function EntityDrawer({
  open,
  onOpenChange,
  icon: Icon,
  title,
  subtitle,
  status,
  statusTone,
  metrics,
  detailPath,
  actions,
  children,
}: EntityDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[520px] lg:max-w-[600px] flex flex-col p-0 border-l border-border/40 bg-background overflow-hidden">
        <SheetHeader className="p-6 border-b border-border/40 shrink-0 text-left">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {Icon && (
                <div className="p-2.5 bg-secondary/50 text-secondary-foreground rounded-lg border border-border/50 shrink-0 mt-1">
                  <Icon className="w-5 h-5" />
                </div>
              )}
              <div>
                <SheetTitle className="text-xl font-semibold flex items-center gap-2">
                  {title}
                  {status && (
                    <StatusBadge status={status} tone={statusTone || "neutral"} />
                  )}
                </SheetTitle>
                {subtitle && (
                  <SheetDescription className="text-sm mt-1.5 text-muted-foreground">
                    {subtitle}
                  </SheetDescription>
                )}
              </div>
            </div>
            {detailPath && (
              <Button variant="ghost" size="icon" asChild className="shrink-0 -mr-2">
                <Link to={detailPath} title="Open Full Details">
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  <span className="sr-only">Open Full Details</span>
                </Link>
              </Button>
            )}
          </div>
          
          {metrics && metrics.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
              {metrics.map((metric, i) => (
                <div key={i} className="flex flex-col gap-1 text-left">
                  <span className="text-xs font-medium text-muted-foreground">
                    {metric.label}
                  </span>
                  <span className="text-sm font-semibold">{metric.value}</span>
                </div>
              ))}
            </div>
          )}
        </SheetHeader>
        
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
          {children}
        </div>
        
        <SheetFooter className="p-6 border-t border-border/40 shrink-0 bg-secondary/20 flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          {detailPath ? (
            <Button variant="link" asChild className="p-0 h-auto text-muted-foreground hover:text-foreground">
              <Link to={detailPath} className="flex items-center gap-1.5">
                View full entity details <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </Button>
          ) : (
            <div />
          )}
          {actions && (
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
              {actions}
            </div>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
