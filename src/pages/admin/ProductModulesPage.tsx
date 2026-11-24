import { Link, Navigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowUpRight, ChevronRight, Grid2X2 } from "lucide-react";
import { AdminModuleIcon } from "@/components/admin/AdminModulePicker";
import { Button } from "@/components/ui/button";
import { adminModuleHome, groupsForModule, moduleLink, visibleAdminModules } from "@/lib/adminModules";
import { ADMIN_NAV } from "@/lib/adminNavigation";

export default function ProductModulesPage() {
  const { productId } = useParams();
  const { canOpen } = useOutletContext<{ canOpen: (path: string) => boolean }>();
  const modules = visibleAdminModules(canOpen);

  if (!productId) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Products and workspaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">Choose a product to open its tools, or use the Control Center for shared operations.</p>
        </header>
        {([{ id: "operations", label: "Operations" }, { id: "portfolio", label: "Product portfolio" }] as const).map(({ id, label }) => (
          <section key={id} aria-labelledby={`products-${id}`} className="space-y-3">
            <h2 id={`products-${id}`} className="text-base font-semibold">{label}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {modules.filter((module) => module.category === id).map((module) => {
                const url = adminModuleHome(module, canOpen);
                return url && (
                  <Link key={module.id} to={url} className="flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/30">
                    <AdminModuleIcon module={module} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{module.label}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>
                    </div>
                    <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const module = modules.find((item) => item.id === productId);
  if (!module || module.id === "platform") return <Navigate to="/admin/products" replace />;

  const groups = groupsForModule(module)
    .map((group) => ({
      ...group,
      label: group.id === "product-overview" ? "Brand management" : group.label,
      items: group.items.filter((item) => !item.path.startsWith("/admin/products") && canOpen(item.path)),
    }))
    .filter((group) => group.items.length);
  const shared = ADMIN_NAV
    .filter((group) => ["finance", "support", "analytics", "settings"].includes(group.id) && !module.groups.includes(group.id))
    .map((group) => ({ ...group.items[0], label: group.label }))
    .filter((item) => canOpen(item.path));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <AdminModuleIcon module={module} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{module.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>
          </div>
        </div>
        <Button variant="outline" asChild><Link to="/admin/products"><Grid2X2 className="mr-2 size-4" />All products</Link></Button>
      </header>

      {module.category === "portfolio" && (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          Product operations are managed separately. Use the links below to open the product or its store listing.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <section key={group.id} className="rounded-xl border bg-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-base font-semibold"><group.icon className="size-4 text-primary" />{group.label}</h2>
            {group.items.map((item) => (
              <Link key={item.path} to={item.document ? item.path : moduleLink(item.path, module.id)} reloadDocument={item.document} className="flex min-h-10 items-center justify-between gap-2 rounded-md px-2 text-sm hover:bg-accent">
                {item.label}<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))}
          </section>
        ))}
        {!!module.links?.length && (
          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-base font-semibold">Product links</h2>
            {module.links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="flex min-h-10 items-center justify-between gap-2 rounded-md px-2 text-sm hover:bg-accent">
                {link.label}<ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </a>
            ))}
          </section>
        )}
      </div>

      {!!shared.length && module.category === "operations" && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold">Shared operations</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">These tools cover the whole platform. Use their filters to narrow the data.</p>
          <div className="flex flex-wrap gap-2">
            {shared.map((item) => <Button key={item.path} asChild variant="outline" size="sm"><Link to={moduleLink(item.path, "platform")}>{item.label}</Link></Button>)}
          </div>
        </section>
      )}
    </div>
  );
}
