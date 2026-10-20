import { LayoutDashboard, ShoppingCart, ChefHat, LayoutGrid, Menu as MenuIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

/** Matches vendor app bottom nav: Home, Orders, Kitchen. Hub has been removed. */
const getMobileNavItems = (features: Record<string, boolean>) => [
  { label: "Home", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Orders", icon: ShoppingCart, path: "/dashboard/orders" },
  ...(features.kds !== false ? [{ label: "Kitchen", icon: ChefHat, path: "/dashboard/kitchen" }] : []),
];

interface BottomNavProps {
  onMenuClick: () => void;
  features?: Record<string, boolean>;
}

export function BottomNav({ onMenuClick, features = {} }: BottomNavProps) {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/dashboard") return location.pathname === "/dashboard";
    return location.pathname.startsWith(path);
  };

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-background/80 backdrop-blur-lg border-t border-border z-50 px-4 flex items-center justify-around shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
      {getMobileNavItems(features).map((item) => (
        <Link
          key={item.path}
          to={item.path}
          className={cn(
            "flex flex-col items-center justify-center gap-1 w-16 h-full transition-all duration-200 relative group",
            isActive(item.path) ? "text-primary scale-110" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <item.icon className={cn("w-5 h-5", isActive(item.path) && "fill-primary/10")} />
          <span className="text-[10px] font-black uppercase tracking-widest leading-none">
            {item.label}
          </span>
          {isActive(item.path) && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary rounded-b-full shadow-[0_2px_10px_rgba(163,230,53,0.5)]" />
          )}
        </Link>
      ))}
      <button
        onClick={onMenuClick}
        className="flex flex-col items-center justify-center gap-1 w-16 h-full text-muted-foreground hover:text-foreground transition-all duration-200"
      >
        <MenuIcon className="w-5 h-5" />
        <span className="text-[10px] font-black uppercase tracking-widest leading-none">More</span>
      </button>
    </div>
  );
}
