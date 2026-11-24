import { Outlet, Link, useLocation, Navigate } from "react-router-dom";
import { AsyncDialogHost } from "@/components/admin/core/asyncDialogs";
import { useEffect, useCallback, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { ROLE_LABELS } from "@/lib/rbac";
import { LogOut, Search, ChevronRight, ChevronDown, MessageSquare } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "./ThemeToggle";
import { AdminCommandMenu } from "./admin/AdminCommandMenu";
import { AdminScopeProvider } from "@/hooks/useAdminScope";
import { ZoneScopeBar } from "./admin/zones/ZoneScopeBar";
import { AdminErrorBoundary } from "./admin/AdminErrorBoundary";
import {
  AdminNotificationsProvider,
  useAdminNotifications,
} from "@/hooks/useAdminNotifications";
import { AdminNotificationCenter } from "./admin/notifications/AdminNotificationCenter";
import type { WorkspaceAlertCounts, AdminItemCounts } from "@/types/adminNotifications";
import { ADMIN_NAV, adminNavItemIsActive, hasVerseWorkspace, VERSE_WORKSPACE_PATH, splitNavPath, workspaceForAdminPath } from "@/lib/adminNavigation";
import { getAdminModule, groupsForModule, moduleForLocation, moduleLink, visibleAdminModules } from "@/lib/adminModules";
import { AdminModulePicker } from "./admin/AdminModulePicker";


const NAV_COLLAPSED_KEY = "kada_admin_module_nav_collapsed";

// ─── Page title map ───────────────────────────────────────────────────────────

/**
 * Breadcrumb labels, one per workspace route.
 *
 * Deliberately short: the tab strip inside the workspace already names the
 * pane, so repeating it in the breadcrumb would say the same thing twice.
 */
const PAGE_TITLES: Record<string, string> = {
  "/admin/products": "Products",
  "/admin": "Dashboard",
  "/admin/orders": "Orders & Operations",
  "/admin/customers": "Customers",
  "/admin/vendors": "Vendors",
  "/admin/delivery": "Delivery",
  "/admin/markets": "Markets & Zones",
  "/admin/finance": "Finance",
  "/admin/pricing": "Pricing",
  "/admin/plans": "Plans & Billing",
  "/admin/stay": "KadaStay",
  "/admin/mess": "Kada Mess",
  "/admin/support": "AI & Support",
  "/admin/quality": "Quality & Trust",
  "/admin/growth": "Marketing",
  "/admin/analytics": "Analytics",
  "/admin/settings": "Settings",
};

// ─── Auth check ───────────────────────────────────────────────────────────────

const fallbackAdmins = ["thekada@gmail.com", "thekadaapp@gmail.com"];
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || "")
  .split(",")
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

if (ADMIN_EMAILS.length === 0) {
  ADMIN_EMAILS.push(...fallbackAdmins);
}

function getWorkspaceBadge(wsId: string, workspaces: WorkspaceAlertCounts) {
  const count = workspaces[wsId as keyof WorkspaceAlertCounts] || 0;
  if (count <= 0) return null;
  const isCritical = wsId === "orders" && workspaces.orders > 0;
  return { count, isCritical };
}

function getItemBadge(
  path: string,
  counts: AdminItemCounts
): { count: number; variant: "critical" | "warning" | "info" } | null {
  if (path === "/admin/support?tab=chats" && counts.escalatedChats > 0) {
    return { count: counts.escalatedChats, variant: "critical" };
  }
  if (path === "/admin/finance?tab=settlements" && counts.pendingSettlements > 0) {
    return { count: counts.pendingSettlements, variant: "warning" };
  }
  if (path === "/admin/finance?tab=refunds" && counts.pendingRefunds > 0) {
    return { count: counts.pendingRefunds, variant: "warning" };
  }
  if (path === "/admin/orders?tab=incidents" && counts.openIncidents > 0) {
    return { count: counts.openIncidents, variant: "critical" };
  }
  if (path === "/admin/orders?tab=live" && counts.delayedDeliveries > 0) {
    return { count: counts.delayedDeliveries, variant: "critical" };
  }
  if (path === "/admin/vendors?tab=onboarding" && counts.vendorOnboarding > 0) {
    return { count: counts.vendorOnboarding, variant: "info" };
  }
  if (path === "/admin/delivery" && counts.riderOnboarding > 0) {
    return { count: counts.riderOnboarding, variant: "info" };
  }
  if (path === "/admin/stay?tab=hosts" && counts.hostOnboarding > 0) {
    return { count: counts.hostOnboarding, variant: "info" };
  }
  if (path === "/admin/quality?tab=bank" && counts.bankActionCount > 0) {
    return { count: counts.bankActionCount, variant: "warning" };
  }
  return null;
}

