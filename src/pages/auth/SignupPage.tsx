import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, ShieldCheck, Zap, BarChart3, Store, Mail, Phone, ChefHat, Sparkles } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { toast } from "sonner";
import { motion } from "framer-motion";

import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { PhoneOtpAuth } from "@/components/auth/PhoneOtpAuth";
import { useAuth } from "@/hooks/useAuth";
import {
  resolvePostAuthPath,
  signInWithGoogleWeb,
  signInWithAppleWeb,
  setSignupIntent,
  getSignupIntent,
} from "@/lib/auth-flow";
import { cn } from "@/lib/utils";

const ease = [0.16, 1, 0.3, 1] as const;
const t = { duration: 0.6, ease };

const PERKS = [
  {
    icon: Zap,
    title: "Up and running in 30 minutes",
    desc: "Self-serve onboarding gets your kitchen live same day.",
  },
  {
    icon: ShieldCheck,
    title: "Bank-grade security",
    desc: "End-to-end encrypted. SOC-2 ready cloud infrastructure.",
  },
  {
    icon: BarChart3,
    title: "Real-time analytics",
    desc: "Track live subscribers, daily meal counts, orders & staff metrics.",
  },
];

export default function SignupPage() {
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get("type") === "mess" ? "mess" : (getSignupIntent() || "restaurant");
  const [accountType, setAccountType] = useState<"restaurant" | "mess">(initialType);
  const [restaurantName, setRestaurantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(true);
  const [authMethod, setAuthMethod] = useState<"email" | "phone">("email");

  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setSignupIntent(accountType);
  }, [accountType]);

  // ── Auth redirect if already logged in ──────────────────────
  useEffect(() => {
    let active = true;
    if (authLoading) return () => { active = false; };
    if (!user) { setRedirecting(false); return () => { active = false; }; }

    void (async () => {
      try {
        const nextPath = await resolvePostAuthPath(user);
        if (!active) return;
        navigate(nextPath, { replace: true });
      } finally {
        if (active) setRedirecting(false);
      }
    })();

    return () => { active = false; };
  }, [authLoading, navigate, user]);

  if (authLoading || redirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 p-2.5 border border-blue-100">
            <img src="/logo.png" alt="Kada Dine" className="h-full w-full object-contain" />
          </div>
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (!restaurantName.trim()) {
      toast.error("Please enter your restaurant or business name.");
      return;
    }

    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (userCredential.user) {
        await updateProfile(userCredential.user, {
          displayName: restaurantName.trim()
        });
        const nextPath = await resolvePostAuthPath(userCredential.user);
        toast.success("Account created successfully!");
        navigate(nextPath, { replace: true });
      }
    } catch (error: any) {
      const code = String(error?.code ?? "");
      let msg = error instanceof Error ? error.message : "Failed to create account";
      if (code === "auth/email-already-in-use") {
        msg = "An account with this email already exists. Please sign in.";
      } else if (code === "auth/invalid-email") {
        msg = "Please enter a valid email address.";
      } else if (code === "auth/weak-password") {
        msg = "Password is too weak. Please use a stronger password.";
      }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setLoading(true);
    try {
      await signInWithGoogleWeb();
      const u = auth.currentUser;
      if (u) {
        const nextPath = await resolvePostAuthPath(u);
        toast.success("Signed in with Google!");
        navigate(nextPath, { replace: true });
      }
    } catch (error: any) {
      if (error?.code !== "auth/popup-closed-by-user") {
        toast.error(error instanceof Error ? error.message : "Google registration failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignup = async () => {
    setLoading(true);
    try {
      await signInWithAppleWeb();
      const u = auth.currentUser;
      if (u) {
        const nextPath = await resolvePostAuthPath(u);
        toast.success("Signed in with Apple!");
        navigate(nextPath, { replace: true });
      }
    } catch (error: any) {
      if (error?.code !== "auth/popup-closed-by-user") {
        toast.error(error instanceof Error ? error.message : "Apple registration failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      {/* ════════ LEFT PANEL — branding (desktop only) ════════ */}
      <div className="hidden lg:flex w-[46%] xl:w-[42%] shrink-0 flex-col relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(255,255,255,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_90%,rgba(99,102,241,0.3),transparent_50%)]" />

        <div className="relative z-10 flex flex-col h-full px-12 xl:px-14 py-12">
          {/* Logo */}
          <a href="/" className="inline-flex items-center gap-2.5 hover:opacity-80 transition-opacity group">
            <div className="h-10 w-10 rounded-xl overflow-hidden bg-white/20 border border-white/25 p-1 group-hover:scale-105 transition-transform backdrop-blur-sm">
              <img src="/logo.png" alt="Kada Dine" className="h-full w-full object-contain" />
            </div>
            <span className="font-black text-xl tracking-tight text-white">
              Kada<span className="text-blue-200 italic">Dine</span>
            </span>
          </a>

          <div className="flex-1 flex flex-col justify-center space-y-8">
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={t} className="space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-blue-100 text-[11px] font-black uppercase tracking-widest backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
                Restaurant Partner Onboarding
              </div>
              <h1 className="text-4xl xl:text-[2.75rem] font-black text-white tracking-tight leading-[1.1]">
                Launch your kitchen <br />
                <span className="text-blue-200">in minutes.</span>
              </h1>
              <p className="text-blue-100/80 text-[15px] font-medium leading-relaxed max-w-sm">
                Join 500+ restaurants powering tables, QR menus, orders, and automated billing with Kada Dine.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ ...t, delay: 0.12 }} className="space-y-3">
              {PERKS.map((p, idx) => (
                <motion.div
                  key={p.title}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...t, delay: 0.18 + idx * 0.07 }}
                  className="flex items-start gap-4 p-4 rounded-2xl bg-white/10 border border-white/[0.12] backdrop-blur-sm"
                >
                  <div className="w-9 h-9 rounded-xl bg-white/20 text-white flex items-center justify-center shrink-0">
                    <p.icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-white font-bold text-sm">{p.title}</div>
                    <div className="text-blue-100/70 text-xs mt-0.5">{p.desc}</div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-blue-100/80 text-xs font-medium">✓ No credit card required to start</span>
          </div>
        </div>
      </div>

      {/* ════════ RIGHT PANEL — Sign up form ════════ */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-12 sm:px-8 bg-white relative overflow-y-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={t} className="w-full max-w-[420px] relative">
          <a href="/" className="lg:hidden flex items-center gap-2.5 mb-8 hover:opacity-80 transition-opacity mx-auto w-fit">
            <div className="h-9 w-9 rounded-xl overflow-hidden bg-blue-50 p-1 border border-blue-100">
              <img src="/logo.png" alt="Kada Dine" className="h-full w-full object-contain" />
            </div>
            <span className="font-black text-xl tracking-tight text-slate-900">
              Kada<span className="text-blue-600 italic">Dine</span>
            </span>
          </a>

          <div className="mb-4">
            <h2 className="text-[1.75rem] font-black tracking-tight text-slate-950 leading-tight">
              Create your account
            </h2>
            <p className="mt-1 text-[14px] text-slate-500 font-medium">
              {accountType === "mess"
                ? "Start your self-serve mess kitchen onboarding for meal plans"
                : "Start your self-serve restaurant onboarding setup"}
            </p>
          </div>

          {/* Business Type Selector (Dine vs Mess) */}
          <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-100 rounded-2xl mb-4 border border-slate-200/60">
            <button
              type="button"
              onClick={() => {
                setAccountType("restaurant");
                setSignupIntent("restaurant");
              }}
              className={cn(
                "py-2 px-3 rounded-xl text-xs font-black transition-all flex flex-col items-center gap-0.5",
                accountType === "restaurant"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200/80"
                  : "text-slate-500 hover:text-slate-900"
              )}
            >
              <div className="flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5" />
                <span>Kada Dine</span>
              </div>
              <span className="text-[10px] font-medium text-slate-400">Restaurant / Cafe / QSR</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAccountType("mess");
                setSignupIntent("mess");
              }}
              className={cn(
                "py-2 px-3 rounded-xl text-xs font-black transition-all flex flex-col items-center gap-0.5",
                accountType === "mess"
                  ? "bg-white text-emerald-600 shadow-sm border border-slate-200/80"
                  : "text-slate-500 hover:text-slate-900"
              )}
            >
              <div className="flex items-center gap-1.5">
                <ChefHat className="w-3.5 h-3.5 text-emerald-600" />
                <span>Kada Mess</span>
              </div>
              <span className="text-[10px] font-medium text-slate-400">Meal Plans / Tiffin</span>
            </button>
          </div>

          <SocialAuthButtons
            loading={loading}
            onGoogle={() => {
              setSignupIntent(accountType);
              void handleGoogleSignup();
            }}
            onApple={() => {
              setSignupIntent(accountType);
              void handleAppleSignup();
            }}
            emphasis="join"
          />

          {/* Method selector tabs */}
          <div className="flex p-1 bg-slate-100 rounded-2xl my-4">
            <button
              type="button"
              onClick={() => setAuthMethod("email")}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                authMethod === "email"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Mail className="w-3.5 h-3.5" /> Work Email
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod("phone")}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                authMethod === "phone"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Phone className="w-3.5 h-3.5" /> Mobile OTP
            </button>
          </div>

          {authMethod === "phone" ? (
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <label htmlFor="phone-restaurant-name" className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                  {accountType === "mess" ? "Kitchen Name" : "Restaurant Name"}
                </label>
                <input
                  id="phone-restaurant-name"
                  type="text"
                  placeholder={accountType === "mess" ? "e.g. Amma's Mess" : "e.g. Spice Symphony"}
                  required
                  value={restaurantName}
                  onChange={(e) => setRestaurantName(e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-[14px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-blue-500/60 focus:bg-white focus:ring-4 focus:ring-blue-500/8 transition-all"
                />
              </div>
              <PhoneOtpAuth restaurantName={restaurantName} />
            </div>
          ) : (
            <form onSubmit={handleSignup} className="space-y-3.5 mt-2">
              <div className="space-y-1.5">
                <label htmlFor="restaurant-name" className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                  {accountType === "mess" ? "Kitchen Name" : "Restaurant Name"}
                </label>
                <div className="relative">
                  <input
                    id="restaurant-name"
                    type="text"
                    placeholder={accountType === "mess" ? "e.g. Amma's Mess" : "e.g. Spice Symphony"}
                    required
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    className="w-full h-11 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-[14px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-blue-500/60 focus:bg-white focus:ring-4 focus:ring-blue-500/8 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="signup-email" className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                  Work Email
                </label>
                <input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  placeholder="owner@restaurant.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-[14px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-blue-500/60 focus:bg-white focus:ring-4 focus:ring-blue-500/8 transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="signup-password" className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="signup-password"
                    type={showPwd ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-11 pl-4 pr-11 rounded-2xl border border-slate-200 bg-slate-50 text-[14px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-blue-500/60 focus:bg-white focus:ring-4 focus:ring-blue-500/8 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                    aria-label={showPwd ? "Hide password" : "Show password"}
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirm-password" className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type={showPwd ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Confirm your password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-[14px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-blue-500/60 focus:bg-white focus:ring-4 focus:ring-blue-500/8 transition-all"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="mt-3 w-full h-12 rounded-2xl bg-blue-600 text-white text-[15px] font-black tracking-wide shadow-lg shadow-blue-600/20 hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-700/25 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating account…
                  </>
                ) : (
                  <>
                    Create Account & Setup
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-sm font-medium text-slate-500">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-black text-blue-600 hover:text-blue-500 transition-colors underline underline-offset-2 decoration-blue-200 hover:decoration-blue-400"
            >
              Sign in
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
