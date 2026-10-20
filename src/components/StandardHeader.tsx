import { Menu, Search, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

interface StandardHeaderProps {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
  searchPlaceholder?: string;
  showSearch?: boolean;
  showNotifications?: boolean;
  userAvatar?: React.ReactNode;
  userName?: string;
  navLinks?: { label: string; href: string }[];
  actions?: React.ReactNode;
  logo?: React.ReactNode;
  className?: string;
  variant?: 'dashboard' | 'marketing';
  maxWidth?: string;
}

export function StandardHeader({
  onMenuClick,
  showMenuButton = false,
  searchPlaceholder = "Search...",
  showSearch = false,
  showNotifications = false,
  userAvatar,
  userName,
  navLinks,
  actions,
  logo,
  className,
  variant = 'dashboard',
  maxWidth,
}: StandardHeaderProps) {
  const isMarketing = variant === 'marketing';
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <header className={cn(
      "h-16 md:h-20 border-b border-border/40 backdrop-blur-2xl z-40 transition-all duration-500",
      isMarketing ? "sticky top-0 bg-background" : "bg-card shrink-0",
      className
    )}>
      <div className={cn(
        "flex h-full items-center px-3 md:px-8 gap-1.5 sm:gap-6",
        maxWidth ? `mx-auto w-full ${maxWidth}` : "w-full"
      )}>
        {logo && (
          <div className="flex items-center shrink-0">
            {logo}
          </div>
        )}

        {navLinks && (
          <nav className="hidden md:flex items-center gap-8 text-[11px] font-black uppercase tracking-[0.15em] text-muted-foreground ml-8">
            {navLinks.map((link) => (
              <Link 
                key={link.href} 
                to={link.href} 
                className="hover:text-primary transition-colors relative group"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary transition-all group-hover:w-full" />
              </Link>
            ))}
          </nav>
        )}

        {showSearch && (
          <div className="hidden md:flex items-center gap-3 bg-muted/50 rounded-xl px-4 py-2 flex-1 max-w-md border border-border/40 focus-within:border-primary/40 focus-within:bg-background transition-all ml-8">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input 
              placeholder={searchPlaceholder} 
              className="bg-transparent text-xs font-bold outline-none w-full placeholder:text-muted-foreground/60 uppercase tracking-widest" 
            />
          </div>
        )}

        <div className="flex-1" />

        {/* Offline Badge */}
        {isOffline && (
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-destructive/10 text-destructive text-[11px] font-bold tracking-wide uppercase border border-destructive/20 mr-2 shadow-sm animate-pulse">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Offline POS Mode</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 sm:gap-4">
          <ThemeToggle />
          
          <div className="flex items-center gap-1 sm:gap-3">
            {actions}
          </div>

          {showNotifications && <NotificationCenter />}

          {showMenuButton && (
            <button 
              onClick={onMenuClick} 
              className="lg:hidden p-2 rounded-xl bg-muted/50 hover:bg-primary/10 hover:text-primary transition-all border border-border/40"
              aria-label="Toggle Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          {(userAvatar || userName) && (
            <>
              <div className="h-6 w-px bg-border/60 mx-1 sm:mx-2" />
              <div className="flex items-center gap-2 sm:gap-3 group cursor-pointer pl-1">
                {userAvatar}
                {userName && (
                  <span className="hidden sm:inline text-[11px] font-black uppercase tracking-widest text-muted-foreground group-hover:text-primary transition-colors">
                    {userName}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
