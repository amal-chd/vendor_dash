import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCards } from "@/components/admin/StatCards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Bell, Send, Users, Clock, CheckCircle2, AlertCircle, Loader2, Smartphone, Bike, Hotel, Building2, Image as ImageIcon, Link as LinkIcon, ChevronDown, ChevronUp, Sparkles, Check, Mail } from "lucide-react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast } from "sonner";
import { notificationService } from "@/services/notificationService";
import { useCommsApp, type AppKey } from "@/pages/admin/comms/channelShell";

interface NotificationLog {
  id: string;
  title: string;
  body: string;
  audience: string;
  sentAt: string;
  recipientCount: number;
  pushed?: number;
  status: string;
}

const AUDIENCE_OPTIONS = [
  // Master Broadcasts
  { value: "all_apps", label: "Global: All Apps", icon: Sparkles, app: "all" as AppKey },
  
  // App-Specific
  { value: "customers", label: "Customer app", icon: Smartphone, app: "customer" as AppKey },
  { value: "riders", label: "Delivery riders", icon: Bike, app: "delivery" as AppKey },
  { value: "hosts", label: "Stay hosts", icon: Hotel, app: "host" as AppKey },
  
  // Vendor Filters
  { value: "all", label: "All vendors", icon: Building2, app: "vendor" as AppKey },
  { value: "active", label: "Active subscribers", icon: CheckCircle2, app: "vendor" as AppKey },
  { value: "expired", label: "Expired / lapsed", icon: AlertCircle, app: "vendor" as AppKey },

  // Custom Segments
  { value: "segment:inactive_customers", label: "Inactive (>30 days)", icon: Clock, app: "customer" as AppKey },
  { value: "segment:new_signups", label: "New Signups (7 days)", icon: Sparkles, app: "customer" as AppKey },
  { value: "segment:high_spenders", label: "High Spenders (LTV > 5000)", icon: Sparkles, app: "customer" as AppKey },

  // Preference Audiences (Auto-created via Topic Subscriptions)
  { value: "topic:promo", label: "Prefers Promotions (Opt-in)", icon: Sparkles, app: "customer" as AppKey },
  { value: "topic:newsletter", label: "Newsletter Subscribers", icon: Mail, app: "customer" as AppKey },
  { value: "topic:veg", label: "Vegetarian Only", icon: Sparkles, app: "customer" as AppKey },
];

const TEMPLATE_PRESETS = [
  // Promo / Sales
  { label: "Flash Sale", title: "FLASH SALE ⚡️", body: "Hungry? Grab FLAT 50% OFF on select restaurants for the next 2 hours!" },
  { label: "Weekend Cravings", title: "Weekend cravings? 🍕", body: "Kick off the weekend right! Get 20% off your favorite local spots tonight only." },
  { label: "Happy Hour", title: "Happy Hour! 🍻", body: "Enjoy 1-plus-1 on drinks and appetizers from 4 PM to 7 PM." },
  { label: "Free Delivery", title: "Free Delivery! 🛵", body: "Order now and get your food delivered to your door step for free!" },
  
  // Rider Specific
  { label: "Rider Surge", title: "Peak Hour Bonus Active! 🛵💨", body: "Earn an extra ₹15 on every delivery you complete in the next 3 hours!" },
  { label: "Rain Alert (Riders)", title: "Rain Alert 🌧️", body: "It's raining! Drive safely. Rain surge of ₹20 per order is now active." },
  
  // Vendor Specific
  { label: "Vendor: New Feature", title: "New Feature Alert 🚀", body: "Check out the new Menu AI tools in your vendor dashboard to easily build your menu!" },
  { label: "Vendor: Reminder", title: "Update Your Inventory 📦", body: "Please ensure your menu items and stock are up to date for the weekend rush." },
  
  // System / General
  { label: "Maintenance", title: "Scheduled maintenance ⚠️", body: "Kada will be briefly unavailable tonight from 2 AM - 4 AM." },
  { label: "App Update", title: "Update Available 📱", body: "A new version of the app is available! Update now for a faster experience." },
];

function defaultAudience(app: AppKey): string {
  if (app === "customer") return "customers";
  if (app === "delivery") return "riders";
  if (app === "host") return "hosts";
  if (app === "vendor") return "all";
  return "customers";
}

