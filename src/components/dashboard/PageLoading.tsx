import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Props {
  /** How many KPI / stat tiles to render at the top. */
  stats?: number;
  /** Render a chart-shaped placeholder under the stats. */
  chart?: boolean;
  /** How many table-style rows to render at the bottom. */
  rows?: number;
  className?: string;
}

/**
 * Page-level skeleton that mirrors the dashboard's usual layout: a header,
 * a row of KPI tiles, an optional chart, then a table. Replaces the lone
 * spinner most pages render during the initial Firestore fetch.
 */
export function PageLoading({ stats = 4, chart = true, rows = 6, className }: Props) {
  return (
    <div className={cn("space-y-6", className)} aria-busy="true">
      {/* Header skeleton */}
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-10 w-28 rounded-2xl" />
      </div>

      {/* KPI tiles */}
      {stats > 0 && (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${stats}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/40 p-5 space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {chart && (
        <div className="rounded-2xl border border-border/40 p-5 space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      )}

      {/* Table rows */}
      {rows > 0 && (
        <div className="rounded-2xl border border-border/40 overflow-hidden">
          <div className="border-b border-border/40 bg-muted/30 px-5 py-3">
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="divide-y divide-border/40">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-2 w-1/5" />
                </div>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-20 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
