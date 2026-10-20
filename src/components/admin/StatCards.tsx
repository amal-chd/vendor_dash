import React, { type ComponentType, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface StatItem {
  label?: string;
  title?: string;
  value: ReactNode;
  /** Tailwind text-color class, e.g. "text-emerald-600". Tints the icon, and the value when it is non-zero. */
  tone?: string;
  /** A component (lucide icon) or an already-rendered element. */
  icon?: ComponentType<{ className?: string }> | ReactNode;
  /** One short line of context under the value. */
  hint?: ReactNode;
  trend?: { value: number; label?: string; isPositive?: boolean };
  /** Drill-down — makes the card a button (e.g. apply the matching filter). */
  onClick?: () => void;
  /** Highlights the card whose filter is currently applied. */
  active?: boolean;
  loading?: boolean;
}

/**
 * Column classes per card count. Spelled out in full so Tailwind's scanner
 * sees every class. Each count fills its row exactly at the widest breakpoint,
 * so a KPI row never ends in an empty slot.
 */
const GRID: Record<number, string> = {
  1: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  // Never 3-up: five cards over three columns leaves a hole on the second row.
  5: "grid-cols-2 lg:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
  8: "grid-cols-2 lg:grid-cols-4",
};

/** On the 2-up phone grid an odd last card spans the row instead of leaving a hole. */
const ODD_TAIL: Record<number, string> = {
  3: "col-span-2 md:col-span-1",
  5: "col-span-2 lg:col-span-1",
};

/** "0", "₹0", "0.0%", "0 / 12" all read as zero — shown muted rather than in an alarm colour. */
function isZero(value: ReactNode): boolean {
  if (typeof value === "number") return value === 0;
  if (typeof value !== "string") return false;
  return /^[^\d]*0+(?:[.,]0+)?[^\d]*$/.test(value.trim());
}

function renderIcon(icon: StatItem["icon"]) {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  // lucide icons are forwardRef objects, not functions — anything that isn't
  // already an element is treated as a component.
  if (typeof icon === "function" || (typeof icon === "object" && "$$typeof" in (icon as object))) {
    return React.createElement(icon as ComponentType<{ className?: string }>, { className: "h-4 w-4" });
  }
  return null;
}

function StatCard({ s, className }: { s: StatItem; className?: string }) {
  const label = s.label || s.title;
  const zero = isZero(s.value);
  const tone = s.tone ?? "text-muted-foreground";
  const clickable = !!s.onClick;
  const Tag = clickable ? "button" : "div";

  return (
    <Tag
      type={clickable ? "button" : undefined}
      onClick={s.onClick}
      aria-pressed={clickable && s.active !== undefined ? s.active : undefined}
      className={cn(
        "flex h-full min-w-0 flex-col rounded-2xl border border-border/50 bg-card p-4 text-left shadow-sm sm:p-5",
        clickable &&
          "cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        s.active && "border-primary/60 ring-1 ring-primary/30",
        className,
      )}
    >
      {/* Label gets the full width; the icon sits beside the value, so six
          cards across a laptop screen don't truncate "Subscribed vendors". */}
      <p className="w-full truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground" title={label}>
        {label}
      </p>
      <div className="mt-1.5 flex w-full items-center justify-between gap-2">
        {s.loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <p
            className={cn(
              "min-w-0 truncate text-2xl font-bold tabular-nums tracking-tight",
              zero || !s.tone ? "text-foreground" : s.tone,
            )}
            title={typeof s.value === "string" || typeof s.value === "number" ? String(s.value) : undefined}
          >
            {s.value}
          </p>
        )}
        {s.icon && (
          <span
            className={cn(
              "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              zero ? "text-muted-foreground" : tone,
            )}
          >
            <span className="absolute inset-0 rounded-lg bg-current opacity-10" aria-hidden />
            <span className="relative flex [&_svg]:h-4 [&_svg]:w-4">{renderIcon(s.icon)}</span>
          </span>
        )}
      </div>
      {s.hint && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{s.hint}</p>}
      {s.trend && (
        <p className={cn("mt-1 truncate text-[11px]", s.trend.isPositive === false ? "text-rose-500" : "text-emerald-600")}>
          {s.trend.value > 0 ? (s.trend.isPositive === false ? "↓ " : "↑ ") : ""}
          {s.trend.value} {s.trend.label}
        </p>
      )}
    </Tag>
  );
}

/**
 * The one KPI row used across the admin console.
 *
 * Column count follows the number of cards so every row is full width with no
 * trailing gap. Keep rows to 2–6 cards (or 8); split anything larger into a
 * second, differently-titled section rather than one long wrapping row.
 */
export function StatCards({
  stats,
  items,
  cards,
  loading,
  className,
}: {
  stats?: StatItem[];
  items?: StatItem[];
  cards?: StatItem[];
  /** Shows skeleton values for every card. */
  loading?: boolean;
  className?: string;
}) {
  const list = stats ?? items ?? cards ?? [];
  if (list.length === 0) return null;
  const n = list.length;
  const grid = GRID[n] ?? "grid-cols-2 lg:grid-cols-4";

  return (
    <div className={cn("grid gap-3", grid, className)}>
      {list.map((s, idx) => (
        <StatCard
          key={s.label || s.title || idx}
          s={loading ? { ...s, loading: true } : s}
          className={idx === n - 1 ? ODD_TAIL[n] : undefined}
        />
      ))}
    </div>
  );
}
