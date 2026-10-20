import { cn } from "@/lib/utils";

export function FilterChips({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-bold border transition-colors",
            value === o.id
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border/60 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
