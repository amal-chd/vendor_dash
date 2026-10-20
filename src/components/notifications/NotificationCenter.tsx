import React, { useState, useEffect } from "react";
import { Bell, Check, Megaphone, Calendar, AlertTriangle, ChefHat, Info } from "lucide-react";
import { collection, query, orderBy, onSnapshot, limit, doc, writeBatch, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  severity: "info" | "success" | "warning" | "high";
  source: string;
  metadata: Record<string, any> | null;
  createdAt: Timestamp | null;
}

export function NotificationCenter() {
  const { restaurantId } = useAuth();
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!restaurantId) return;

    const q = query(
      collection(db, "restaurants", restaurantId, "notifications"),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: SystemNotification[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as SystemNotification);
      });
      setNotifications(data);
    }, (err) => console.error("[NotificationCenter] q listener failed", err));

    return () => unsubscribe();
  }, [restaurantId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = async (id: string) => {
    if (!restaurantId) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "restaurants", restaurantId, "notifications", id), { read: true });
      await batch.commit();
    } catch (e) {
      console.error("Failed to mark as read", e);
    }
  };

  const markAllAsRead = async () => {
    if (!restaurantId) return;
    try {
      const batch = writeBatch(db);
      notifications.filter(n => !n.read).forEach((n) => {
        batch.update(doc(db, "restaurants", restaurantId, "notifications", n.id), { read: true });
      });
      await batch.commit();
    } catch (e) {
      console.error("Failed to mark all as read", e);
    }
  };

  const handleNotificationClick = (n: SystemNotification) => {
    if (!n.read) markAsRead(n.id);
    setOpen(false);

    // Route logic based on source
    if (n.source === "qr_menu") {
      navigate("/dashboard/orders");
    } else if (n.source === "support") {
      navigate("/dashboard/support");
    } else if (n.source === "reservation") {
      navigate("/dashboard/reservations");
    }
  };

  const getNotificationBadge = (source: string, severity: string) => {
    switch (source) {
      case "qr_menu":
        return {
          icon: <ChefHat className="h-4 w-4 text-orange-600 dark:text-orange-400" />,
          bg: "bg-orange-500/10 border-orange-500/20",
        };
      case "reservation":
        return {
          icon: <Calendar className="h-4 w-4 text-teal-600 dark:text-teal-400" />,
          bg: "bg-teal-500/10 border-teal-500/20",
        };
      case "admin":
      case "support":
        return {
          icon: <Megaphone className="h-4 w-4 text-purple-600 dark:text-purple-400" />,
          bg: "bg-purple-500/10 border-purple-500/20",
        };
      default:
        if (severity === "high" || severity === "warning") {
          return {
            icon: <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />,
            bg: "bg-rose-500/10 border-rose-500/20",
          };
        }
        return {
          icon: <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
          bg: "bg-blue-500/10 border-blue-500/20",
        };
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-background">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="h-auto p-0 text-xs font-medium text-primary hover:bg-transparent"
            >
              <Check className="mr-1 h-3 w-3" />
              Mark all as read
            </Button>
          )}
        </div>

        <div className="flex max-h-[400px] flex-col overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bell className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No new notifications</p>
            </div>
          ) : (
            notifications.map((n) => {
              const badge = getNotificationBadge(n.source, n.severity);
              return (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`group flex items-start cursor-pointer gap-3 border-b border-border/50 p-4 transition-colors hover:bg-muted/50 ${
                    !n.read ? "bg-primary/5" : ""
                  }`}
                >
                  {/* Premium Badge Icon */}
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${badge.bg}`}>
                    {badge.icon}
                  </div>

                  <div className="flex flex-1 flex-col gap-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`text-sm leading-tight truncate ${!n.read ? "font-bold" : "font-semibold"}`}>
                        {n.title}
                      </span>
                      {n.createdAt && (
                        <span className="shrink-0 text-[10px] text-muted-foreground mt-0.5">
                          {formatDistanceToNow(n.createdAt.toDate(), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {n.message}
                    </p>
                  </div>

                  {/* Tiny unread indicator dot at the right end */}
                  {!n.read && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary self-center" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
