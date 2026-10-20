import { useAdminScope } from "@/hooks/useAdminScope";
import { cn } from "@/lib/utils";
import { MapPin, X, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "react-router-dom";

/**
 * The console-wide city/zone selector.
 *
 * Sits in the admin header so the scope is visible and changeable from every
 * page, rather than each page carrying its own location filter that the
 * operator has to re-apply as they move around.
 */
export function ZoneScopeBar({ className }: { className?: string }) {
  const { marketId, zoneId, setMarket, setZone, clear, markets, scopedZones, label, loading } =
    useAdminScope();

  const scoped = Boolean(marketId || zoneId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 h-8 text-xs font-semibold transition-colors max-w-[220px]",
            scoped
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
            className,
          )}
          title="Filter the whole console to a city or zone"
        >
          <MapPin className={cn("h-3.5 w-3.5 shrink-0", scoped && "text-primary")} />
          <span className="truncate">{loading ? "Loading areas…" : label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 rounded-xl">
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Scope the console
        </DropdownMenuLabel>

        <DropdownMenuItem
          onClick={clear}
          className={cn("text-xs cursor-pointer", !scoped && "font-bold")}
        >
          All areas
        </DropdownMenuItem>

        {markets.length > 0 && <DropdownMenuSeparator />}
        {markets.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => setMarket(m.id)}
            className={cn(
              "text-xs cursor-pointer",
              marketId === m.id && !zoneId && "font-bold",
            )}
          >
            <span className="flex-1 truncate">{m.name || m.city || m.id}</span>
            {m.status === "paused" && (
              <span className="text-[9px] uppercase tracking-wide text-amber-600">Paused</span>
            )}
          </DropdownMenuItem>
        ))}

        {scopedZones.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Zones
            </DropdownMenuLabel>
            {scopedZones.map((z) => (
              <DropdownMenuItem
                key={z.id}
                onClick={() => setZone(z.id)}
                className={cn("text-xs cursor-pointer", zoneId === z.id && "font-bold")}
              >
                <span
                  className="h-2 w-2 rounded-full mr-2 shrink-0"
                  style={{ backgroundColor: z.colour || "#94A3B8" }}
                />
                <span className="flex-1 truncate">{z.name || z.id}</span>
                {z.active === false && (
                  <span className="text-[9px] uppercase tracking-wide text-amber-600">Paused</span>
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {!loading && !markets.length && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-2">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                No cities yet. Add one, then draw its service zones.
              </p>
              <Link
                to="/admin/markets"
                className="mt-1.5 inline-block text-[11px] font-bold text-primary underline underline-offset-2"
              >
                Set up Markets &amp; Cities
              </Link>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A small inline badge naming a record's zone.
 *
 * Renders an explicit "No zone" rather than an empty cell — an unassigned
 * vendor is invisible to customers, so it needs to read as a problem, not as
 * missing decoration.
 */
export function ZoneBadge({
  zoneId,
  zoneName,
  className,
}: {
  zoneId?: string | null;
  zoneName?: string | null;
  className?: string;
}) {
  const { zones } = useAdminScope();
  const zone = zoneId ? zones.find((z) => z.id === zoneId) : undefined;
  const name = zoneName || zone?.name;

  if (!zoneId || !name) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-amber-600",
          className,
        )}
        title="Outside every service zone — customers cannot see this record"
      >
        <MapPin className="h-3 w-3" /> No zone
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", className)}>
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: zone?.colour || "#94A3B8" }}
      />
      <span className="truncate">{name}</span>
      {zone?.active === false && (
        <span className="text-[9px] uppercase tracking-wide text-amber-600">paused</span>
      )}
    </span>
  );
}

/** Dismissible chip shown above a scoped list, so the filter is never invisible. */
export function ZoneScopeChip() {
  const { isAll, label, clear } = useAdminScope();
  if (isAll) return null;
  return (
    <button
      type="button"
      onClick={clear}
      className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-foreground hover:bg-primary/15 transition-colors"
      title="Clear the area filter"
    >
      <MapPin className="h-3 w-3 text-primary" />
      {label}
      <X className="h-3 w-3 opacity-60" />
    </button>
  );
}