export default function AdminLayout() {
  return (
    <AdminScopeProvider>
      <AdminNotificationsProvider>
        <AdminLayoutContent />
      </AdminNotificationsProvider>
    </AdminScopeProvider>
  );
}

function AdminLayoutContent() {
  const location = useLocation();
  const { user } = useAuth();
  const { role, loading: permsLoading, canAccessWorkspace } = usePermissions();
  const { summary, counts } = useAdminNotifications();
  const [commandOpen, setCommandOpen] = useState(false);
  const [navQuery, setNavQuery] = useState("");
  const requestedModule = moduleForLocation(location.pathname, location.search);
  const defaultCollapsed = ADMIN_NAV.filter((group) => !["dashboard", "orders"].includes(group.id)).map((group) => `platform:${group.id}`);
  const [collapsedIds, setCollapsedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(NAV_COLLAPSED_KEY);
      if (!raw) return defaultCollapsed;
      const stored: unknown = JSON.parse(raw);
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(collapsedIds));
    } catch {
      // Sidebar preferences are optional.
    }
  }, [collapsedIds]);

  useEffect(() => {
    setNavQuery("");
    const group = groupsForModule(getAdminModule(requestedModule)).find((entry) =>
      entry.items.some((item) => adminNavItemIsActive(item.path, location.pathname, location.search))
    );
    if (group) setCollapsedIds((ids) => ids.filter((id) => id !== `${requestedModule}:${group.id}`));
  }, [location.pathname, location.search, requestedModule]);

  const toggleWs = (id: string) =>
    setCollapsedIds((ids) => ids.includes(id) ? ids.filter((key) => key !== id) : [...ids, id]);

  // CMD+K shortcut
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setCommandOpen((open) => !open);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Auth guard
  if (!user) return <Navigate to="/login" replace />;
  // Access is claim-aware: bootstrap owners (email) OR anyone with a resolved
  // admin role (platformAdmin claim → super, or a delegated `adminRole`). Wait
  // for the role claim to resolve before deciding, so a delegated admin isn't
  // flash-redirected on first paint while their token is still loading.
  const bootstrapAdmin =
    !!user.email && ADMIN_EMAILS.includes(user.email.toLowerCase());
  if (!bootstrapAdmin && permsLoading) {
    return (
      <div className="grid h-[100dvh] place-items-center bg-background text-sm text-muted-foreground">
        Loading your workspace…
      </div>
    );
  }
  if (!bootstrapAdmin && !role) return <Navigate to="/dashboard" replace />;

  const routeWorkspace = workspaceForAdminPath(location.pathname);
  if (role && routeWorkspace && !canAccessWorkspace(routeWorkspace)) {
    const fallback = ADMIN_NAV.flatMap((group) => group.items).find(({ path, document }) => {
      const workspace = workspaceForAdminPath(splitNavPath(path).pathname);
      return !document && workspace && canAccessWorkspace(workspace);
    });
    return <Navigate to={fallback?.path ?? "/dashboard"} replace />;
  }

  const isActive = (path: string) => adminNavItemIsActive(path, location.pathname, location.search);

  // Derive breadcrumb title
  const pageTitle =
    Object.entries(PAGE_TITLES)
      .sort((a, b) => b[0].length - a[0].length) // longest prefix first
      .find(([path]) =>
        path === "/admin"
          ? location.pathname === "/admin"
          : location.pathname.startsWith(path)
      )?.[1] ?? "Admin";

  // Logout
  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = "/";
  };

  // Avatar initial — first char of email
  const avatarInitial = user.email?.charAt(0).toUpperCase() ?? "A";

  const canOpen = (path: string) => {
    const workspace = workspaceForAdminPath(splitNavPath(path).pathname);
    return !workspace || (role ? canAccessWorkspace(workspace) : bootstrapAdmin);
  };
  const availableModules = visibleAdminModules(canOpen);
  const activeModule = availableModules.find((module) => module.id === requestedModule) ?? getAdminModule("platform");
  const q = navQuery.trim().toLowerCase();
  const visibleWorkspaces = (q ? ADMIN_NAV : groupsForModule(activeModule))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        canOpen(item.path) && (!q || `${group.label} ${item.label}`.toLowerCase().includes(q))
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <SidebarProvider>
      <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
        {/* ── Sidebar ─────────────────────────────────────────── */}
        <Sidebar
          collapsible="icon"
          className="border-r border-border/60 bg-background"
        >
          {/* Logo */}
          <SidebarHeader className="h-14 flex flex-row items-center justify-start border-b border-border/60 px-4">
            <Link
              to="/admin"
              className="flex items-center gap-2.5 group min-w-0"
              aria-label="Kada Verse Control Center"
            >
              <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 flex items-center justify-center shadow-sm">
                <img
                  src={hasVerseWorkspace ? `${VERSE_WORKSPACE_PATH}favicon.png` : "/logo.png"}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden overflow-hidden text-left">
                <span className="text-sm font-bold tracking-tight text-foreground truncate">
                  Kada Control Center
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">
                  {activeModule.label}
                </span>
              </div>
            </Link>
          </SidebarHeader>

          {/* Sidebar nav search */}
          <div className="px-3 pt-2.5 pb-1 group-data-[collapsible=icon]:hidden">
            <div className="flex items-center gap-2 h-8 rounded-md bg-muted/60 border border-border/50 px-2.5 focus-within:border-primary/50 transition-colors">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                value={navQuery}
                onChange={(e) => setNavQuery(e.target.value)}
                placeholder="Filter navigation…"
                aria-label="Filter navigation"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              />
              {navQuery && (
                <button
                  type="button"
                  onClick={() => setNavQuery("")}
                  aria-label="Clear filter"
                  className="text-muted-foreground hover:text-foreground text-xs leading-none"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Workspace accordion */}
          <SidebarContent className="py-2">
            {visibleWorkspaces.length === 0 && (
              <p className="px-4 py-6 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                No navigation matches “{navQuery}”.
              </p>
            )}
            {visibleWorkspaces.map((ws) => {
              const collapseKey = `${activeModule.id}:${ws.id}`;
              const open = !!q || !collapsedIds.includes(collapseKey);
              return (
                <SidebarGroup key={ws.id} className="px-2 py-0.5">
                  {/* Workspace header — accordion toggle (hidden in icon mode) */}
                  {(() => {
                    const wsBadge = getWorkspaceBadge(ws.id, summary.workspaces);
                    return (
                      <button
                        type="button"
                        onClick={() => toggleWs(collapseKey)}
                        aria-expanded={open}
                        className="group-data-[collapsible=icon]:hidden flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 hover:text-foreground hover:bg-muted/40 transition-colors"
                      >
                        <ws.icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="flex-1 text-left truncate">{ws.label}</span>
                        {wsBadge && (
                          <span
                            className={cn(
                              "h-4 min-w-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center mr-0.5",
                              wsBadge.isCritical
                                ? "bg-rose-500 text-white animate-pulse"
                                : "bg-muted text-foreground border border-border"
                            )}
                          >
                            {wsBadge.count > 99 ? "99+" : wsBadge.count}
                          </span>
                        )}
                        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 transition-transform", open ? "" : "-rotate-90")} />
                      </button>
                    );
                  })()}
                  <SidebarGroupContent className={cn(!open && "hidden group-data-[collapsible=icon]:block")}>
                    <SidebarMenu className="gap-0.5">
                      {ws.items.map((item) => {
                        const active = isActive(item.path);
                        const itemBadge = getItemBadge(item.path, counts);
                        return (
                          <SidebarMenuItem key={item.path}>
                            <SidebarMenuButton
                              asChild
                              isActive={active}
                              tooltip={item.label}
                              className={cn(
                                "h-8 rounded-md text-sm font-medium transition-colors",
                                active
                                  ? "bg-primary/10 text-primary font-semibold"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                              )}
                            >
                              <Link to={item.document ? item.path : moduleLink(item.path, q ? "platform" : activeModule.id)} reloadDocument={item.document} aria-current={active ? "page" : undefined} className="flex items-center gap-2.5">
                                <item.icon
                                  className={cn(
                                    "w-4 h-4 shrink-0",
                                    active ? "text-primary" : "text-muted-foreground"
                                  )}
                                />
                                <span className="group-data-[collapsible=icon]:hidden">
                                  {item.label}
                                </span>
                                {itemBadge && (
                                  <span
                                    className={cn(
                                      "ml-auto h-4 min-w-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center group-data-[collapsible=icon]:hidden",
                                      itemBadge.variant === "critical"
                                        ? "bg-rose-500 text-white animate-pulse"
                                        : itemBadge.variant === "warning"
                                        ? "bg-amber-500 text-white"
                                        : "bg-primary/20 text-primary font-bold"
                                    )}
                                  >
                                    {itemBadge.count > 99 ? "99+" : itemBadge.count}
                                  </span>
                                )}
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })}
          </SidebarContent>

          {/* Footer */}
          <SidebarFooter className="border-t border-border/60 p-3 space-y-1">
            {/* User info row */}
            <div className="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
              <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-semibold text-primary">
                  {avatarInitial}
                </span>
              </div>
              <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden min-w-0">
                <span className="text-xs font-medium text-foreground truncate max-w-[140px]">
                  {user.email}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {role ? ROLE_LABELS[role] : "Administrator"}
                </span>
              </div>
            </div>

            {/* Logout button */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2.5 h-8 rounded-md text-sm font-medium text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
              onClick={handleLogout}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className="group-data-[collapsible=icon]:hidden">
                Log out
              </span>
            </Button>
          </SidebarFooter>
        </Sidebar>

        {/* ── Main Content ────────────────────────────────────── */}
        <SidebarInset className="flex-1 overflow-hidden flex flex-col bg-muted/30">
          {/* Header */}
          <header className="h-14 flex items-center justify-between gap-2 px-2 sm:px-4 border-b border-border/60 bg-background/80 backdrop-blur-sm shrink-0">
            {/* Left: trigger + breadcrumb */}
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors -ml-1" />
              <Separator orientation="vertical" className="h-4" />
              <nav className="hidden min-w-0 items-center gap-1 text-sm sm:flex">
                <span className="text-muted-foreground font-medium">Admin</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="truncate text-foreground font-semibold">{pageTitle}</span>
              </nav>
            </div>

            {/* Center/Right: scope + search + actions */}
            <div className="flex items-center gap-2">
              <div className="hidden xl:block">
                <ZoneScopeBar />
              </div>

              {/* CMD+K Search hint */}
              <button
                onClick={() => setCommandOpen(true)}
                className="hidden md:flex items-center gap-2 h-8 bg-muted/60 border border-border/60 hover:bg-muted/80 rounded-md px-3 w-36 2xl:w-52 transition-all text-muted-foreground"
              >
                <Search className="w-3.5 h-3.5 shrink-0" />
                <span className="text-sm flex-1 text-left">Search...</span>
                <kbd className="inline-flex items-center rounded border border-border/60 bg-background px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                  ⌘K
                </kbd>
              </button>
              
              {/* Mobile Search Button */}
              <Button aria-label="Search the console"
                variant="ghost"
                size="icon"
                onClick={() => setCommandOpen(true)}
                className="md:hidden relative h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Search className="w-4 h-4" />
              </Button>

              {/* Theme toggle */}
              <div className="hidden sm:block"><ThemeToggle /></div>

              {/* Support Chat */}
              {(!role || canAccessWorkspace("support")) && (
              <Button
                variant="ghost"
                size="icon"
                asChild
                className="relative h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Link to="/admin/support?tab=chats" aria-label="Support chats">
                  <MessageSquare className="w-4 h-4" />
                  {counts.escalatedChats > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white border-2 border-background animate-pulse">
                      {counts.escalatedChats > 99 ? "99+" : counts.escalatedChats}
                    </span>
                  )}
                </Link>
              </Button>
              )}

              {/* Notifications */}
              <AdminNotificationCenter />

              <AdminModulePicker
                active={activeModule}
                modules={availableModules}
                canOpen={canOpen}
              />
            </div>
          </header>

          <div className="flex items-center gap-2 border-b bg-background px-3 py-2 xl:hidden">
            <ZoneScopeBar />
          </div>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            <AdminErrorBoundary>
              <Outlet context={{ canOpen }} />
            </AdminErrorBoundary>
          </main>
        </SidebarInset>
      </div>
      <AdminCommandMenu open={commandOpen} setOpen={setCommandOpen} canOpen={canOpen} activeModule={activeModule.id} />
      <AsyncDialogHost />
    </SidebarProvider>
  );
}
