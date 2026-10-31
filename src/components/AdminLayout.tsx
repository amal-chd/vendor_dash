import { Outlet, Link, useLocation, Navigate } from "react-router-dom";
import { AsyncDialogHost } from "@/components/admin/core/asyncDialogs";
import { useEffect, useCallback, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { type Role, type Workspace } from "@/lib/rbac";
import {
  LayoutDashboard,
  BarChart3,
  Building2,
  Users,
  CreditCard,
  Headset,
  ChefHat,
  MessageSquare,
  CalendarCheck,
  CalendarClock,
  ShieldCheck,
  FileCheck2,
  Bell,
  Download,
  LogOut,
  Search,
  ChevronRight,
  ChevronDown,
  Settings,
  Dot,
  Bike,
  PackageSearch,
  Smartphone,
  Ticket,
  Share2,
  HeartHandshake,
  Megaphone,
  Mail,
  Send,
  Layers,
  Inbox,
  Gift,
  SlidersHorizontal,
  ShoppingBag,
  BookOpen,
  Hotel,
  Sparkles,
  Zap,
  FileText,
  Target,
  Calendar,
  AlertTriangle,
  Cpu,
  Activity,
  UserCog, Star, MapPin, Map,
  Wallet,
  Landmark,
  ClipboardCheck,
  Flame,
  RotateCcw,
  Flag,
  Crown,
  UtensilsCrossed,
  ListX,
  ScrollText,
  type LucideIcon,
  FlaskConical,
  History,
  Scale,
  Rocket,
  CalendarRange,
  Palette,
  QrCode,
  Bot,
} from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// ─── Information Architecture ────────────────────────────────────────────────
// Kada Control Center — 12 function-centric workspaces. Every existing route is
// mapped into a workspace so nothing is lost; the sidebar renders these as an
// accordion (progressive disclosure) rather than one giant expanded list.

type NavItem = { label: string; icon: LucideIcon; path: string };
type NavWorkspace = { id: string; label: string; icon: LucideIcon; items: NavItem[] };

/**
 * The admin console's fourteen destinations.
 *
 * Each entry is one route; its specialist tools live inside as `?tab=` panes
 * (see `WorkspaceShell`). The console previously listed ~60 top-level items
 * across 12 groups, which meant the same record was reachable by different
 * routes depending on where you started.
 *
 * `items` are deep links into a workspace's tabs — they render as sub-entries
 * so the tools stay discoverable and searchable from the sidebar without
 * becoming destinations of their own.
 */
/**
 * Split a nav entry into its route and tab, so active-state can compare both.
 * Sub-items are deep links like `/admin/finance?tab=refunds`; matching on the
 * pathname alone would light up every sibling at once.
 */
const NAV_COLLAPSED_KEY = "kada_admin_nav_collapsed";

function splitNavPath(path: string): { pathname: string; tab: string } {
  const [pathname, query = ""] = path.split("?");
  return { pathname, tab: new URLSearchParams(query).get("tab") ?? "" };
}

/**
 * Sidebar group → the RBAC workspace that grants it. The sidebar's group ids
 * (dashboard, orders, customers…) aren't RBAC workspace ids (command,
 * marketplace, trust…); filtering on them directly hid 8 of the 15 groups from
 * every admin once their role loaded.
 */
const NAV_GROUP_ACCESS: Record<string, Workspace> = {
  dashboard: "dashboard",
  orders: "orders",
  customers: "customers",
  vendors: "vendors",
  delivery: "delivery",
  markets: "markets",
  // Pricing and Plans are Finance surfaces — whoever may see the money may
  // see the rules that produce it.
  pricing: "finance",
  finance: "finance",
  plans: "finance",
  stay: "stay",
  mess: "mess",
  support: "support",
  quality: "quality",
  growth: "growth",
  analytics: "analytics",
  settings: "settings",
};

/** First path segment under /admin. Legacy bookmarks (consumers, fleet, …)
 * return null so their <Navigate> redirects still run. */
function workspaceForAdminPath(pathname: string): Workspace | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "admin") return null;
  const seg = parts[1];
  if (!seg) return "dashboard";
  return NAV_GROUP_ACCESS[seg] ?? null;
}

