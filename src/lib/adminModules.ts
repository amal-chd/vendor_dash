import {
  Bike, BookOpen, BriefcaseBusiness, ChefHat, ClipboardList, Gamepad2, Grid2X2, Hotel,
  LayoutDashboard, PanelsTopLeft, Play, ShoppingBag, Store, Target, UtensilsCrossed, type LucideIcon,
} from "lucide-react";
import { ADMIN_NAV, splitNavPath, type NavItem, type NavWorkspace } from "./adminNavigation";

export type AdminModule = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  logo?: string;
  groups: string[];
  category: "operations" | "portfolio";
  brand?: string;
  links?: { label: string; url: string }[];
};

export const ADMIN_MODULES: AdminModule[] = [
  { id: "platform", label: "Control Center", description: "Platform-wide operations, finance, support and settings.", icon: LayoutDashboard, category: "operations", groups: ADMIN_NAV.map((group) => group.id) },
  { id: "the-kada", label: "The Kada", description: "Customer marketplace, orders, loyalty and service areas.", icon: ShoppingBag, logo: "/kada-customer-logo.png", category: "operations", brand: "the-kada", groups: ["orders", "customers", "markets", "quality", "growth"] },
  { id: "kada-dine", label: "Kada Dine", description: "Restaurants, onboarding, reservations and POS plans.", icon: UtensilsCrossed, logo: "/kada-vendor-logo.png", category: "operations", brand: "kada-dine", groups: ["vendors", "quality"] },
  { id: "kada-delivery", label: "Kada Delivery", description: "Rider fleet, verification, dispatch and incidents.", icon: Bike, logo: "/kada-delivery-logo.png", category: "operations", brand: "kada-delivery", groups: ["delivery", "orders", "markets"] },
  { id: "kada-stay", label: "Kada Stay", description: "Properties, bookings, hosts, destinations and reviews.", icon: Hotel, logo: "/kadastay-logo.png", category: "operations", brand: "kada-stay", groups: ["stay"] },
  { id: "kada-mess", label: "Kada Mess", description: "Kitchens, meal plans, subscriptions and settlements.", icon: ChefHat, category: "operations", brand: "kada-mess", groups: ["mess"] },
  { id: "kadaverse", label: "KadaVerse", description: "Studio enquiries, campaigns, social content and branding.", icon: PanelsTopLeft, category: "operations", brand: "kadaverse", groups: ["growth", "support", "dashboard"] },
  { id: "kada-ledger", label: "Kada Ledger", description: "Digital khata, merchant credit and statements.", icon: BookOpen, category: "portfolio", brand: "kada-ledger", groups: [], links: [{ label: "Product site", url: "https://ledger.thekada.in" }] },
  { id: "sellrapp", label: "SellrApp", description: "Online storefronts for independent sellers.", icon: Store, category: "portfolio", brand: "sellrapp", groups: [], links: [{ label: "Product site", url: "https://sellrapp.thekada.in" }] },
  { id: "taskpilot", label: "TaskPilot", description: "Project and site operations for construction teams.", icon: ClipboardList, category: "portfolio", groups: [], links: [{ label: "Company case study", url: "https://www.thekada.in/work/task-pilot" }] },
  { id: "puzlume", label: "Puzlume", description: "Mobile puzzle game and its store listing.", icon: Gamepad2, logo: "/admin-products/puzlume.webp", category: "portfolio", groups: [], links: [{ label: "Google Play listing", url: "https://play.google.com/store/apps/details?id=com.puzlume.game" }] },
  { id: "whichott", label: "WhichOTT", description: "Discover where movies and series are streaming.", icon: Play, category: "portfolio", groups: [], links: [{ label: "Product site", url: "https://whichott.vercel.app" }] },
  { id: "devflow", label: "DevFlow", description: "A workspace for freelancers and small studios.", icon: BriefcaseBusiness, category: "portfolio", groups: [], links: [{ label: "Product site", url: "https://devflow-web-puce.vercel.app" }] },
  { id: "lunoo", label: "Lunoo", description: "Habits, personal finance and wellness.", icon: Target, category: "portfolio", groups: [], links: [{ label: "Product site", url: "https://lunoo-two.vercel.app" }] },
];

const PRIMARY_MODULE: Record<string, string> = {
  orders: "the-kada", customers: "the-kada", vendors: "kada-dine",
  delivery: "kada-delivery", stay: "kada-stay", mess: "kada-mess",
};

export function getAdminModule(id: string) {
  return ADMIN_MODULES.find((module) => module.id === id) ?? ADMIN_MODULES[0];
}

export function moduleForLocation(pathname: string, search: string) {
  const [, , section, product] = pathname.split("/");
  const id = section === "products" ? product : new URLSearchParams(search).get("module");
  if (id && ADMIN_MODULES.some((module) => module.id === id)) return id;
  return PRIMARY_MODULE[section] ?? "platform";
}

export function moduleLink(path: string, moduleId: string) {
  if (!path.startsWith("/admin/") || path.startsWith("/admin/products")) return path;
  const [pathname, query] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("module", moduleId);
  return `${pathname}?${params}`;
}

export function adminModuleHome(module: AdminModule, canOpen: (path: string) => boolean) {
  if (module.id === "platform") {
    return canOpen("/admin") ? "/admin" : ADMIN_NAV.flatMap((group) => group.items).find((item) => canOpen(item.path))?.path;
  }
  if (canOpen("/admin/products")) return `/admin/products/${module.id}`;
  const available = groupsForModule(module).flatMap((group) => group.items).find((item) => canOpen(item.path));
  return available ? moduleLink(available.path, module.id) : undefined;
}

export function visibleAdminModules(canOpen: (path: string) => boolean) {
  return ADMIN_MODULES.filter((module) => {
    if (module.category === "portfolio") return canOpen("/admin/products");
    return groupsForModule(module).some((group) => group.items.some((item) => canOpen(item.path)));
  });
}

export function groupsForModule(module: AdminModule): NavWorkspace[] {
  if (module.id === "platform") return ADMIN_NAV;

  const home: NavItem = { label: "Module Overview", icon: Grid2X2, path: `/admin/products/${module.id}` };
  const groups = module.groups.flatMap((id) => {
    const group = ADMIN_NAV.find((candidate) => candidate.id === id);
    if (!group) return [];
    let items = group.items;
    if (id === "dashboard") items = items.filter((item) => item.document);
    if (id === "orders" && module.id === "kada-delivery") items = items.filter((item) => splitNavPath(item.path).tab);
    if (id === "growth") {
      const hidden = module.id === "the-kada" ? ["enquiries", "social", "brand"] : ["brand"];
      items = items.filter((item) => !hidden.includes(splitNavPath(item.path).tab));
    }
    return items.length ? [{ ...group, items }] : [];
  });
  const brand: NavItem[] = module.brand
    ? [{ label: "Product Brand Profile", icon: Target, path: `/admin/growth?tab=brand&brand=${module.brand}` }]
    : [];
  return [{ id: "product-overview", label: module.label, icon: module.icon, items: [home, ...brand] }, ...groups];
}
