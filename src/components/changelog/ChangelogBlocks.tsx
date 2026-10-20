import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { Block, Span } from "@/lib/changelogMarkdown";

/**
 * Renders a changelog body from its block tree.
 *
 * Blocks are produced by the server parser (or its web mirror, for the live
 * editor preview), which has already allow-listed every link and image, so
 * this component never touches raw HTML.
 *
 * `density` switches between the roomy website layout and the tighter card
 * used for in-app previews in the editor.
 */
export function ChangelogBlocks({
  blocks,
  density = "comfortable",
  className,
}: {
  blocks: Block[];
  density?: "comfortable" | "compact";
  className?: string;
}) {
  const compact = density === "compact";

  if (!blocks.length) return null;

  return (
    <div className={cn(compact ? "space-y-2.5" : "space-y-4", "text-foreground/90", className)}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h2":
            return (
              <h3
                key={i}
                className={cn(
                  "font-bold tracking-tight text-foreground",
                  compact ? "text-[15px] pt-1" : "text-lg pt-2",
                )}
              >
                <Spans spans={b.s} />
              </h3>
            );
          case "h3":
            return (
              <h4
                key={i}
                className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}
              >
                <Spans spans={b.s} />
              </h4>
            );
          case "p":
            return (
              <p key={i} className={cn("leading-relaxed", compact ? "text-[13px]" : "text-[15px]")}>
                <Spans spans={b.s} />
              </p>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                className={cn(
                  "border-l-2 border-primary/50 pl-3 text-muted-foreground",
                  compact ? "text-[13px]" : "text-[15px]",
                )}
              >
                <Spans spans={b.s} />
              </blockquote>
            );
          case "ul":
          case "ol": {
            const List = b.t === "ul" ? "ul" : "ol";
            return (
              <List
                key={i}
                className={cn(
                  "space-y-1.5 pl-5 leading-relaxed marker:text-muted-foreground",
                  b.t === "ul" ? "list-disc" : "list-decimal",
                  compact ? "text-[13px]" : "text-[15px]",
                )}
              >
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item.s} />
                  </li>
                ))}
              </List>
            );
          }
          case "img":
            return (
              <img
                key={i}
                src={b.src}
                alt={b.alt}
                loading="lazy"
                className="w-full rounded-xl border border-border object-cover"
              />
            );
          case "hr":
            return <hr key={i} className="border-border" />;
          default:
            return null;
        }
      })}
    </div>
  );
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        let node: React.ReactNode = s.x;
        if (s.c) {
          node = (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">{s.x}</code>
          );
        }
        if (s.i) node = <em>{node}</em>;
        if (s.b) node = <strong className="font-semibold text-foreground">{node}</strong>;

        if (s.href) {
          // App deep links can't open in a browser; show them as text.
          if (s.href.startsWith("kada://")) {
            return (
              <span key={i} className="font-medium text-foreground" title={s.href}>
                {node}
              </span>
            );
          }
          const external = /^https?:\/\//i.test(s.href) || s.href.startsWith("mailto:");
          return (
            <a
              key={i}
              href={s.href}
              className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {node}
            </a>
          );
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}
