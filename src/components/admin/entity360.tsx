import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Entity-360 design system (spec §40) — one consistent scaffold reused by every
 * 360 view (Order, Vendor, Customer, Rider, Host, Property…). The prop shapes
 * are intentionally permissive so the various 360 pages can use whichever alias
 * reads best (label/status, main/children, time/timestamp, detail/description).
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "destructive" | "admin";

const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  destructive: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  admin: "bg-primary/10 text-primary",
};

export function StatusBadge({
  label,
  status,
  tone = "neutral",
  className,
}: {
  label?: ReactNode;
  status?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        TONE_PILL[tone],
        className,
      )}
    >
      {status ?? label}
    </span>
  );
}

export interface Metric {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
}

export function Entity360Header({
  backTo,
  backLabel = "Back",
  icon: Icon,
  title,
  subtitle,
  status,
  statusTone = "neutral",
  metrics = [],
  actions,
}: {
  backTo?: string;
  backLabel?: string;
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional entity type tag (accepted for compatibility). */
  type?: ReactNode;
  status?: ReactNode;
  statusTone?: Tone;
  metrics?: Metric[];
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {backTo && (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
        </Link>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight text-foreground truncate">{title}</h1>
              {status && <StatusBadge status={status} tone={statusTone} />}
            </div>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>

      {metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {metrics.map((m, i) => (
            <div key={i} className="rounded-lg border border-border/60 bg-card px-3.5 py-3">
              <p className="text-[11px] font-medium text-muted-foreground truncate">{m.label}</p>
              <p
                className={cn(
                  "mt-1 text-lg font-bold tabular-nums leading-tight truncate",
                  m.tone === "success" && "text-emerald-600 dark:text-emerald-400",
                  (m.tone === "danger" || m.tone === "destructive") && "text-rose-600 dark:text-rose-400",
                  m.tone === "warning" && "text-amber-600 dark:text-amber-400",
                )}
              >
                {m.value}
              </p>
              {m.hint && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{m.hint}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border/60 bg-card", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Entity360Layout({
  main,
  children,
  header,
  rail,
}: {
  main?: ReactNode;
  children?: ReactNode;
  header?: ReactNode;
  rail: ReactNode;
}) {
  return (
    <div className="space-y-5">
      {header}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">{main ?? children}</div>
        <div className="space-y-5">{rail}</div>
      </div>
    </div>
  );
}

/** A key/value row for the overview / facts panels. */
export function Fact({
  label,
  children,
  value,
  icon: Icon,
  link,
}: {
  label: string;
  children?: ReactNode;
  value?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  link?: string;
}) {
  const content = children ?? value ?? "—";
  const inner = (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate">{content}</span>
    </span>
  );
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-foreground text-right min-w-0">
        {link ? (
          <Link to={link} className="hover:text-primary hover:underline transition-colors">
            {inner}
          </Link>
        ) : (
          inner
        )}
      </span>
    </div>
  );
}

export interface TimelineEvent {
  id?: string;
  time?: Date | string | null;
  timestamp?: Date | string | null;
  title: ReactNode;
  detail?: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  admin?: boolean;
  active?: boolean;
  icon?: LucideIcon;
}

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  destructive: "bg-rose-500",
  admin: "bg-primary",
};

const asDate = (x?: Date | string | null): Date | null => (x instanceof Date ? x : null);
const ms = (x?: Date | string | null) => (x instanceof Date ? x.getTime() : 0);
const fmtWhen = (x?: Date | string | null) => {
  const d = asDate(x);
  if (d) return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return typeof x === "string" ? x : "—";
};

/** Chronological event timeline (spec §7) — lifecycle + admin actions together. */
export function Timeline({ events, items }: { events?: TimelineEvent[]; items?: TimelineEvent[] }) {
  const list = events ?? items ?? [];
  const sorted = [...list].sort((a, b) => ms(a.time ?? a.timestamp) - ms(b.time ?? b.timestamp));
  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No timeline events recorded yet.</p>;
  }
  return (
    <ol className="relative ml-1">
      <span className="absolute left-[5px] top-1 bottom-1 w-px bg-border" aria-hidden />
      {sorted.map((e, i) => {
        const when = e.time ?? e.timestamp;
        const detail = e.detail ?? e.description;
        return (
          <li key={e.id ?? i} className="relative flex gap-3 pb-4 last:pb-0 pl-4">
            <span
              className={cn(
                "absolute left-0 top-1 h-[11px] w-[11px] rounded-full ring-4 ring-card",
                TONE_DOT[e.tone ?? "neutral"],
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">{e.title}</span>
                {e.admin && (
                  <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                    <ShieldCheck className="h-2.5 w-2.5" /> Admin
                  </span>
                )}
              </div>
              {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">{fmtWhen(when)}</span>
          </li>
        );
      })}
    </ol>
  );
}
