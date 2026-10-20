import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
   Users, Search,
   Wallet, TrendingUp, History,
    Award, Heart, Star, ChevronRight,
   Mail, Phone
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { db } from "@/lib/firebase";
import { collection, query, onSnapshot, orderBy, limit, Timestamp } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/lib/currency";
import { PageLoading } from "@/components/dashboard/PageLoading";
import { format as formatDate } from "date-fns";

interface Customer {
   id: string;
   name: string;
   phone: string;
   visits: number;
   lastVisit: string;
   spendValue: number;
   spend: string;
   segment: "VIP" | "Repeat" | "New";
   avatar: string;
}

const segmentStyles: Record<string, { bg: string; text: string; glow: string }> = {
   VIP: { bg: "bg-purple-500/10", text: "text-purple-500", glow: "shadow-purple-500/30" },
   Repeat: { bg: "bg-emerald-500/10", text: "text-emerald-500", glow: "shadow-emerald-500/30" },
   New: { bg: "bg-orange-500/10", text: "text-orange-500", glow: "shadow-orange-500/30" },
};

export default function CustomersPage() {
   const { user, activeRestaurantId } = useAuth();
   const { format } = useCurrency();
   const [search, setSearch] = useState("");
   const [activeTab, setActiveTab] = useState("all");
   const [customers, setCustomers] = useState<Customer[]>([]);
   const [stats, setStats] = useState({
      total: "0",
      avgTicket: format(0),
      retention: "0%",
      vip: "0%"
   });
   const [loading, setLoading] = useState(true);

   useEffect(() => {
      if (!user || !activeRestaurantId) return;
      setLoading(true);

      const q = query(
         collection(db, "restaurants", activeRestaurantId, "customers"),
         orderBy("totalSpent", "desc"),
         limit(1000)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
         let totalSpend = 0;
         let orderCount = 0;

         const customerList = snapshot.docs.map(doc => {
            const data = doc.data();
            const visits = data.totalOrders || 1;
            const spend = data.totalSpent || 0;

            totalSpend += spend;
            orderCount += visits;

            let lastVisitStr = "Unknown";
            if (data.lastOrderDate?.toDate) {
               lastVisitStr = formatDate(data.lastOrderDate.toDate(), "MMM d, yyyy");
            } else if (data.lastSeen?.toDate) {
               lastVisitStr = formatDate(data.lastSeen.toDate(), "MMM d, yyyy");
            }

            return {
               id: doc.id,
               name: data.name || "Guest",
               phone: data.phone || doc.id,
               visits,
               spendValue: spend,
               spend: format(spend),
               lastVisit: lastVisitStr,
               segment: visits >= 5 ? "VIP" : visits > 1 ? "Repeat" : "New",
               avatar: (data.name || "G").charAt(0).toUpperCase(),
            } as Customer;
         });

         setCustomers(customerList);

         const distinctCount = customerList.length;
         const repeaters = customerList.filter(c => c.visits > 1).length;
         const vips = customerList.filter(c => c.visits >= 5).length;

         setStats({
            total: distinctCount.toString(),
            avgTicket: format(Math.round(totalSpend / (orderCount || 1))),
            retention: `${Math.round((repeaters / (distinctCount || 1)) * 100)}%`,
            vip: `${Math.round((vips / (distinctCount || 1)) * 100)}%`
         });
         setLoading(false);
      }, (err) => console.error("[CustomersPage] q listener failed", err));

      return () => unsubscribe();
   }, [user, activeRestaurantId]);

   const filteredCustomers = useMemo(() => {
      let result = customers;
      if (activeTab !== "all") {
         const segmentMap: Record<string, string> = { vips: "VIP", repeat: "Repeat", new: "New" };
         result = result.filter(c => c.segment === segmentMap[activeTab]);
      }
      if (search) {
         const q = search.toLowerCase();
         result = result.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q));
      }
      return result;
   }, [customers, search, activeTab]);

   const topCustomers = useMemo(() => customers.slice(0, 5), [customers]);

   if (loading) return <PageLoading />;

   return (
      <div className="max-w-7xl mx-auto space-y-8 pb-12 animate-in fade-in duration-500">
         {/* Header */}
         <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
               <h1 className="text-4xl font-black tracking-tight text-foreground flex items-center gap-3">
                  Customers
                  <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                     CRM Active
                  </Badge>
               </h1>
               <p className="text-muted-foreground mt-2 font-medium max-w-xl">
                  Deep insights into your customers' behaviors, preferences, and spending habits to drive loyalty.
               </p>
            </div>
         </div>

         {/* Stats Grid */}
         <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-6 rounded-[2rem] border-transparent shadow-xl bg-card hover:scale-[1.02] transition-transform duration-300">
               <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center mb-4">
                  <Users className="w-6 h-6" />
               </div>
               <p className="text-sm font-bold text-muted-foreground">Total Guests</p>
               <p className="text-3xl font-black text-foreground mt-1 tracking-tight">{stats.total}</p>
            </Card>

            <Card className="p-6 rounded-[2rem] border-transparent shadow-xl bg-card hover:scale-[1.02] transition-transform duration-300">
               <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-4">
                  <Wallet className="w-6 h-6" />
               </div>
               <p className="text-sm font-bold text-muted-foreground">Avg Ticket Size</p>
               <p className="text-3xl font-black text-foreground mt-1 tracking-tight">{stats.avgTicket}</p>
            </Card>

            <Card className="p-6 rounded-[2rem] border-transparent shadow-xl bg-card hover:scale-[1.02] transition-transform duration-300 relative overflow-hidden">
               <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-500 flex items-center justify-center mb-4">
                  <History className="w-6 h-6" />
               </div>
               <p className="text-sm font-bold text-muted-foreground">Retention Rate</p>
               <p className="text-3xl font-black text-foreground mt-1 tracking-tight">{stats.retention}</p>
            </Card>

            <Card className="p-6 rounded-[2rem] border-transparent shadow-xl bg-card hover:scale-[1.02] transition-transform duration-300">
               <div className="w-12 h-12 rounded-2xl bg-orange-500/10 text-orange-500 flex items-center justify-center mb-4">
                  <Star className="w-6 h-6" />
               </div>
               <p className="text-sm font-bold text-muted-foreground">VIP Patrons</p>
               <p className="text-3xl font-black text-foreground mt-1 tracking-tight">{stats.vip}</p>
            </Card>
         </div>

         {/* Main Content */}
         <div className="grid lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8 space-y-6">
               <Card className="rounded-[2.5rem] border-transparent shadow-xl bg-card overflow-hidden">
                  <div className="p-6 border-b border-border/50 bg-muted/20">
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex bg-muted/50 p-1 rounded-2xl">
                           {[
                              { id: "all", label: "All Directory" },
                              { id: "vips", label: "VIPs" },
                              { id: "repeat", label: "Repeat" },
                              { id: "new", label: "New" }
                           ].map(t => (
                              <button
                                 key={t.id}
                                 onClick={() => setActiveTab(t.id)}
                                 className={cn(
                                    "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                                    activeTab === t.id 
                                       ? "bg-background text-foreground shadow-sm" 
                                       : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                                 )}
                              >
                                 {t.label}
                              </button>
                           ))}
                        </div>

                        <div className="relative w-full sm:w-64">
                           <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                           <Input 
                              placeholder="Search customers..." 
                              value={search}
                              onChange={e => setSearch(e.target.value)}
                              className="pl-9 h-11 rounded-xl bg-background border-border/50"
                           />
                        </div>
                     </div>
                  </div>

                  <div className="overflow-x-auto">
                     <table className="w-full text-left border-collapse">
                        <thead>
                           <tr className="border-b border-border/50 text-xs uppercase tracking-wider text-muted-foreground font-black bg-muted/10">
                              <th className="px-6 py-4 font-black">Customer</th>
                              <th className="px-6 py-4 font-black">Segment</th>
                              <th className="px-6 py-4 font-black">Activity</th>
                              <th className="px-8 py-4 text-right font-black">Actions</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                           <AnimatePresence mode="popLayout">
                              {filteredCustomers.length === 0 ? (
                                 <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center">
                                       <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted/50 mb-4">
                                          <Users className="w-8 h-8 text-muted-foreground/50" />
                                       </div>
                                       <h3 className="text-lg font-bold text-foreground">No customers found</h3>
                                       <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or search query.</p>
                                    </td>
                                 </tr>
                              ) : (
                                 filteredCustomers.map((customer) => (
                                    <motion.tr 
                                       key={customer.id}
                                       initial={{ opacity: 0 }}
                                       animate={{ opacity: 1 }}
                                       exit={{ opacity: 0 }}
                                       layout
                                       className="group hover:bg-muted/20 transition-colors"
                                    >
                                       <td className="px-6 py-5">
                                          <div className="flex items-center gap-4">
                                             <div className="relative">
                                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 flex items-center justify-center font-black text-primary text-xl">
                                                   {customer.avatar}
                                                </div>
                                                {customer.segment === "VIP" && (
                                                   <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-purple-500 rounded-lg flex items-center justify-center shadow-lg">
                                                      <Star className="w-2.5 h-2.5 text-white fill-white" />
                                                   </div>
                                                )}
                                             </div>
                                             <div>
                                                <p className="font-bold text-foreground text-sm leading-none">{customer.name}</p>
                                                {customer.phone ? (
                                                   <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5 font-medium">
                                                      <Phone className="w-3 h-3" /> {customer.phone}
                                                   </p>
                                                ) : (
                                                   <p className="text-xs text-muted-foreground/50 mt-1.5 italic">No contact</p>
                                                )}
                                             </div>
                                          </div>
                                       </td>
                                       <td className="px-6 py-5">
                                          <div className={cn(
                                             "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-transparent shadow-sm",
                                             segmentStyles[customer.segment].bg,
                                             segmentStyles[customer.segment].text
                                          )}>
                                             {customer.segment}
                                          </div>
                                       </td>
                                       <td className="px-6 py-5">
                                          <p className="text-sm font-black text-foreground">{customer.spend}</p>
                                          <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-70 tracking-wider mt-1">{customer.visits} Visits • Last: {customer.lastVisit}</p>
                                       </td>
                                       <td className="px-8 py-5 text-right">
                                          {/* Was a message icon and an arrow,
                                              neither with a handler: this
                                              dashboard has no customer detail
                                              view and no messaging. The phone
                                              number is real, so the one action
                                              that works is offered. */}
                                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                             {customer.phone && (
                                                <Button
                                                   asChild
                                                   size="icon"
                                                   variant="ghost"
                                                   className="h-9 w-9 rounded-xl hover:bg-primary/10 hover:text-primary"
                                                >
                                                   <a href={`tel:${customer.phone}`} aria-label={`Call ${customer.name || "this guest"}`}>
                                                      <Phone className="w-4 h-4" />
                                                   </a>
                                                </Button>
                                             )}
                                          </div>
                                       </td>
                                    </motion.tr>
                                 ))
                              )}
                           </AnimatePresence>
                        </tbody>
                     </table>
                  </div>
               </Card>
            </div>

            {/* Right Sidebar */}
            <div className="lg:col-span-4 space-y-6">
               {/* Top Spenders List */}
               <Card className="rounded-[2.5rem] border-transparent shadow-xl bg-card/80 backdrop-blur-2xl ring-1 ring-border/50 p-6 overflow-hidden relative">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full -z-10" />

                  <div className="flex items-center justify-between mb-6">
                     <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                           <Award className="w-5 h-5" />
                        </div>
                        <div>
                           <h3 className="font-black text-foreground">Top Patrons</h3>
                           <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Highest LTV</p>
                        </div>
                     </div>
                  </div>

                  <div className="space-y-4">
                     {topCustomers.map((c, i) => (
                        <div key={c.id} className="flex items-center gap-4 p-3 rounded-2xl hover:bg-muted/50 transition-colors">
                           <div className="relative font-black text-2xl text-muted-foreground/30 w-6 text-center italic">
                              {i + 1}
                           </div>
                           <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
                              {c.avatar}
                           </div>
                           <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm text-foreground truncate">{c.name}</p>
                              <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{c.visits} orders</p>
                           </div>
                           <div className="text-right">
                              <p className="font-black text-primary text-sm">{c.spend}</p>
                           </div>
                        </div>
                     ))}
                  </div>
               </Card>

               {/* Loyalty & CRM Card */}
               <Card className="rounded-[2.5rem] border-none shadow-2xl bg-gradient-to-br from-[#1E293B] to-[#0F172A] text-white p-8 relative overflow-hidden group">
                  {/* Decorative Elements */}
                  <div className="absolute top-0 right-0 p-8 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 group-hover:rotate-12 transition-transform duration-500">
                     <Heart className="w-32 h-32" />
                  </div>
                  <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-primary/20 blur-3xl rounded-full" />

                  <div className="relative z-10">
                     <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-white/90 text-[10px] font-black uppercase tracking-widest mb-6 backdrop-blur-md">
                        <Heart className="w-3 h-3 fill-current text-rose-500" /> Loyalty Program
                     </div>

                     <h3 className="text-3xl font-black tracking-tight leading-none mb-3">Engage & Retain</h3>
                     <p className="text-sm text-white/60 font-medium leading-relaxed mb-8">
                        Your repeat customer rate is looking healthy. Launch a targeted campaign to convert more 'New' guests into 'Repeat' patrons.
                     </p>

                     <div className="space-y-3">

                     </div>
                  </div>
               </Card>
            </div>
         </div>
      </div>
   );
}