const WORKSPACES: NavWorkspace[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    items: [
      { label: "Overview", icon: LayoutDashboard, path: "/admin" },
    ],
  },
  {
    id: "orders",
    label: "Orders & Ops",
    icon: ShoppingBag,
    items: [
      { label: "Orders", icon: ShoppingBag, path: "/admin/orders" },
      { label: "Live Dispatch", icon: Activity, path: "/admin/orders?tab=live" },
      { label: "Incidents", icon: AlertTriangle, path: "/admin/orders?tab=incidents" },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    icon: Smartphone,
    items: [
      { label: "Directory", icon: Smartphone, path: "/admin/customers" },
      { label: "Segments & CRM", icon: Target, path: "/admin/customers?tab=segments" },
      { label: "Loyalty & Gold", icon: Crown, path: "/admin/customers?tab=loyalty" },
      { label: "Referrals", icon: Share2, path: "/admin/customers?tab=referrals" },
      { label: "Gift Cards", icon: Gift, path: "/admin/customers?tab=credits" },
    ],
  },
  {
    id: "vendors",
    label: "Vendors",
    icon: Building2,
    items: [
      { label: "Directory", icon: Building2, path: "/admin/vendors" },
      { label: "Onboarding & KYC", icon: Users, path: "/admin/vendors?tab=onboarding" },
      { label: "Reservations", icon: Calendar, path: "/admin/vendors?tab=reservations" },
      { label: "Plans & Billing", icon: CreditCard, path: "/admin/vendors?tab=plans" },
    ],
  },
  {
    id: "delivery",
    label: "Delivery",
    icon: Bike,
    items: [
      { label: "Fleet & KYC", icon: Bike, path: "/admin/delivery" },
    ],
  },
  {
    id: "markets",
    label: "Markets & Zones",
    icon: Map,
    items: [
      { label: "Service Zones", icon: Map, path: "/admin/markets" },
      { label: "Cities", icon: MapPin, path: "/admin/markets?tab=cities" },
      { label: "Surge & Demand", icon: Flame, path: "/admin/markets?tab=surge" },
    ],
  },
  {
    id: "pricing",
    label: "Pricing",
    icon: Scale,
    items: [
      { label: "Rules", icon: Scale, path: "/admin/pricing" },
      { label: "Simulator", icon: FlaskConical, path: "/admin/pricing?tab=simulator" },
      { label: "Audit Log", icon: History, path: "/admin/pricing?tab=audit" },
      { label: "Price Checks", icon: FileCheck2, path: "/admin/pricing?tab=checks" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: Landmark,
    items: [
      { label: "Overview", icon: Landmark, path: "/admin/finance" },
      { label: "Settlements", icon: Wallet, path: "/admin/finance?tab=settlements" },
      { label: "Payout Runs", icon: Send, path: "/admin/finance?tab=payouts" },
      { label: "Refunds", icon: RotateCcw, path: "/admin/finance?tab=refunds" },
      { label: "Transaction Ledger", icon: CreditCard, path: "/admin/finance?tab=ledger" },
      { label: "Reconciliation", icon: FileCheck2, path: "/admin/finance?tab=reconciliation" },
      { label: "Kada Cares", icon: HeartHandshake, path: "/admin/finance?tab=donations" },
    ],
  },
  {
    id: "stay",
    label: "KadaStay",
    icon: Hotel,
    items: [
      { label: "Command Centre", icon: Hotel, path: "/admin/stay" },
      { label: "Properties", icon: Building2, path: "/admin/stay?tab=properties" },
      { label: "Bookings", icon: Calendar, path: "/admin/stay?tab=bookings" },
      { label: "Hosts", icon: Users, path: "/admin/stay?tab=hosts" },
      { label: "Amenities", icon: Settings, path: "/admin/stay?tab=amenities" },
      { label: "Cancellation Policies", icon: ScrollText, path: "/admin/stay?tab=policies" },
      { label: "Destinations", icon: MapPin, path: "/admin/stay?tab=destinations" },
      { label: "Stay Reviews", icon: Star, path: "/admin/stay?tab=reviews" },
      { label: "Stay Analytics", icon: BarChart3, path: "/admin/stay?tab=analytics" },
    ],
  },
  {
    id: "mess",
    label: "Kada Mess",
    icon: ChefHat,
    items: [
      { label: "Kitchens", icon: ChefHat, path: "/admin/mess" },
      { label: "Onboarding Queue", icon: Users, path: "/admin/mess?tab=onboarding" },
      { label: "Meal Plans", icon: Layers, path: "/admin/mess?tab=plans" },
      { label: "Subscriptions", icon: CalendarCheck, path: "/admin/mess?tab=subscriptions" },
      { label: "Mess Settlements", icon: Wallet, path: "/admin/mess?tab=settlements" },
    ],
  },
  {
    id: "support",
    label: "AI & Support",
    icon: Headset,
    items: [
      { label: "Cases", icon: Headset, path: "/admin/support" },
      { label: "Live Chat", icon: MessageSquare, path: "/admin/support?tab=chats" },
      { label: "Knowledge Base", icon: BookOpen, path: "/admin/support?tab=knowledge" },
      { label: "Assist Analytics", icon: BarChart3, path: "/admin/support?tab=analytics" },
      { label: "Demo Requests", icon: CalendarClock, path: "/admin/support?tab=leads" },
    ],
  },
  {
    id: "quality",
    label: "Quality & Trust",
    icon: ShieldCheck,
    items: [
      { label: "Food Reviews", icon: Star, path: "/admin/quality" },
      { label: "Catalog QC", icon: UtensilsCrossed, path: "/admin/quality?tab=catalog" },
      { label: "Bank Verification", icon: Landmark, path: "/admin/quality?tab=bank" },
      { label: "Risk Center", icon: ShieldCheck, path: "/admin/quality?tab=risk" },
    ],
  },
  {
    id: "growth",
    label: "Marketing",
    icon: Megaphone,
    items: [
      { label: "Overview", icon: Activity, path: "/admin/growth" },
      { label: "Autopilot", icon: Bot, path: "/admin/growth?tab=autopilot" },
      { label: "Planner", icon: CalendarRange, path: "/admin/growth?tab=planner" },
      { label: "Audience & Consent", icon: ShieldCheck, path: "/admin/growth?tab=audience" },
      { label: "Coupons & Offers", icon: Ticket, path: "/admin/growth?tab=promos" },
      { label: "Ads & Sponsorships", icon: Megaphone, path: "/admin/growth?tab=ads" },
      { label: "Home Merchandising", icon: Layers, path: "/admin/growth?tab=merchandising" },
      { label: "Mobile Notifications", icon: Bell, path: "/admin/growth?tab=notifications" },
      { label: "Email", icon: Mail, path: "/admin/growth?tab=email" },
      { label: "Links & QR", icon: QrCode, path: "/admin/growth?tab=links" },
      { label: "Brand Kit", icon: Palette, path: "/admin/growth?tab=brand" },
      { label: "Changelog", icon: Rocket, path: "/admin/growth?tab=changelog" },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: BarChart3,
    items: [
      { label: "Business Analytics", icon: BarChart3, path: "/admin/analytics" },
      { label: "Data Exports", icon: Download, path: "/admin/analytics?tab=exports" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: SlidersHorizontal,
    items: [
      { label: "Platform Settings", icon: SlidersHorizontal, path: "/admin/settings" },
      { label: "Business Rules", icon: FileText, path: "/admin/settings?tab=rules" },
      { label: "Cancellation Reasons", icon: ListX, path: "/admin/settings?tab=cancellation" },
      { label: "App modules", icon: Flag, path: "/admin/settings?tab=platform" },
      { label: "App Releases", icon: Smartphone, path: "/admin/settings?tab=releases" },
      { label: "Integrations", icon: Zap, path: "/admin/settings?tab=integrations" },
      { label: "Webhooks", icon: Activity, path: "/admin/settings?tab=webhooks" },
      { label: "Admin Team", icon: UserCog, path: "/admin/settings?tab=team" },
      { label: "Activity Log", icon: ScrollText, path: "/admin/settings?tab=audit" },
      { label: "Security", icon: ShieldCheck, path: "/admin/settings?tab=security" },
    ],
  },
];

// ─── Page title map ───────────────────────────────────────────────────────────

/**
 * Breadcrumb labels, one per workspace route.
 *
 * Deliberately short: the tab strip inside the workspace already names the
 * pane, so repeating it in the breadcrumb would say the same thing twice.
 */
const PAGE_TITLES: Record<string, string> = {
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
  const { role, loading: permsLoading, isSuperAdmin, canAccessWorkspace } = usePermissions();
  const { summary, counts } = useAdminNotifications();
  const [commandOpen, setCommandOpen] = useState(false);
  // Sidebar nav state — a search filter + which workspaces are expanded
  // (accordion). Declared with the other hooks, BEFORE the auth-guard returns.
  const [navQuery, setNavQuery] = useState("");
  // Every workspace starts EXPANDED. Collapsing all but the current one hides
  // ~50 tools behind a click and reads as "the pages are gone" — the whole
  // point of the restructure is that everything stays findable. Collapse is
  // opt-in and remembered.
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(NAV_COLLAPSED_KEY);
      const collapsed: string[] = stored ? JSON.parse(stored) : [];
      return new Set(WORKSPACES.map((w) => w.id).filter((id) => !collapsed.includes(id)));
    } catch {
      return new Set(WORKSPACES.map((w) => w.id));
    }
  });

  // Persist which groups the operator chose to fold away.
  useEffect(() => {
    try {
      const collapsed = WORKSPACES.map((w) => w.id).filter((id) => !openIds.has(id));
      localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {
      /* storage blocked — nav state just won't persist */
    }
  }, [openIds]);

  // Keep the workspace containing the current route expanded.
  useEffect(() => {
    let best: { id: string; len: number } | null = null;
    for (const ws of WORKSPACES) {
      for (const it of ws.items) {
        const { pathname } = splitNavPath(it.path);
        const match =
          pathname === "/admin"
            ? location.pathname === "/admin"
            : location.pathname === pathname || location.pathname.startsWith(`${pathname}/`);
        if (match && (!best || pathname.length > best.len)) {
          best = { id: ws.id, len: pathname.length };
        }
      }
    }
    const id = best?.id ?? "dashboard";
    setOpenIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, [location.pathname]);

  const toggleWs = (id: string) =>
    setOpenIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const canSeeNavGroup = (role: Role, groupId: string): boolean => {
    const workspace = NAV_GROUP_ACCESS[groupId];
    // An unmapped group is shown to owners rather than silently dropped.
    return workspace ? canAccessWorkspace(workspace) : role === "super_admin" || role === "platform_admin";
  };

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
    return <Navigate to="/admin" replace />;
  }

  // Active route helper. A sub-item is only active when both its route and
  // its tab match, so one workspace's tabs never all highlight together. An
  // item with no tab is the workspace's landing pane, which is also what shows
  // when the URL carries no `?tab=` at all.
  const currentTab = new URLSearchParams(location.search).get("tab") ?? "";
  const isActive = (path: string) => {
    const { pathname, tab } = splitNavPath(path);
    const routeMatches =
      pathname === "/admin"
        ? location.pathname === "/admin"
        : location.pathname === pathname || location.pathname.startsWith(`${pathname}/`);
    if (!routeMatches) return false;
    return tab === currentTab;
  };

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

  // Search-filtered workspaces (progressive disclosure: a query flattens the
  // accordion and shows only matching items).
  const q = navQuery.trim().toLowerCase();
  const visibleWorkspaces = WORKSPACES
    // Role-aware IA: a delegated admin only sees the workspaces their role can
    // reach (super/owner sees all). Defense-in-depth — the real boundary is the
    // Firestore rules + callables; this keeps the nav honest and uncluttered.
    .filter((ws) => !role || isSuperAdmin || bootstrapAdmin || canSeeNavGroup(role, ws.id))
    .map((ws) => ({
      ...ws,
      items: q ? ws.items.filter((it) => it.label.toLowerCase().includes(q)) : ws.items,
    }))
    .filter((ws) => ws.items.length > 0);

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
            >
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 shadow-sm">
                <span className="text-[8px] font-black text-primary-foreground leading-none">
                  KD
                </span>
              </div>
              <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden overflow-hidden text-left">
                <span className="text-sm font-bold tracking-tight text-foreground truncate">
                  Kada
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">
                  Control Center
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
              const open = !!q || openIds.has(ws.id);
              return (
                <SidebarGroup key={ws.id} className="px-2 py-0.5">
                  {/* Workspace header — accordion toggle (hidden in icon mode) */}
                  {(() => {
                    const wsBadge = getWorkspaceBadge(ws.id, summary.workspaces);
                    return (
                      <button
                        type="button"
                        onClick={() => toggleWs(ws.id)}
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
                              <Link to={item.path} className="flex items-center gap-2.5">
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
                  Super Admin
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
          <header className="h-14 flex items-center justify-between px-4 border-b border-border/60 bg-background/80 backdrop-blur-sm shrink-0">
            {/* Left: trigger + breadcrumb */}
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors -ml-1" />
              <Separator orientation="vertical" className="h-4" />
              <nav className="flex items-center gap-1 text-sm">
                <span className="text-muted-foreground font-medium">Admin</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-foreground font-semibold">{pageTitle}</span>
              </nav>
            </div>

            {/* Center/Right: scope + search + actions */}
            <div className="flex items-center gap-2">
              <Link to="/portal-select">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 text-xs font-bold"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Switch Admin Portal</span>
                </Button>
              </Link>

              {/* City / zone scope — filters every list in the console at once. */}
              <ZoneScopeBar />

              {/* CMD+K Search hint */}
              <button
                onClick={() => setCommandOpen(true)}
                className="hidden md:flex items-center gap-2 h-8 bg-muted/60 border border-border/60 hover:bg-muted/80 rounded-md px-3 w-56 transition-all text-muted-foreground"
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
              <ThemeToggle />

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

              {/* User avatar */}
              <div
                className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-xs font-semibold text-primary-foreground shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                title={user.email ?? ""}
              >
                {avatarInitial}
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            <AdminErrorBoundary>
              <Outlet />
            </AdminErrorBoundary>
          </main>
        </SidebarInset>
      </div>
      <AdminCommandMenu open={commandOpen} setOpen={setCommandOpen} />
      <AsyncDialogHost />
    </SidebarProvider>
  );
}
