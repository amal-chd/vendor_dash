import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { 
  LayoutDashboard, ShoppingCart, UtensilsCrossed, Grid3X3,
  ChefHat, Monitor, Package, Users, UserCircle, Megaphone,
  BarChart3, Settings, Wallet, Building2, PlugZap, 
  Calendar, CreditCard, Bell, Search, TrendingUp, Clock,
  AlertTriangle, Check, ArrowRight, Printer, Sparkles,
  ChevronDown, Flame, Timer, CheckCircle2, QrCode, Wifi,
  Smartphone, Battery, Signal, Plus, Minus, ArrowLeft, Camera
} from "lucide-react";
import { 
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
  BarChart, Bar, CartesianGrid, PieChart, Pie, Cell
} from "recharts";

export default function ShowcasePage() {
  const { view = "overview" } = useParams();

  // If the view starts with "mobile-", render the pure mobile screen
  if (view.startsWith("mobile-")) {
    return <ShowcaseMobileView screen={view.replace("mobile-", "")} />;
  }

  const navGroups = [
    {
      label: "Explore",
      items: [
        { label: "Home", icon: LayoutDashboard, id: "overview" },
        { label: "Orders", icon: ShoppingCart, id: "orders" },
        { label: "Menu", icon: UtensilsCrossed, id: "menu" },
        { label: "Tables", icon: Grid3X3, id: "tables" },
        { label: "Reservations", icon: Calendar, id: "reservations" },
      ]
    },
    {
      label: "Operating",
      items: [
        { label: "Kitchen", icon: ChefHat, id: "kitchen", badge: "3" },
        { label: "Sell / POS", icon: Monitor, id: "pos" },
        { label: "Stock", icon: Package, id: "inventory", badge: "2" },
      ]
    },
    {
      label: "Cloud Kitchen",
      items: [
        { label: "Outlets", icon: Building2, id: "outlets" },
        { label: "Kada Mess Kitchen", icon: ChefHat, id: "mess" },
      ]
    },
    {
      label: "Manage",
      items: [
        { label: "Team", icon: Users, id: "staff" },
        { label: "Guests", icon: UserCircle, id: "customers" },
        { label: "Channels", icon: PlugZap, id: "integrations" },
        { label: "Reports", icon: BarChart3, id: "reports" },
        { label: "Expenses", icon: Wallet, id: "expenses" },
        { label: "Plans & Pricing", icon: CreditCard, id: "pricing" },
        { label: "Settings", icon: Settings, id: "settings" },
      ]
    },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/20">
      
      {/* ── Real Vendor Dash Sidebar ── */}
      <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900/95 flex flex-col justify-between select-none">
        <div>
          {/* Logo */}
          <div className="h-16 flex items-center px-5 border-b border-slate-800 justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 p-1 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <ChefHat className="w-5 h-5 text-white" />
              </div>
              <span className="text-sm font-black tracking-tight uppercase italic text-white">
                Kada <span className="text-blue-500 not-italic">Dine</span>
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-extrabold border border-emerald-500/20">
              Live OS
            </span>
          </div>

          {/* Outlet Switcher */}
          <div className="p-3 border-b border-slate-800/60">
            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between cursor-pointer hover:border-blue-500/50 transition">
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 font-black flex items-center justify-center text-xs shrink-0 border border-blue-500/30">
                  MC
                </div>
                <div className="overflow-hidden">
                  <div className="text-xs font-bold text-white truncate">Malabar Coastal Kitchen</div>
                  <div className="text-[10px] text-slate-400 truncate">Kochi • Main Branch</div>
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </div>
          </div>

          {/* Nav Groups */}
          <nav className="p-3 space-y-4 overflow-y-auto max-h-[calc(100vh-210px)]">
            {navGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                <div className="px-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isCurrent = view === item.id;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.id}
                        to={`/showcase/${item.id}`}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition ${
                          isCurrent
                            ? "bg-blue-600 text-white shadow-md shadow-blue-600/30 font-bold"
                            : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className={`w-4 h-4 ${isCurrent ? "text-white" : "text-slate-400"}`} />
                          <span>{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                            isCurrent ? "bg-white text-blue-600" : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                          }`}>
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* User Card */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-xs shadow-md">
              AM
            </div>
            <div className="overflow-hidden flex-1">
              <div className="text-xs font-bold text-white truncate">Chef Anand Menon</div>
              <div className="text-[10px] text-emerald-400 font-semibold truncate">Partner / Admin</div>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
        </div>
      </aside>

      {/* ── Main View Container ── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-950">
        
        {/* Top Header */}
        <header className="h-16 shrink-0 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/60 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="text-slate-400">Dashboard</span>
              <span>/</span>
              <span className="text-white font-bold capitalize">{view.replace("-", " ")}</span>
            </div>
            <div className="h-4 w-px bg-slate-800" />
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Online • Table QR & Online Orders Active
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <span>Search menu, orders, tables...</span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">⌘K</kbd>
            </div>
            <div className="relative p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white cursor-pointer">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500" />
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-lg shadow-blue-600/30 flex items-center gap-1.5">
              <ShoppingCart className="w-3.5 h-3.5" />
              F2 Quick POS
            </div>
          </div>
        </header>

        {/* Dynamic Page View Body */}
        <main className="flex-1 overflow-y-auto p-6">
          {view === "overview" && <ShowcaseOverview />}
          {view === "pos" && <ShowcasePOS />}
          {view === "kitchen" && <ShowcaseKitchen />}
          {view === "tables" && <ShowcaseTables />}
          {view === "inventory" && <ShowcaseInventory />}
          {view === "reports" && <ShowcaseReports />}
          {view === "menu" && <ShowcaseMenu />}
          {view === "orders" && <ShowcaseOrders />}
          {view === "mess" && <ShowcaseMess />}
        </main>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Real Mobile Screen View Component (390x844 iPhone Viewport)
// ─────────────────────────────────────────────────────────────────────────────
function ShowcaseMobileView({ screen }: { screen: string }) {
  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none pb-16">
      
      {/* iOS Status Bar */}
      <div className="h-11 px-6 flex items-center justify-between text-xs font-bold text-slate-300 shrink-0">
        <span>9:41</span>
        <div className="flex items-center gap-1.5">
          <Signal className="w-3.5 h-3.5" />
          <Wifi className="w-3.5 h-3.5" />
          <Battery className="w-4 h-4" />
        </div>
      </div>

      {/* Mobile App Bar */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/60 backdrop-blur shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-md">
            <ChefHat className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-xs font-extrabold text-white flex items-center gap-1.5">
              Malabar Coastal
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </div>
            <div className="text-[10px] text-emerald-400 font-semibold">Live • Table QR & KDS Active</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-slate-800 text-slate-300">
            <Bell className="w-4 h-4" />
          </div>
          <div className="w-7 h-7 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">
            AM
          </div>
        </div>
      </div>

      {/* Screen Body */}
      <div className="p-4 flex-1 overflow-y-auto">
        {screen === "overview" && <MobileOverviewContent />}
        {screen === "pos" && <MobilePOSContent />}
        {screen === "kitchen" && <MobileKitchenContent />}
        {screen === "tables" && <MobileTablesContent />}
        {screen === "inventory" && <MobileInventoryContent />}
        {screen === "analytics" && <MobileAnalyticsContent />}
        {screen === "qr" && <MobileQrContent />}
        {screen === "ai" && <MobileAiContent />}
        {screen === "mess" && <MobileMessContent />}
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 h-14 bg-slate-900/95 border-t border-slate-800 px-6 flex items-center justify-between backdrop-blur-lg">
        <div className={`flex flex-col items-center gap-0.5 ${screen === "overview" ? "text-blue-500 font-bold" : "text-slate-400"}`}>
          <LayoutDashboard className="w-4 h-4" />
          <span className="text-[10px]">Home</span>
        </div>
        <div className={`flex flex-col items-center gap-0.5 ${screen === "pos" ? "text-blue-500 font-bold" : "text-slate-400"}`}>
          <Monitor className="w-4 h-4" />
          <span className="text-[10px]">POS</span>
        </div>
        <div className={`flex flex-col items-center gap-0.5 ${screen === "kitchen" ? "text-blue-500 font-bold" : "text-slate-400"}`}>
          <ChefHat className="w-4 h-4" />
          <span className="text-[10px]">KDS</span>
        </div>
        <div className={`flex flex-col items-center gap-0.5 ${screen === "tables" ? "text-blue-500 font-bold" : "text-slate-400"}`}>
          <Grid3X3 className="w-4 h-4" />
          <span className="text-[10px]">Tables</span>
        </div>
        <div className={`flex flex-col items-center gap-0.5 ${screen === "analytics" ? "text-blue-500 font-bold" : "text-slate-400"}`}>
          <BarChart3 className="w-4 h-4" />
          <span className="text-[10px]">Reports</span>
        </div>
      </div>
    </div>
  );
}

// Mobile Content Modules
function MobileOverviewContent() {
  return (
    <div className="space-y-4">
      {/* Revenue Card */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-900/50 via-slate-900 to-slate-900 border border-blue-500/30">
        <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
          <span>Today's Total Revenue</span>
          <span className="text-emerald-400 font-bold">+18.4%</span>
        </div>
        <div className="text-3xl font-black text-white">₹48,650</div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800">
          <span>126 Orders Settled</span>
          <span>AOV ₹386</span>
          <span className="text-blue-400 font-bold">8 Tables Live</span>
        </div>
      </div>

      {/* Quick Action Pills */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
          <ShoppingCart className="w-4 h-4 text-blue-400 mx-auto mb-1" />
          <div className="text-[11px] font-bold text-white">New Bill</div>
        </div>
        <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
          <ChefHat className="w-4 h-4 text-amber-400 mx-auto mb-1" />
          <div className="text-[11px] font-bold text-white">KDS Screen</div>
        </div>
        <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
          <QrCode className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
          <div className="text-[11px] font-bold text-white">Table QR</div>
        </div>
      </div>

      {/* Live Order Stream */}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-xs font-bold text-slate-300">
          <span>Active Pipeline (14 orders)</span>
          <span className="text-blue-400 text-[11px]">View All →</span>
        </div>
        {[
          { id: "#1024", table: "Table 04", items: "Malabar Biryani x2, Lime Soda x2", total: "₹560", time: "8m ago", status: "Cooking", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
          { id: "#1025", table: "Table 02", items: "Mutton Pepper Fry, Porotta x4", total: "₹480", time: "2m ago", status: "New", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
          { id: "#1023", table: "Swiggy #482", items: "Karimeen Pollichathu, Rice", total: "₹420", time: "12m ago", status: "Ready", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
        ].map((o) => (
          <div key={o.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span className="font-mono text-blue-400">{o.id}</span>
                <span>• {o.table}</span>
              </div>
              <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{o.items}</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-black text-white">{o.total}</div>
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${o.color}`}>{o.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobilePOSContent() {
  return (
    <div className="space-y-4">
      {/* Category Strip */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
        {["Biryani", "Porotta", "Seafood", "Starters", "Drinks"].map((c, i) => (
          <span key={c} className={`px-3 py-1 rounded-lg text-xs font-bold shrink-0 ${
            i === 0 ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-400 border border-slate-800"
          }`}>
            {c}
          </span>
        ))}
      </div>

      {/* Dishes */}
      <div className="space-y-2">
        {[
          { name: "Malabar Chicken Dum Biryani", price: "₹240", tag: "Bestseller" },
          { name: "Thalassery Mutton Biryani", price: "₹320", tag: "Special" },
          { name: "Kerala Porotta (2 pcs)", price: "₹50", tag: "Flaky" },
          { name: "Karimeen Pollichathu", price: "₹380", tag: "Fresh" },
        ].map((d) => (
          <div key={d.name} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-white">{d.name}</div>
              <div className="text-[10px] text-blue-400">{d.tag}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-white">{d.price}</span>
              <button className="w-6 h-6 rounded bg-blue-600 text-white flex items-center justify-center text-xs font-bold">+</button>
            </div>
          </div>
        ))}
      </div>

      {/* Cart Drawer */}
      <div className="p-3.5 rounded-2xl bg-slate-900 border border-blue-500/30 space-y-2 mt-4">
        <div className="flex justify-between text-xs font-bold text-white">
          <span>Active Cart (Table 04)</span>
          <span className="text-emerald-400">₹670.00</span>
        </div>
        <div className="text-[11px] text-slate-400">2x Biryani, 4x Porotta, 2x Lime Soda</div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button className="py-2 rounded-xl bg-slate-800 text-[11px] font-bold text-white flex items-center justify-center gap-1">
            <Printer className="w-3 h-3" /> Bluetooth KOT
          </button>
          <button className="py-2 rounded-xl bg-emerald-600 text-[11px] font-bold text-white flex items-center justify-center gap-1">
            <QrCode className="w-3 h-3" /> Dynamic UPI
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileKitchenContent() {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center text-xs font-bold text-slate-300">
        <span>Station 01: Hot Kitchen (5 Active)</span>
        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px]">Live Tickets</span>
      </div>

      {[
        { id: "#1024", table: "Table 04", timer: "⏱ 8m", items: ["2x Malabar Biryani", "4x Kerala Porotta", "2x Lime Soda"], rush: true },
        { id: "#1025", table: "Table 02", timer: "⏱ 3m", items: ["1x Mutton Pepper Fry", "3x Appam"], rush: false },
        { id: "#1026", table: "Swiggy #482", timer: "⏱ 1m", items: ["2x Chicken Biryani"], rush: false },
      ].map((t) => (
        <div key={t.id} className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex justify-between items-center">
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <span className="font-mono text-blue-400">{t.id}</span>
              <span>{t.table}</span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${t.rush ? "bg-rose-500/20 text-rose-400" : "bg-slate-800 text-slate-300"}`}>
              {t.timer}
            </span>
          </div>
          <div className="space-y-1 text-xs text-slate-300">
            {t.items.map((it) => (
              <div key={it} className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>{it}</span>
              </div>
            ))}
          </div>
          <button className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs">
            Bump Ticket / Ready
          </button>
        </div>
      ))}
    </div>
  );
}

function MobileTablesContent() {
  const tables = [
    { name: "Table 01", seats: 2, status: "Available", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" },
    { name: "Table 02", seats: 4, status: "Occupied • 14m", color: "text-blue-400 border-blue-500/30 bg-blue-500/5" },
    { name: "Table 03", seats: 4, status: "Available", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" },
    { name: "Table 04", seats: 6, status: "Bill Req • ₹1,249", color: "text-amber-400 border-amber-500/30 bg-amber-500/5" },
    { name: "Table 05", seats: 2, status: "Occupied • 8m", color: "text-blue-400 border-blue-500/30 bg-blue-500/5" },
    { name: "Table 06", seats: 8, status: "Reserved 8:00PM", color: "text-purple-400 border-purple-500/30 bg-purple-500/5" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center text-xs font-bold text-slate-300">
        <span>Dining Room (6 tables active)</span>
        <span className="text-emerald-400 text-[11px]">4 Free</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {tables.map((t) => (
          <div key={t.name} className={`p-3 rounded-xl border ${t.color} space-y-1`}>
            <div className="text-xs font-black text-white">{t.name}</div>
            <div className="text-[10px] text-slate-400">{t.seats} seats</div>
            <div className="text-[11px] font-bold">{t.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileInventoryContent() {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center text-xs font-bold text-slate-300">
        <span>Pantry Stock Levels</span>
        <span className="text-rose-400 text-[11px]">2 Critical Low</span>
      </div>
      {[
        { name: "Fresh Chicken (Curry Cut)", current: "8.5 kg", min: "40 kg", critical: true },
        { name: "Jeerakasala Kaima Rice", current: "14.2 kg", min: "40 kg", critical: true },
        { name: "Amul Butter Blocks", current: "18 blocks", min: "10 blocks", critical: false },
        { name: "Coconut Oil", current: "24 litres", min: "15 litres", critical: false },
      ].map((it) => (
        <div key={it.name} className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
          <div className="flex justify-between text-xs font-bold">
            <span className="text-white">{it.name}</span>
            <span className={it.critical ? "text-rose-400" : "text-emerald-400"}>{it.current}</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div className={`h-full ${it.critical ? "bg-rose-500 w-[22%]" : "bg-emerald-500 w-[75%]"}`} />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Min Par: {it.min}</span>
            {it.critical && <span className="text-blue-400 font-bold">1-Tap WhatsApp PO</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function MobileAnalyticsContent() {
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
        <div className="text-xs text-slate-400 font-bold mb-1">Today's Revenue</div>
        <div className="text-3xl font-black text-white">₹48,650</div>
        <div className="text-xs text-emerald-400 mt-1 font-semibold">+18.4% vs yesterday</div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-slate-400 text-[10px]">AOV (Ticket)</div>
          <div className="text-lg font-black text-white">₹386</div>
        </div>
        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-slate-400 text-[10px]">GST 5%</div>
          <div className="text-lg font-black text-white">₹2,432</div>
        </div>
      </div>
      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
        <div className="text-xs font-bold text-white">Payment Tender Mix</div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-blue-400">
            <span>UPI / QR Code</span>
            <span className="font-bold">71%</span>
          </div>
          <div className="flex justify-between text-emerald-400">
            <span>Credit/Debit Cards</span>
            <span className="font-bold">19%</span>
          </div>
          <div className="flex justify-between text-amber-400">
            <span>Cash Drawer</span>
            <span className="font-bold">10%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileQrContent() {
  return (
    <div className="space-y-4 text-center">
      <div className="p-6 rounded-2xl bg-white text-slate-950 flex flex-col items-center">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Scan to Order & Pay</div>
        <div className="text-base font-black mb-3">Table 01 • Malabar Coastal</div>
        <QRCodeSVG value="https://dine.thekada.in/m/table-01" size={160} />
        <div className="mt-3 text-[10px] text-slate-500 font-mono">dine.thekada.in/m/table-01</div>
      </div>
      <button className="w-full py-2.5 rounded-xl bg-blue-600 font-bold text-xs text-white">
        Download Acrylic QR Standee PDF
      </button>
    </div>
  );
}

function MobileAiContent() {
  return (
    <div className="space-y-4 text-center">
      <div className="p-6 rounded-2xl bg-purple-950/40 border border-purple-500/30 flex flex-col items-center">
        <Camera className="w-10 h-10 text-purple-400 mb-2" />
        <div className="text-sm font-black text-white">Gemini Vision AI Menu Scanner</div>
        <div className="text-xs text-slate-400 mt-1 max-w-xs">
          Take a photo of your paper restaurant menu. AI extracts 50+ dishes into Kada Dine in 10s.
        </div>
      </div>
      <button className="w-full py-2.5 rounded-xl bg-purple-600 font-bold text-xs text-white flex items-center justify-center gap-1.5">
        <Camera className="w-4 h-4" /> Snap Photo of Menu
      </button>
    </div>
  );
}

function MobileMessContent() {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center text-xs font-bold text-slate-300">
        <span>Kada Mess Meal Plans</span>
        <span className="text-emerald-400 text-[11px]">48 Active Subscribers</span>
      </div>
      {[
        { meal: "Breakfast (7:30 - 9:30 AM)", menu: "Idli, Vada, Sambar, Chutney, Tea", count: "42 packed" },
        { meal: "Lunch (12:30 - 2:30 PM)", menu: "Kerala Meals, Fish Curry, Curd, Payasam", count: "48 packed" },
        { meal: "Dinner (7:30 - 9:30 PM)", menu: "Chappathi x3, Chicken Curry / Veg Kurma", count: "45 packed" },
      ].map((m) => (
        <div key={m.meal} className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="text-xs font-bold text-white flex justify-between">
            <span>{m.meal}</span>
            <span className="text-blue-400">{m.count}</span>
          </div>
          <div className="text-[11px] text-slate-400">{m.menu}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop View Helpers
// ─────────────────────────────────────────────────────────────────────────────
function ShowcaseOverview() {
  const chartData = [
    { hour: "11 AM", revenue: 4200, orders: 12 },
    { hour: "12 PM", revenue: 9800, orders: 28 },
    { hour: "1 PM", revenue: 19400, orders: 54 },
    { hour: "2 PM", revenue: 16200, orders: 42 },
    { hour: "3 PM", revenue: 6500, orders: 18 },
    { hour: "4 PM", revenue: 4800, orders: 14 },
    { hour: "5 PM", revenue: 7200, orders: 20 },
    { hour: "6 PM", revenue: 11500, orders: 32 },
    { hour: "7 PM", revenue: 21400, orders: 58 },
    { hour: "8 PM", revenue: 28600, orders: 74 },
    { hour: "9 PM", revenue: 24300, orders: 62 },
    { hour: "10 PM", revenue: 12800, orders: 35 },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold">Revenue Today</span>
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">₹84,250</div>
          <div className="mt-2 text-xs text-emerald-400 flex items-center gap-1 font-semibold">
            <span>+18.4%</span>
            <span className="text-slate-400 font-normal">vs yesterday (₹71,150)</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold">Total Orders</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">214 Orders</div>
          <div className="mt-2 text-xs text-blue-400 flex items-center gap-1 font-semibold">
            <span>18 Live Active</span>
            <span className="text-slate-400 font-normal">• AOV ₹394</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold">Table Occupancy</span>
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400">
              <Grid3X3 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">8 / 12 Tables</div>
          <div className="mt-2 text-xs text-purple-400 flex items-center gap-1 font-semibold">
            <span>67% Seated</span>
            <span className="text-slate-400 font-normal">• 4 Available</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold">Kitchen SLA & Turn</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">12.4 mins</div>
          <div className="mt-2 text-xs text-emerald-400 flex items-center gap-1 font-semibold">
            <span>-2.1m prep time</span>
            <span className="text-slate-400 font-normal">• 98% on-time</span>
          </div>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-bold text-white">Hourly Revenue & Order Rush Curve</h2>
            <p className="text-xs text-slate-400">Real-time dine-in, takeaway, and QR ordering rush progression</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-lg bg-slate-800 text-xs text-white font-bold border border-slate-700">Today</span>
            <span className="px-3 py-1 rounded-lg text-xs text-slate-400 hover:text-white cursor-pointer">Yesterday</span>
            <span className="px-3 py-1 rounded-lg text-xs text-slate-400 hover:text-white cursor-pointer">7 Days</span>
          </div>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="revenueGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="hour" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `₹${v/1000}k`} />
              <Tooltip 
                contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "12px" }}
                formatter={(val) => [`₹${val}`, "Revenue"]}
              />
              <Area type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#revenueGlow)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 p-6 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white">Live Kitchen & Table Queue (18 active)</h3>
            <span className="text-xs text-blue-400 font-semibold cursor-pointer">View KDS →</span>
          </div>
          <div className="space-y-2.5">
            {[
              { id: "#1024", table: "Table 04", items: "Malabar Biryani x2, Porotta x4, Lime Soda x2", total: "₹1,249", timer: "8m ago", status: "Cooking", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
              { id: "#1025", table: "Table 02", items: "Mutton Pepper Fry, Appam x3, Black Tea x2", total: "₹680", timer: "2m ago", status: "New Order", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
              { id: "#1023", table: "Table 07", items: "Karimeen Pollichathu, Kerala Meals x2", total: "₹820", timer: "14m ago", status: "Ready", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
            ].map((ord) => (
              <div key={ord.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="font-mono text-xs font-black text-white">{ord.id}</div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span>{ord.table}</span>
                      <span className="text-slate-400 font-normal">• {ord.timer}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">{ord.items}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-white">{ord.total}</span>
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold border ${ord.color}`}>
                    {ord.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4 p-6 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white">Stock Warnings (2 low)</h3>
            <span className="text-xs text-rose-400 font-semibold cursor-pointer">Restock →</span>
          </div>
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-slate-950 border border-rose-500/20">
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <span className="text-white">Fresh Chicken (Curry Cut)</span>
                <span className="text-rose-400">8.5 kg left</span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-rose-500 h-full w-[21%]" />
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                <span>Min: 40 kg</span>
                <span className="text-blue-400 font-bold cursor-pointer">1-Click WhatsApp PO</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/20">
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <span className="text-white">Kaima / Jeerakasala Rice</span>
                <span className="text-amber-400">14.2 kg left</span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-amber-500 h-full w-[35%]" />
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                <span>Min: 40 kg</span>
                <span className="text-blue-400 font-bold cursor-pointer">1-Click WhatsApp PO</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShowcasePOS() {
  const [activeCat, setActiveCat] = useState("Biryani & Rice");
  const categories = ["All", "Biryani & Rice", "Breads & Porotta", "Seafood", "Starters", "Desserts", "Beverages"];

  const dishes = [
    { id: 1, name: "Malabar Chicken Dum Biryani", price: 240, cat: "Biryani & Rice", tag: "Bestseller", veg: false },
    { id: 2, name: "Thalassery Mutton Biryani", price: 320, cat: "Biryani & Rice", tag: "Chef Special", veg: false },
    { id: 3, name: "Kerala Porotta (Flaky)", price: 25, cat: "Breads & Porotta", tag: "Must Try", veg: true },
    { id: 4, name: "Karimeen Pollichathu", price: 380, cat: "Seafood", tag: "Fresh Catch", veg: false },
    { id: 5, name: "Kozhi Porichathu (Fried Chicken)", price: 220, cat: "Starters", tag: "Crispy", veg: false },
    { id: 6, name: "Fresh Mint Lime Soda", price: 40, cat: "Beverages", tag: "Chilled", veg: true },
  ];

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto">
      <div className="lg:col-span-8 flex flex-col space-y-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setActiveCat(c)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold shrink-0 transition ${
                activeCat === c
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                  : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 flex-1">
          {dishes.map((dish) => (
            <div
              key={dish.id}
              className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-blue-500/50 cursor-pointer transition flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`w-3 h-3 rounded-sm border flex items-center justify-center p-0.5 ${
                    dish.veg ? "border-emerald-500 text-emerald-500" : "border-rose-500 text-rose-500"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${dish.veg ? "bg-emerald-500" : "bg-rose-500"}`} />
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-bold text-slate-300">
                    {dish.tag}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-white group-hover:text-blue-400 transition leading-snug">
                  {dish.name}
                </h4>
              </div>
              <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-800/60">
                <span className="text-sm font-black text-white">₹{dish.price}</span>
                <span className="w-6 h-6 rounded-lg bg-blue-600/20 text-blue-400 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center text-xs font-bold transition">
                  +
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lg:col-span-4 p-5 rounded-3xl bg-slate-900 border border-slate-800 flex flex-col justify-between shadow-2xl">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <div className="text-xs font-extrabold text-white flex items-center gap-1.5">
                <Grid3X3 className="w-3.5 h-3.5 text-blue-400" />
                Table 04 • Dine-In
              </div>
              <div className="text-[10px] text-slate-400">Waiter: Rahul P. • 4 Guests</div>
            </div>
            <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
              KOT #1024
            </span>
          </div>

          <div className="py-4 space-y-3">
            {[
              { name: "Malabar Chicken Dum Biryani", qty: 2, price: 480 },
              { name: "Kerala Porotta (Flaky)", qty: 4, price: 100 },
              { name: "Karimeen Pollichathu", qty: 1, price: 380 },
              { name: "Fresh Mint Lime Soda", qty: 2, price: 80 },
            ].map((item) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex-1 pr-2">
                  <div className="font-bold text-white leading-tight">{item.name}</div>
                  <div className="text-[10px] text-slate-400">₹{item.price / item.qty} each</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-400 cursor-pointer">-</span>
                    <span className="font-mono font-bold text-white text-xs">{item.qty}</span>
                    <span className="text-slate-400 cursor-pointer">+</span>
                  </div>
                  <span className="font-mono font-bold text-white w-12 text-right">₹{item.price}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-800 space-y-1.5 text-xs text-slate-400">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="text-white font-mono">₹1,040.00</span>
            </div>
            <div className="flex justify-between">
              <span>CGST (2.5%)</span>
              <span className="text-white font-mono">₹26.00</span>
            </div>
            <div className="flex justify-between">
              <span>SGST (2.5%)</span>
              <span className="text-white font-mono">₹26.00</span>
            </div>
            <div className="flex justify-between text-emerald-400 font-semibold">
              <span>Promo (FLAT10)</span>
              <span className="font-mono">-₹104.00</span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">Grand Total</span>
            <span className="text-xl font-black text-white font-mono">₹988.00</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button className="py-2.5 px-3 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white hover:bg-slate-700 flex items-center justify-center gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              F9 Print KOT
            </button>
            <button className="py-2.5 px-3 rounded-xl bg-emerald-600 text-xs font-extrabold text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5">
              <QrCode className="w-3.5 h-3.5" />
              Dynamic UPI
            </button>
          </div>

          <button className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs shadow-lg shadow-blue-600/40 uppercase tracking-wider">
            F10 Settle & Bill (₹988.00)
          </button>
        </div>
      </div>
    </div>
  );
}

function ShowcaseKitchen() {
  const columns = [
    {
      title: "New Orders (2)",
      color: "border-blue-500/40 bg-blue-500/5",
      badge: "bg-blue-500 text-white",
      tickets: [
        { id: "#1026", table: "Table 02", channel: "Dine-In", timer: "2m", urgency: "normal", items: [{ name: "Mutton Pepper Fry", qty: 1, station: "Grill" }, { name: "Kerala Porotta", qty: 4, station: "Tandoor" }] },
        { id: "#1027", table: "Swiggy #482", channel: "Delivery", timer: "1m", urgency: "normal", items: [{ name: "Chicken Dum Biryani", qty: 2, station: "Main Hot" }] },
      ]
    },
    {
      title: "Cooking / Prep (3)",
      color: "border-amber-500/40 bg-amber-500/5",
      badge: "bg-amber-500 text-slate-950 font-black",
      tickets: [
        { id: "#1024", table: "Table 04", channel: "Dine-In", timer: "9m", urgency: "rush", items: [{ name: "Chicken Dum Biryani", qty: 2, station: "Main Hot" }, { name: "Karimeen Pollichathu", qty: 1, station: "Fish Fry" }] },
        { id: "#1025", table: "Table 09", channel: "Dine-In", timer: "6m", urgency: "normal", items: [{ name: "Butter Chicken", qty: 1, station: "Main Hot" }, { name: "Garlic Naan", qty: 3, station: "Tandoor" }] },
      ]
    },
    {
      title: "Ready for Pickup (2)",
      color: "border-emerald-500/40 bg-emerald-500/5",
      badge: "bg-emerald-500 text-slate-950 font-black",
      tickets: [
        { id: "#1022", table: "Table 01", channel: "Dine-In", timer: "Ready 1m", urgency: "done", items: [{ name: "Cold Coffee", qty: 2, station: "Beverage" }] },
        { id: "#1021", table: "Zomato #901", channel: "Courier Waiting", timer: "Ready 3m", urgency: "done", items: [{ name: "Paneer Tikka Roll", qty: 2, station: "Snack" }] },
      ]
    }
  ];

  return (
    <div className="h-full flex flex-col space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" />
            Station 01: Main Hot Kitchen & KDS Board
          </h2>
          <p className="text-xs text-slate-400">Color urgency timers: Green &lt;10m, Amber 10-15m, Red &gt;15m rush</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-lg bg-blue-600 text-xs font-bold text-white">All Stations</span>
          <span className="px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400">Grill Only</span>
          <span className="px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400">Beverages</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 flex-1">
        {columns.map((col) => (
          <div key={col.title} className={`p-4 rounded-3xl border ${col.color} flex flex-col space-y-3`}>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <span className="text-xs font-bold text-white">{col.title}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${col.badge}`}>Live</span>
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto">
              {col.tickets.map((t) => (
                <div key={t.id} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-black text-sm text-white">{t.id}</span>
                      <div className="text-xs font-bold text-blue-400">{t.table}</div>
                    </div>
                    <div className="text-right">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-black ${
                        t.urgency === "rush" ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "bg-slate-800 text-slate-300"
                      }`}>
                        ⏱ {t.timer}
                      </span>
                      <div className="text-[10px] text-slate-400 mt-0.5">{t.channel}</div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
                    {t.items.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-white">
                          <span className="font-mono text-blue-400 mr-1.5">{it.qty}x</span>
                          {it.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {it.station}
                        </span>
                      </div>
                    ))}
                  </div>

                  <button className="w-full py-2 rounded-xl bg-slate-800 hover:bg-emerald-600 hover:text-white text-xs font-bold text-slate-300 transition flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Mark Ready & Bump
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShowcaseTables() {
  const tables = [
    { id: "T1", name: "Table 01", seats: 2, status: "Available", time: "-", bill: "₹0", waiter: "Unassigned" },
    { id: "T2", name: "Table 02", seats: 4, status: "Occupied", time: "14m", bill: "₹680", waiter: "Rahul P." },
    { id: "T3", name: "Table 03", seats: 4, status: "Available", time: "-", bill: "₹0", waiter: "Unassigned" },
    { id: "T4", name: "Table 04", seats: 6, status: "Occupied", time: "32m", bill: "₹1,249", waiter: "Priya S." },
    { id: "T5", name: "Table 05", seats: 2, status: "Ordering", time: "4m", bill: "₹0", waiter: "Arjun D." },
    { id: "T6", name: "Table 06", seats: 8, status: "Reserved", time: "8:00 PM", bill: "₹0", waiter: "Banquet Tag" },
    { id: "T7", name: "Table 07", seats: 4, status: "Bill Requested", time: "48m", bill: "₹820", waiter: "Rahul P." },
    { id: "T8", name: "Table 08", seats: 4, status: "Available", time: "-", bill: "₹0", waiter: "Unassigned" },
    { id: "T9", name: "Table 09", seats: 6, status: "Occupied", time: "18m", bill: "₹1,560", waiter: "Priya S." },
    { id: "T10", name: "Table 10", seats: 2, status: "Available", time: "-", bill: "₹0", waiter: "Unassigned" },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Visual Dining Floor Plan (10 Tables)</h2>
          <p className="text-xs text-slate-400">Live floor status: 4 Available, 3 Seated, 1 Ordering, 1 Bill Requested, 1 Reserved</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Available
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Occupied
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Bill Requested
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Reserved
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {tables.map((t) => {
          const isAvail = t.status === "Available";
          const isOcc = t.status === "Occupied";
          const isBill = t.status === "Bill Requested";

          return (
            <div
              key={t.id}
              className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between h-44 ${
                isAvail ? "bg-slate-900 border-slate-800 hover:border-emerald-500/50" :
                isOcc ? "bg-blue-950/20 border-blue-500/40 shadow-lg shadow-blue-500/5" :
                isBill ? "bg-amber-950/20 border-amber-500/40 shadow-lg shadow-amber-500/5" :
                "bg-purple-950/20 border-purple-500/40"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm font-black text-white">{t.name}</span>
                  <span className="text-[10px] font-bold text-slate-400">{t.seats} seats</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${
                    isAvail ? "bg-emerald-500" : isOcc ? "bg-blue-500 animate-pulse" : isBill ? "bg-amber-500" : "bg-purple-500"
                  }`} />
                  <span className={`text-xs font-bold ${
                    isAvail ? "text-emerald-400" : isOcc ? "text-blue-400" : isBill ? "text-amber-400" : "text-purple-400"
                  }`}>
                    {t.status}
                  </span>
                </div>
              </div>

              <div className="space-y-1 pt-2 border-t border-slate-800/60">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Elapsed:</span>
                  <span className="font-mono text-white font-bold">{t.time}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Bill Total:</span>
                  <span className="font-mono text-white font-black">{t.bill}</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  Waiter: {t.waiter}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShowcaseInventory() {
  const stock = [
    { name: "Fresh Chicken (Curry Cut)", cat: "Poultry", current: 8.5, min: 40, unit: "kg", cost: 180, status: "critical" },
    { name: "Kaima / Jeerakasala Rice", cat: "Grains", current: 14.2, min: 40, unit: "kg", cost: 95, status: "low" },
    { name: "Amul Butter (500g Blocks)", cat: "Dairy", current: 18, min: 10, unit: "blocks", cost: 260, status: "ok" },
    { name: "Cold Pressed Coconut Oil", cat: "Oils", current: 24, min: 15, unit: "litres", cost: 210, status: "ok" },
    { name: "Karimeen (Pearl Spot Fish)", cat: "Seafood", current: 12, min: 8, unit: "kg", cost: 420, status: "ok" },
    { name: "Malabar Whole Garam Masala", cat: "Spices", current: 4.8, min: 3, unit: "kg", cost: 850, status: "ok" },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Recipe & Raw Material Stock Manager</h2>
          <p className="text-xs text-slate-400">Live ingredient meters, auto-deduction on orders, and 1-click supplier POs</p>
        </div>
        <button className="px-4 py-2 rounded-xl bg-blue-600 text-xs font-bold text-white shadow-lg shadow-blue-600/30">
          + Add Ingredient
        </button>
      </div>

      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
              <th className="pb-3">Ingredient</th>
              <th className="pb-3">Category</th>
              <th className="pb-3">Current Level</th>
              <th className="pb-3">Min Par Level</th>
              <th className="pb-3">Unit Cost</th>
              <th className="pb-3">Status</th>
              <th className="pb-3 text-right">Supplier Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {stock.map((s) => (
              <tr key={s.name} className="hover:bg-slate-800/30 transition">
                <td className="py-3.5 font-bold text-white">{s.name}</td>
                <td className="py-3.5 text-slate-400">{s.cat}</td>
                <td className="py-3.5 font-mono font-bold text-white">{s.current} {s.unit}</td>
                <td className="py-3.5 font-mono text-slate-400">{s.min} {s.unit}</td>
                <td className="py-3.5 font-mono text-white">₹{s.cost}/{s.unit}</td>
                <td className="py-3.5">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                    s.status === "critical" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                    s.status === "low" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                    "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  }`}>
                    {s.status}
                  </span>
                </td>
                <td className="py-3.5 text-right">
                  <span className="text-xs font-bold text-blue-400 hover:text-blue-300 cursor-pointer">
                    Generate WhatsApp PO →
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShowcaseReports() {
  const tenderData = [
    { name: "UPI / QR Code", value: 71, color: "#3b82f6" },
    { name: "Credit / Debit Cards", value: 19, color: "#10b981" },
    { name: "Cash Drawer", value: 10, color: "#f59e0b" },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Financial Reports & GST Tax Audit</h2>
          <p className="text-xs text-slate-400">Consolidated gross sales, day-part breakdown, and GSTR-1 Excel export</p>
        </div>
        <button className="px-4 py-2 rounded-xl bg-emerald-600 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 flex items-center gap-1.5">
          <Printer className="w-3.5 h-3.5" />
          Export GSTR-1 Excel (.xlsx)
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="text-xs text-slate-400 font-bold mb-1">Monthly Gross Revenue</div>
          <div className="text-2xl font-black text-white">₹4,86,400</div>
          <div className="text-xs text-emerald-400 mt-1 font-semibold">+22.4% vs last month</div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="text-xs text-slate-400 font-bold mb-1">Net GST Liability (5%)</div>
          <div className="text-2xl font-black text-white">₹24,320</div>
          <div className="text-xs text-slate-400 mt-1">CGST ₹12,160 • SGST ₹12,160</div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="text-xs text-slate-400 font-bold mb-1">Total Bills Settled</div>
          <div className="text-2xl font-black text-white">1,248 Bills</div>
          <div className="text-xs text-blue-400 mt-1 font-semibold">Average Ticket ₹389.70</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 p-6 rounded-2xl bg-slate-900 border border-slate-800">
          <h3 className="text-sm font-bold text-white mb-4">Payment Tender Mix (Digital vs Cash)</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={tenderData} innerRadius={60} outerRadius={85} paddingAngle={5} dataKey="value">
                  {tenderData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderRadius: "12px" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-around pt-2 border-t border-slate-800 text-xs">
            {tenderData.map((d) => (
              <span key={d.name} className="flex items-center gap-1.5 font-bold" style={{ color: d.color }}>
                ● {d.name}: {d.value}%
              </span>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 p-6 rounded-2xl bg-slate-900 border border-slate-800">
          <h3 className="text-sm font-bold text-white mb-4">Day-Part Meal Shift Revenue Split</h3>
          <div className="space-y-4 pt-2">
            {[
              { shift: "Lunch Rush (12 PM - 3 PM)", pct: 45, val: "₹2,18,880", color: "bg-blue-500" },
              { shift: "Dinner Rush (7 PM - 11 PM)", pct: 28, val: "₹1,36,192", color: "bg-emerald-500" },
              { shift: "Breakfast (7 AM - 11 AM)", pct: 15, val: "₹72,960", color: "bg-amber-500" },
              { shift: "Evening Snacks & Tea (4 PM - 6 PM)", pct: 12, val: "₹58,368", color: "bg-purple-500" },
            ].map((s) => (
              <div key={s.shift} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-white">{s.shift}</span>
                  <span className="font-mono text-slate-300 font-semibold">{s.val} ({s.pct}%)</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className={`h-full ${s.color}`} style={{ width: `${s.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShowcaseMenu() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-900/40 via-blue-900/30 to-slate-900 border border-purple-500/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Gemini Vision AI Menu Digitizer</h3>
            <p className="text-xs text-slate-400">Scan paper laminated menu photo to extract dishes, categories & prices in 10s</p>
          </div>
        </div>
        <button className="px-4 py-2 rounded-xl bg-purple-600 text-white text-xs font-bold hover:bg-purple-500 shadow-lg shadow-purple-600/30">
          Upload Paper Menu
        </button>
      </div>

      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Menu Catalog (54 active items)</h3>
          <span className="text-xs text-blue-400 font-bold cursor-pointer">+ Add New Dish</span>
        </div>
        <div className="space-y-2">
          {[
            { name: "Malabar Chicken Dum Biryani", cat: "Biryani & Rice", price: "₹240", status: "Live on QR", veg: false },
            { name: "Thalassery Mutton Biryani", cat: "Biryani & Rice", price: "₹320", status: "Live on QR", veg: false },
            { name: "Kerala Porotta", cat: "Breads", price: "₹25", status: "Live on QR", veg: true },
            { name: "Karimeen Pollichathu", cat: "Seafood Specials", price: "₹380", status: "Live on QR", veg: false },
            { name: "Beef Dry Fry (BDF)", cat: "Starters", price: "₹280", status: "Sold Out (86)", veg: false },
          ].map((d) => (
            <div key={d.name} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-sm border flex items-center justify-center p-0.5 ${
                  d.veg ? "border-emerald-500" : "border-rose-500"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${d.veg ? "bg-emerald-500" : "bg-rose-500"}`} />
                </span>
                <div>
                  <div className="text-xs font-bold text-white">{d.name}</div>
                  <div className="text-[10px] text-slate-400">{d.cat}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono font-bold text-white text-xs">{d.price}</span>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  d.status.includes("Live") ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}>
                  {d.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShowcaseOrders() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Real-Time Multi-Channel Orders Hub</h2>
          <p className="text-xs text-slate-400">Dine-in, Takeaway, The Kada app, Swiggy, and Zomato orders on one screen</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-lg bg-blue-600 text-xs font-bold text-white">All Orders (18)</span>
          <span className="px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400">Dine-In (11)</span>
          <span className="px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400">Aggregators (7)</span>
        </div>
      </div>

      <div className="space-y-3">
        {[
          { id: "#1026", source: "Dine-In", table: "Table 04", time: "8m ago", total: "₹1,249", status: "Cooking", items: "Malabar Biryani x2, Porotta x4, Lime Soda x2" },
          { id: "#1027", source: "Swiggy", table: "Courier: Arjun (Rider #89)", time: "4m ago", total: "₹480", status: "Preparing", items: "Chicken Biryani x2, Salan x2" },
          { id: "#1028", source: "The Kada App", table: "Takeaway • Asha M.", time: "2m ago", total: "₹680", status: "New Order", items: "Mutton Pepper Fry, Appam x3" },
          { id: "#1025", source: "Zomato", table: "Courier Arriving in 4m", time: "12m ago", total: "₹820", status: "Ready for Pickup", items: "Butter Chicken x1, Garlic Naan x3" },
        ].map((o) => (
          <div key={o.id} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="font-mono text-sm font-black text-white">{o.id}</div>
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <span>{o.table}</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-blue-400 border border-slate-700">
                    {o.source}
                  </span>
                  <span className="text-slate-400 font-normal">• {o.time}</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{o.items}</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="font-mono font-bold text-white text-sm">{o.total}</span>
              <span className="px-3 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-bold">
                {o.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShowcaseMess() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-black text-white">Kada Mess & Meal Subscriptions Hub</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 text-xs font-bold">
              142 Active Subscribers
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Batch meal production, automated packaging checklists, scheduled route dispatches, and WhatsApp meal updates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1.5">
            <Printer className="w-3.5 h-3.5 text-slate-400" />
            Print Tiffin Labels
          </button>
          <button className="px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-lg shadow-blue-600/30 hover:bg-blue-500 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            New Subscriber
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="text-xs text-slate-400 mb-1">Active Subscribers</div>
          <div className="text-2xl font-black text-white">142</div>
          <div className="text-[11px] text-emerald-400 mt-2 font-semibold flex items-center gap-1">
            <span>+16 new this month</span>
            <span className="text-slate-400 font-normal">• 98% renewal rate</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="text-xs text-slate-400 mb-1">Today's Tiffin Count</div>
          <div className="text-2xl font-black text-white">286 Meals</div>
          <div className="text-[11px] text-blue-400 mt-2 font-semibold">
            B: 82 • L: 124 • D: 80
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="text-xs text-slate-400 mb-1">Monthly Subscription Revenue</div>
          <div className="text-2xl font-black text-white">₹3,48,200</div>
          <div className="text-[11px] text-emerald-400 mt-2 font-semibold">
            +22.4% vs last month (₹2,84,400)
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="text-xs text-slate-400 mb-1">Packing & Transit State</div>
          <div className="text-2xl font-black text-emerald-400">92% On-Time</div>
          <div className="text-[11px] text-slate-400 mt-2">
            3 Delivery routes en-route
          </div>
        </div>
      </div>

      {/* Today's Meal Production Batches */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">Today's Meal Production & Packaging Batches</h3>
            <p className="text-xs text-slate-400">Live KDS tiffin packing stations and route batches</p>
          </div>
          <span className="text-xs text-blue-400 font-bold">Kochi Central Kitchen Hub</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Breakfast Batch (7:00 - 9:30 AM)</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                Delivered (82/82)
              </span>
            </div>
            <div className="text-xs text-slate-300 font-medium">
              4x Idli, 1x Medu Vada, Sambar, Coconut Chutney & Filter Coffee
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full w-full rounded-full" />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>82 Tiffins Packed</span>
              <span className="text-emerald-400 font-bold">100% Completed</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-blue-500/40 space-y-3 shadow-lg shadow-blue-500/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Lunch Batch (12:00 - 2:00 PM)</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold animate-pulse">
                In Transit (124/124)
              </span>
            </div>
            <div className="text-xs text-slate-300 font-medium">
              Kerala Matta Rice, Fish Curry / Sambar, Thoran, Kootu Curry, Moru & Payasam
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div className="bg-blue-500 h-full w-full rounded-full" />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>124 Tiffins Dispatched</span>
              <span className="text-blue-400 font-bold">On Route • 3 Vans</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Dinner Batch (7:30 - 9:30 PM)</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">
                Prep in Progress
              </span>
            </div>
            <div className="text-xs text-slate-300 font-medium">
              3x Whole Wheat Chappathi, Malabar Chicken Curry / Vegetable Kurma, Fresh Salad
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div className="bg-amber-500 h-full w-2/5 rounded-full" />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>80 Tiffins Scheduled</span>
              <span className="text-amber-400 font-bold">KDS Prep Started</span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Subscribers Table */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">Recent Subscribers & Meal Dispatch Log</h3>
            <p className="text-xs text-slate-400">Individual dietary tags, delivery hubs, and pause/resume schedule</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] text-slate-300 font-medium">InfoPark Campus</span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] text-slate-300 font-medium">Panampilly Nagar</span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] text-slate-300 font-medium">MG Road Hub</span>
          </div>
        </div>

        <div className="divide-y divide-slate-800">
          {[
            { id: "SUB-1082", name: "Ananya Nair", plan: "Executive 3-Meal Combo (Monthly)", hub: "InfoPark Phase 2, Wipro Campus", pref: "Non-Veg (Fish/Chicken)", status: "Active", renewal: "Renews in 18 days" },
            { id: "SUB-1083", name: "Karthik Varma", plan: "Corporate Lunch Box (Monthly)", hub: "MG Road, Axis Tower 4th Floor", pref: "Pure Veg (No Onion/Garlic)", status: "Active", renewal: "Renews in 12 days" },
            { id: "SUB-1084", name: "Deepak Nambiar", plan: "Student 2-Meal Pack (Lunch + Dinner)", hub: "Kakkanad Near Rajagiri College", pref: "Non-Veg", status: "Active", renewal: "Renews in 24 days" },
            { id: "SUB-1085", name: "Meera Krishnan", plan: "Healthy Homestyle Dinner (Weekly)", hub: "Panampilly Nagar, Main Avenue", pref: "Low Oil / Diabetic Friendly", status: "Paused (Vacation)", renewal: "Resumes Nov 24" },
          ].map((s) => (
            <div key={s.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-600/20 text-blue-400 font-bold flex items-center justify-center shrink-0 border border-blue-500/30">
                  {s.name.split(" ").map(n => n[0]).join("")}
                </div>
                <div>
                  <div className="font-bold text-white flex items-center gap-2">
                    <span>{s.name}</span>
                    <span className="font-mono text-[10px] text-slate-400 font-normal">({s.id})</span>
                  </div>
                  <div className="text-slate-400 text-[11px] mt-0.5">{s.plan} • <span className="text-slate-300">{s.hub}</span></div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {s.pref}
                </span>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  s.status === "Active" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                }`}>
                  {s.status}
                </span>
                <span className="text-slate-400 text-[10px] font-mono">{s.renewal}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
