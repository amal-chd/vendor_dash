import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface Crumb {
  label: string;
  to?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  className?: string;
}

/**
 * Standard dashboard page header. Use it on every page so the visual rhythm
 * is consistent — title, optional subtitle/breadcrumbs/badge on the left;
 * action buttons aligned right; wraps cleanly on small screens.
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  badge,
  actions,
  crumbs,
  className,
}: Props) {
  return (
    <header className={cn("flex flex-col gap-4 pb-2 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0 space-y-1.5">
        {crumbs && crumbs.length > 0 && (
          <nav className="flex flex-wrap items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {crumbs.map((c, i) => (
              <span key={c.label + i} className="flex items-center gap-1">
                {c.to ? (
                  <Link to={c.to} className="hover:text-foreground transition-colors">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
                {i < crumbs.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          {icon && (
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary md:flex">
              {icon}
            </div>
          )}
          <h1 className="truncate text-2xl font-black tracking-tight text-foreground md:text-3xl">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="max-w-2xl text-sm font-medium text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
