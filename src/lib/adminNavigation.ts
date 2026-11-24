import { Activity, AlertTriangle, BarChart3, Bell, Bike, BookOpen, Bot, Building2, Calendar, CalendarCheck, CalendarClock, CalendarRange, ChefHat, CreditCard, Crown, Download, FileCheck2, FileText, Flame, FlaskConical, Gift, Grid2X2, Headset, HeartHandshake, History, Hotel, Inbox, Landmark, Layers, LayoutDashboard, ListX, Mail, Map, MapPin, Megaphone, MessageSquare, Palette, PanelsTopLeft, QrCode, Rocket, RotateCcw, Scale, ScrollText, Send, Settings, Share2, ShieldCheck, ShoppingBag, SlidersHorizontal, Smartphone, Star, Target, Ticket, UserCog, Users, UtensilsCrossed, Wallet, Zap, type LucideIcon } from "lucide-react";
import type { Workspace } from "@/lib/rbac";

export type NavItem = { label: string; icon: LucideIcon; path: string; document?: boolean };
export type NavWorkspace = { id: string; label: string; icon: LucideIcon; items: NavItem[] };

export const VERSE_WORKSPACE_PATH = "/verse-app/";
export const hasVerseWorkspace = import.meta.env.VITE_KADA_VERSE_WORKSPACE === "true";

export function splitNavPath(path: string): { pathname: string; tab: string } {
  const [pathname, query = ""] = path.split("?");
  return { pathname, tab: new URLSearchParams(query).get("tab") ?? "" };
}

// Route access stays aligned with the existing RBAC workspaces.
const NAV_GROUP_ACCESS: Record<string, Workspace> = {
  dashboard: "dashboard",
  products: "dashboard",
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
export function workspaceForAdminPath(pathname: string): Workspace | null {
  if (pathname === VERSE_WORKSPACE_PATH.replace(/\/$/, "") || pathname === VERSE_WORKSPACE_PATH) return "dashboard";
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "admin") return null;
  const seg = parts[1];
  if (!seg) return "dashboard";
  return NAV_GROUP_ACCESS[seg] ?? null;
}

export const ADMIN_NAV: NavWorkspace[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    items: [
      { label: "Overview", icon: LayoutDashboard, path: "/admin" },
      { label: "Products", icon: Grid2X2, path: "/admin/products" },
      ...(hasVerseWorkspace
        ? [{ label: "Kada Verse workspace", icon: PanelsTopLeft, path: VERSE_WORKSPACE_PATH, document: true }]
        : []),
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
      { label: "Overview", icon: ChefHat, path: "/admin/mess" },
      { label: "Kitchens", icon: Building2, path: "/admin/mess?tab=kitchens" },
      { label: "Mess Analytics", icon: BarChart3, path: "/admin/mess?tab=analytics" },
      { label: "Subscribers", icon: Users, path: "/admin/mess?tab=customers" },
      { label: "Mess Reviews", icon: Star, path: "/admin/mess?tab=reviews" },
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
      { label: "Website Enquiries", icon: Inbox, path: "/admin/growth?tab=enquiries" },
      { label: "Social Studio", icon: Share2, path: "/admin/growth?tab=social" },
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
      { label: "Write Release Notes", icon: FileText, path: "/admin/growth/changelog/new" },
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
      { label: "Platform & App Modules", icon: SlidersHorizontal, path: "/admin/settings" },
      { label: "Business Rules", icon: FileText, path: "/admin/settings?tab=rules" },
      { label: "Cancellation Reasons", icon: ListX, path: "/admin/settings?tab=cancellation" },
      { label: "App Releases", icon: Smartphone, path: "/admin/settings?tab=releases" },
      { label: "Integrations", icon: Zap, path: "/admin/settings?tab=integrations" },
      { label: "Webhooks", icon: Activity, path: "/admin/settings?tab=webhooks" },
      { label: "Roles & Permissions", icon: ShieldCheck, path: "/admin/settings?tab=roles" },
      { label: "Admin Team", icon: UserCog, path: "/admin/settings?tab=team" },
      { label: "Activity Log", icon: ScrollText, path: "/admin/settings?tab=audit" },
      { label: "Security", icon: ShieldCheck, path: "/admin/settings?tab=security" },
    ],
  },
];


const DEFAULT_TABS: Record<string, string> = {
  "/admin": "overview", "/admin/orders": "orders", "/admin/customers": "directory",
  "/admin/vendors": "directory", "/admin/delivery": "fleet", "/admin/markets": "zones",
  "/admin/finance": "overview", "/admin/pricing": "rules", "/admin/stay": "overview",
  "/admin/mess": "overview", "/admin/support": "queue", "/admin/quality": "reviews",
  "/admin/growth": "overview", "/admin/analytics": "business", "/admin/settings": "platform",
};

export function adminNavItemIsActive(path: string, pathname: string, search: string) {
  const item = splitNavPath(path);
  const matches = pathname === item.pathname ||
    (item.pathname !== "/admin" && !item.pathname.startsWith("/admin/products") && pathname.startsWith(`${item.pathname}/`));
  if (!matches) return false;
  const params = new URLSearchParams(search);
  const defaultTab = DEFAULT_TABS[item.pathname] ?? "";
  const brand = new URLSearchParams(path.split("?")[1]).get("brand");
  return (item.tab || defaultTab) === (params.get("tab") || defaultTab) && (!brand || brand === params.get("brand"));
}
