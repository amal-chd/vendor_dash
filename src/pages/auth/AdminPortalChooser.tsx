import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { 
  Building2, 
  Store, 
  LayoutDashboard, 
  ArrowRight, 
  ShieldCheck, 
  Sparkles, 
  ExternalLink,
  ChevronRight,
  LogOut,
  Hotel
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { signOutWeb } from "@/lib/auth-flow";
import { getHostAdminUrl, getCompanyAdminUrl } from "@/lib/urls";

export default function AdminPortalChooser() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOutWeb(user);
    navigate("/login");
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
          <div className="h-9 w-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="font-black text-sm tracking-tight text-white flex items-center gap-2">
              The Kada <span className="text-blue-400 font-medium text-xs px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">Admin Gateway</span>
            </div>
            <div className="text-[11px] text-slate-400 font-medium">
              Signed in as <span className="text-slate-200">{user?.email}</span>
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
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-12 flex flex-col justify-center">
        <div className="text-center space-y-3 mb-10">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-blue-300 text-[11px] font-black uppercase tracking-widest"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            Super Admin Access
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight"
          >
            Select Your Admin Console
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto"
          >
            Which administrative management console would you like to operate today?
          </motion.p>
        </div>

        {/* Portals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1: Kada Dine (Platform Admin) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            whileHover={{ y: -4 }}
            className="p-7 rounded-3xl bg-slate-900/90 border border-blue-500/30 hover:border-blue-500/60 shadow-xl shadow-blue-500/5 transition-all flex flex-col justify-between group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all pointer-events-none" />
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-inner">
                  <Store className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Dine Platform Admin
                </span>
              </div>

              <div>
                <h3 className="text-xl font-black text-white group-hover:text-blue-300 transition-colors flex items-center gap-2">
                  Kada Dine Platform
                </h3>
                <p className="text-slate-400 text-xs sm:text-sm mt-1.5 leading-relaxed">
                  The complete operations control center for onboarded restaurants, food menus, delivery fleet, live orders, catalog QC & finance settlements.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/[0.08]">
                <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Features included:</div>
                <ul className="text-xs text-slate-400 space-y-1.5">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    Multi-restaurant Directory & Verification
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    Live Orders Dispatch, Incidents & KDS
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    Delivery Fleet, Rider 360 & Zone Surge
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    Catalog Quality Control, Finance & Payouts
                  </li>
                </ul>
              </div>
            </div>

            <Button
              onClick={() => navigate("/admin")}
              className="mt-6 w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 group-hover:gap-3 transition-all"
            >
              Enter Kada Dine Admin <ArrowRight className="w-4 h-4" />
            </Button>
          </motion.div>

          {/* Card 2: Kada Host (Stays Admin) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            whileHover={{ y: -4 }}
            className="p-7 rounded-3xl bg-slate-900/90 border border-indigo-500/30 hover:border-indigo-500/60 shadow-xl shadow-indigo-500/5 transition-all flex flex-col justify-between group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all pointer-events-none" />
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner">
                  <Hotel className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Host Super Admin
                </span>
              </div>

              <div>
                <h3 className="text-xl font-black text-white group-hover:text-indigo-300 transition-colors flex items-center gap-2">
                  Kada Host & Stays
                </h3>
                <p className="text-slate-400 text-xs sm:text-sm mt-1.5 leading-relaxed">
                  The centralized hospitality administration suite for hotel & resort listings, booking calendars, host verifications, and guest support leads.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/[0.08]">
                <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Features included:</div>
                <ul className="text-xs text-slate-400 space-y-1.5">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    Hotels & Resorts Directory Management
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    Live Guest Bookings & Room Allocations
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    Support & Onboarding Leads Pipeline
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    Host Revenue Settlements & Seeder Tools
                  </li>
                </ul>
              </div>
            </div>

            <Button
              onClick={() => { window.location.href = getHostAdminUrl("/admin"); }}
              className="mt-6 w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 group-hover:gap-3 transition-all"
            >
              Enter Kada Host Admin <ExternalLink className="w-4 h-4" />
            </Button>
          </motion.div>

          {/* Card 3: The Kada (Company HQ Admin) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            whileHover={{ y: -4 }}
            className="p-7 rounded-3xl bg-slate-900/90 border border-emerald-500/30 hover:border-emerald-500/60 shadow-xl shadow-emerald-500/5 transition-all flex flex-col justify-between group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all pointer-events-none" />
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
                  <Building2 className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Company HQ Admin
                </span>
              </div>

              <div>
                <h3 className="text-xl font-black text-white group-hover:text-emerald-300 transition-colors flex items-center gap-2">
                  The Kada Digital Ventures
                </h3>
                <p className="text-slate-400 text-xs sm:text-sm mt-1.5 leading-relaxed">
                  The central company management portal for internal teams, candidates, client CRM, enterprise proposals, regional franchise partners & system architecture.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/[0.08]">
                <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Features included:</div>
                <ul className="text-xs text-slate-400 space-y-1.5">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Internal Team Directory & Org Hierarchy
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Client CRM, Leads & Proposal Contracts
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Internship Portal & Applications Manager
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Franchise Hub, SLA Tickets & RBAC Roles
                  </li>
                </ul>
              </div>
            </div>

            <Button
              onClick={() => { window.location.href = getCompanyAdminUrl("/"); }}
              className="mt-6 w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 group-hover:gap-3 transition-all"
            >
              Enter The Kada Admin <ExternalLink className="w-4 h-4" />
            </Button>
          </motion.div>
        </div>

        {/* Bottom option: Merchant View */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-8 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-300">
              <LayoutDashboard className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Looking for the Single Restaurant Merchant Dashboard?</div>
              <div className="text-xs text-slate-400">View live orders, menu builder, and billing POS as a merchant.</div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/dashboard")}
            className="border-white/20 text-white hover:bg-white/10 rounded-xl gap-2 text-xs font-bold"
          >
            Enter Restaurant View <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </motion.div>
      </main>
    </div>
  );
}