export default function NotificationsPage() {
  const [searchParams] = useSearchParams();
  const initialApp = (searchParams.get("app") as AppKey) || "customer";
  const appContext = useCommsApp();
  
  const [title, setTitle] = useState(searchParams.get("draftTitle") || "");
  const [body, setBody] = useState(searchParams.get("draftBody") || "");
  const [imageUrl, setImageUrl] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [audience, setAudience] = useState(defaultAudience((appContext || initialApp) as AppKey));
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewPlatform, setPreviewPlatform] = useState<"ios" | "android">("ios");

  // AI Modal State
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiResults, setAiResults] = useState<any[]>([]);

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    try {
      const response = await notificationService.generateNotificationContent({
        prompt: aiPrompt,
        objective: "increase_orders",
        tone: "engaging",
        language: "auto",
      });
      setAiResults(response.results || []);
    } catch (e) {
      toast.error("Failed to generate content");
    } finally {
      setIsGenerating(false);
    }
  };

  // Removed effect that forces audience based on appContext

  const visibleAudiences = useMemo(() => {
    return AUDIENCE_OPTIONS; // Allow sending to all apps separately regardless of context
  }, [appContext]);

  useEffect(() => {
    let active = true;
    setEstimate(null);
    notificationService.estimateAudience(audience).then((c) => {
      if (active) setEstimate(c);
    });
    return () => { active = false; };
  }, [audience]);

  useEffect(() => {
    const q = query(collection(db, "admin_notifications"), orderBy("sentAt", "desc"), limit(50));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setLogs(
          snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              sentAt: data.sentAt?.toDate?.()?.toLocaleString("en-IN") || new Date(data.sentAt).toLocaleString("en-IN"),
            } as NotificationLog;
          }),
        );
      },
      (err) => {
        console.error("[NotificationsPage] admin_notifications listener failed", err);
        toast.error("Couldn't load notification history — check your connection.");
      },
    );
    return () => unsubscribe();
  }, []);

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    try {
      const res = await notificationService.sendBroadcast({
        title: title.trim(),
        body: body.trim(),
        audience,
        urgent,
        type: urgent ? "alert" : "promo",
        // Extended payload (backend ignores if unsupported, but forwards to FCM payload if implemented)
        ...(imageUrl && { imageUrl }),
        ...(deepLink && { deepLink }),
      } as any);
      toast.success(`Sent to ${res.recipients.toLocaleString("en-IN")} inboxes (${res.pushed.toLocaleString("en-IN")} devices pushed)`);
      setTitle("");
      setBody("");
      setImageUrl("");
      setDeepLink("");
      setUrgent(false);
    } catch (error) {
      console.error(error);
      toast.error("Failed to send notification");
    } finally {
      setSending(false);
    }
  };

  const selected = AUDIENCE_OPTIONS.find((a) => a.value === audience);
  
  // Real-time Preview properties
  const appName = "The Kada";
  const now = new Date();
  const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6 pb-12">
      <StatCards
        stats={[
          { label: "Broadcasts sent", value: logs.length },
          {
            label: "People reached",
            value: logs.reduce((sum, l) => sum + (l.recipientCount || 0), 0).toLocaleString("en-IN"),
            hint: "Across all broadcasts",
            tone: "text-indigo-600",
          },
          {
            label: "Selected audience",
            value: estimate == null ? "—" : estimate.toLocaleString("en-IN"),
            hint: "Who this message would reach",
            tone: "text-emerald-600",
            loading: estimate == null,
          },
          {
            label: "Failed broadcasts",
            value: logs.filter((l) => l.status === "failed").length,
            tone: "text-rose-600",
          },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr,400px]">
        
        {/* Left Col: Composer */}
        <div className="space-y-6">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 pb-4 border-b border-border/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Send className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Compose Push Notification</CardTitle>
                    <CardDescription>
                      Push notification to active devices and in-app inbox.
                    </CardDescription>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    setAiResults([]);
                    setAiPrompt("");
                    setAiModalOpen(true);
                  }} 
                  className="gap-2 text-primary hover:text-primary hover:bg-primary/10 border-primary/20"
                >
                  <Sparkles className="w-4 h-4" />
                  Write with AI
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-6">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Target Audience
                </Label>
                <div className="flex gap-4 items-center">
                  <Select value={audience} onValueChange={setAudience}>
                    <SelectTrigger className="h-11 rounded-xl flex-1 bg-background border-slate-200 shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleAudiences.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <opt.icon className="h-4 w-4 text-slate-500" />
                            <span className="font-medium">{opt.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl whitespace-nowrap text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    <Users className="w-4 h-4 inline-block mr-1.5 opacity-50" />
                    {estimate == null ? "..." : estimate.toLocaleString("en-IN")}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Title
                </Label>
                <Input
                  placeholder="e.g. New Feature: AI Menu Import"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-11 rounded-xl bg-background border-slate-200 shadow-sm text-base font-medium"
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Message
                </Label>
                <Textarea
                  placeholder="Write the notification people will see…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-[120px] rounded-xl resize-none bg-background border-slate-200 shadow-sm text-base"
                  maxLength={500}
                />
                <p className="text-[11px] text-muted-foreground text-right mt-1">{body.length}/500</p>
              </div>

              {/* Advanced Integrations Toggle */}
              <div className="pt-2 border-t border-border/50">
                <button 
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  Advanced Integrations
                </button>
                
                {showAdvanced && (
                  <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <ImageIcon className="w-3.5 h-3.5" /> Rich Media URL
                        </Label>
                        <Input
                          placeholder="https://.../image.png"
                          value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                          className="h-10 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <LinkIcon className="w-3.5 h-3.5" /> Deep Link
                        </Label>
                        <Input
                          placeholder="kada://restaurant/123"
                          value={deepLink}
                          onChange={(e) => setDeepLink(e.target.value)}
                          className="h-10 rounded-lg text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
                      <div>
                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Mark as Urgent Alert</p>
                        <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">Overrides DND settings and shows prominent warning.</p>
                      </div>
                      <Switch checked={urgent} onCheckedChange={setUrgent} />
                    </div>
                  </div>
                )}
              </div>

              <Button
                onClick={handleSend}
                disabled={sending || !title.trim() || !body.trim()}
                className="w-full h-12 rounded-xl text-base font-bold shadow-md gap-2"
                size="lg"
              >
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                {sending ? "Sending…" : `Send to ${selected?.label || "audience"}`}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-3 border-b border-border/40 bg-muted/20">
              <CardTitle className="text-sm font-semibold text-foreground/90">Quick Start Templates</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 p-4">
              {TEMPLATE_PRESETS.map((template) => (
                <button
                  key={template.label}
                  onClick={() => { setTitle(template.title); setBody(template.body); }}
                  className="text-left p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-background hover:border-primary hover:bg-primary/5 transition-all group"
                >
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-primary mb-1">{template.label}</p>
                  <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{template.body}</p>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Col: Live Preview & History */}
        <div className="space-y-6">
          <Card className="border-border/60 shadow-sm overflow-hidden bg-slate-50 dark:bg-slate-900/50">
            <CardHeader className="pb-4 pt-5 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Live Preview</CardTitle>
                <Tabs value={previewPlatform} onValueChange={(v: any) => setPreviewPlatform(v)}>
                  <TabsList className="h-8">
                    <TabsTrigger value="ios" className="text-xs">iOS</TabsTrigger>
                    <TabsTrigger value="android" className="text-xs">Android</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent className="flex justify-center p-6 bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-900 dark:to-black">
              {/* Phone Mockup Frame */}
              <div className="relative w-[280px] h-[580px] bg-slate-900 rounded-[40px] border-[8px] border-slate-800 shadow-2xl overflow-hidden ring-1 ring-slate-900/20">
                {/* Notch */}
                <div className="absolute top-0 inset-x-0 h-6 bg-slate-800 rounded-b-xl w-32 mx-auto z-20"></div>
                
                {/* Wallpaper / OS Background */}
                <div className="absolute inset-0 bg-slate-100 dark:bg-slate-800">
                  <div className="absolute top-12 w-full px-5 text-center z-0">
                    <p className="text-5xl font-extralight text-slate-800 dark:text-slate-100 opacity-60 tracking-tight">
                      {now.getHours() % 12 || 12}:{now.getMinutes().toString().padStart(2, '0')}
                    </p>
                    <p className="text-xs font-medium text-slate-500 mt-2 opacity-80">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric'})}</p>
                  </div>
                </div>

                {/* Notification Bubble */}
                <div className="absolute top-[110px] inset-x-2 z-10 animate-in slide-in-from-top-10 fade-in duration-500">
                  {previewPlatform === "ios" ? (
                    <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-2xl p-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded bg-primary flex items-center justify-center shrink-0">
                            <span className="text-white text-[10px] font-bold tracking-tighter">K</span>
                          </div>
                          <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{appName}</span>
                        </div>
                        <span className="text-[10px] text-slate-400">now</span>
                      </div>
                      <div className="px-1">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight mb-1">
                          {title || "Notification Title"}
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300 leading-tight line-clamp-3">
                          {body || "Your message body will appear here. Start typing to see the live preview."}
                        </p>
                        {imageUrl && (
                          <div className="mt-3 rounded-lg overflow-hidden h-32 bg-slate-100 dark:bg-slate-900">
                            <img src={imageUrl} className="w-full h-full object-cover" alt="Preview" onError={(e) => (e.currentTarget.style.display = 'none')} />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-3.5 shadow-lg border border-slate-200 dark:border-slate-700">
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                          <Bell className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs text-primary font-medium">{appName} • now</span>
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                          </div>
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-0.5 leading-snug">
                            {title || "Notification Title"}
                          </p>
                          <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug line-clamp-3">
                            {body || "Your message body will appear here. Start typing to see the live preview."}
                          </p>
                          {imageUrl && (
                            <div className="mt-3 rounded-lg overflow-hidden h-32 bg-slate-200 dark:bg-slate-900">
                              <img src={imageUrl} className="w-full h-full object-cover" alt="Preview" onError={(e) => (e.currentTarget.style.display = 'none')} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 overflow-hidden">
            <CardHeader className="pb-3 bg-muted/20 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">History</CardTitle>
                <Badge variant="secondary" className="text-xs bg-white dark:bg-black">{logs.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {logs.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No broadcasts yet</p>
                </div>
              ) : (
                <div className="max-h-[280px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
                  {logs.map((log) => (
                    <div key={log.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate flex-1">{log.title}</p>
                        <Badge variant="outline" className="text-[10px] shrink-0 bg-transparent">
                          {log.audience}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2 mb-2 leading-relaxed">{log.body}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                          <Users className="h-3 w-3 text-slate-500" />
                          {log.recipientCount} inboxes
                          {log.pushed != null ? ` · ${log.pushed} push` : ""}
                        </span>
                        <span className="text-[10px] text-slate-400">{log.sentAt}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Write with AI Dialog */}
      <Dialog open={aiModalOpen} onOpenChange={setAiModalOpen}>
        <DialogContent className="sm:max-w-[600px] overflow-hidden p-0">
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-background p-6 pb-4 border-b">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="w-5 h-5 text-primary" />
                Write with AI
              </DialogTitle>
              <DialogDescription>
                Describe what you want to announce, and Kada AI will craft the perfect push notification.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="p-6 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Prompt
              </Label>
              <div className="relative">
                <Textarea 
                  placeholder="e.g. 'Announce our new BOGO pizza offer for the weekend...'"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  className="min-h-[100px] rounded-xl resize-none bg-background pr-12"
                  autoFocus
                />
                <Button aria-label="Generate with AI" 
                  size="icon" 
                  className="absolute bottom-2 right-2 rounded-lg"
                  onClick={handleGenerateAI}
                  disabled={!aiPrompt.trim() || isGenerating}
                >
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {aiResults.length > 0 && (
              <div className="space-y-3 pt-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Suggestions
                </Label>
                <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
                  {aiResults.map((res, i) => (
                    <div 
                      key={i} 
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 hover:border-primary/50 cursor-pointer transition-colors group relative"
                      onClick={() => {
                        setTitle(res.title);
                        setBody(res.body);
                        if (res.deepLink) setDeepLink(res.deepLink);
                        setAiModalOpen(false);
                      }}
                    >
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">{res.title}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{res.body}</p>
                      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Badge className="bg-primary text-primary-foreground gap-1">
                          <Check className="w-3 h-3" /> Use this
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
