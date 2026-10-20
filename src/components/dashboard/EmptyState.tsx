import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** "card" matches dashboard cards; "ghost" sits inside another container. */
  variant?: "card" | "ghost";
}

/**
 * Standardised empty state — same visual language wherever a list, table,
 * or chart has nothing to show. Use action for a CTA button.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  variant = "card",
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-14",
        variant === "card" && "rounded-2xl border-2 border-dashed border-border/60 bg-card/40",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground/70">
          {icon}
        </div>
      )}
      <h3 className="text-base font-black tracking-tight text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm font-medium text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
