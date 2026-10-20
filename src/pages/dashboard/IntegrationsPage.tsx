import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  PlugZap,
  QrCode,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Platform = {
  key: string;
  name: string;
  subtitle: string;
  gradient: string;
  badge: string;
  icon: React.ReactNode;
  partnerUrl?: string;
};

type ChannelStats = {
  orders: number;
  revenue: number;
};

type IntSettings = {
  enabled: boolean;
  apiKey?: string;
};

function ZomatoIcon() {
  return <span className="text-3xl leading-none drop-shadow-md">🔴</span>;
}
function SwiggyIcon() {
  return <span className="text-3xl leading-none drop-shadow-md">🟠</span>;
}
function UberEatsIcon() {
  return <span className="text-3xl leading-none drop-shadow-md">🟢</span>;
}
function DoorDashIcon() {
  return <span className="text-3xl leading-none drop-shadow-md">🏎️</span>;
}
function GenericDeliveryIcon() {
  return <span className="text-3xl leading-none drop-shadow-md">🛵</span>;
}

const PLATFORMS: Platform[] = [
  {
    key: "ubereats",
    name: "Uber Eats",
    subtitle: "Sync Uber Eats orders instantly to your KDS.",
    gradient: "from-green-500/20 to-green-500/5",
    badge: "bg-green-500 text-white",
    icon: <UberEatsIcon />,
  },
  {
    key: "doordash",
    name: "DoorDash",
    subtitle: "Receive DoorDash orders without a separate tablet.",
    gradient: "from-rose-500/20 to-rose-500/5",
    badge: "bg-rose-500 text-white",
    icon: <DoorDashIcon />,
  },
  {
    key: "deliveroo",
    name: "Deliveroo",
    subtitle: "Process Deliveroo orders smoothly.",
    gradient: "from-cyan-500/20 to-cyan-500/5",
    badge: "bg-cyan-500 text-white",
    icon: <GenericDeliveryIcon />,
  },
  {
    key: "grab",
    name: "GrabFood",
    subtitle: "Connect your Grab merchant account.",
    gradient: "from-emerald-500/20 to-emerald-500/5",
    badge: "bg-emerald-500 text-white",
    icon: <GenericDeliveryIcon />,
  },
  {
    key: "talabat",
    name: "Talabat",
    subtitle: "Sync MENA region Talabat orders.",
    gradient: "from-orange-500/20 to-orange-500/5",
    badge: "bg-orange-500 text-white",
    icon: <GenericDeliveryIcon />,
  },
  {
    key: "zomato",
    name: "Zomato",
    subtitle: "Receive Zomato orders directly in your kitchen display.",
    gradient: "from-red-500/20 to-red-500/5",
    badge: "bg-red-500 text-white",
    icon: <ZomatoIcon />,
  },
  {
    key: "swiggy",
    name: "Swiggy",
    subtitle: "Auto-accept Swiggy orders and route them to the KDS.",
    gradient: "from-orange-500/20 to-orange-500/5",
    badge: "bg-orange-500 text-white",
    icon: <SwiggyIcon />,
  },
  {
    key: "kada",
    name: "Kada QR",
    subtitle: "Guest table QR ordering powered by KadaDine.",
    gradient: "from-primary/20 to-primary/5",
    badge: "bg-primary text-white",
    icon: <QrCode className="h-8 w-8 text-primary drop-shadow-md" />,
  },
];

function webhookUrl(uid: string, platform: string): string {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "YOUR_PROJECT_ID";
  // Region must track functions/src/options.ts. This URL is pasted into
  // partner dashboards, so a stale region silently breaks live integrations
  // rather than failing somewhere we would notice.
  return `https://asia-south1-${projectId}.cloudfunctions.net/aggregatorWebhook?platform=${platform}&uid=${uid}`;
}

