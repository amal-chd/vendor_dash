import { createContext, useContext, useState, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * Shared shell for the two — and only two — communication channels
 * (Mobile Notifications, Email). One clean layout: a channel header, a
 * segmented App selector (scopes the whole channel to one Kada app), an
 * optional KPI strip, and an underlined tab bar. Every tab reads `useCommsApp()`
 * so its data/events/templates/audiences scope to the selected app.
 */

export type AppKey = "all" | "customer" | "vendor" | "delivery" | "host";

export const APP_OPTIONS: { key: AppKey; label: string; dot: string }[] = [
  { key: "all", label: "All Apps", dot: "bg-slate-400" },
  { key: "customer", label: "Customer", dot: "bg-blue-500" },
  { key: "vendor", label: "Vendor", dot: "bg-amber-500" },
  { key: "delivery", label: "Delivery", dot: "bg-emerald-500" },
  { key: "host", label: "Host", dot: "bg-rose-500" },
];

const AppCtx = createContext<AppKey>("all");
export const useCommsApp = () => useContext(AppCtx);

const TabNavCtx = createContext<(key: string) => void>(() => {});
/** Switch the active channel tab from a child page (e.g. Overview CTAs). */
export const useChannelTab = () => useContext(TabNavCtx);

/** Map an email/template category to the Kada app it belongs to. Shared/cross-app
 *  categories (auth, announcements, support, system) map to "all". */
export function categoryToApp(category?: string): AppKey {
  switch ((category || "").toLowerCase()) {
    case "vendor": return "vendor";
    case "rider": return "delivery";
    case "host": return "host";
    case "orders": case "payments": case "billing": case "marketing":
    case "subscriptions": case "recommendations": case "loyalty": case "cart":
    case "promotions": case "reviews": return "customer";
    default: return "all";
  }
}

/** Map a communication-profile userType to its app. */
export function userTypeToApp(ut?: string): AppKey {
  switch ((ut || "").toUpperCase()) {
    case "CUSTOMER": return "customer";
    case "VENDOR": case "RESTAURANT_STAFF": return "vendor";
    case "DELIVERY_PARTNER": return "delivery";
    case "HOST": return "host";
    default: return "all";
  }
}

/** True when an item belonging to `itemApp` should show under the `selected` app. */
export function matchesApp(selected: AppKey, itemApp: AppKey): boolean {
  return selected === "all" || itemApp === "all" || itemApp === selected;
}

export interface ChannelTab {
  key: string;
  label: string;
  icon?: ReactNode;
  element: ReactNode;
}

/** Segmented App selector — one-tap, no dropdown. */
export function AppSelector({
  value,
  onChange,
}: {
  value: AppKey;
  onChange: (v: AppKey) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-muted/40 p-1">
      {APP_OPTIONS.map((a) => (
        <button
          key={a.key}
          onClick={() => onChange(a.key)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
            value === a.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", a.dot)} />
          {a.label}
        </button>
      ))}
    </div>
  );
}

export function ChannelShell({
  title,
  subtitle,
  icon,
  tabs,
  kpis,
  defaultTab,
  headerRight,
  embedded = false,
}: {
  title: string;
  subtitle: string;
  icon?: ReactNode;
  tabs: ChannelTab[];
  kpis?: ReactNode;
  defaultTab?: string;
  headerRight?: ReactNode;
  /** Inside a workspace, keep `?tab=` for the workspace and use `?section=` here. */
  embedded?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const param = embedded ? "section" : "tab";
  const urlApp = searchParams.get("app") as AppKey | null;
  const [app, setAppState] = useState<AppKey>(
    urlApp && APP_OPTIONS.some((a) => a.key === urlApp) ? urlApp : "all"
  );
  const urlTab = searchParams.get(param);
  const active =
    (urlTab && tabs.some((t) => t.key === urlTab) ? urlTab : null) ||
    defaultTab ||
    tabs[0]?.key;
  const current = tabs.find((t) => t.key === active) || tabs[0];

  const setApp = (value: AppKey) => {
    setAppState(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === "all") next.delete("app");
      else next.set("app", value);
      return next;
    }, { replace: true });
  };

  const setActive = (key: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(param, key);
      return next;
    }, { replace: true });
  };

  return (
    <AppCtx.Provider value={app}>
      <TabNavCtx.Provider value={setActive}>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          {embedded ? (
            <p className="text-sm text-muted-foreground max-w-xl">{subtitle}</p>
          ) : (
            <div className="flex items-center gap-3">
              {icon && (
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  {icon}
                </div>
              )}
              <div>
                <h2 className="text-lg font-semibold tracking-tight leading-none">{title}</h2>
                <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            {headerRight}
            <AppSelector value={app} onChange={setApp} />
          </div>
        </div>

        {/* KPI strip */}
        {kpis}

        {/* Tab bar */}
        <div className="border-b overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActive(t.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap -mb-px",
                  active === t.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div>{current?.element}</div>
      </div>
      </TabNavCtx.Provider>
    </AppCtx.Provider>
  );
}

/** Honest placeholder for engine views not yet surfaced — clean, not fake data. */
export function EngineComingSoon({
  what,
  detail,
  icon,
}: {
  what: string;
  detail: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/20 py-16 px-6 text-center">
      {icon && <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">{icon}</div>}
      <p className="font-bold text-foreground">{what}</p>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">{detail}</p>
    </div>
  );
}
