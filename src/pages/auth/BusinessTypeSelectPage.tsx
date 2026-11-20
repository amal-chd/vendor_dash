import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { 
  Store, 
  ChefHat, 
  Sparkles, 
  ArrowRight, 
  CheckCircle2, 
  LogOut,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { 
  createDefaultRestaurantProfile, 
  createDefaultMessKitchenProfile, 
  createBothProfiles, 
  signOutWeb 
} from "@/lib/auth-flow";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function BusinessTypeSelectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<"restaurant" | "mess" | "both">("both");
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    await signOutWeb(user);
    navigate("/login");
  };

  const handleContinue = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    setLoading(true);
    try {
      if (selectedType === "restaurant") {
        await createDefaultRestaurantProfile(user);
        localStorage.setItem("kada_active_mode", "restaurant");
        toast.success("Restaurant workspace created!");
        navigate("/setup", { replace: true });
      } else if (selectedType === "mess") {
        await createDefaultMessKitchenProfile(user);
        localStorage.setItem("kada_active_mode", "mess");
        toast.success("Mess Kitchen workspace created!");
        navigate("/setup?type=mess", { replace: true });
      } else {
        await createBothProfiles(user);
        localStorage.setItem("kada_active_mode", "restaurant");
        toast.success("Both Restaurant & Mess Kitchen workspaces initialized!");
        navigate("/setup", { replace: true });
      }
    } catch (err: any) {
      console.error("Failed to initialize business profile:", err);
      toast.error(err?.message || "Failed to create workspace. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col relative overflow-hidden">
      {/* Background gradients */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/15 blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[140px]" />
      </div>

      {/* Top Navbar */}
      <header className="border-b border-white/[0.08] px-6 py-4 flex items-center justify-between backdrop-blur-md bg-slate-950/40">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center p-1.5 overflow-hidden">
            <img src="/logo.png" alt="Kada" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="font-black text-sm tracking-tight text-white flex items-center gap-2">
              The Kada <span className="text-blue-400 font-medium text-xs px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">Partner Onboarding</span>
            </div>
            <div className="text-[11px] text-slate-400 font-medium">
              Signed in as <span className="text-slate-200">{user?.email || user?.phoneNumber || "Partner"}</span>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-slate-400 hover:text-white hover:bg-white/10 gap-2 text-xs font-semibold rounded-xl"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-12 flex flex-col justify-center">
        <div className="text-center space-y-3 mb-10">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-blue-300 text-[11px] font-black uppercase tracking-widest"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            Step 1: Workspace Selection
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight"
          >
            What would you like to set up?
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto"
          >
            Choose your operating model. If your shop has both a dine-in/takeaway restaurant and a mess kitchen, select <strong>Both</strong> to manage them seamlessly under one login.
          </motion.p>
        </div>

        {/* 3 Options Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
          {/* 1. Restaurant */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            onClick={() => setSelectedType("restaurant")}
            className={cn(
              "p-6 rounded-3xl cursor-pointer transition-all flex flex-col justify-between border relative group",
              selectedType === "restaurant"
                ? "bg-slate-900 border-blue-500 shadow-xl shadow-blue-500/10 ring-2 ring-blue-500/30"
                : "bg-slate-900/60 border-white/10 hover:border-white/25 hover:bg-slate-900"
            )}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Store className="w-6 h-6" />
                </div>
                {selectedType === "restaurant" && (
                  <CheckCircle2 className="w-6 h-6 text-blue-400" />
                )}
              </div>
              <div>
                <h3 className="text-xl font-black text-white">Restaurant</h3>
                <span className="text-[11px] font-bold text-blue-400 block mt-0.5">Dine-in • Takeaway • Delivery</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Full POS, table management, live food orders, digital menu, staff management, and delivery logistics.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Standard Restaurant Setup</span>
            </div>
          </motion.div>

          {/* 2. Mess Kitchen */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            onClick={() => setSelectedType("mess")}
            className={cn(
              "p-6 rounded-3xl cursor-pointer transition-all flex flex-col justify-between border relative group",
              selectedType === "mess"
                ? "bg-slate-900 border-emerald-500 shadow-xl shadow-emerald-500/10 ring-2 ring-emerald-500/30"
                : "bg-slate-900/60 border-white/10 hover:border-white/25 hover:bg-slate-900"
            )}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <ChefHat className="w-6 h-6" />
                </div>
                {selectedType === "mess" && (
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                )}
              </div>
              <div>
                <h3 className="text-xl font-black text-white">Mess Kitchen</h3>
                <span className="text-[11px] font-bold text-emerald-400 block mt-0.5">Tiffin • Meal Subscriptions</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Manage monthly meal plans, daily subscriber rosters, meal skips, weekly menus, and scheduled kitchen payouts.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Mess & Tiffin Setup</span>
            </div>
          </motion.div>

          {/* 3. Both (Recommended) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            onClick={() => setSelectedType("both")}
            className={cn(
              "p-6 rounded-3xl cursor-pointer transition-all flex flex-col justify-between border relative group",
              selectedType === "both"
                ? "bg-slate-900 border-purple-500 shadow-xl shadow-purple-500/10 ring-2 ring-purple-500/30"
                : "bg-slate-900/60 border-white/10 hover:border-white/25 hover:bg-slate-900"
            )}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Sparkles className="w-6 h-6" />
                </div>
                {selectedType === "both" ? (
                  <CheckCircle2 className="w-6 h-6 text-purple-400" />
                ) : (
                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Unified
                  </span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black text-white">Both</h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                    Dual Mode
                  </span>
                </div>
                <span className="text-[11px] font-bold text-purple-400 block mt-0.5">Restaurant + Mess Kitchen</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Run daily dining/POS orders and monthly mess subscriptions simultaneously. Easily switch between dashboards with one click.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs font-semibold text-purple-300">
              <span>Full Hybrid Workspace</span>
            </div>
          </motion.div>
        </div>

        {/* Action Button */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            size="lg"
            onClick={handleContinue}
            disabled={loading}
            className="w-full sm:w-auto min-w-[240px] h-13 rounded-2xl bg-white text-slate-950 hover:bg-slate-100 font-black text-sm tracking-wide gap-2 shadow-xl shadow-white/5 transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Initializing Workspace...</span>
              </>
            ) : (
              <>
                <span>Continue Setup</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  );
}