export default function IntegrationsPage() {
  const { user, activeRestaurantId } = useAuth();
  const { symbol, format } = useCurrency();

  const fmtMoney = (n: number) => {
    if (n >= 100_000) return `${symbol}${(n / 100_000).toFixed(1)}L`;
    if (n >= 1_000) return `${symbol}${(n / 1_000).toFixed(1)}k`;
    return format(n);
  };
  const [settings, setSettings] = useState<Record<string, IntSettings>>({});
  const [stats, setStats] = useState<Record<string, ChannelStats>>({
    kada:   { orders: 0, revenue: 0 },
    pos:    { orders: 0, revenue: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      try {
        const rid = activeRestaurantId;
        const settingsSnap = await getDoc(doc(db, "restaurants", rid, "settings", "integrations"));
        if (settingsSnap.exists()) {
          setSettings(settingsSnap.data() as Record<string, IntSettings>);
        }

        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);

        const ordersSnap = await getDocs(
          query(
            collection(db, "orders"),
            where("restaurantId", "==", rid),
            where("timestamp", ">=", Timestamp.fromDate(dayStart)),
            orderBy("timestamp", "desc"),
          ),
        );

        const acc: Record<string, ChannelStats> = {
          kada:   { orders: 0, revenue: 0 },
          pos:    { orders: 0, revenue: 0 },
        };

        ordersSnap.forEach((d) => {
          const data = d.data();
          const rawSrc = (data.source ?? data.orderSource ?? "pos").toString().toLowerCase();
          const validChannels = ["zomato", "swiggy", "kada", "ubereats", "doordash", "deliveroo", "grab", "foodpanda", "talabat"];
          const key = validChannels.includes(rawSrc) ? rawSrc : "pos";
          if (!acc[key]) acc[key] = { orders: 0, revenue: 0 };
          acc[key].orders += 1;
          acc[key].revenue += Number(data.total ?? data.totalAmount ?? 0);
        });

        setStats(acc);
      } catch (err) {
        console.error("Failed to load integrations page data:", err);
        toast.error("Failed to load channel stats. Please check database indexes.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [user, activeRestaurantId]);

  const togglePlatform = async (key: string, enabled: boolean) => {
    if (!user) return;
    setSaving(key);
    const next = { ...settings, [key]: { ...(settings[key] ?? {}), enabled } };
    setSettings(next);
    await setDoc(
      doc(db, "restaurants", activeRestaurantId, "settings", "integrations"),
      { [key]: { enabled } },
      { merge: true },
    );
    setSaving(null);
    toast.success(`${key.charAt(0).toUpperCase() + key.slice(1)} ${enabled ? "enabled" : "disabled"}`);
  };

  const saveApiKey = async (key: string) => {
    if (!user) return;
    const apiKey = apiKeys[key] ?? "";
    setSaving(key + "_key");
    await setDoc(
      doc(db, "restaurants", activeRestaurantId, "settings", "integrations"),
      { [key]: { apiKey } },
      { merge: true },
    );
    setSaving(null);
    toast.success("API key saved");
  };

  const copyWebhook = (uid: string, key: string) => {
    void navigator.clipboard.writeText(webhookUrl(uid, key));
    toast.success("Webhook URL copied to clipboard");
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="mt-2">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-foreground uppercase italic">
          Channels <span className="text-primary not-italic">&amp; Sync</span>
        </h1>
        <p className="mt-1 text-xs sm:text-sm font-medium text-muted-foreground opacity-70 italic">
          Connect your delivery partners and Kada QR to sync all orders into one KDS.
        </p>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Kada QR", key: "kada", color: "text-primary", bg: "bg-primary/10 border-primary/20" },
          { label: "Delivery", key: "delivery", color: "text-purple-500", bg: "bg-purple-500/10 border-purple-500/20" },
          { label: "POS", key: "pos", color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/20" },
        ].map((c, i) => {
          let orders = 0;
          let revenue = 0;
          if (c.key === "delivery") {
            const externalKeys = ["zomato", "swiggy", "ubereats", "doordash", "deliveroo", "grab", "foodpanda", "talabat"];
            externalKeys.forEach(k => {
              if (stats[k]) {
                orders += stats[k].orders;
                revenue += stats[k].revenue;
              }
            });
          } else {
             orders = stats[c.key]?.orders ?? 0;
             revenue = stats[c.key]?.revenue ?? 0;
          }

          return (
            <motion.div
              key={c.key}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={cn("rounded-[2rem] border p-6 backdrop-blur-2xl transition-transform hover:scale-[1.02]", c.bg)}
            >
              <p className={cn("text-[9px] font-black uppercase tracking-widest", c.color)}>
                {c.label}
              </p>
              <p className="mt-2 text-3xl font-black text-foreground">
                {orders}
              </p>
              <p className="mt-1 text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                {fmtMoney(revenue)} Today
              </p>
            </motion.div>
          );
        })}
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start mt-8">
        {/* Integrations List */}
        <div className="xl:col-span-8 space-y-6">
          <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60 ml-2">
            Connected Platforms
          </h2>
          <div className="space-y-5">
            {PLATFORMS.map((p, i) => {
              const cfg: IntSettings = settings[p.key] ?? { enabled: false };
              const isEnabled = p.key === "kada" ? true : cfg.enabled === true;
              const isExpanded = expanded[p.key] ?? false;
              const isSaving = saving === p.key;
              const pStats = stats[p.key] ?? { orders: 0, revenue: 0 };

              return (
                <motion.div
                  key={p.key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className={cn(
                    "overflow-hidden rounded-[2rem] border bg-card/40 backdrop-blur-xl shadow-lg transition-all duration-300",
                    isEnabled ? "border-primary/30 shadow-primary/5" : "border-border/30 opacity-80"
                  )}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 p-6">
                    <div className={cn("flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br border border-white/10", p.gradient)}>
                      {p.icon}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xl font-black text-foreground uppercase tracking-tight italic">
                          {p.name}
                        </span>
                        {isEnabled && (
                          <span className={cn("rounded-md px-2.5 py-1 text-[8px] font-black uppercase tracking-widest shadow-sm", p.badge)}>
                            Live Now
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-medium text-muted-foreground opacity-80 leading-relaxed max-w-sm">
                        {p.subtitle}
                      </p>
                    </div>

                    <div className="flex items-center justify-between w-full sm:w-auto gap-6 sm:gap-8 mt-4 sm:mt-0">
                       <div className="text-left sm:text-right">
                         <p className="text-lg font-black text-foreground">
                           {pStats.orders} <span className="text-[10px] uppercase opacity-50">Orders</span>
                         </p>
                         <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">
                           {fmtMoney(pStats.revenue)}
                         </p>
                       </div>

                       <div className="flex items-center gap-3">
                         {p.key !== "kada" && (
                           <button
                             onClick={() => void togglePlatform(p.key, !isEnabled)}
                             disabled={isSaving}
                             className={cn(
                               "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors",
                               isEnabled ? "bg-primary" : "bg-muted-foreground/30",
                             )}
                           >
                             <span
                               className={cn(
                                 "inline-block h-6 w-6 translate-x-1 rounded-full bg-white shadow-sm transition-transform",
                                 isEnabled && "translate-x-7",
                               )}
                             />
                             {isSaving && (
                               <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin text-white" />
                             )}
                           </button>
                         )}

                         {isEnabled && (
                           <button
                             onClick={() =>
                               setExpanded((prev) => ({
                                 ...prev,
                                 [p.key]: !prev[p.key],
                               }))
                             }
                             className={cn("rounded-xl p-2 transition-colors", isExpanded ? "bg-muted" : "bg-transparent hover:bg-muted/50")}
                           >
                             <ChevronDown className={cn("h-5 w-5 transition-transform duration-300", isExpanded && "rotate-180")} />
                           </button>
                         )}
                       </div>
                    </div>
                  </div>

                  <AnimatePresence>
                    {isEnabled && isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-border/20 bg-background/50 backdrop-blur-md"
                      >
                        <div className="p-6 space-y-6">
                          <div className="space-y-2.5">
                            <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                              Webhook URL
                            </label>
                            <div className="flex flex-col sm:flex-row gap-3">
                              <div className="min-w-0 flex-1 rounded-xl border border-border/40 bg-muted/20 px-4 py-3 font-mono text-xs text-muted-foreground overflow-hidden flex items-center">
                                <p className="truncate select-all">
                                  {webhookUrl(user!.uid, p.key)}
                                </p>
                              </div>
                              <Button
                                onClick={() => copyWebhook(user!.uid, p.key)}
                                className="shrink-0 rounded-xl bg-primary text-primary-foreground h-12 px-6 font-black uppercase tracking-widest text-[9px] shadow-lg shadow-primary/20"
                              >
                                <Copy className="h-4 w-4 mr-2" /> Copy URL
                              </Button>
                            </div>
                            <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground italic">
                              <Info className="h-3.5 w-3.5 shrink-0 opacity-50" />
                              Paste this URL in your {p.name} partner portal under API/Webhook settings.
                            </p>
                          </div>

                          {p.key !== "kada" && (
                            <div className="space-y-2.5">
                              <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                                API Key / Webhook Secret
                              </label>
                              <div className="flex gap-3">
                                <Input
                                  type="password"
                                  placeholder={`Paste your ${p.name} webhook secret`}
                                  value={apiKeys[p.key] ?? ""}
                                  onChange={(e) =>
                                    setApiKeys((prev) => ({
                                      ...prev,
                                      [p.key]: e.target.value,
                                    }))
                                  }
                                  className="h-12 rounded-xl bg-muted/20 border-border/40 font-bold focus:ring-primary focus:border-primary"
                                />
                                <Button
                                  variant="secondary"
                                  onClick={() => void saveApiKey(p.key)}
                                  disabled={saving === p.key + "_key"}
                                  className="h-12 rounded-xl px-6 font-black uppercase tracking-widest text-[9px]"
                                >
                                  {saving === p.key + "_key" ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                  ) : (
                                    <Check className="h-4 w-4 mr-2" />
                                  )}
                                  Save Key
                                </Button>
                              </div>
                            </div>
                          )}

                          {p.partnerUrl && (
                            <div className="pt-2">
                               <a
                                 href={p.partnerUrl}
                                 target="_blank"
                                 rel="noopener noreferrer"
                                 className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity"
                               >
                                 Open Partner Portal
                                 <ExternalLink className="h-3.5 w-3.5" />
                               </a>
                            </div>
                          )}

                          {p.key === "kada" && (
                            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 space-y-2">
                              <p className="text-[11px] font-black uppercase tracking-widest text-emerald-500">
                                Native Integration
                              </p>
                              <p className="text-xs font-medium text-muted-foreground leading-relaxed">
                                When guests scan a table QR and place an order through
                                the KadaDine guest app, it routes here instantly. You'll see a{" "}
                                <span className="inline-block rounded bg-emerald-500 px-2 py-0.5 text-[9px] font-black text-white ml-1 mr-1">
                                  KADA QR
                                </span>{" "}
                                badge on the kitchen display.
                              </p>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* How It Works Sidebar */}
        <div className="xl:col-span-4 space-y-6 sticky top-8">
          <div className="rounded-[2.5rem] border border-border/40 bg-card/60 backdrop-blur-2xl shadow-xl overflow-hidden p-8">
            <h3 className="text-lg font-black tracking-tight uppercase italic mb-8">
              Sync <span className="text-primary not-italic">Workflow</span>
            </h3>
            
            <div className="relative space-y-8 before:absolute before:inset-0 before:ml-[1.4rem] before:h-full before:w-[2px] before:bg-gradient-to-b before:from-primary/50 before:to-transparent">
              {[
                {
                  icon: PlugZap,
                  title: "1. Connect",
                  desc: "Add your webhook URL to the partner portal to begin listening.",
                },
                {
                  icon: ShoppingBag,
                  title: "2. Receive",
                  desc: "New external orders instantly POST to your webhook.",
                },
                {
                  icon: Activity,
                  title: "3. Display",
                  desc: "The order pops up in your KDS with a source badge automatically.",
                },
                {
                  icon: Check,
                  title: "4. Complete",
                  desc: "Move tickets to READY to sync status back to the platform.",
                },
              ].map(({ icon: Icon, title, desc }, idx) => (
                <motion.div 
                  key={idx} 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + (idx * 0.1) }}
                  className="relative flex gap-5 z-10"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-background border border-primary/20 text-primary shadow-sm ring-4 ring-card">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="pt-1.5 space-y-1.5">
                    <p className="font-black text-foreground uppercase tracking-tight text-sm">{title}</p>
                    <p className="text-xs font-medium text-muted-foreground opacity-80 leading-relaxed">
                      {desc}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
