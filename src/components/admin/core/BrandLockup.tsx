import { cn } from "@/lib/utils";
import { useInWorkspace } from "./workspaceContext";

export type BrandLockupProps = {
  title: string;
  subtitle?: string;
};

/**
 * Product logo + page title. Matches `AdminPageHeader`: a page title on its
 * own route, a section heading when it sits inside a workspace tab.
 */
export function BrandLockup({
  title,
  subtitle,
  logoSrc,
  logoAlt,
  logoClassName,
}: BrandLockupProps & { logoSrc: string; logoAlt: string; logoClassName?: string }) {
  const nested = useInWorkspace();
  const Heading = nested ? "h2" : "h1";
  return (
    <div className="flex items-center gap-3 min-w-0">
      <img
        src={logoSrc}
        alt={logoAlt}
        className={cn(
          "shrink-0 rounded-[10px] object-cover shadow-sm",
          nested ? "h-8 w-8" : "h-10 w-10",
          logoClassName,
        )}
      />
      <div className="min-w-0">
        <Heading
          className={cn(
            "truncate tracking-tight text-foreground",
            nested ? "text-lg font-semibold" : "text-2xl font-bold",
          )}
        >
          {title}
        </Heading>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}
