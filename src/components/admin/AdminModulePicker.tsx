import { useState } from "react";
import { ChevronDown, Grid2X2, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { adminModuleHome, type AdminModule } from "@/lib/adminModules";
import { cn } from "@/lib/utils";

export function AdminModuleIcon({ module }: { module: AdminModule }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
      {module.logo
        ? <img src={module.logo} alt="" className="size-7 rounded-md object-contain" />
        : <module.icon className="size-[18px]" aria-hidden="true" />}
    </span>
  );
}

export function AdminModulePicker({ active, modules, canOpen }: {
  active: AdminModule;
  modules: AdminModule[];
  canOpen: (path: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = modules.filter((module) =>
    `${module.label} ${module.description}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Switch module, current module ${active.label}`} className="h-9 gap-1.5 px-2.5">
          <Grid2X2 className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden max-w-28 truncate sm:inline">{active.label}</span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} aria-label="Product modules" className="w-[min(25rem,calc(100vw-1rem))] rounded-xl p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Switch module</h2>
          {canOpen("/admin/products") && (
            <Link to="/admin/products" onClick={() => { setOpen(false); setQuery(""); }} className="text-sm font-medium text-primary hover:underline">All products</Link>
          )}
        </div>
        <div className="relative my-3">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a module" placeholder="Find a module" className="h-9 pl-8" />
        </div>
        <div className="grid max-h-[min(60dvh,24rem)] grid-cols-3 gap-2 overflow-y-auto p-0.5">
          {results.map((module) => {
            const url = adminModuleHome(module, canOpen);
            return url && (
              <Link
                key={module.id}
                to={url}
                onClick={() => { setOpen(false); setQuery(""); }}
                aria-current={module.id === active.id ? true : undefined}
                className={cn("flex min-h-[75px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-center text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", module.id === active.id && "border-primary bg-primary/10 text-primary")}
              >
                <AdminModuleIcon module={module} />
                <span className="break-words">{module.label}</span>
              </Link>
            );
          })}
          {!results.length && <p className="col-span-full px-2 py-4 text-sm text-muted-foreground">No matching modules.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
