import { Suspense, type ComponentType, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AdminErrorBoundary } from "@/components/admin/AdminErrorBoundary";
import { WorkspaceContext } from "./workspaceContext";

/**
 * The container every admin workspace is built from.
 *
 * The console used to carry ~60 top-level nav entries, so the same entity was
 * reached by a different route depending on where you started. Workspaces
 * collapse that into 14 destinations, each holding its specialist tools as
 * tabs — the pattern the Email channel already used, generalised.
 *
 * Two properties matter operationally:
 *
 *  - The active tab lives in `?tab=`, so a view is linkable. "Look at the
 *    refunds tab" is a URL, not a set of directions.
 *  - Tabs mount lazily and only when selected. A workspace with eight heavy
 *    pages must not pay for eight of them to open one.
 */

export interface WorkspaceTab {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Lazy component — only loaded when the tab is first opened. */
  component: ComponentType<Record<string, never>>;
  /** Small count/alert badge, e.g. items awaiting review. */
  badge?: number;
  /** Renders the tab in the warning tone when something needs attention. */
  alert?: boolean;
}

interface Props {
  title: string;
  description?: string;
  icon?: LucideIcon;
  tabs: WorkspaceTab[];
  defaultTab?: string;
  /** Right-aligned header actions that apply to the whole workspace. */
  actions?: ReactNode;
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function WorkspaceShell({
  title,
  description,
  icon: Icon,
  tabs,
  defaultTab,
  actions,
}: Props) {
  const [params, setParams] = useSearchParams();

  const urlTab = params.get("tab");
  const activeKey =
    (urlTab && tabs.some((t) => t.key === urlTab) ? urlTab : null) ??
    defaultTab ??
    tabs[0]?.key;
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  const select = (key: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", key);
    // Inner channel screens (Email, Push) keep their own pane in `section`.
    next.delete("section");
    // `replace` so tab-hopping doesn't bury the previous page in history.
    setParams(next, { replace: true });
  };

  const Active = active?.component;

  // A one-tab workspace has nothing to switch between: the page's own header
  // is the page title, so the shell steps aside rather than titling it twice.
  if (tabs.length === 1) {
    return (
      <AdminErrorBoundary key={active?.key}>
        <Suspense fallback={<TabFallback />}>{Active ? <Active /> : null}</Suspense>
      </AdminErrorBoundary>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight leading-none truncate">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Tab bar */}
      {/* overflow-y-hidden: the tabs' -mb-px overlap made every bar 1px too
          tall, which drew a stray vertical scrollbar at its right end. */}
      <div className="border-b overflow-x-auto overflow-y-hidden">
        <div className="flex gap-1 min-w-max">
          {tabs.map((t) => {
            const TabIcon = t.icon;
            const isActive = t.key === active?.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => select(t.key)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap -mb-px",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                {TabIcon && <TabIcon className="h-3.5 w-3.5" />}
                {t.label}
                {typeof t.badge === "number" && t.badge > 0 && (
                  <span
                    className={cn(
                      "ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums",
                      t.alert
                        ? "bg-rose-500/15 text-rose-600"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {t.badge > 99 ? "99+" : t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content — keyed so switching tabs resets local state cleanly. */}
      <AdminErrorBoundary key={active?.key}>
        <WorkspaceContext.Provider value={true}>
          <Suspense fallback={<TabFallback />}>{Active ? <Active /> : null}</Suspense>
        </WorkspaceContext.Provider>
      </AdminErrorBoundary>
    </div>
  );
}
