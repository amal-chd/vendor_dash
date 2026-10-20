import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { indiaStates } from "@/constants/indiaData";
import { cn, getTaxLabel } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import { encodeGeohash } from "@/lib/geo";
import {
  Building2, Smartphone, ShieldCheck,
  CreditCard, Bell, Palette,
  Clock, Camera, Save, ChefHat,
  ChevronRight, Lock,
  Check, Volume2, Monitor, AlertTriangle, ArrowRight,
  Star, Zap, Rocket, BadgeCheck, Shield, Sparkles,
  MapPin, Loader2, Crosshair,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { auth, db, functions } from "@/lib/firebase";
import { signOutWeb } from "@/lib/auth-flow";
import { collection, deleteDoc, doc, getDoc, limit, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { toast as sonnerToast } from "sonner";
import { getLocalSessionId } from "@/lib/sessions";
import { useGeoData } from "@/hooks/useGeoData";
import PhoneInput, { isValidPhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";

const settingsCategories = [
  { id: 'profile', label: 'Shop Profile', icon: Building2 },
  { id: 'menu-theme', label: 'Menu Design', icon: Palette },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'tax', label: 'Tax & GST', icon: ChefHat },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'customer-info', label: 'Customer Data', icon: Smartphone },
];

const menuThemes = [
  { id: 'midnight', name: 'Midnight', desc: 'Dark luxurious noir theme', bg: 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950', accent: 'bg-emerald-500', preview: ['#0f172a', '#1e293b', '#10b981'] },
  { id: 'pearl', name: 'Pearl', desc: 'Clean white & elegant', bg: 'bg-gradient-to-br from-stone-50 via-white to-stone-100', accent: 'bg-stone-800', preview: ['#fafaf9', '#ffffff', '#292524'] },
  { id: 'ember', name: 'Ember', desc: 'Warm rustic amber tones', bg: 'bg-gradient-to-br from-amber-950 via-orange-950 to-amber-950', accent: 'bg-amber-500', preview: ['#451a03', '#431407', '#f59e0b'] },
  { id: 'forest', name: 'Forest', desc: 'Natural earthy greens', bg: 'bg-gradient-to-br from-emerald-950 via-green-950 to-emerald-950', accent: 'bg-lime-500', preview: ['#022c22', '#052e16', '#84cc16'] },
  { id: 'royal', name: 'Royal', desc: 'Deep purple & gold', bg: 'bg-gradient-to-br from-purple-950 via-violet-950 to-indigo-950', accent: 'bg-amber-400', preview: ['#3b0764', '#2e1065', '#fbbf24'] },
];

import { useSubscription } from "@/hooks/useSubscription";
import { usePricing } from "@/hooks/usePricing";
import { setSubscriptionCancellation, startSubscriptionCheckout } from "@/lib/subscriptionCheckout";
import { AnimatePresence } from "framer-motion";

export default function SettingsPage() {
  const { user, restaurantId , activeRestaurantId } = useAuth();
  const geo = useGeoData();
  const { format: formatCurrency } = useCurrency();
  const { plan, status: subStatus, daysLeft, isExpired, loading: subLoading, billingModel, cancelAtPeriodEnd } = useSubscription();
  const [cancelBusy, setCancelBusy] = useState(false);
  const toggleCancellation = async () => {
    setCancelBusy(true);
    const err = await setSubscriptionCancellation("dine", !cancelAtPeriodEnd);
    setCancelBusy(false);
    if (err) toast({ title: "Couldn't update subscription", description: err, variant: "destructive" });
    else toast({ title: cancelAtPeriodEnd ? "Subscription will renew as normal" : "Subscription will stop at the end of this period" });
  };
  const { plans: allPlans } = usePricing();
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('annual');
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const { toast } = useToast();
  // `?tab=billing` deep-links here from the renewal banner.
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(
    () => searchParams.get('tab') ?? 'profile',
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pwDialogOpen, setPwDialogOpen] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [profile, setProfile] = useState({
    name: "",
    phone: "",
    address: "",
    hours: "",
    currency: "Indian Rupee (INR)",
    taxId: "",
    fssaiLicense: "",
    supportEmail: "",
    menuTheme: "midnight",
    logoUrl: "",
    state: "",
    district: "",
    postalCode: "",
    place: "",
    countryCode: "IN",
    collectCustomerName: true,
    collectCustomerPhone: true,
    enableTax: false,
    /** Tax percentage charged at checkout when enableTax is on (defaults 5). */
    taxPercentage: 5,
    timezone: "Asia/Kolkata",
    taxLabel: "",
    taxMethod: "exclusive",
    /** Precise restaurant coordinates — powers the customer delivery app's
     *  7km radius discovery. Null until the vendor sets it. */
    location: null as { lat: number; lng: number } | null,
    geohash: "",
  });
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    async function fetchSettings() {
      if (!user) return;
      try {
        const docRef = doc(db, "restaurants", activeRestaurantId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setProfile(prev => ({ ...prev, ...docSnap.data() }));
        }
      } catch (error) {
        console.error("Error fetching settings:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, [user, activeRestaurantId]);

  useEffect(() => {
    if (!user) return;
    setSessionsLoading(true);
    const qSessions = query(
      collection(db, "user_sessions"),
      where("restaurantId", "==", activeRestaurantId),
      orderBy("lastSeen", "desc"),
      limit(25),
    );
    const unsub = onSnapshot(
      qSessions,
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSessionsLoading(false);
      },
      () => setSessionsLoading(false),
    );
    return () => unsub();
  }, [user, activeRestaurantId]);

  const sessionId = user ? getLocalSessionId(user.uid) : "";

  const describeSession = (s: any) => {
    const ua = (s.userAgent || "").toString();
    const platform = (s.platform || "").toString();
    const tz = (s.timeZone || "").toString();
    const isCurrent = s.sessionId === sessionId;

    const label =
      ua.includes("Chrome") && !ua.includes("Edg") ? "Chrome" :
        ua.includes("Safari") && !ua.includes("Chrome") ? "Safari" :
          ua.includes("Firefox") ? "Firefox" :
            ua.includes("Edg") ? "Edge" :
              ua ? "Browser" : "Device";

    const lastSeen = s.lastSeen?.toDate ? s.lastSeen.toDate() : null;
    const lastSeenStr = lastSeen ? lastSeen.toLocaleString() : "—";

    return { label, platform, tz, isCurrent, lastSeenStr };
  };

  /**
   * Buy or renew a Kada Dine subscription on the web via Razorpay.
   *
   * Nothing about the price is sent from here — `createSubscriptionOrder`
   * reads the plan catalog server-side, so a tampered client can only ask for
   * a different plan id, never a different amount. Entitlement is granted by
   * the signature-verified webhook, so after a successful payment we just wait
   * for the subscription stream to catch up instead of flipping any local flag.
   */
  const handleSubscribe = async (planId: string) => {
    setCheckoutPlanId(planId);
    try {
      const err = await startSubscriptionCheckout({
        product: "dine",
        planId,
        period: billingPeriod === "annual" ? "yearly" : "monthly",
        prefill: {
          name: profile.name || undefined,
          email: user?.email || profile.supportEmail || undefined,
          contact: profile.phone || undefined,
        },
      });
      if (err && !err.startsWith("Payment received")) {
        toast({ title: "Payment not completed", description: err, variant: "destructive" });
      } else {
        toast({
          title: "Payment received",
          description: err ?? "Your plan activates within a few seconds. This page updates automatically.",
        });
      }
    } catch (e: any) {
      toast({ title: "Checkout failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setCheckoutPlanId(null);
    }
  };

  const handleChangePassword = async () => {
    if (!user || !user.email) return;
    if (!currentPw || !newPw) {
      sonnerToast.error("Enter current and new password");
      return;
    }
    if (newPw.length < 6) {
      sonnerToast.error("New password must be at least 6 characters");
      return;
    }
    if (newPw !== confirmPw) {
      sonnerToast.error("Passwords do not match");
      return;
    }

    setPwSaving(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPw);
      sonnerToast.success("Password updated");
      setPwDialogOpen(false);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (e) {
      console.error(e);
      sonnerToast.error("Failed to change password");
    } finally {
      setPwSaving(false);
    }
  };

  const handleLogoutAllDevices = async () => {
    if (!user) return;
    try {
      const fn = httpsCallable(functions, "revokeAllSessions");
      await fn({});
      await signOutWeb(user);
      sonnerToast.success("Logged out from all devices");
    } catch (e) {
      console.error(e);
      // Fallback: we can at least clear session records and sign out current device.
      try {
        const toDelete = sessions.map((s) => s.id).filter(Boolean);
        await Promise.all(toDelete.map((id) => deleteDoc(doc(db, "user_sessions", id))));
      } catch (clearErr) {
        console.error("Failed to clear sessions:", clearErr);
      }
      try {
        await signOutWeb(user);
      } catch (signOutErr) {
        console.error("Failed to sign out:", signOutErr);
      }
      sonnerToast.error("Could not revoke tokens. Signed out this device and cleared session list.");
    }
  };

  const captureLocation = () => {
    if (!navigator.geolocation) {
      toast({
        title: "GPS unavailable",
        description: "This device/browser does not support location.",
        variant: "destructive",
      });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setProfile((prev) => ({
          ...prev,
          location: { lat, lng },
          geohash: encodeGeohash(lat, lng, 9),
        }));
        setLocating(false);
        toast({
          title: "Location captured",
          description: `Set to ${lat}, ${lng}. Remember to Save.`,
        });
      },
      () => {
        setLocating(false);
        toast({
          title: "Location failed",
          description: "Could not read GPS. Allow location access and retry.",
          variant: "destructive",
        });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleSave = async () => {
    if (!user) return;
    
    if (profile.phone && !isValidPhoneNumber(profile.phone)) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid international phone number.",
        variant: "destructive"
      });
      return;
    }

    setSaving(true);
    try {
      const getCurrencyCode = (currencyName: string) => {
        const match = currencyName.match(/\(([^)]+)\)/);
        return match ? match[1] : currencyName;
      };

      const updateData: any = {
        name: profile.name || "",
        phone: profile.phone || "",
        address: profile.address || "",
        hours: profile.hours || "",
        currency: profile.currency || "Indian Rupee (INR)",
        currencyCode: getCurrencyCode(profile.currency || "Indian Rupee (INR)"),
        taxId: profile.taxId || "",
        supportEmail: profile.supportEmail || "",
        menuTheme: profile.menuTheme || "midnight",
        logoUrl: profile.logoUrl || "",
        state: profile.state || "",
        district: profile.district || "",
        countryCode: profile.countryCode || "IN",
        collectCustomerName: profile.collectCustomerName ?? true,
        collectCustomerPhone: profile.collectCustomerPhone ?? true,
        enableTax: profile.enableTax ?? false,
        taxPercentage: profile.taxPercentage ?? 5,
        timezone: profile.timezone || "Asia/Kolkata",
        taxLabel: profile.taxLabel || "",
        taxMethod: profile.taxMethod || "exclusive",
        location: profile.location || null,
        geohash: profile.geohash || "",
        updatedAt: new Date()
      };

      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      await updateDoc(doc(db, "restaurants", activeRestaurantId), updateData);
      toast({
        title: "Settings Saved",
        description: "Your changes have been saved successfully."
      });
    } catch (error: any) {
      console.error("Settings save error:", error);
      toast({
        title: "Error",
        description: "Failed to save changes: " + (error?.message || "Unknown error"),
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (!user || !file) return;
    setSaving(true);
    try {
      const storageRef = ref(storage, `logos/${activeRestaurantId}/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);

      setProfile(prev => ({ ...prev, logoUrl: url }));
      await updateDoc(doc(db, "restaurants", activeRestaurantId), { logoUrl: url });

      toast({
        title: "Logo Updated",
        description: "Your brand identity has been synchronized."
      });
    } catch (error) {
      console.error("Logo upload error:", error);
      toast({
        title: "Upload Failed",
        description: "Could not update business logo.",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-1">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your shop profile, billing, and account.</p>
        </div>
        <Button
          disabled={saving}
          onClick={handleSave}
          className="rounded-xl h-10 font-semibold gap-2 px-5 self-start sm:self-auto"
        >
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Navigation Sidebar */}
        <div className="lg:col-span-3 space-y-1 lg:sticky lg:top-6 self-start">
          {settingsCategories.map((cat, i) => (
            <motion.button
              key={cat.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => setActiveTab(cat.id)}
              className={cn(
                "w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-all group",
                activeTab === cat.id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "hover:bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent"
              )}
            >
              <div className="flex items-center gap-3">
                <cat.icon className="w-4 h-4" />
                <span className="text-sm font-medium">{cat.label}</span>
              </div>
              <ChevronRight className={cn(
                "w-3.5 h-3.5 transition-transform",
                activeTab === cat.id ? "text-primary translate-x-0.5" : "text-muted-foreground/40 group-hover:translate-x-0.5"
              )} />
            </motion.button>
          ))}




        </div>

        {/* Content Panel */}
        <div className="lg:col-span-9 space-y-6">
          {activeTab === 'profile' && (
            <Card className="rounded-2xl border border-border/40 shadow-sm overflow-hidden">
              <CardHeader className="px-6 sm:px-8 py-5 border-b border-border/30">
                <CardTitle className="text-base font-semibold">Shop Profile</CardTitle>
                <CardDescription className="text-xs mt-0.5">Your restaurant's public details and display info</CardDescription>
              </CardHeader>
              <CardContent className="px-6 sm:px-8 py-6 space-y-7">
                {/* Logo + identity */}
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div className="relative group flex-shrink-0">
                    <div className="w-24 h-24 rounded-2xl bg-muted/30 border-2 border-dashed border-border/50 flex items-center justify-center overflow-hidden group-hover:border-primary/40 transition-colors">
                      {profile.logoUrl ? (
                        <img loading="lazy" src={profile.logoUrl} alt="Restaurant logo" className="w-full h-full object-cover" />
                      ) : (
                        <Building2 className="w-9 h-9 text-muted-foreground/30" />
                      )}
                    </div>
                    <Input
                      type="file" accept="image/*" className="hidden" id="business-logo"
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) handleLogoUpload(file); }}
                    />
                    <Button
                      size="icon"
                      className="absolute -bottom-2 -right-2 rounded-xl h-8 w-8 shadow-md"
                      onClick={() => document.getElementById('business-logo')?.click()}
                      disabled={saving}
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="text-center sm:text-left">
                    <h3 className="text-base font-semibold text-foreground">{profile.name || "Your Restaurant"}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{profile.address?.split(',')[0] || "Add your address below"}</p>
                    <div className="flex gap-2 mt-3 flex-wrap justify-center sm:justify-start">
                      <Badge variant="secondary" className="rounded-lg px-2.5 py-0.5 text-xs font-medium">{plan.name}</Badge>
                      <Badge variant="secondary" className={cn("rounded-lg px-2.5 py-0.5 text-xs font-medium border-0",
                        isExpired ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-600")}>
                        {isExpired ? "Expired" : subStatus === 'active' ? "Active" : subStatus}
                      </Badge>
                      {daysLeft !== null && (
                        <Badge variant="secondary" className={cn("rounded-lg px-2.5 py-0.5 text-xs font-medium border-0",
                          daysLeft <= 7 ? "bg-amber-500/10 text-amber-600" : "bg-primary/10 text-primary")}>
                          {daysLeft} days left
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Form fields */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">Business name</label>
                    <Input className="h-11 rounded-xl bg-card border-border/40" value={profile.name}
                      onChange={(e) => setProfile(prev => ({ ...prev, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5 [&_.PhoneInputInput]:h-11 [&_.PhoneInputInput]:rounded-xl [&_.PhoneInputInput]:bg-card [&_.PhoneInputInput]:border [&_.PhoneInputInput]:border-border/40 [&_.PhoneInputInput]:px-3 [&_.PhoneInputInput]:text-sm [&_.PhoneInputInput]:focus-visible:outline-none">
                    <label className="text-xs font-medium text-muted-foreground px-1">Phone number</label>
                    <PhoneInput
                      maxLength={15}
                      international
                      defaultCountry="IN"
                      value={profile.phone}
                      onChange={(val) => setProfile(prev => ({ ...prev, phone: val || "" }))}
                      className="w-full"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">Address</label>
                    <Textarea placeholder="Floor, building, street name…"
                      className="rounded-xl bg-card border-border/40 min-h-[88px] resize-none" value={profile.address}
                      onChange={(e) => setProfile(prev => ({ ...prev, address: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">Country</label>
                    <select className="flex h-11 w-full rounded-xl border border-border/40 bg-muted/50 px-3 py-2 text-sm focus-visible:outline-none appearance-none cursor-not-allowed"
                      value="IN" disabled>
                      <option value="IN">India</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">State</label>
                    <select className="flex h-11 w-full rounded-xl border border-border/40 bg-card px-3 py-2 text-sm focus-visible:outline-none appearance-none disabled:opacity-50"
                      value={profile.state} disabled={!profile.countryCode}
                      onChange={(e) => setProfile(prev => ({ ...prev, state: e.target.value, district: "" }))}>
                      <option value="">Select state</option>
                      {profile.countryCode === "IN" ? (
                        indiaStates.map((s) => <option key={s.state} value={s.state}>{s.state}</option>)
                      ) : (
                        (geo?.State.getStatesOfCountry(profile.countryCode || "IN") ?? []).map((s) => <option key={s.isoCode} value={s.isoCode}>{s.name}</option>)
                      )}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">City / District</label>
                    <select className="flex h-11 w-full rounded-xl border border-border/40 bg-card px-3 py-2 text-sm focus-visible:outline-none appearance-none disabled:opacity-50"
                      value={profile.district} disabled={!profile.state}
                      onChange={(e) => setProfile(prev => ({ ...prev, district: e.target.value }))}>
                      <option value="">Select city</option>
                      {profile.countryCode === "IN" ? (
                        indiaStates.find(s => s.state === profile.state)?.districts.map((d) => <option key={d} value={d}>{d}</option>)
                      ) : (
                        (geo?.City.getCitiesOfState(profile.countryCode || "IN", profile.state) ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)
                      )}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">PIN Code</label>
                    <Input type="number" max="999999" className="h-11 rounded-xl bg-card border-border/40" placeholder="e.g. 110001" value={profile.postalCode || ""}
                      onChange={(e) => setProfile(prev => ({ ...prev, postalCode: e.target.value.slice(0, 6) }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">Place / Locality</label>
                    <Input className="h-11 rounded-xl bg-card border-border/40" placeholder="e.g. Connaught Place" value={profile.place || ""}
                      onChange={(e) => setProfile(prev => ({ ...prev, place: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground px-1 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> Restaurant location (for delivery app discovery)
                    </label>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-card p-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={captureLocation}
                        disabled={locating}
                        className="h-9 rounded-lg gap-2"
                      >
                        {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
                        {locating ? "Locating…" : profile.location ? "Update location" : "Use current location"}
                      </Button>
                      {profile.location ? (
                        <span className="text-xs font-medium text-emerald-600 flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5" />
                          {profile.location.lat.toFixed(5)}, {profile.location.lng.toFixed(5)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not set — your restaurant won't appear in the customer delivery app until you set this.
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 px-1">
                      Stand at your restaurant when capturing for the most accurate pin. Tap Save after updating.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">Opening hours</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input 
                          type="time" 
                          className="h-11 rounded-xl bg-card border-border/40 pl-10 [&::-webkit-calendar-picker-indicator]:hidden" 
                          value={profile.hours?.split(" - ")[0] || ""}
                          onChange={(e) => {
                            const end = profile.hours?.split(" - ")[1] || "";
                            setProfile(prev => ({ ...prev, hours: `${e.target.value} - ${end}` }));
                          }} 
                        />
                        <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                      </div>
                      <span className="text-muted-foreground font-medium">-</span>
                      <div className="relative flex-1">
                        <Input 
                          type="time" 
                          className="h-11 rounded-xl bg-card border-border/40 pl-10 [&::-webkit-calendar-picker-indicator]:hidden" 
                          value={profile.hours?.split(" - ")[1] || ""}
                          onChange={(e) => {
                            const start = profile.hours?.split(" - ")[0] || "";
                            setProfile(prev => ({ ...prev, hours: `${start} - ${e.target.value}` }));
                          }} 
                        />
                        <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">Display currency</label>
                    <select className="flex h-11 w-full rounded-xl border border-border/40 bg-card px-3 py-2 text-sm focus-visible:outline-none appearance-none"
                      value={profile.currency} onChange={(e) => setProfile(prev => ({ ...prev, currency: e.target.value }))}>
                      <option>Indian Rupee (INR)</option>
                      <option>US Dollar (USD)</option>
                      <option>Euro (EUR)</option>
                      <option>British Pound (GBP)</option>
                      <option>UAE Dirham (AED)</option>
                      <option>Singapore Dollar (SGD)</option>
                      <option>Canadian Dollar (CAD)</option>
                      <option>Australian Dollar (AUD)</option>
                      <option>Saudi Riyal (SAR)</option>
                      <option>Qatari Riyal (QAR)</option>
                      <option>Malaysian Ringgit (MYR)</option>
                      <option>South African Rand (ZAR)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground px-1">Timezone</label>
                    <select className="flex h-11 w-full rounded-xl border border-border/40 bg-card px-3 py-2 text-sm focus-visible:outline-none appearance-none"
                      value={profile.timezone || "Asia/Kolkata"} onChange={(e) => setProfile(prev => ({ ...prev, timezone: e.target.value }))}>
                      <option value="Asia/Kolkata">India (GMT+5:30) - Asia/Kolkata</option>
                      <option value="America/New_York">US Eastern (GMT-4:00) - America/New_York</option>
                      <option value="America/Chicago">US Central (GMT-5:00) - America/Chicago</option>
                      <option value="America/Denver">US Mountain (GMT-6:00) - America/Denver</option>
                      <option value="America/Los_Angeles">US Pacific (GMT-7:00) - America/Los_Angeles</option>
                      <option value="Europe/London">United Kingdom (GMT+1:00) - Europe/London</option>
                      <option value="Europe/Berlin">Germany/Europe (GMT+2:00) - Europe/Berlin</option>
                      <option value="Asia/Dubai">UAE (GMT+4:00) - Asia/Dubai</option>
                      <option value="Asia/Singapore">Singapore (GMT+8:00) - Asia/Singapore</option>
                      <option value="America/Toronto">Canada (GMT-4:00) - America/Toronto</option>
                      <option value="Australia/Sydney">Australia (GMT+10:00) - Australia/Sydney</option>
                      <option value="Asia/Riyadh">Saudi Arabia (GMT+3:00) - Asia/Riyadh</option>
                      <option value="Asia/Qatar">Qatar (GMT+3:00) - Asia/Qatar</option>
                      <option value="Asia/Kuala_Lumpur">Malaysia (GMT+8:00) - Asia/Kuala_Lumpur</option>
                      <option value="Africa/Johannesburg">South Africa (GMT+2:00) - Africa/Johannesburg</option>
                    </select>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'menu-theme' && (
            <Card className="rounded-2xl border border-border/40 shadow-sm overflow-hidden">
              <CardHeader className="px-6 sm:px-8 py-5 border-b border-border/30">
                <CardTitle className="text-base font-semibold">Menu Design</CardTitle>
                <CardDescription className="text-xs mt-0.5">Choose how your digital QR menu looks to customers</CardDescription>
              </CardHeader>
              <CardContent className="px-6 sm:px-8 py-6 space-y-6">
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {menuThemes.map((theme) => {
                    const isActive = profile.menuTheme === theme.id;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => setProfile(prev => ({ ...prev, menuTheme: theme.id }))}
                        className={cn(
                          "relative rounded-3xl overflow-hidden border-2 transition-all text-left group hover:scale-[1.02]",
                          isActive ? "border-primary shadow-xl shadow-primary/20 ring-2 ring-primary/20" : "border-border/40 hover:border-border"
                        )}
                      >
                        {/* Theme preview */}
                        <div className={cn("h-36 w-full relative", theme.bg)}>
                          {/* Mini menu mockup */}
                          <div className="absolute inset-4 flex flex-col items-center justify-center">
                            <div className="w-8 h-8 rounded-xl mb-2" style={{ backgroundColor: theme.preview[2] }} />
                            <div className="w-20 h-2 rounded-full mb-1" style={{ backgroundColor: theme.preview[2], opacity: 0.6 }} />
                            <div className="w-14 h-1.5 rounded-full" style={{ backgroundColor: theme.preview[2], opacity: 0.3 }} />
                            <div className="mt-3 flex gap-1.5">
                              {[1, 2, 3].map(i => (
                                <div key={i} className="w-12 h-8 rounded-lg border" style={{ borderColor: `${theme.preview[2]}30`, backgroundColor: `${theme.preview[1]}20` }} />
                              ))}
                            </div>
                          </div>
                          {isActive && (
                            <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                              <Check className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                        </div>
                        <div className="p-4 bg-card">
                          <p className="font-black text-sm">{theme.name}</p>
                          <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{theme.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="p-6 rounded-2xl bg-muted/20 border border-border/20">
                  <p className="text-xs font-bold text-muted-foreground">
                    💡 <strong className="text-foreground">Tip:</strong> The theme will be applied to your customer-facing QR menu page instantly. Your restaurant name, logo, and branding will be prominently displayed.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'billing' && (
            <div className="space-y-6">

              {/* ── Current Plan Status ─────────────────────────────────── */}
              <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 md:p-8">
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-primary/5 blur-3xl" />
                </div>
                <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "text-xs font-black uppercase tracking-[0.18em] px-2.5 py-1 rounded-full",
                        isExpired ? "bg-rose-500/10 text-rose-500 border border-rose-500/20" : "bg-primary/10 text-primary border border-primary/20"
                      )}>
                        {isExpired ? "Expired" : subStatus === 'active' ? 'Active' : subStatus}
                      </span>
                    </div>
                    <h2 className="text-2xl font-black text-foreground tracking-tight mt-2">
                      {plan?.name || "Starter"} Plan
                    </h2>
                    <p className="text-sm text-muted-foreground font-medium mt-1">
                      {isExpired
                        ? "Your subscription has ended. Choose a plan below to reactivate."
                        : daysLeft !== null && daysLeft <= 7
                        ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining — renew soon to avoid interruption.`
                        : daysLeft !== null
                        ? `${daysLeft} days remaining on your current plan.`
                        : "Choose a plan below to subscribe."}
                    </p>
                  </div>
                  <div className="flex flex-col sm:items-end gap-2">
                    <span className="text-[11px] font-semibold text-muted-foreground text-center sm:text-right">
                      {billingModel === 'subscription'
                        ? cancelAtPeriodEnd
                          ? "Stops at the end of this period — commission billing applies after that."
                          : "Billing is managed here on the web."
                        : "You're on commission billing — a plan replaces per-order commission."}
                    </span>
                    {billingModel === 'subscription' && subStatus === 'active' && !isExpired && (
                      <Button variant="outline" size="sm" onClick={toggleCancellation} disabled={cancelBusy}>
                        {cancelBusy ? "Saving…" : cancelAtPeriodEnd ? "Keep my subscription" : "Cancel at period end"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Billing Period Toggle ───────────────────────────────── */}
              <div className="flex flex-col items-center gap-1">
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">Compare Plans</p>
                <div className="inline-flex items-center rounded-full border border-border bg-muted p-1.5 gap-1">
                  <button
                    onClick={() => setBillingPeriod('monthly')}
                    className={cn(
                      "rounded-full px-5 py-2 text-sm font-bold transition-colors duration-200",
                      billingPeriod === 'monthly' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingPeriod('annual')}
                    className={cn(
                      "flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold transition-colors duration-200",
                      billingPeriod === 'annual' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Annual
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider transition-colors",
                      billingPeriod === 'annual' ? "bg-emerald-500 text-white" : "bg-emerald-500/20 text-emerald-600"
                    )}>
                      Save 20%
                    </span>
                  </button>
                </div>
              </div>

              {/* ── Plan Cards ─────────────────────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
                {allPlans.map((p, i) => {
                  const isPopular = !!p.popular;
                  const isCurrentPlan = plan?.id === p.id;
                  const price = billingPeriod === 'annual' ? p.annualPrice : p.monthlyPrice;
                  const isCustom = price === "Custom";
                  return (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: i * 0.07 }}
                      className={cn(
                        "relative flex flex-col rounded-3xl border transition-all duration-300 h-full",
                        isPopular
                          ? "bg-foreground text-background border-foreground shadow-2xl md:scale-[1.03] lg:scale-105 z-10"
                          : isCurrentPlan
                          ? "bg-primary/5 border-primary/40 shadow-md"
                          : "bg-background text-foreground border-border shadow-sm hover:border-foreground/30 hover:shadow-md"
                      )}
                    >
                      {/* Badges */}
                      {isPopular && (
                        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-950 shadow-lg shadow-primary/30">
                          <Star className="h-3 w-3 fill-slate-950" /> Most Popular
                        </div>
                      )}
                      {isCurrentPlan && !isPopular && (
                        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-lg">
                          <Check className="h-3 w-3" /> Current Plan
                        </div>
                      )}
                      {isCurrentPlan && isPopular && (
                        <div className="absolute -top-3.5 right-4 flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white shadow-lg">
                          <Check className="h-2.5 w-2.5" /> Active
                        </div>
                      )}

                      <div className="p-7 flex-1 flex flex-col">
                        {/* Plan name */}
                        <div className="mb-6">
                          <div className="flex items-center gap-2 mb-2">
                            {p.id === "starter" && <Zap className="h-4 w-4 text-amber-500" />}
                            {p.id === "growth" && <Rocket className="h-4 w-4 text-primary" />}
                            {p.id === "enterprise" && <Building2 className="h-4 w-4 text-blue-400" />}
                            <span className={cn(
                              "text-xs font-black uppercase tracking-[0.18em]",
                              isPopular ? "text-primary" : "text-muted-foreground"
                            )}>
                              {p.name}
                            </span>
                          </div>
                          <p className={cn(
                            "text-sm font-medium leading-relaxed",
                            isPopular ? "text-background/80" : "text-muted-foreground"
                          )}>
                            {p.tagline}
                          </p>
                        </div>

                        {/* Price */}
                        <div className="mb-5">
                          <AnimatePresence mode="wait">
                            <motion.div
                              key={`${p.id}-${billingPeriod}`}
                              initial={{ opacity: 0, y: -6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 6 }}
                              transition={{ duration: 0.18 }}
                              className="flex items-baseline gap-1"
                            >
                              {isCustom ? (
                                <span className={cn("text-4xl font-black tracking-tight", isPopular ? "text-white" : "text-foreground")}>Custom</span>
                              ) : (
                                <>
                                  <span className={cn("text-xl font-black", isPopular ? "text-background/80" : "text-muted-foreground")}>₹</span>
                                  <span className={cn("text-5xl font-black tracking-tighter leading-none", isPopular ? "text-background" : "text-foreground")}>
                                    {(price as number).toLocaleString("en-IN")}
                                  </span>
                                </>
                              )}
                            </motion.div>
                          </AnimatePresence>
                          {!isCustom && (
                            <p className={cn("mt-1 text-xs font-semibold", isPopular ? "text-background/60" : "text-muted-foreground")}>
                              per month, billed {billingPeriod === 'annual' ? 'annually' : 'monthly'}
                            </p>
                          )}
                          {!isCustom && billingPeriod === 'annual' && (
                            <p className={cn("mt-0.5 text-[11px] font-bold", isPopular ? "text-emerald-400" : "text-emerald-600")}>
                              Save ₹{((p.monthlyPrice as number) - (p.annualPrice as number)) * 12}/yr
                            </p>
                          )}
                        </div>

                        <div className={cn("h-px mb-5", isPopular ? "bg-background/20" : "bg-border")} />

                        {/* Features */}
                        <ul className="space-y-2.5 flex-1">
                          {p.features.slice(0, 5).map((f) => (
                            <li key={f} className="flex items-start gap-2.5 text-sm leading-tight">
                              <span className={cn(
                                "mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full",
                                isPopular ? "bg-background text-foreground" : "bg-foreground/10 text-foreground"
                              )}>
                                <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
                              </span>
                              <span className={cn("font-medium", isPopular ? "text-background/90" : "text-foreground/80")}>{f}</span>
                            </li>
                          ))}
                        </ul>

                        {/* CTA */}
                        <div className="mt-6">
                          {isCurrentPlan ? (
                            <div className={cn(
                              "w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-black uppercase tracking-wide border-2",
                              isPopular ? "border-background/30 text-background/70" : "border-emerald-500/30 text-emerald-600"
                            )}>
                              <Check className="h-4 w-4" /> Your Current Plan
                            </div>
                          ) : isCustom ? (
                            <a
                              href="/contact"
                              className={cn(
                                "block w-full h-11 rounded-xl font-bold text-sm text-center flex items-center justify-center",
                                "bg-muted text-foreground hover:bg-muted/70 transition-colors"
                              )}
                            >
                              Contact Sales →
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled={checkoutPlanId !== null}
                              onClick={() => handleSubscribe(p.id)}
                              className={cn(
                                "block w-full h-11 rounded-xl font-black text-sm text-center flex items-center justify-center gap-2 transition-all hover:scale-[1.02] disabled:opacity-60 disabled:hover:scale-100 disabled:cursor-not-allowed",
                                isPopular
                                  ? "bg-background text-foreground hover:bg-background/90"
                                  : "bg-foreground text-background hover:bg-foreground/90"
                              )}
                            >
                              {checkoutPlanId === p.id ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening checkout…</>
                              ) : (
                                <><ArrowRight className="h-3.5 w-3.5" /> {isExpired ? 'Renew Plan' : plan ? 'Switch to this Plan' : 'Choose Plan'}</>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* ── Trust Signals ────────────────────────────────────────── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { icon: BadgeCheck, label: "Cancel Anytime", sub: "No lock-in contract" },
                  { icon: Shield, label: "Zero Setup Fee", sub: "Start in 30 minutes" },
                  { icon: Zap, label: "Zero Commission", sub: "Keep 100% of sales" },
                  { icon: Sparkles, label: "24/7 Support", sub: "Email + call" },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-card p-4 text-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                      <item.icon className="h-4 w-4 text-primary" />
                    </div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-foreground">{item.label}</p>
                    <p className="text-[10px] font-medium text-muted-foreground">{item.sub}</p>
                  </div>
                ))}
              </div>

              {/* ── Billing Info ───────────────────────────────────────── */}
              <div className="p-5 rounded-2xl bg-muted/20 border border-border/40 space-y-2">
                <p className="text-xs font-semibold text-foreground">Billing &amp; invoices</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Subscriptions are purchased and renewed here on the web, secured by Razorpay.
                  Your Kada Dine mobile app unlocks automatically once payment is confirmed —
                  usually within a few seconds. For invoices or a plan change, contact support.
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                  <Link to="/privacy" className="text-primary font-medium underline underline-offset-2">Privacy Policy</Link>
                  <Link to="/terms" className="text-primary font-medium underline underline-offset-2">Terms of Use</Link>
                  <Link to="/refund" className="text-primary font-medium underline underline-offset-2">Refund Policy</Link>
                </div>
              </div>

            </div>
          )}


          {/* ── TAX & GST TAB ────────────────────────────────────────────── */}
          {activeTab === 'tax' && (
            <div className="space-y-6">

              {/* Header card */}
              <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 md:p-8">
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-primary/5 blur-3xl" />
                </div>
                <div className="relative">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                      <ChefHat className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-foreground tracking-tight">Tax Settings</h2>
                      <p className="text-xs font-medium text-muted-foreground">Configure how tax is calculated and displayed on bills</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Toggle card */}
              <Card className="rounded-2xl border border-border/40 shadow-sm overflow-hidden">
                <CardHeader className="px-6 py-4 border-b border-border/30">
                  <CardTitle className="text-sm font-semibold">Tax Collection</CardTitle>
                  <CardDescription className="text-xs">Enable or disable automatic tax on customer bills</CardDescription>
                </CardHeader>
                <CardContent className="px-6 py-5 space-y-5">

                  {/* Enable Tax toggle */}
                  <div className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                        <CreditCard className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Auto-collect Tax</p>
                        <p className="text-xs text-muted-foreground">Add {profile.taxPercentage ?? 5}% {getTaxLabel(profile.countryCode)} automatically to every bill</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setProfile(prev => ({ ...prev, enableTax: !prev.enableTax }))}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative flex items-center px-0.5 flex-shrink-0",
                        profile.enableTax ? "bg-primary" : "bg-muted-foreground/25"
                      )}
                    >
                      <motion.div
                        animate={{ x: profile.enableTax ? 24 : 2 }}
                        className="w-5 h-5 rounded-full bg-white shadow-sm"
                      />
                    </button>
                  </div>

                  {/* Tax details grid */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 px-1">Tax Details</p>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground px-1">
                          {profile.countryCode === "IN" ? "GSTIN Number" : `${profile.taxLabel || getTaxLabel(profile.countryCode)} Number`}
                        </label>
                        <Input
                          className="h-11 rounded-xl bg-card border-border/40 uppercase"
                          value={profile.taxId}
                          placeholder={profile.countryCode === "IN" ? "15-digit GSTIN" : `${profile.taxLabel || getTaxLabel(profile.countryCode)} Number`}
                          onChange={(e) => setProfile(prev => ({ ...prev, taxId: e.target.value.toUpperCase() }))}
                        />
                      </div>
                      {profile.countryCode === "IN" && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground px-1">FSSAI License Number</label>
                          <Input
                            className="h-11 rounded-xl bg-card border-border/40"
                            value={profile.fssaiLicense || ""}
                            placeholder="14-digit FSSAI No."
                            onChange={(e) => setProfile(prev => ({ ...prev, fssaiLicense: e.target.value }))}
                          />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground px-1">Tax rate (%)</label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          className="h-11 rounded-xl bg-card border-border/40"
                          value={profile.taxPercentage ?? 5}
                          placeholder="5"
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setProfile(prev => ({
                              ...prev,
                              taxPercentage: Number.isFinite(v) && v >= 0 ? v : 0,
                            }));
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground px-1">Custom Tax Label</label>
                        <Input
                          className="h-11 rounded-xl bg-card border-border/40"
                          value={profile.taxLabel || ""}
                          placeholder={`Default: ${getTaxLabel(profile.countryCode)}`}
                          onChange={(e) => setProfile(prev => ({ ...prev, taxLabel: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground px-1">Calculation Method</label>
                        <select
                          className="flex h-11 w-full rounded-xl border border-border/40 bg-card px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          value={profile.taxMethod || "exclusive"}
                          onChange={(e) => setProfile(prev => ({ ...prev, taxMethod: e.target.value }))}
                        >
                          <option value="exclusive">Tax Exclusive (Added on top)</option>
                          <option value="inclusive">Tax Inclusive (Included in prices)</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground px-1">Billing contact email</label>
                        <Input
                          className="h-11 rounded-xl bg-card border-border/40"
                          value={profile.supportEmail}
                          placeholder="billing@yourrestaurant.com"
                          onChange={(e) => setProfile(prev => ({ ...prev, supportEmail: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Live preview */}
                  {profile.enableTax && (() => {
                    const taxPct = profile.taxPercentage ?? 5;
                    const taxLabel = profile.taxLabel || getTaxLabel(profile.countryCode);
                    const isInclusive = profile.taxMethod === "inclusive";
                    let sub = 1000;
                    let taxV = sub * (taxPct / 100);
                    let totalV = sub + taxV;
                    
                    if (isInclusive) {
                      totalV = 1000;
                      sub = totalV / (1 + taxPct / 100);
                      taxV = totalV - sub;
                    }
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-2"
                      >
                        <p className="text-xs font-black uppercase tracking-widest text-primary">Bill Preview</p>
                        <div className="space-y-1 text-xs font-medium text-muted-foreground">
                          <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(sub)}</span></div>
                          <div className="flex justify-between text-foreground font-semibold">
                            <span>{taxLabel} ({taxPct}%{isInclusive ? ' Incl.' : ''})</span>
                            <span>{isInclusive ? "" : "+ "}{formatCurrency(taxV)}</span>
                          </div>
                          <div className="flex justify-between font-black text-foreground border-t border-border/40 pt-1.5 mt-1.5">
                            <span>Total Payable</span>
                            <span>{formatCurrency(totalV)}</span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })()}

                </CardContent>
              </Card>

            </div>
          )}

          {activeTab === 'security' && (
            <Card className="rounded-2xl border border-border/40 shadow-sm overflow-hidden">
              <CardHeader className="px-6 sm:px-8 py-5 border-b border-border/30">
                <CardTitle className="text-base font-semibold">Security</CardTitle>
                <CardDescription className="text-xs mt-0.5">Manage passwords, access, and active sessions</CardDescription>
              </CardHeader>
              <CardContent className="px-6 sm:px-8 py-6 space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Lock className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Password</p>
                      <p className="text-xs text-muted-foreground">Change your account password</p>
                    </div>
                  </div>
                  <Button size="sm" className="rounded-lg font-medium px-4 h-8 text-xs" onClick={() => setPwDialogOpen(true)}>
                    Change
                  </Button>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <Smartphone className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Two-Step Login</p>
                      <p className="text-xs text-muted-foreground">Extra layer of account security</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-lg text-xs font-medium">Coming soon</Badge>
                </div>

                <div className="rounded-xl border border-border/30 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3.5 bg-muted/20 border-b border-border/30">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-rose-500/10 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4 text-rose-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Active Sessions</p>
                        <p className="text-xs text-muted-foreground">All devices currently signed in</p>
                      </div>
                    </div>
                    <Button variant="destructive" size="sm" className="rounded-lg h-8 text-xs font-medium px-3" onClick={handleLogoutAllDevices}>
                      Sign out all
                    </Button>
                  </div>
                  <div className="divide-y divide-border/20 bg-card">
                    {sessionsLoading ? (
                      <div className="px-4 py-4 text-sm text-muted-foreground">Loading…</div>
                    ) : sessions.length === 0 ? (
                      <div className="px-4 py-4 text-sm text-muted-foreground">No active sessions found.</div>
                    ) : (
                      sessions.map((s) => {
                        const meta = describeSession(s);
                        return (
                          <div key={s.id} className="px-4 py-3.5 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground truncate">{meta.label}</span>
                                {meta.isCurrent && (
                                  <Badge className="bg-primary/10 text-primary border-0 rounded-full text-[10px] font-semibold">
                                    This device
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {meta.platform || "Unknown platform"}{meta.tz ? ` · ${meta.tz}` : ""} · Last seen {meta.lastSeenStr}
                              </p>
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground/50 flex-shrink-0">
                              {String(s.sessionId || "").slice(0, 8)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'customer-info' && (
            <Card className="rounded-2xl border border-border/40 shadow-sm overflow-hidden">
              <CardHeader className="px-6 sm:px-8 py-5 border-b border-border/30">
                <CardTitle className="text-base font-semibold">Customer Data</CardTitle>
                <CardDescription className="text-xs mt-0.5">Control what information guests provide when ordering</CardDescription>
              </CardHeader>
              <CardContent className="px-6 sm:px-8 py-6 space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Collect customer name</p>
                      <p className="text-xs text-muted-foreground">Ask for the guest's name before ordering</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setProfile(prev => ({ ...prev, collectCustomerName: !prev.collectCustomerName }))}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative flex items-center px-0.5 flex-shrink-0",
                      profile.collectCustomerName ? "bg-primary" : "bg-muted-foreground/25"
                    )}
                  >
                    <motion.div
                      animate={{ x: profile.collectCustomerName ? 24 : 2 }}
                      className="w-5 h-5 rounded-full bg-white shadow-sm"
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <Smartphone className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Collect customer phone</p>
                      <p className="text-xs text-muted-foreground">Ask for the guest's phone number</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setProfile(prev => ({ ...prev, collectCustomerPhone: !prev.collectCustomerPhone }))}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative flex items-center px-0.5 flex-shrink-0",
                      profile.collectCustomerPhone ? "bg-emerald-500" : "bg-muted-foreground/25"
                    )}
                  >
                    <motion.div
                      animate={{ x: profile.collectCustomerPhone ? 24 : 2 }}
                      className="w-5 h-5 rounded-full bg-white shadow-sm"
                    />
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-900/30">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground font-medium">Tip:</strong> Disabling these fields speeds up ordering — customers can place orders in fewer taps. Enable them when you need contact info for delivery or follow-up marketing.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'notifications' && (
            <Card className="rounded-2xl border border-border/40 shadow-sm overflow-hidden">
              <CardHeader className="px-6 sm:px-8 py-5 border-b border-border/30">
                <CardTitle className="text-base font-semibold">Notifications</CardTitle>
                <CardDescription className="text-xs mt-0.5">Control alerts for kitchen, orders, and stock</CardDescription>
              </CardHeader>
              <CardContent className="px-6 sm:px-8 py-6 space-y-6">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-3">Kitchen & order alerts</p>
                  <div className="space-y-3">
                    {[
                      { icon: Volume2, label: "New order sound alert", desc: "Play a sound when a new order arrives", color: "text-primary", bg: "bg-primary/10" },
                      { icon: ChefHat, label: "Order ready notification", desc: "Alert when kitchen marks an order ready", color: "text-amber-600", bg: "bg-amber-500/10" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", item.bg)}>
                            <item.icon className={cn("w-4 h-4", item.color)} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{item.label}</p>
                            <p className="text-xs text-muted-foreground">{item.desc}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="rounded-lg text-xs font-medium">Coming soon</Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-3">Stock & inventory</p>
                  <div className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-rose-500/10 flex items-center justify-center">
                        <AlertTriangle className="w-4 h-4 text-rose-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Low stock alerts</p>
                        <p className="text-xs text-muted-foreground">Notify when items drop below minimum level</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="rounded-lg text-xs font-medium">Coming soon</Badge>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-3">Browser & push</p>
                  <div className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center">
                        <Monitor className="w-4 h-4 text-violet-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Desktop push notifications</p>
                        <p className="text-xs text-muted-foreground">Get browser notifications even when the tab is in the background</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="rounded-lg text-xs font-medium">Coming soon</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>

      <Dialog open={pwDialogOpen} onOpenChange={setPwDialogOpen}>
        <DialogContent className="rounded-3xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">Change Password</DialogTitle>
            <DialogDescription>For security, confirm your current password.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 pt-2">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest">Current Password</Label>
              <Input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="h-12 rounded-2xl font-bold"
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest">New Password</Label>
              <Input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="h-12 rounded-2xl font-bold"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest">Confirm New Password</Label>
              <Input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                className="h-12 rounded-2xl font-bold"
                autoComplete="new-password"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-2xl" onClick={() => setPwDialogOpen(false)} disabled={pwSaving}>
              Cancel
            </Button>
            <Button className="rounded-2xl" onClick={handleChangePassword} disabled={pwSaving}>
              {pwSaving ? "Updating..." : "Update Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
