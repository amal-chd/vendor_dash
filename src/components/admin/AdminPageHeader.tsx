import type { ComponentType, ReactNode } from "react";
import { StatCards, type StatItem } from "@/components/admin/StatCards";
import { useInWorkspace } from "@/components/admin/core/workspaceContext";

interface AdminPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Alias for `description`. */
  subtitle?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  logoSrc?: string;
  /** A small badge/chip rendered next to the title. */
  badge?: ReactNode;
  /** Right-aligned actions (buttons, filters) shown next to the title. */
  actions?: ReactNode;
  /** Alias for `actions`. */
  action?: ReactNode;
  /** @deprecated use `actions` — accepted so older pages keep working. */
  children?: ReactNode;
  /** Optional KPI row rendered under the title via the shared StatCards. */
  stats?: StatItem[];
}

/**
 * Consistent admin page header — title + description + optional actions and a
 * KPI stat row. Standardizes the ad-hoc headers across admin pages so every
 * page reads the same. Pair with `StatCards` for the data-driven KPI row.
 */
export function AdminPageHeader({
  title,
  description,
  subtitle,
  icon: Icon,
  logoSrc,
  badge,
  actions,
  action,
  children,
  stats,
}: AdminPageHeaderProps) {
  const right = actions ?? action ?? children;
  const desc = description ?? subtitle;
  // Inside a workspace the shell already carries the page title and icon, so
  // this header becomes the tab's section heading.
  const nested = useInWorkspace();
  const Heading = nested ? "h2" : "h1";
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Heading
            className={
              nested
                ? "flex items-center gap-2 text-lg font-semibold tracking-tight"
                : "flex items-center gap-2 text-2xl font-bold tracking-tight"
            }
          >
            {!nested &&
              (logoSrc ? (
                <img src={logoSrc} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
              ) : (
                Icon && <Icon className="w-6 h-6 text-primary shrink-0" />
              ))}
            <span className="truncate">{title}</span>
            {badge}
          </Heading>
          {desc && (
            <p className="text-muted-foreground mt-1 text-sm">{desc}</p>
          )}
        </div>
        {right && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {right}
          </div>
        )}
      </div>
      {stats && stats.length > 0 && <StatCards stats={stats} />}
    </div>
  );
}
