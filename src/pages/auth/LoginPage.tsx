import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, ShieldCheck, Zap, BarChart3, Mail, Phone } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
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
} from "@/lib/auth-flow";

const ease = [0.16, 1, 0.3, 1] as const;
const t = { duration: 0.6, ease };

const PERKS = [
  {
    icon: Zap,
    title: "Up and running in 30 minutes",
    desc: "Onboarding team gets you live same day.",
  },
  {
    icon: ShieldCheck,
    title: "Bank-grade security",
    desc: "End-to-end encrypted. SOC-2 ready infrastructure.",
  },
  {
    icon: BarChart3,
    title: "Real-time analytics",
    desc: "Revenue, orders & staff performance — live.",
  },
];

export default function LoginPage() {
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [showPwd, setShowPwd]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [redirecting, setRedirecting]   = useState(true);
  const [authMethod, setAuthMethod]     = useState<"email" | "phone">("email");

  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // ── Auth redirect ────────────────────────────────────────────
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

  // ── Full-screen loader ───────────────────────────────────────
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

  // ── Handlers ─────────────────────────────────────────────────
  const completeSignIn = async () => {
    const u = auth.currentUser;
    if (!u) throw new Error("Could not verify your account session.");
    navigate(await resolvePostAuthPath(u));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await completeSignIn();
      toast.success("Welcome back to Kada Dine.");
    } catch (error: any) {
      const code = String(error?.code ?? "");
      let msg = error instanceof Error ? error.message : "Failed to log in";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password")
        msg = "Email or password is incorrect.";
      else if (code === "auth/user-not-found")
        msg = "No account found with this email.";
      else if (code === "auth/too-many-requests")
        msg = "Too many failed attempts. Please wait a moment.";
      else if (code === "auth/network-request-failed")
        msg = "Network error. Check your internet connection.";
      else if (code === "auth/user-disabled")
        msg = "This account has been disabled. Contact support.";
      else if (code === "auth/invalid-email")
        msg = "Please enter a valid email address.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Enter your email address first, then click Forgot password.");
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      toast.success(`Reset link sent to ${trimmed}. Check your inbox.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send reset email.");
    } finally {
      setResetLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithGoogleWeb();
      await completeSignIn();
      toast.success("Google sign-in completed.");
    } catch (error: any) {
      if (error?.code !== "auth/popup-closed-by-user") {
        toast.error(error instanceof Error ? error.message : "Google sign-in failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithAppleWeb();
      await completeSignIn();
      toast.success("Apple sign-in completed.");
    } catch (error: any) {
      if (error?.code !== "auth/popup-closed-by-user") {
        toast.error(error instanceof Error ? error.message : "Apple sign-in failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex bg-white">

      {/* ════════ LEFT PANEL — branding (desktop only) ════════ */}
      <div className="hidden lg:flex w-[46%] xl:w-[42%] shrink-0 flex-col relative overflow-hidden">
        {/* Blue gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(255,255,255,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_90%,rgba(99,102,241,0.3),transparent_50%)]" />

        {/* Subtle pattern overlay */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

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

          {/* Main copy */}
          <div className="flex-1 flex flex-col justify-center space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={t}
              className="space-y-5"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-blue-100 text-[11px] font-black uppercase tracking-widest backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
                Restaurant OS Platform
              </div>
              <h1 className="text-4xl xl:text-[2.75rem] font-black text-white tracking-tight leading-[1.1]">
                Run your restaurant<br />
                <span className="text-blue-200">from anywhere.</span>
              </h1>
              <p className="text-blue-100/80 text-[15px] font-medium leading-relaxed max-w-sm">
                Billing, QR ordering, kitchen display, inventory, CRM &amp; live analytics — one platform, any device.
              </p>
            </motion.div>

            {/* Perks */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...t, delay: 0.12 }}
              className="space-y-3"
            >
              {PERKS.map((p, i) => (
                <motion.div
                  key={p.title}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...t, delay: 0.18 + i * 0.07 }}
                  className="flex items-start gap-4 p-4 rounded-2xl bg-white/10 border border-white/[0.12] hover:bg-white/15 transition-colors backdrop-blur-sm"
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

          {/* Bottom trust row */}
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {[
                "/merchant_avatar_1.webp",
                "/merchant_avatar_2.webp",
                "/merchant_avatar_3.webp",
                "/merchant_avatar_4.webp",
              ].map((src, idx) => (
                <div
                  key={src}
                  className="w-8 h-8 rounded-full border-2 border-blue-700 overflow-hidden flex items-center justify-center bg-blue-800"
                >
                  <img
                    src={src}
                    alt={`Merchant ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
            <p className="text-blue-100/70 text-xs font-medium">
              <strong className="text-white">500+ merchants</strong> trust Kada Dine
            </p>
          </div>
        </div>
      </div>

      {/* ════════ RIGHT PANEL — login form ════════ */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-12 sm:px-8 bg-white relative">
        {/* Top-left glow on form panel */}
        <div className="pointer-events-none absolute top-0 right-0 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px]" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t}
          className="w-full max-w-[400px] relative"
        >
          {/* Mobile-only logo */}
          <a
            href="/"
            className="lg:hidden flex items-center gap-2.5 mb-8 hover:opacity-80 transition-opacity mx-auto w-fit"
          >
            <div className="h-9 w-9 rounded-xl overflow-hidden bg-blue-50 p-1 border border-blue-100">
              <img src="/logo.png" alt="Kada Dine" className="h-full w-full object-contain" />
            </div>
            <span className="font-black text-xl tracking-tight text-slate-900">
              Kada<span className="text-blue-600 italic">Dine</span>
            </span>
          </a>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-[1.75rem] font-black tracking-tight text-slate-950 leading-tight">
              Welcome back
            </h2>
            <p className="mt-1.5 text-[15px] text-slate-500 font-medium">
              Sign in to your restaurant dashboard
            </p>
          </div>

          {/* Social sign-in (Google + Apple) */}
          <SocialAuthButtons
            loading={loading}
            onGoogle={() => void handleGoogleSignIn()}
            onApple={() => void handleAppleSignIn()}
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
            <div className="mt-2">
              <PhoneOtpAuth />
            </div>
          ) : (
            /* Email / password form */
            <form onSubmit={handleLogin} className="space-y-4 mt-1">
              {/* Email */}
              <div className="space-y-1.5">
                <label
                  htmlFor="login-email"
                  className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500"
                >
                  Work Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="owner@restaurant.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-[15px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-blue-500/60 focus:bg-white focus:ring-4 focus:ring-blue-500/8 transition-all"
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="login-password"
                    className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500"
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleForgotPassword()}
                    disabled={resetLoading}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-500 disabled:opacity-50 transition-colors"
                  >
                    {resetLoading ? "Sending…" : "Forgot password?"}
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPwd ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-12 pl-4 pr-12 rounded-2xl border border-slate-200 bg-slate-50 text-[15px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-blue-500/60 focus:bg-white focus:ring-4 focus:ring-blue-500/8 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                    aria-label={showPwd ? "Hide password" : "Show password"}
                  >
                    {showPwd
                      ? <EyeOff className="w-4 h-4" />
                      : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                disabled={loading}
                className="mt-2 w-full h-12 rounded-2xl bg-blue-600 text-white text-[15px] font-black tracking-wide shadow-lg shadow-blue-600/20 hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-700/25 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          )}

          {/* Footer */}
          <p className="mt-8 text-center text-sm font-medium text-slate-500">
            New to KadaDine?{" "}
            <Link
              to="/signup"
              className="font-black text-blue-600 hover:text-blue-500 transition-colors underline underline-offset-2 decoration-blue-200 hover:decoration-blue-400"
            >
              Create an account
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
