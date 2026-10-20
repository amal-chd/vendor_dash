import React from "react";
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick?: () => void; href?: string };
  variant?: 'default' | 'inline';
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'default',
  className
}: EmptyStateProps) {
  
  if (variant === 'inline') {
    return (
      <div className={cn("py-8 flex flex-col items-center justify-center text-center text-muted-foreground", className)}>
        {Icon && <Icon className="w-8 h-8 mb-3 opacity-50" />}
        <h4 className="text-sm font-medium text-foreground">{title}</h4>
        {description && <p className="text-xs mt-1 max-w-xs mx-auto opacity-70">{description}</p>}
        {action && (
          <div className="mt-4">
            {action.href ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={action.href}>{action.label}</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center justify-center p-12 sm:p-16 border border-dashed border-border rounded-xl bg-card/50 text-center min-h-[300px]", className)}>
      <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-6 border border-border/50">
        {Icon ? <Icon className="w-8 h-8 text-muted-foreground" /> : <div className="w-8 h-8 bg-muted rounded-md" />}
      </div>
      <h3 className="text-lg font-semibold tracking-tight mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
          {description}
        </p>
      )}
      {action && (
        action.href ? (
          <Button asChild>
            <Link to={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button onClick={action.onClick}>
            {action.label}
          </Button>
        )
      )}
    </div>
  );
}
