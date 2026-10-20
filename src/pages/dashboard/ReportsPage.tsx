import { useMemo, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  BarChart3, Calendar, Printer, FileDown, TrendingUp, TrendingDown,
  ShoppingBag, DollarSign, Percent, Receipt, Users, Loader2,
  FileText, LayoutGrid, Tag, CreditCard, Clock, Search, Grid3X3,
  Star, Zap, AlertTriangle, X, ChevronLeft, ChevronRight, Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/lib/currency";
import { PageLoading } from "@/components/dashboard/PageLoading";
import { db } from "@/lib/firebase";
import {
  collection, query, where, onSnapshot, Timestamp, orderBy, doc, getDoc,
} from "firebase/firestore";
import { toast } from "sonner";
import { FeatureGate } from "@/components/FeatureGate";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  ResponsiveContainer, AreaChart, Area, LineChart as RLineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, BarChart as RBarChart, Bar,
  PieChart, Pie, Cell, Legend,
} from "recharts";

// ─── Types ─────────────────────────────────────────────────────────────────────

type RangePreset = "today" | "yesterday" | "this_week" | "last_7_days" | "this_month" | "last_month" | "last_30_days" | "this_quarter" | "this_year" | "custom";

interface OrderItem {
  name?: string; title?: string; price?: number | string;
  qty?: number | string; quantity?: number | string;
  category?: string; tag?: string;
}

interface FirestoreOrder {
  restaurantId?: string; orderNumber?: string | number; table?: string | number;
  items?: OrderItem[]; subtotal?: number | string; tax?: number | string;
  discount?: number | string; total?: number | string; status?: string;
  paymentMethod?: string; payment?: string;
  timestamp?: Timestamp | { toDate: () => Date } | string | number;
  type?: string; channel?: string;
}

interface RestaurantProfile {
  name?: string; address?: string; phone?: string; gstin?: string;
}

interface DailyPoint {
  label: string; date: string; net: number; gross: number;
  orders: number; units: number; discount: number; tax: number; receipts: number;
}

interface HourlyPoint { hour: string; net: number; orders: number; }
interface HeatmapCell { hour: number; dow: number; orders: number; }

interface Agg {
  gross: number; net: number; receipts: number; orders: number;
  cancelledOrders: number; preparingOrders: number; readyOrders: number;
  units: number; discount: number; tax: number; aov: number;
  peakHour: number | null; daily: DailyPoint[]; hourly: HourlyPoint[];
  heatmap: HeatmapCell[];
  typeMix: Array<{ type: string; net: number; orders: number }>;
  paymentMix: Array<{ method: string; net: number; orders: number }>;
  statusMix: Array<{ status: string; count: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number; pct: number }>;
  categoryMix: Array<{ category: string; net: number; units: number; pct: number }>;
  staffPerf: Array<{ name: string; orders: number; revenue: number }>;
  tableMix: Array<{ table: string; net: number; orders: number; aov: number }>;
  dayPartMix: Array<{ slot: string; revenue: number; orders: number; pct: number }>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isCompletedStatus(s: unknown) { return ["completed","done","delivered","paid"].includes((s??"").toString().toLowerCase()); }
function isCancelledStatus(s: unknown) { return ["cancelled","canceled","void","voided"].includes((s??"").toString().toLowerCase()); }
function isPreparingStatus(s: unknown) { return ["preparing","in progress","in_progress","cooking"].includes((s??"").toString().toLowerCase()); }
function isReadyStatus(s: unknown) { return ["ready","ready to serve","ready_to_serve"].includes((s??"").toString().toLowerCase()); }

function asDate(ts: unknown): Date {
  if (!ts) return new Date(0);
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts === "object" && ts !== null && "toDate" in ts && typeof (ts as {toDate:unknown}).toDate === "function")
    return (ts as {toDate:()=>Date}).toDate();
  if (typeof ts === "string" || typeof ts === "number") return new Date(ts);
  return new Date(0);
}
function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function orderSubtotal(o: FirestoreOrder) {
  const subtotal = Number(o.subtotal);
  if (Number.isFinite(subtotal) && subtotal > 0) return subtotal;
  const total = Number(o.total) || Number((o as any).totalAmount) || 0;
  const tax = Number(o.tax) || 0;
  if (Number.isFinite(total) && total > 0) return Math.max(total - tax, 0);
  return total;
}
function orderTax(o: FirestoreOrder) {
  return Number(o.tax) || 0;
}
function orderDiscount(o: FirestoreOrder) {
  return Number(o.discount) || 0;
}
function orderTotal(o: FirestoreOrder) {
  const total = Number(o.total) || Number((o as any).totalAmount) || 0;
  if (Number.isFinite(total) && total > 0) return total;
  return orderSubtotal(o) + orderTax(o);
}
function pctChange(cur: number, prev: number) {
  if (!Number.isFinite(cur)) cur=0; if (!Number.isFinite(prev)) prev=0;
  if (prev===0) return cur===0?0:100;
  return ((cur-prev)/prev)*100;
}
function parseQty(q: unknown) {
  if (typeof q==="number"&&Number.isFinite(q)) return q;
  const n=parseInt((q??"1").toString(),10); return Number.isFinite(n)?n:1;
}
function normalizePayment(raw: unknown) {
  const s=(raw??"").toString().toLowerCase().trim();
  if (s==="upi") return "UPI"; if (s==="card"||s.includes("card")) return "Card";
  if (s==="cash") return "Cash"; if (s==="pending"||s==="pay later") return "Pay Later";
  return "Other";
}
function getDayPart(h: number) {
  if (h>=6&&h<12) return "Breakfast"; if (h>=12&&h<15) return "Lunch";
  if (h>=15&&h<18) return "Snacks"; if (h>=18&&h<23) return "Dinner";
  return "Late Night";
}
const DAY_PART_ORDER = ["Breakfast","Lunch","Snacks","Dinner","Late Night"];
const DAY_PART_COLORS: Record<string,string> = {
  "Breakfast":"hsl(43 96% 56%)","Lunch":"hsl(var(--primary))","Snacks":"hsl(280 84% 60%)",
  "Dinner":"hsl(350 89% 60%)","Late Night":"hsl(221 83% 53%)",
};

// ─── Aggregation ───────────────────────────────────────────────────────────────

function aggregateOrders(orders: FirestoreOrder[]): Agg {
  const completed = orders.filter(o=>isCompletedStatus(o.status));
  const cancelled = orders.filter(o=>isCancelledStatus(o.status));
  const preparing = orders.filter(o=>isPreparingStatus(o.status));
  const ready     = orders.filter(o=>isReadyStatus(o.status));

  let gross=0,tax=0,discount=0,net=0,receipts=0;
  completed.forEach(o=>{
    const oDisc=orderDiscount(o),oTax=orderTax(o),oSub=orderSubtotal(o);
    const oGross=oSub+oDisc,oNet=oGross-oDisc;
    gross+=oGross; discount+=oDisc; tax+=oTax; net+=oNet; receipts+=oNet+oTax;
  });

  const ordersCount=completed.length;
  const aov=ordersCount>0?receipts/ordersCount:0;
  const units=completed.reduce((acc,o)=>{
    return acc+(Array.isArray(o.items)?o.items:[]).reduce((s,it)=>s+parseQty(it?.quantity??it?.qty),0);
  },0);

  // Peak hour
  const hourCounts: Record<number,number>={};
  completed.forEach(o=>{ const h=asDate(o.timestamp).getHours(); hourCounts[h]=(hourCounts[h]||0)+1; });
  const peakEntry=Object.entries(hourCounts).sort((a,b)=>Number(b[1])-Number(a[1]))[0];
  const peakHour=peakEntry?parseInt(peakEntry[0],10):null;

  // Daily trend
  const dayMap=new Map<string,DailyPoint>();
  completed.forEach(o=>{
    const d=asDate(o.timestamp),key=toIsoDate(d);
    const v:DailyPoint=dayMap.get(key)??{date:key,label:key.slice(5),net:0,gross:0,orders:0,units:0,discount:0,tax:0,receipts:0};
    const oDisc=orderDiscount(o),oTax=orderTax(o),oGross=orderSubtotal(o)+oDisc,oNet=oGross-oDisc;
    v.gross+=oGross; v.discount+=oDisc; v.tax+=oTax; v.net+=oNet; v.receipts+=oNet+oTax; v.orders+=1;
    v.units+=(Array.isArray(o.items)?o.items:[]).reduce((s,it)=>s+parseQty(it?.quantity??it?.qty),0);
    dayMap.set(key,v);
  });
  const daily=Array.from(dayMap.values()).sort((a,b)=>a.date.localeCompare(b.date));

  // Hourly
  const hourlyMap=new Map<number,{net:number;orders:number}>();
  completed.forEach(o=>{
    const h=asDate(o.timestamp).getHours();
    const v=hourlyMap.get(h)??{net:0,orders:0};
    v.net+=orderSubtotal(o); v.orders+=1; hourlyMap.set(h,v);
  });
  const hourly:HourlyPoint[]=Array.from({length:24},(_,h)=>{
    const v=hourlyMap.get(h)??{net:0,orders:0};
    return {hour:`${String(h).padStart(2,"0")}:00`,net:v.net,orders:v.orders};
  });

  // Heatmap
  const heatmapMap=new Map<string,number>();
  orders.forEach(o=>{ const d=asDate(o.timestamp); heatmapMap.set(`${d.getHours()}-${d.getDay()}`,(heatmapMap.get(`${d.getHours()}-${d.getDay()}`)||0)+1); });
  const heatmap:HeatmapCell[]=[];
  for(let h=0;h<24;h++) for(let dow=0;dow<7;dow++) heatmap.push({hour:h,dow,orders:heatmapMap.get(`${h}-${dow}`)??0});

  // Type mix
  const typeAgg=new Map<string,{net:number;orders:number}>();
  completed.forEach(o=>{
    const raw=(o.type??o.channel??"unknown").toString().toLowerCase();
    const key=raw==="dine-in"||raw==="dinein"||raw==="dine_in"?"Dine-In":raw==="delivery"?"Delivery":raw==="takeaway"||raw==="pickup"?"Takeaway":"Other";
    const v=typeAgg.get(key)??{net:0,orders:0}; v.net+=orderSubtotal(o); v.orders+=1; typeAgg.set(key,v);
  });
  const typeMix=Array.from(typeAgg.entries()).map(([type,v])=>({type,net:v.net,orders:v.orders})).sort((a,b)=>b.net-a.net);

  // Payment mix
  const payAgg=new Map<string,{net:number;orders:number}>();
  completed.forEach(o=>{
    const method=normalizePayment(o.paymentMethod??o.payment);
    const v=payAgg.get(method)??{net:0,orders:0};
    v.net+=orderTotal(o); v.orders+=1; payAgg.set(method,v);
  });
  const paymentMix=Array.from(payAgg.entries()).map(([method,v])=>({method,net:v.net,orders:v.orders})).sort((a,b)=>b.net-a.net);

  // Status mix
  const statusMix=[
    {status:"Completed",count:completed.length},{status:"Preparing",count:preparing.length},
    {status:"Ready",count:ready.length},{status:"Cancelled",count:cancelled.length},
  ].filter(s=>s.count>0);

  // Items + categories
  const itemAgg=new Map<string,{qty:number;revenue:number}>();
  const catAgg=new Map<string,{net:number;units:number}>();
  completed.forEach(o=>{
    (Array.isArray(o.items)?o.items:[]).forEach(it=>{
      const name=(it?.name??it?.title??"Item").toString();
      const qty=parseQty(it?.quantity??it?.qty),price=Number(it?.price)||0;
      const cat=(it?.category??it?.tag??"Uncategorized").toString(),rev=qty*price;
      const pi=itemAgg.get(name)??{qty:0,revenue:0}; pi.qty+=qty; pi.revenue+=rev; itemAgg.set(name,pi);
      const pc=catAgg.get(cat)??{net:0,units:0}; pc.units+=qty; pc.net+=rev; catAgg.set(cat,pc);
    });
  });
  const totalItemRev=Array.from(itemAgg.values()).reduce((s,v)=>s+v.revenue,0);
  const topItems=Array.from(itemAgg.entries()).map(([name,v])=>({name,qty:v.qty,revenue:v.revenue,pct:totalItemRev>0?(v.revenue/totalItemRev)*100:0})).sort((a,b)=>b.revenue-a.revenue);
  const totalCatRev=Array.from(catAgg.values()).reduce((s,v)=>s+v.net,0);
  const categoryMix=Array.from(catAgg.entries()).map(([category,v])=>({category,net:v.net,units:v.units,pct:totalCatRev>0?(v.net/totalCatRev)*100:0})).sort((a,b)=>b.net-a.net);

  // Staff
  const staffMap=new Map<string,{orders:number;revenue:number}>();
  completed.forEach(o=>{
    const raw=(o as unknown as Record<string,unknown>)["staffName"]??(o as unknown as Record<string,unknown>)["server"]??(o as unknown as Record<string,unknown>)["waiter"];
    if(!raw) return;
    const v=staffMap.get(raw.toString())??{orders:0,revenue:0};
    v.orders+=1; v.revenue+=orderTotal(o); staffMap.set(raw.toString(),v);
  });
  const staffPerf=Array.from(staffMap.entries()).map(([name,v])=>({name,orders:v.orders,revenue:v.revenue})).sort((a,b)=>b.revenue-a.revenue);

  // Table mix
  const tableAgg=new Map<string,{net:number;orders:number}>();
  completed.forEach(o=>{
    const tbl=o.table!=null&&o.table!==""?`Table ${o.table}`:"Takeaway/Other";
    const v=tableAgg.get(tbl)??{net:0,orders:0};
    v.net+=orderTotal(o); v.orders+=1; tableAgg.set(tbl,v);
  });
  const tableMix=Array.from(tableAgg.entries()).map(([table,v])=>({table,net:v.net,orders:v.orders,aov:v.orders>0?v.net/v.orders:0})).sort((a,b)=>b.net-a.net);

  // Day-part
  const dpAgg=new Map<string,{revenue:number;orders:number}>();
  completed.forEach(o=>{
    const slot=getDayPart(asDate(o.timestamp).getHours());
    const v=dpAgg.get(slot)??{revenue:0,orders:0};
    v.revenue+=orderTotal(o); v.orders+=1; dpAgg.set(slot,v);
  });
  const dpTotal=Array.from(dpAgg.values()).reduce((s,v)=>s+v.revenue,0);
  const dayPartMix=DAY_PART_ORDER.filter(s=>dpAgg.has(s)).map(slot=>{
    const v=dpAgg.get(slot)!;
    return {slot,revenue:v.revenue,orders:v.orders,pct:dpTotal>0?(v.revenue/dpTotal)*100:0};
  });

  return {
    gross,net,receipts,orders:ordersCount,cancelledOrders:cancelled.length,
    preparingOrders:preparing.length,readyOrders:ready.length,
    units,discount,tax,aov,peakHour,daily,hourly,heatmap,
    typeMix,paymentMix,statusMix,topItems,categoryMix,staffPerf,tableMix,dayPartMix,
  };
}

// ─── Chart palette ─────────────────────────────────────────────────────────────
const PALETTE = ["hsl(var(--primary))","hsl(142 76% 36%)","hsl(43 96% 56%)","hsl(280 84% 60%)","hsl(221 83% 53%)","hsl(350 89% 60%)"];

// ─── KPI Card ──────────────────────────────────────────────────────────────────
interface KpiCardProps { label:string; value:string; sub?:string; pct?:number; icon:React.ReactNode; accent?:"default"|"green"|"red"|"amber"; delay?:number; }
function KpiCard({label,value,sub,pct,icon,accent="default",delay=0}:KpiCardProps) {
  const aMap={default:"bg-primary/5 text-primary border-primary/10",green:"bg-emerald-500/5 text-emerald-600 border-emerald-500/15",red:"bg-red-500/5 text-red-500 border-red-500/15",amber:"bg-amber-500/5 text-amber-600 border-amber-500/15"};
  const iMap={default:"bg-primary/10 text-primary",green:"bg-emerald-500/10 text-emerald-600",red:"bg-red-500/10 text-red-500",amber:"bg-amber-500/10 text-amber-600"};
  const tMap={default:"text-foreground",green:"text-emerald-600",red:"text-red-500",amber:"text-amber-600"};
  return (
    <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay,duration:0.35,ease:"easeOut"}} className={cn("rounded-2xl p-5 border backdrop-blur-xl",aMap[accent])}>
      <div className="flex items-start justify-between mb-3">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center",iMap[accent])}>{icon}</div>
        {pct!==undefined&&<span className={cn("flex items-center gap-0.5 text-[10px] font-bold rounded-full px-2 py-0.5",pct>=0?"bg-emerald-500/10 text-emerald-600":"bg-red-500/10 text-red-500")}>{pct>=0?<TrendingUp className="w-3 h-3"/>:<TrendingDown className="w-3 h-3"/>}{Math.abs(pct).toFixed(1)}%</span>}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-current opacity-50 mb-1">{label}</p>
      <p className={cn("text-2xl font-semibold leading-tight",tMap[accent])}>{value}</p>
      {sub&&<p className="text-[10px] font-semibold opacity-50 mt-1">{sub}</p>}
    </motion.div>
  );
}

// Chart tooltip
interface TTP { name:string; value:number; color?:string; }
function ChartTooltip({active,payload,label}:{active?:boolean;payload?:TTP[];label?:string}) {
  const { format } = useCurrency();
  if(!active||!payload?.length) return null;
  return (
    <div className="bg-card border border-border/40 rounded-xl p-3 shadow-xl text-xs font-semibold space-y-1">
      {label&&<p className="text-muted-foreground mb-1">{label}</p>}
      {payload.map((p,i)=><div key={i} className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{background:p.color??"hsl(var(--primary))"}}/><span className="text-muted-foreground">{p.name}:</span><span>{format(p.value)}</span></div>)}
    </div>
  );
}

// ─── Empty Agg ─────────────────────────────────────────────────────────────────
const EMPTY_AGG: Agg = {
  gross:0,net:0,receipts:0,orders:0,cancelledOrders:0,preparingOrders:0,readyOrders:0,
  units:0,discount:0,tax:0,aov:0,peakHour:null,daily:[],
  hourly:Array.from({length:24},(_,h)=>({hour:`${String(h).padStart(2,"0")}:00`,net:0,orders:0})),
  heatmap:[],typeMix:[],paymentMix:[],statusMix:[],topItems:[],categoryMix:[],staffPerf:[],tableMix:[],dayPartMix:[],
};

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { user, restaurantId , activeRestaurantId } = useAuth();
  const { format, symbol, taxLabel, isGST, locale } = useCurrency();
  const [agg,setAgg] = useState<Agg>(EMPTY_AGG);
  const [prevAgg,setPrevAgg] = useState<Agg>(EMPTY_AGG);
  const [loading,setLoading] = useState(true);
  const [restaurantProfile,setRestaurantProfile] = useState<RestaurantProfile>({});
  const [preset,setPreset] = useState<RangePreset>("today");
  const [customStart,setCustomStart] = useState(()=>toIsoDate(new Date()));
  const [customEnd,setCustomEnd] = useState(()=>toIsoDate(new Date()));
  const [customDialogOpen,setCustomDialogOpen] = useState(false);
  const [activeTab,setActiveTab] = useState("overview");
  const [rawOrders,setRawOrders] = useState<FirestoreOrder[]>([]);
  const [billSearch,setBillSearch] = useState("");
  const [billStatusFilter,setBillStatusFilter] = useState("all");

  const formatINR = (n: number) => format(Math.round(Number(n)||0));
  const formatINRCompact = (n: number) => {
    const v = Math.round(Number(n)||0);
    if (v >= 1_00_000) return `${symbol}${(v/1_00_000).toFixed(1)}L`;
    if (v >= 1_000) return `${symbol}${(v/1_000).toFixed(1)}k`;
    return `${symbol}${v}`;
  };

  const range = useMemo(()=>{
    const now=new Date(),start=new Date(now),end=new Date(now);
    start.setHours(0,0,0,0); end.setHours(0,0,0,0);
    if(preset==="today") return {start,end:new Date(start)};
    if(preset==="yesterday"){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1);return{start,end};}
    if(preset==="this_week"){start.setDate(start.getDate()-start.getDay());return{start,end};}
    if(preset==="last_7_days"){start.setDate(start.getDate()-6);return{start,end};}
    if(preset==="this_month"){start.setDate(1);return{start,end};}
    if(preset==="last_month"){start.setDate(1);start.setMonth(start.getMonth()-1);end.setDate(0);return{start,end};}
    if(preset==="last_30_days"){start.setDate(start.getDate()-29);return{start,end};}
    if(preset==="this_quarter"){const q=Math.floor(start.getMonth()/3);start.setMonth(q*3,1);return{start,end};}
    if(preset==="this_year"){start.setMonth(0,1);return{start,end};}
    const cs=new Date(customStart),ce=new Date(customEnd);
    cs.setHours(0,0,0,0);ce.setHours(0,0,0,0);
    if(isNaN(cs.getTime())||isNaN(ce.getTime())) return{start,end};
    return cs<=ce?{start:cs,end:ce}:{start:ce,end:cs};
  },[preset,customStart,customEnd]);

  const rangeLabel = useMemo(()=>{
    if(preset==="today") return "Today";
    if(preset==="yesterday") return "Yesterday";
    if(preset==="this_week") return "This Week";
    if(preset==="last_7_days") return "Last 7 Days";
    if(preset==="this_month") return "This Month";
    if(preset==="last_month") return "Last Month";
    if(preset==="last_30_days") return "Last 30 Days";
    if(preset==="this_quarter") return "This Quarter";
    if(preset==="this_year") return "This Year";
    return `${customStart} → ${customEnd}`;
  },[preset,customStart,customEnd]);

  useEffect(()=>{ if(!user) return; getDoc(doc(db,"restaurants",activeRestaurantId)).then(snap=>{if(snap.exists())setRestaurantProfile(snap.data() as RestaurantProfile);}).catch(()=>{}); },[user,activeRestaurantId]);

  useEffect(()=>{
    if(!user) return; setLoading(true);
    const endEx=new Date(range.end.getTime()+24*60*60*1000);
    const q=query(collection(db,"orders"),where("restaurantId","==",activeRestaurantId),where("timestamp",">=",Timestamp.fromDate(range.start)),where("timestamp","<",Timestamp.fromDate(endEx)),orderBy("timestamp","desc"));
    const unsub=onSnapshot(q,snapshot=>{const orders=snapshot.docs.map(d=>d.data() as FirestoreOrder);setRawOrders(orders);setAgg(aggregateOrders(orders));setLoading(false);},()=>{setLoading(false);toast.error("Failed to load report data");});
    return ()=>unsub();
  },[user,activeRestaurantId,range.start.getTime(),range.end.getTime()]);

  useEffect(()=>{
    if(!user) return;
    const periodMs=range.end.getTime()-range.start.getTime()+24*60*60*1000;
    const prevStart=new Date(range.start.getTime()-periodMs),prevEndEx=new Date(range.start.getTime());
    const q=query(collection(db,"orders"),where("restaurantId","==",activeRestaurantId),where("timestamp",">=",Timestamp.fromDate(prevStart)),where("timestamp","<",Timestamp.fromDate(prevEndEx)),orderBy("timestamp","desc"));
    const unsub=onSnapshot(q,snap=>{setPrevAgg(aggregateOrders(snap.docs.map(d=>d.data() as FirestoreOrder)));}, (err) => console.error("[ReportsPage] q listener failed", err));
    return ()=>unsub();
  },[user,activeRestaurantId,range.start.getTime(),range.end.getTime()]);

  // Menu Engineering
  const menuEngineering = useMemo(()=>{
    const items=[...agg.topItems];
    if(items.length<2) return items.map(it=>({...it,quadrant:"star" as "star"|"plowhorse"|"puzzle"|"dog"}));
    const byQty=[...items].sort((a,b)=>a.qty-b.qty),byRev=[...items].sort((a,b)=>a.revenue-b.revenue);
    const midQ=byQty[Math.floor(byQty.length/2)]?.qty??0,midR=byRev[Math.floor(byRev.length/2)]?.revenue??0;
    return items.map(it=>{
      const hp=it.qty>=midQ,hr=it.revenue>=midR;
      const quadrant: "star"|"plowhorse"|"puzzle"|"dog"=hp&&hr?"star":hp&&!hr?"plowhorse":!hp&&hr?"puzzle":"dog";
      return {...it,quadrant};
    });
  },[agg.topItems]);

  // Filtered bills
  const filteredBills = useMemo(()=>{
    return rawOrders.filter(o=>{
      const q=billSearch.toLowerCase();
      const ms=!q||String(o.orderNumber??"").toLowerCase().includes(q)||String(o.table??"").toLowerCase().includes(q)||String(o.total??"").includes(q);
      const mf=billStatusFilter==="all"||(o.status??"").toLowerCase()===billStatusFilter;
      return ms&&mf;
    });
  },[rawOrders,billSearch,billStatusFilter]);

  const handleExportCSV = useCallback(()=>{
    if(rawOrders.length===0){toast.error("No orders to export");return;}
    const hdr=["Order #","Table","Status","Payment","Type","Subtotal","Discount","Tax","Total","Date","Time"];
    const rows=rawOrders.map(o=>{const d=asDate(o.timestamp);return [o.orderNumber??"",o.table??"",o.status??"",o.paymentMethod??o.payment??"",o.type??"",orderSubtotal(o),orderDiscount(o),orderTax(o),orderTotal(o),toIsoDate(d),`${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`].join(",");});
    const csv=[hdr.join(","),...rows].join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const a=document.createElement("a");a.href=url;a.download=`KadaDine-Orders-${rangeLabel.replace(/\s+/g,"-")}.csv`;a.click();URL.revokeObjectURL(url);
    toast.success("CSV exported");
  },[rawOrders,rangeLabel]);

  const handleExportTax = useCallback(()=>{
    if(agg.tax===0){toast.error(`No ${taxLabel} data for this period`);return;}
    const hdr=isGST ? ["Date","Orders","Net Sales","CGST (50%)","SGST (50%)","Total Tax"] : ["Date","Orders","Net Sales","Total Tax"];
    const rows=agg.daily.map(d=>isGST ? [d.label,d.orders,Math.round(d.net),Math.round(d.tax/2),Math.round(d.tax/2),Math.round(d.tax)].join(",") : [d.label,d.orders,Math.round(d.net),Math.round(d.tax)].join(","));
    const csv=[hdr.join(","),...rows,isGST ? `TOTAL,${agg.orders},${Math.round(agg.net)},${Math.round(agg.tax/2)},${Math.round(agg.tax/2)},${Math.round(agg.tax)}` : `TOTAL,${agg.orders},${Math.round(agg.net)},${Math.round(agg.tax)}`].join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const a=document.createElement("a");a.href=url;a.download=`KadaDine-${taxLabel.replace(/\s+/g,"-")}-${rangeLabel.replace(/\s+/g,"-")}.csv`;a.click();URL.revokeObjectURL(url);
    toast.success(`${taxLabel} report exported`);
  },[agg,rangeLabel,taxLabel,isGST]);

  const printBill = useCallback((order: FirestoreOrder)=>{
    const d=asDate(order.timestamp);
    const items=(Array.isArray(order.items)?order.items:[]).map(it=>`<tr><td style="padding:4px 0">${it.name??it.title??"Item"}</td><td style="text-align:center;padding:4px 8px">${parseQty(it.quantity??it.qty)}</td><td style="text-align:right">${symbol}${Math.round((Number(it.price)||0)*parseQty(it.quantity??it.qty))}</td></tr>`).join("");
    const w=window.open("","_blank","width=400,height=600");if(!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Bill #${order.orderNumber}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:monospace;font-size:12px;padding:16px;max-width:320px}h2{font-size:16px;font-weight:bold;text-align:center;margin-bottom:4px}.meta{text-align:center;font-size:10px;color:#666;margin-bottom:12px}hr{border:1px dashed #ccc;margin:8px 0}table{width:100%}th{font-size:10px;text-transform:uppercase;color:#888;padding:4px 0;text-align:left}th:nth-child(2){text-align:center}th:last-child{text-align:right}.total-row td{font-weight:bold;padding-top:8px;border-top:1px solid #ccc}.footer{text-align:center;font-size:10px;color:#aaa;margin-top:12px}@media print{@page{margin:4mm}}</style></head><body>
<h2>${restaurantProfile.name||"Restaurant"}</h2><div class="meta">${restaurantProfile.address||""}<br/>Bill #${order.orderNumber||"—"} | Table: ${order.table||"—"}<br/>${d.toLocaleString(locale)}</div>
<hr/><table><thead><tr><th>Item</th><th>Qty</th><th>Amt</th></tr></thead><tbody>${items}</tbody></table><hr/>
<table><tr><td>Subtotal</td><td style="text-align:right">${symbol}${Math.round(Number(order.subtotal)||0)}</td></tr>${Number(order.discount)>0?`<tr><td>Discount</td><td style="text-align:right">-${symbol}${Math.round(Number(order.discount))}</td></tr>`:""}<tr><td>Tax</td><td style="text-align:right">${symbol}${Math.round(Number(order.tax)||0)}</td></tr><tr class="total-row"><td colspan="1">TOTAL</td><td style="text-align:right">${symbol}${Math.round(Number(order.total)||0)}</td></tr></table>
<hr/><p style="text-align:center;font-size:10px">Payment: ${order.paymentMethod??order.payment??"—"}</p>
<div class="footer">Thank you! Visit again<br/>Powered by KadaDine</div></body></html>`);
    w.document.close();setTimeout(()=>w.print(),400);
  },[restaurantProfile, locale]);

  const handlePrint = useCallback((autoPdf=false)=>{
    toast.info(autoPdf?"Preparing PDF…":"Opening print report…");
    const rName=restaurantProfile.name||"Restaurant";
    const rAddr=restaurantProfile.address||"";
    const rPhone=(restaurantProfile as RestaurantProfile & {phone?:string}).phone||"";
    // The restaurant doc no longer carries the login email (it is public); fall back to the signed-in account.
    const rEmail=(restaurantProfile as RestaurantProfile & {email?:string}).email||user?.email||"";
    const rGstin=restaurantProfile.gstin||"";
    const generated=new Date().toLocaleString(locale,{day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"});
    const reportId=`KD-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const inr=(n:number)=>`${symbol}${Math.round(n).toLocaleString(locale)}`;
    const pct=(n:number)=>`${n.toFixed(1)}%`;
    const isSingleDay=preset==="today"||preset==="yesterday";
    const dayCount=Math.round((range.end.getTime()-range.start.getTime())/(24*60*60*1000))+1;

    // Comparison
    const cmpReceipts=pctChange(agg.receipts,prevAgg.receipts);
    const cmpOrders=pctChange(agg.orders,prevAgg.orders);
    const cmpAov=pctChange(agg.aov,prevAgg.aov);
    const cmpDiscount=pctChange(agg.discount,prevAgg.discount);
    const arrow=(p:number)=>p>0?"▲":p<0?"▼":"●";
    const cmpColor=(p:number)=>p>0?"#10b981":p<0?"#ef4444":"#888";

    // Menu Engineering quadrant tally
    const meStars=menuEngineering.filter(m=>m.quadrant==="star").length;
    const mePlow=menuEngineering.filter(m=>m.quadrant==="plowhorse").length;
    const mePuz=menuEngineering.filter(m=>m.quadrant==="puzzle").length;
    const meDog=menuEngineering.filter(m=>m.quadrant==="dog").length;
    const meRow=(label:string,count:number,desc:string,color:string)=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:8px;vertical-align:middle"></span><strong>${label}</strong></td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center;font-weight:700">${count}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:#666;font-size:11px">${desc}</td></tr>`;

    // Hourly heatmap → top peak hours
    const peakHours=[...agg.heatmap].filter(c=>c.orders>0).sort((a,b)=>b.orders-a.orders).slice(0,5);
    const peakRows=peakHours.map(h=>{
      const dow=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][h.dow]||"—";
      const hr=`${String(h.hour).padStart(2,"0")}:00`;
      return `<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${dow} · ${hr}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${h.orders} orders</td></tr>`;
    }).join("");

    // Build all rows
    const topRows=agg.topItems.slice(0,20).map((it,i)=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:#888;font-size:11px">${i+1}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${it.name}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${it.qty}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(it.revenue)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#888;font-size:11px">${pct(it.pct)}</td></tr>`).join("");
    const statusRows=agg.statusMix.map(s=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600;text-transform:capitalize">${s.status}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${s.count}</td></tr>`).join("");
    const dailyShown=isSingleDay?agg.hourly:agg.daily.slice(-31);
    const trendRows=isSingleDay
      ? dailyShown.map(d=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${(d as {hour:string}).hour}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${d.orders}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right">${inr(d.net)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right">${inr(d.tax)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(d.receipts)}</td></tr>`).join("")
      : (agg.daily.slice(-31)).map(d=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${d.date}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${d.orders}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right">${inr(d.net)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right">${inr(d.tax)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(d.receipts)}</td></tr>`).join("");
    const payRows=agg.paymentMix.map(p=>{const tot=agg.paymentMix.reduce((s,x)=>s+x.net,0);const sh=tot>0?(p.net/tot)*100:0;return `<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600;text-transform:uppercase">${p.method}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${p.orders}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(p.net)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#888;font-size:11px">${pct(sh)}</td></tr>`;}).join("");
    const catRows=agg.categoryMix.map(c=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${c.category}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${c.units}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(c.net)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#888;font-size:11px">${pct(c.pct)}</td></tr>`).join("");
    const dpRows=agg.dayPartMix.map(d=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${d.slot}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${d.orders}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(d.revenue)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#888;font-size:11px">${pct(d.pct)}</td></tr>`).join("");
    const tblRows=agg.tableMix.slice(0,15).map(t=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${t.table}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${t.orders}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(t.net)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#888;font-size:11px">${inr(t.aov)}</td></tr>`).join("");
    const staffRows=(agg.staffPerf||[]).slice(0,10).map(s=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${s.name}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${s.orders}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(s.revenue)}</td></tr>`).join("");
    const meTopRows=menuEngineering.filter(m=>m.quadrant==="star").slice(0,8).map(m=>`<tr><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${m.name}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${m.qty}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(m.revenue)}</td></tr>`).join("");
    const meDogRows=menuEngineering.filter(m=>m.quadrant==="dog").slice(0,8).map(m=>`<tr><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">${m.name}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${m.qty}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(m.revenue)}</td></tr>`).join("");

    // Recent bills (last 25)
    const billRows=rawOrders.slice(0,25).map(o=>{
      const d=asDate(o.timestamp);
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">#${o.orderNumber||"—"}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${d.toLocaleDateString(locale,{day:"numeric",month:"short"})} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${o.table||"—"}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-transform:capitalize">${o.status||"—"}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(orderTotal(o))}</td></tr>`;
    }).join("");

    const w=window.open("","_blank","width=900,height=1200");
    if(!w){toast.error("Popup blocked. Allow popups and retry.");return;}

    const html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Sales Report — ${rName} — ${rangeLabel}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Outfit','Helvetica Neue',Arial,sans-serif;color:#0f172a;background:#fff;padding:32px 40px;font-size:12px;line-height:1.5}
.cover{padding:40px 0 24px;border-bottom:4px solid #0f172a;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.brand{font-size:32px;font-weight:900;letter-spacing:-1.5px;color:#0f172a}.brand span{color:#f97316}
.subtitle{font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.18em;margin-top:4px}
.biz{text-align:right;max-width:280px}
.biz-name{font-size:18px;font-weight:800;color:#0f172a}
.biz-meta{font-size:10px;color:#64748b;margin-top:2px;line-height:1.4}
.tag{display:inline-block;background:#0f172a;color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.15em;padding:3px 8px;border-radius:4px;margin-bottom:6px}
.period-card{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid #e2e8f0;border-radius:16px;padding:18px 24px;margin-bottom:24px}
.period-card .l{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#64748b}
.period-card .v{font-size:18px;font-weight:800;color:#0f172a;margin-top:2px}
.period-card .d{font-size:10px;color:#64748b;margin-top:2px}
.period-card .meta{text-align:right;font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.12em;line-height:1.5}
.pnl{border:2px solid #0f172a;border-radius:18px;padding:24px 28px;margin-bottom:24px;background:#fff}
.pnl-t{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#64748b;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #e2e8f0}
.pnl-r{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;font-weight:600;color:#334155}
.pnl-r.d{color:#ef4444}.pnl-r.a{color:#10b981}
.pnl-divider{height:1px;background:#e2e8f0;margin:8px 0}
.pnl-total{display:flex;justify-content:space-between;font-size:22px;font-weight:900;padding-top:14px;margin-top:6px;border-top:3px solid #0f172a;color:#0f172a}
.kg{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.kb{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px}
.kb.accent{background:linear-gradient(135deg,#fff7ed,#ffedd5);border-color:#fdba74}
.kb.warn{background:#fef2f2;border-color:#fca5a5}
.kl{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.15em;color:#64748b;margin-bottom:4px}
.kv{font-size:18px;font-weight:800;color:#0f172a}
.kc{font-size:10px;font-weight:700;margin-top:4px;display:flex;align-items:center;gap:4px}
.sh{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#0f172a;margin:24px 0 10px;padding-bottom:6px;border-bottom:2px solid #0f172a;display:flex;align-items:center;justify-content:space-between}
.sh .sh-num{background:#0f172a;color:#fff;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;margin-right:8px}
.sh-meta{font-size:9px;color:#94a3b8;font-weight:700;letter-spacing:.1em}
table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px}
thead th{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#64748b;padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:left;background:#f8fafc}
thead th:nth-child(n+3){text-align:right}
.toc{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 24px;margin-bottom:28px}
.toc-t{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;color:#64748b;margin-bottom:10px}
.toc-list{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 24px;font-size:11px;color:#334155}
.toc-list span{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dotted #cbd5e1}
.toc-list span b{color:#0f172a;font-weight:600}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:8px}
.note{background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:8px;margin:12px 0;font-size:11px;color:#78350f}
.legal{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-top:18px;font-size:10px;color:#64748b;line-height:1.6}
.rf{margin-top:36px;padding-top:14px;border-top:2px solid #0f172a;display:flex;justify-content:space-between;align-items:center}
.rf-l{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#0f172a}
.rf-r{font-size:9px;color:#94a3b8;font-weight:600;text-align:right}
.signs{display:grid;grid-template-columns:repeat(2,1fr);gap:48px;margin-top:36px;padding-top:24px}
.sigbox{border-top:1px solid #cbd5e1;padding-top:6px;text-align:center;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#64748b}
.page-break{page-break-before:always}
.avoid-break{page-break-inside:avoid}
@media print{
  body{padding:18px 24px}
  @page{margin:14mm 14mm 18mm 14mm;size:A4}
  @page{@bottom-center{content:"Page " counter(page) " of " counter(pages);font-family:'Outfit',sans-serif;font-size:9px;color:#94a3b8;letter-spacing:.1em}}
}
</style></head><body>

<!-- Cover -->
<div class="cover avoid-break">
  <div>
    <div class="brand">Kada<span>Dine</span></div>
    <div class="subtitle">Sales &amp; Analytics Report</div>
    <div style="margin-top:14px;display:inline-block;background:#0f172a;color:#fff;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;padding:5px 10px;border-radius:6px">${rangeLabel}</div>
  </div>
  <div class="biz">
    <span class="tag">Restaurant</span>
    <div class="biz-name">${rName}</div>
    ${rAddr?`<div class="biz-meta">${rAddr}</div>`:""}
    ${rPhone?`<div class="biz-meta">Phone: ${rPhone}</div>`:""}
    ${rEmail?`<div class="biz-meta">Email: ${rEmail}</div>`:""}
    ${isGST&&rGstin?`<div class="biz-meta"><strong>GSTIN:</strong> ${rGstin}</div>`:""}
  </div>
</div>

<!-- Period card -->
<div class="period-card avoid-break">
  <div>
    <div class="l">Reporting Period</div>
    <div class="v">${rangeLabel}</div>
    <div class="d">${range.start.toLocaleDateString(locale,{day:"numeric",month:"long",year:"numeric"})} → ${range.end.toLocaleDateString(locale,{day:"numeric",month:"long",year:"numeric"})} · ${dayCount} ${dayCount===1?"day":"days"}</div>
  </div>
  <div class="meta">
    <div>Report ID</div>
    <div style="color:#0f172a;font-size:11px;font-weight:800;letter-spacing:.05em;margin:2px 0 6px">${reportId}</div>
    <div>Generated</div>
    <div style="color:#0f172a;font-size:10px;font-weight:700">${generated}</div>
  </div>
</div>

<!-- Table of Contents -->
<div class="toc avoid-break">
  <div class="toc-t">Contents of this report</div>
  <div class="toc-list">
    <span><b>1. Profit &amp; Loss summary</b><span>P&amp;L</span></span>
    <span><b>2. Key performance indicators</b><span>KPI</span></span>
    <span><b>3. Period-over-period comparison</b><span>vs prev</span></span>
    <span><b>4. Day-part analysis</b><span>${agg.dayPartMix.length}</span></span>
    <span><b>5. Sales trend (daily/hourly)</b><span>${agg.daily.length||agg.hourly.length}</span></span>
    <span><b>6. Peak performance hours</b><span>${peakHours.length}</span></span>
    <span><b>7. Sales by category</b><span>${agg.categoryMix.length}</span></span>
    <span><b>8. Top selling items</b><span>${agg.topItems.length}</span></span>
    <span><b>9. Menu engineering matrix</b><span>${menuEngineering.length}</span></span>
    <span><b>10. Table performance</b><span>${agg.tableMix.length}</span></span>
    <span><b>11. Payment breakdown</b><span>${agg.paymentMix.length}</span></span>
    <span><b>12. ${taxLabel} summary ${isGST?"(CGST + SGST)":""}</b><span>${isGST?rGstin?"GSTIN":"—":""}</span></span>
    ${(agg.staffPerf||[]).length>0?`<span><b>13. Staff performance</b><span>${agg.staffPerf.length}</span></span>`:""}
    <span><b>14. Recent bills register</b><span>${Math.min(25,rawOrders.length)}</span></span>
    <span><b>15. Operational status</b><span>${agg.statusMix.length}</span></span>
  </div>
</div>

<!-- 1. P&L -->
<div class="pnl avoid-break">
  <div class="pnl-t">1 · Profit &amp; Loss summary</div>
  <div class="pnl-r"><span>Gross Sales (incl. discounts)</span><span>${inr(agg.gross)}</span></div>
  <div class="pnl-r d"><span>(–) Discounts &amp; Promotions</span><span>– ${inr(agg.discount)}</span></div>
  <div class="pnl-divider"></div>
  <div class="pnl-r"><span><b>Net Sales</b></span><span><b>${inr(agg.net)}</b></span></div>
  <div class="pnl-r a"><span>(+) ${taxLabel} Collected ${isGST?"(CGST + SGST)":""}</span><span>+ ${inr(agg.tax)}</span></div>
  <div class="pnl-total"><span>Total Receipts</span><span>${inr(agg.receipts)}</span></div>
</div>

<!-- 2. KPI grid -->
<div class="sh avoid-break"><span><span class="sh-num">2</span>Key performance indicators</span><span class="sh-meta">vs previous ${rangeLabel.toLowerCase()}</span></div>
<div class="kg avoid-break">
  <div class="kb"><div class="kl">Total Receipts</div><div class="kv">${inr(agg.receipts)}</div><div class="kc" style="color:${cmpColor(cmpReceipts)}">${arrow(cmpReceipts)} ${Math.abs(cmpReceipts)}% vs prev</div></div>
  <div class="kb"><div class="kl">Orders Completed</div><div class="kv">${agg.orders}</div><div class="kc" style="color:${cmpColor(cmpOrders)}">${arrow(cmpOrders)} ${Math.abs(cmpOrders)}% vs prev</div></div>
  <div class="kb"><div class="kl">Avg Order Value</div><div class="kv">${inr(agg.aov)}</div><div class="kc" style="color:${cmpColor(cmpAov)}">${arrow(cmpAov)} ${Math.abs(cmpAov)}% vs prev</div></div>
  <div class="kb"><div class="kl">Items Sold</div><div class="kv">${agg.units}</div><div class="kc" style="color:#64748b">${dayCount>0?(agg.units/dayCount).toFixed(1):"0"}/day avg</div></div>
  <div class="kb accent"><div class="kl">Discounts Given</div><div class="kv">${inr(agg.discount)}</div><div class="kc" style="color:${cmpColor(-cmpDiscount)}">${agg.gross>0?pct((agg.discount/agg.gross)*100):"0%"} of gross</div></div>
  <div class="kb"><div class="kl">${taxLabel} Collected</div><div class="kv">${inr(agg.tax)}</div><div class="kc" style="color:#64748b">${agg.net>0?pct((agg.tax/agg.net)*100):"0%"} eff. rate</div></div>
  <div class="kb warn"><div class="kl">Cancelled Orders</div><div class="kv" style="color:#ef4444">${agg.cancelledOrders}</div><div class="kc" style="color:#64748b">${(agg.orders+agg.cancelledOrders)>0?pct((agg.cancelledOrders/(agg.orders+agg.cancelledOrders))*100):"0%"} cancel rate</div></div>
  <div class="kb"><div class="kl">Best Hour</div><div class="kv">${peakHours[0]?`${String(peakHours[0].hour).padStart(2,"0")}:00`:"—"}</div><div class="kc" style="color:#64748b">${peakHours[0]?`${peakHours[0].orders} orders`:"No data"}</div></div>
</div>

<!-- 3. Comparison block -->
<div class="sh avoid-break"><span><span class="sh-num">3</span>Period-over-period comparison</span></div>
<table class="avoid-break"><thead><tr><th>Metric</th><th>This Period</th><th>Previous</th><th>Change</th></tr></thead><tbody>
  <tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">Receipts</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(agg.receipts)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#64748b">${inr(prevAgg.receipts)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:${cmpColor(cmpReceipts)}">${arrow(cmpReceipts)} ${Math.abs(cmpReceipts)}%</td></tr>
  <tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">Orders</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${agg.orders}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#64748b">${prevAgg.orders}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:${cmpColor(cmpOrders)}">${arrow(cmpOrders)} ${Math.abs(cmpOrders)}%</td></tr>
  <tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">Avg Order Value</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(agg.aov)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#64748b">${inr(prevAgg.aov)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:${cmpColor(cmpAov)}">${arrow(cmpAov)} ${Math.abs(cmpAov)}%</td></tr>
  <tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">Discounts</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(agg.discount)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#64748b">${inr(prevAgg.discount)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:${cmpColor(-cmpDiscount)}">${arrow(cmpDiscount)} ${Math.abs(cmpDiscount)}%</td></tr>
</tbody></table>

${agg.dayPartMix.length>0?`
<div class="sh avoid-break"><span><span class="sh-num">4</span>Day-part analysis</span><span class="sh-meta">When customers visit</span></div>
<table class="avoid-break"><thead><tr><th>Period</th><th></th><th>Orders</th><th>Revenue</th><th>Share</th></tr></thead><tbody>${dpRows}</tbody></table>`:""}

${dailyShown.length>0?`
<div class="sh"><span><span class="sh-num">5</span>${isSingleDay?"Hourly":"Daily"} sales trend</span><span class="sh-meta">${isSingleDay?agg.hourly.length:Math.min(31,agg.daily.length)} ${isSingleDay?"hours":"days"}</span></div>
<table><thead><tr><th>${isSingleDay?"Hour":"Date"}</th><th>Orders</th><th>Net</th><th>Tax</th><th>Receipts</th></tr></thead><tbody>${trendRows}</tbody></table>`:""}

${peakHours.length>0?`
<div class="sh avoid-break"><span><span class="sh-num">6</span>Peak performance hours</span><span class="sh-meta">Top 5 by volume</span></div>
<table class="avoid-break"><thead><tr><th>Day · Hour</th><th>Orders</th></tr></thead><tbody>${peakRows}</tbody></table>`:""}

${agg.categoryMix.length>0?`
<div class="sh avoid-break"><span><span class="sh-num">7</span>Sales by category</span></div>
<table class="avoid-break"><thead><tr><th>Category</th><th></th><th>Units</th><th>Revenue</th><th>Share</th></tr></thead><tbody>${catRows}</tbody></table>`:""}

${agg.topItems.length>0?`
<div class="sh"><span><span class="sh-num">8</span>Top selling items</span><span class="sh-meta">Top ${Math.min(20,agg.topItems.length)}</span></div>
<table><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Revenue</th><th>Share</th></tr></thead><tbody>${topRows}</tbody></table>`:""}

${menuEngineering.length>1?`
<div class="sh avoid-break"><span><span class="sh-num">9</span>Menu engineering matrix</span><span class="sh-meta">Boston-style classification</span></div>
<table class="avoid-break"><thead><tr><th>Quadrant</th><th>Items</th><th>Action</th></tr></thead><tbody>
  ${meRow("Stars",meStars,"High popularity + high profit. Promote &amp; protect.","#f59e0b")}
  ${meRow("Plowhorses",mePlow,"Popular but low margin. Re-cost or upsell sides.","#3b82f6")}
  ${meRow("Puzzles",mePuz,"Profitable but slow movers. Reposition on menu.","#8b5cf6")}
  ${meRow("Dogs",meDog,"Low pop &amp; low margin. Consider removing.","#ef4444")}
</tbody></table>
${(meTopRows||meDogRows)?`<div class="two-col"><div>${meTopRows?`<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#f59e0b;margin:8px 0 4px">★ Star items</div><table><thead><tr><th>Item</th><th>Qty</th><th>Revenue</th></tr></thead><tbody>${meTopRows}</tbody></table>`:""}</div><div>${meDogRows?`<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#ef4444;margin:8px 0 4px">⚠ Dog items</div><table><thead><tr><th>Item</th><th>Qty</th><th>Revenue</th></tr></thead><tbody>${meDogRows}</tbody></table>`:""}</div></div>`:""}`:""}

${agg.tableMix.length>0?`
<div class="sh avoid-break"><span><span class="sh-num">10</span>Table performance</span><span class="sh-meta">Top ${Math.min(15,agg.tableMix.length)}</span></div>
<table class="avoid-break"><thead><tr><th>Table</th><th></th><th>Orders</th><th>Revenue</th><th>Avg Bill</th></tr></thead><tbody>${tblRows}</tbody></table>`:""}

${agg.paymentMix.length>0?`
<div class="sh avoid-break"><span><span class="sh-num">11</span>Payment breakdown</span></div>
<table class="avoid-break"><thead><tr><th>Method</th><th></th><th>Orders</th><th>Amount</th><th>Share</th></tr></thead><tbody>${payRows}</tbody></table>`:""}

${agg.tax>0?`
<div class="sh avoid-break"><span><span class="sh-num">12</span>${taxLabel} summary</span><span class="sh-meta">${isGST?"CGST + SGST · Intrastate":"Tax collected"}</span></div>
<table class="avoid-break"><thead><tr><th>Component</th><th>Rate</th><th></th><th>Amount</th></tr></thead><tbody>
  ${isGST?`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">CGST</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:#64748b">50%</td><td></td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(agg.tax/2)}</td></tr>
  <tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600">SGST</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:#64748b">50%</td><td></td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">${inr(agg.tax/2)}</td></tr>`:""}
  <tr style="font-weight:800;background:#f8fafc"><td style="padding:7px 10px">Total Tax Collected</td><td colspan="2"></td><td style="padding:7px 10px;text-align:right;color:#0f172a">${inr(agg.tax)}</td></tr>
  <tr><td style="padding:7px 10px;color:#64748b" colspan="3">Net Taxable Amount</td><td style="padding:7px 10px;text-align:right;font-weight:700;color:#64748b">${inr(agg.net)}</td></tr>
</tbody></table>
${isGST?rGstin?`<div class="note"><strong>GSTIN:</strong> ${rGstin} · This summary may be used as supporting documentation for GSTR-1 filing. Verify item-level HSN codes separately.</div>`:`<div class="note"><strong>Note:</strong> GSTIN not configured. Add it in Settings → Restaurant Profile to include it on tax reports.</div>`:""}`:""}

${(agg.staffPerf||[]).length>0?`
<div class="sh avoid-break"><span><span class="sh-num">13</span>Staff performance</span><span class="sh-meta">Top ${Math.min(10,agg.staffPerf.length)}</span></div>
<table class="avoid-break"><thead><tr><th>Staff</th><th></th><th>Orders</th><th>Revenue</th></tr></thead><tbody>${staffRows}</tbody></table>`:""}

${rawOrders.length>0?`
<div class="sh page-break"><span><span class="sh-num">14</span>Recent bills register</span><span class="sh-meta">Last ${Math.min(25,rawOrders.length)}</span></div>
<table><thead><tr><th>Bill #</th><th>Date · Time</th><th>Table</th><th>Status</th><th>Amount</th></tr></thead><tbody>${billRows}</tbody></table>`:""}

${agg.statusMix.length>0?`
<div class="sh avoid-break"><span><span class="sh-num">15</span>Operational status</span></div>
<table class="avoid-break"><thead><tr><th>Status</th><th>Orders</th></tr></thead><tbody>${statusRows}</tbody></table>`:""}

<!-- Signatures -->
<div class="signs avoid-break">
  <div class="sigbox">Prepared by</div>
  <div class="sigbox">Authorised signatory</div>
</div>

<!-- Legal -->
<div class="legal avoid-break">
  <strong>Disclaimer:</strong> This is a system-generated report from KadaDine POS based on order data captured during the reporting period. All amounts are in ${symbol}. Cancelled and pending orders are excluded from sales totals unless explicitly noted. ${isGST?"Tax computations assume intrastate supply with equal CGST + SGST split; for interstate (IGST) transactions, refer to invoice-level details. ":""}This report is for the restaurant's internal record-keeping; for statutory filings, please reconcile with bank statements and accounting books.
</div>

<!-- Footer -->
<div class="rf">
  <div class="rf-l">Powered by KadaDine POS</div>
  <div class="rf-r">Report ID ${reportId} · Generated ${generated}<br/>${rName}${rGstin?` · GSTIN ${rGstin}`:""}</div>
</div>

<script>
(function(){
  function go(){ try{ window.focus(); window.print(); }catch(e){} }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function(){ setTimeout(go, 200); });
  } else {
    window.addEventListener('load', function(){ setTimeout(go, 500); });
  }
})();
</script>
</body></html>`;

    w.document.open();
    w.document.write(html);
    w.document.close();

    if (autoPdf) {
      setTimeout(()=>toast.success("In the print dialog, choose ‘Save as PDF’ as the destination."),800);
    }
  },[agg,prevAgg,range,rangeLabel,restaurantProfile,menuEngineering,rawOrders,preset]);

  const heatmapMax=useMemo(()=>Math.max(...agg.heatmap.map(c=>c.orders),1),[agg.heatmap]);
  const isEmpty=!loading&&agg.orders===0&&agg.cancelledOrders===0;
  const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const isSingleDay=preset==="today"||preset==="yesterday";
  const trendData=isSingleDay?agg.hourly:agg.daily;
  const trendKey=isSingleDay?"hour":"label";
  const PRESETS: Array<{key:RangePreset;label:string;group:"day"|"week"|"month"|"long"}> = [
    {key:"today",label:"Today",group:"day"},
    {key:"yesterday",label:"Yesterday",group:"day"},
    {key:"this_week",label:"This Week",group:"week"},
    {key:"last_7_days",label:"Last 7 Days",group:"week"},
    {key:"this_month",label:"This Month",group:"month"},
    {key:"last_month",label:"Last Month",group:"month"},
    {key:"last_30_days",label:"Last 30 Days",group:"month"},
    {key:"this_quarter",label:"This Quarter",group:"long"},
    {key:"this_year",label:"This Year",group:"long"},
  ];

  // Quick prev/next navigation - shifts custom range by current period length
  const shiftRange = useCallback((dir: -1 | 1)=>{
    const periodMs = range.end.getTime() - range.start.getTime() + 24*60*60*1000;
    const ns = new Date(range.start.getTime() + dir*periodMs);
    const ne = new Date(range.end.getTime() + dir*periodMs);
    setCustomStart(toIsoDate(ns));
    setCustomEnd(toIsoDate(ne));
    setPreset("custom");
  },[range.start,range.end]);

  // Format range as friendly label like "Mon, 1 Jan – Sun, 7 Jan 2026"
  const friendlyRange = useMemo(()=>{
    const opts:Intl.DateTimeFormatOptions={day:"numeric",month:"short"};
    const yr=range.end.getFullYear();
    const sameDay=toIsoDate(range.start)===toIsoDate(range.end);
    if(sameDay) return range.start.toLocaleDateString(locale,{weekday:"short",day:"numeric",month:"short",year:"numeric"});
    return `${range.start.toLocaleDateString(locale,opts)} – ${range.end.toLocaleDateString(locale,{...opts,year:"numeric"})}${range.start.getFullYear()!==yr?"":""}`;
  },[range.start,range.end,locale]);

  const dayCount = useMemo(()=>Math.round((range.end.getTime()-range.start.getTime())/(24*60*60*1000))+1,[range.start,range.end]);

  return (
    <FeatureGate capability="pnl_reports">
      <div className="space-y-6 pb-12">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                {restaurantId === "global" ? "All Outlets (Global)" : (restaurantProfile.name || "Reports")}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">Analytics, tax reports, menu engineering, bill register &amp; exports.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-xl h-9 gap-2 font-semibold text-xs" disabled={loading}>
                    <Download className="w-3.5 h-3.5"/>Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-xl">
                  <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Export this report</DropdownMenuLabel>
                  <DropdownMenuItem onClick={handleExportCSV} className="gap-2 cursor-pointer">
                    <FileDown className="w-4 h-4"/>
                    <div className="flex-1"><div className="font-semibold text-xs">CSV (raw orders)</div><div className="text-[10px] text-muted-foreground">For spreadsheets &amp; accounting</div></div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={()=>handlePrint(true)} className="gap-2 cursor-pointer">
                    <FileText className="w-4 h-4"/>
                    <div className="flex-1"><div className="font-semibold text-xs">PDF report</div><div className="text-[10px] text-muted-foreground">Professional, sharable summary</div></div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator/>
                  <DropdownMenuItem onClick={()=>handlePrint(false)} className="gap-2 cursor-pointer">
                    <Printer className="w-4 h-4"/>
                    <div className="flex-1"><div className="font-semibold text-xs">Print report</div><div className="text-[10px] text-muted-foreground">Open print dialog directly</div></div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" className="rounded-xl h-9 gap-2 font-semibold text-xs shadow-lg shadow-primary/20" onClick={()=>handlePrint(false)} disabled={loading}><Printer className="w-3.5 h-3.5"/>Print</Button>
            </div>
          </div>

          {/* ── Period selector (redesigned) ─────────────────────────── */}
          <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-xl overflow-hidden">
            {/* Hero row: current period + nav + action */}
            <div className="flex items-stretch border-b border-border/30">
              {/* Prev */}
              <button
                onClick={()=>shiftRange(-1)}
                title="Previous period"
                className="px-3 sm:px-4 flex items-center justify-center hover:bg-primary/5 transition-colors border-r border-border/30 group"
              >
                <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors"/>
              </button>

              {/* Center: live period summary */}
              <button
                onClick={()=>setCustomDialogOpen(true)}
                className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Calendar className="w-4 h-4 text-primary"/>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reporting period</p>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">{rangeLabel}</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground mt-0.5 truncate">{friendlyRange}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{dayCount} {dayCount===1?"day":"days"} · {toIsoDate(range.start)} → {toIsoDate(range.end)}</p>
                </div>
              </button>

              {/* Next */}
              <button
                onClick={()=>shiftRange(1)}
                title="Next period"
                className="px-3 sm:px-4 flex items-center justify-center hover:bg-primary/5 transition-colors border-l border-border/30 group"
              >
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors"/>
              </button>
            </div>

            {/* Quick presets, grouped */}
            <div className="p-3 sm:p-4 space-y-2.5">
              {(["day","week","month","long"] as const).map(group=>{
                const groupPresets = PRESETS.filter(p=>p.group===group);
                const groupLabel = {day:"Day",week:"Week",month:"Month",long:"Long range"}[group];
                return (
                  <div key={group} className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 w-20 shrink-0">{groupLabel}</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {groupPresets.map(p=>(
                        <button key={p.key} onClick={()=>setPreset(p.key)}
                          className={cn("h-7 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border",
                            preset===p.key
                              ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                              : "bg-muted/20 text-muted-foreground border-border/30 hover:border-primary/40 hover:text-foreground hover:bg-muted/40")}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* Custom row */}
              <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border/30 mt-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 w-20 shrink-0">Custom</span>
                <button onClick={()=>setCustomDialogOpen(true)}
                  className={cn("h-7 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border flex items-center gap-1.5",
                    preset==="custom"
                      ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                      : "bg-muted/20 text-muted-foreground border-border/30 hover:border-primary/40 hover:text-foreground hover:bg-muted/40")}>
                  <Calendar className="w-3 h-3"/>{preset==="custom"?`${customStart} → ${customEnd}`:"Pick dates…"}
                </button>
                {preset==="custom"&&(
                  <button onClick={()=>setPreset("today")} className="h-7 px-2.5 rounded-lg bg-muted/20 border border-border/30 flex items-center gap-1 hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-colors text-[10px] font-bold uppercase tracking-wider">
                    <X className="w-3 h-3"/>Reset
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Loading skeleton — mirrors the report layout that follows */}
        <AnimatePresence>{loading&&<motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="py-4"><PageLoading stats={4} chart={true} rows={6} /></motion.div>}</AnimatePresence>

        {/* Empty */}
        {!loading&&isEmpty&&(
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mb-4"><BarChart3 className="w-8 h-8 text-muted-foreground/40"/></div>
            <h3 className="text-base font-semibold mb-1">No data for this period</h3>
            <p className="text-sm text-muted-foreground max-w-xs">Try selecting a different date range above.</p>
          </motion.div>
        )}

        {/* Content */}
        {!loading&&(
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <KpiCard label="Total Revenue" value={formatINRCompact(agg.receipts)} sub={`Net: ${formatINR(agg.net)}`} pct={pctChange(agg.receipts,prevAgg.receipts)} icon={<DollarSign className="w-4 h-4"/>} accent="green" delay={0}/>
              <KpiCard label="Total Orders" value={agg.orders.toString()} sub={`${agg.units} items sold`} pct={pctChange(agg.orders,prevAgg.orders)} icon={<ShoppingBag className="w-4 h-4"/>} delay={0.05}/>
              <KpiCard label="Avg Order Value" value={formatINR(agg.aov)} sub="Per completed order" pct={pctChange(agg.aov,prevAgg.aov)} icon={<Receipt className="w-4 h-4"/>} delay={0.1}/>
              <KpiCard label="Discounts Given" value={formatINR(agg.discount)} sub={agg.gross>0?`${((agg.discount/agg.gross)*100).toFixed(1)}% of gross`:"No sales"} icon={<Percent className="w-4 h-4"/>} accent="amber" delay={0.15}/>
              <KpiCard label={`${taxLabel} Collected`} value={formatINR(agg.tax)} sub="Tax portion of receipts" icon={<Tag className="w-4 h-4"/>} delay={0.2}/>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-auto w-full sm:w-auto rounded-xl bg-muted/20 border border-border/30 p-1 flex overflow-x-auto gap-0.5">
                {[
                  {value:"overview",label:"Overview",icon:<LayoutGrid className="w-3 h-3"/>},
                  {value:"sales",label:"Sales",icon:<TrendingUp className="w-3 h-3"/>},
                  {value:"items",label:"Menu",icon:<Tag className="w-3 h-3"/>},
                  {value:"tables",label:"Tables",icon:<Grid3X3 className="w-3 h-3"/>},
                  {value:"gst",label:taxLabel,icon:<FileText className="w-3 h-3"/>},
                  {value:"bills",label:"Bills",icon:<Receipt className="w-3 h-3"/>},
                  {value:"staff",label:"Staff",icon:<Users className="w-3 h-3"/>},
                ].map(t=>(
                  <TabsTrigger key={t.value} value={t.value} className="rounded-lg text-[10px] font-bold uppercase tracking-widest px-3 h-8 gap-1.5 flex items-center whitespace-nowrap">
                    {t.icon}{t.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* ── OVERVIEW ─────────────────────────────────────────── */}
              <TabsContent value="overview" className="mt-4 space-y-4">
                <div className="grid xl:grid-cols-3 gap-4">
                  <Card className="xl:col-span-2 rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                    <CardHeader className="px-6 pt-6 pb-4">
                      <div className="flex items-center justify-between">
                        <div><CardTitle className="text-sm font-semibold">Revenue Trend</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">{isSingleDay?"Hourly":"Daily"} breakdown</CardDescription></div>
                        {agg.peakHour!==null&&<Badge variant="outline" className="text-[10px] font-bold gap-1 rounded-lg"><Clock className="w-3 h-3"/>Peak: {String(agg.peakHour).padStart(2,"0")}:00</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="px-2 pb-6">
                      <ResponsiveContainer width="100%" height={240}>
                        <AreaChart data={trendData} margin={{left:8,right:8}}>
                          <defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25}/><stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/></linearGradient></defs>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.07}/>
                          <XAxis dataKey={trendKey} tick={{fontSize:9,fontWeight:600}} tickLine={false} axisLine={false} interval={isSingleDay?3:"preserveStartEnd"}/>
                          <YAxis tick={{fontSize:9}} tickLine={false} axisLine={false} tickFormatter={(v:number)=>formatINRCompact(v)} width={52}/>
                          <Tooltip content={<ChartTooltip/>}/>
                          <Area type="monotone" dataKey="net" name="Revenue" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#rg)"/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                  <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                    <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Payment Methods</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">Tender breakdown</CardDescription></CardHeader>
                    <CardContent className="px-6 pb-6">
                      {agg.paymentMix.length===0?<div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40"><CreditCard className="w-8 h-8 mb-2"/><p className="text-xs">No payments</p></div>:(
                        <>
                          <ResponsiveContainer width="100%" height={160}>
                            <PieChart><Pie data={agg.paymentMix.map(p=>({name:p.method,value:p.net}))} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={3} strokeWidth={0}>{agg.paymentMix.map((_,i)=><Cell key={i} fill={PALETTE[i%PALETTE.length]}/>)}</Pie><Tooltip formatter={(v:unknown)=>formatINR(Number(v))} contentStyle={{borderRadius:12,border:"1px solid hsl(var(--border))",fontSize:11,fontWeight:600}}/></PieChart>
                          </ResponsiveContainer>
                          <div className="space-y-2 mt-2">
                            {agg.paymentMix.map((p,i)=>{const tot=agg.paymentMix.reduce((s,x)=>s+x.net,0),pct=tot>0?(p.net/tot)*100:0;return(<div key={p.method} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:PALETTE[i%PALETTE.length]}}/><span className="text-xs font-semibold flex-1">{p.method}</span><span className="text-[10px] text-muted-foreground font-bold">{pct.toFixed(0)}%</span><span className="text-xs font-bold">{formatINR(p.net)}</span></div>);})}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Day-Part Analysis */}
                {agg.dayPartMix.length>0&&(
                  <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                    <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Day-Part Analysis</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">Revenue by meal period</CardDescription></CardHeader>
                    <CardContent className="px-6 pb-6">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                        {DAY_PART_ORDER.map(slot=>{const d=agg.dayPartMix.find(x=>x.slot===slot);if(!d) return null;return(<div key={slot} className="rounded-xl p-4 border border-border/30 bg-muted/10 space-y-1"><p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{slot}</p><p className="text-lg font-bold">{formatINRCompact(d.revenue)}</p><p className="text-[10px] text-muted-foreground font-semibold">{d.orders} orders · {d.pct.toFixed(1)}%</p><div className="h-1.5 rounded-full bg-muted/30 overflow-hidden mt-2"><div className="h-full rounded-full" style={{width:`${d.pct}%`,background:DAY_PART_COLORS[slot]??"hsl(var(--primary))"}}/></div></div>);})}
                      </div>
                      <ResponsiveContainer width="100%" height={160}>
                        <RBarChart data={agg.dayPartMix} margin={{left:4,right:8}}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.07}/>
                          <XAxis dataKey="slot" tick={{fontSize:10,fontWeight:600}} tickLine={false} axisLine={false}/>
                          <YAxis tick={{fontSize:9}} tickLine={false} axisLine={false} tickFormatter={(v:number)=>formatINRCompact(v)} width={52}/>
                          <Tooltip formatter={(v:unknown)=>formatINR(Number(v))} contentStyle={{borderRadius:10,fontSize:11,fontWeight:600}}/>
                          <Bar dataKey="revenue" name="Revenue" radius={[6,6,0,0]}>{agg.dayPartMix.map((d,i)=><Cell key={i} fill={DAY_PART_COLORS[d.slot]??PALETTE[i%PALETTE.length]}/>)}</Bar>
                        </RBarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                <div className="grid xl:grid-cols-2 gap-4">
                  <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                    <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Order Status Summary</CardTitle></CardHeader>
                    <CardContent className="px-6 pb-6">
                      {agg.statusMix.length===0?<div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40"><ShoppingBag className="w-8 h-8 mb-2"/><p className="text-xs">No orders</p></div>:(
                        <div className="flex items-center gap-6">
                          <ResponsiveContainer width={160} height={160}><PieChart><Pie data={agg.statusMix} dataKey="count" nameKey="status" innerRadius={44} outerRadius={68} paddingAngle={3} strokeWidth={0}>{agg.statusMix.map((s,i)=>{const c:Record<string,string>={Completed:"hsl(142 76% 36%)",Preparing:"hsl(43 96% 56%)",Ready:"hsl(221 83% 53%)",Cancelled:"hsl(350 89% 60%)"};return<Cell key={i} fill={c[s.status]??PALETTE[i%PALETTE.length]}/>;})}</Pie><Tooltip contentStyle={{borderRadius:10,fontSize:11,fontWeight:600}}/></PieChart></ResponsiveContainer>
                          <div className="space-y-3 flex-1">{agg.statusMix.map(s=>{const tot=agg.statusMix.reduce((x,v)=>x+v.count,0),pct=tot>0?(s.count/tot)*100:0;const c:Record<string,string>={Completed:"text-emerald-600",Preparing:"text-amber-600",Ready:"text-blue-600",Cancelled:"text-red-500"};return(<div key={s.status}><div className="flex justify-between text-xs font-semibold mb-1"><span className={cn(c[s.status]??"text-foreground")}>{s.status}</span><span>{s.count} ({pct.toFixed(0)}%)</span></div><Progress value={pct} className="h-1.5"/></div>);})}</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                    <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Sales by Category</CardTitle></CardHeader>
                    <CardContent className="px-6 pb-6">
                      {agg.categoryMix.length===0?<div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40"><BarChart3 className="w-8 h-8 mb-2"/><p className="text-xs">No data</p></div>:(
                        <ResponsiveContainer width="100%" height={200}><RBarChart data={agg.categoryMix.slice(0,8)} layout="vertical" margin={{left:0,right:48}}><CartesianGrid strokeDasharray="3 3" opacity={0.07} horizontal={false}/><XAxis type="number" tick={{fontSize:9}} tickLine={false} axisLine={false} tickFormatter={(v:number)=>formatINRCompact(v)}/><YAxis type="category" dataKey="category" tick={{fontSize:10,fontWeight:600}} tickLine={false} axisLine={false} width={80}/><Tooltip formatter={(v:unknown)=>formatINR(Number(v))} contentStyle={{borderRadius:10,fontSize:11,fontWeight:600}}/><Bar dataKey="net" name="Revenue" fill="hsl(var(--primary))" radius={[0,6,6,0]}/></RBarChart></ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* ── SALES ─────────────────────────────────────────────── */}
              <TabsContent value="sales" className="mt-4 space-y-4">
                <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                  <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Revenue &amp; Orders Trend</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">{isSingleDay?"Hourly":"Daily"} — {rangeLabel}</CardDescription></CardHeader>
                  <CardContent className="px-2 pb-6">
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={trendData} margin={{left:8,right:8}}>
                        <defs><linearGradient id="ng" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/><stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/></linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.07}/>
                        <XAxis dataKey={trendKey} tick={{fontSize:9,fontWeight:600}} tickLine={false} axisLine={false} interval={isSingleDay?3:"preserveStartEnd"}/>
                        <YAxis yAxisId="rev" tick={{fontSize:9}} tickLine={false} axisLine={false} tickFormatter={(v:number)=>formatINRCompact(v)} width={52}/>
                        <YAxis yAxisId="ord" orientation="right" tick={{fontSize:9}} tickLine={false} axisLine={false} width={32}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Legend wrapperStyle={{fontSize:10,fontWeight:700,paddingTop:8}}/>
                        <Area yAxisId="rev" type="monotone" dataKey="net" name="Revenue" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#ng)"/>
                        <Line yAxisId="ord" type="monotone" dataKey="orders" name="Orders" stroke="hsl(142 76% 36%)" strokeWidth={2} dot={false}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Heatmap */}
                <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                  <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Busy Times Heatmap</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">Order volume by hour × day of week</CardDescription></CardHeader>
                  <CardContent className="px-6 pb-6 overflow-x-auto">
                    <div className="min-w-[520px]">
                      <div className="grid gap-0.5 mb-0.5" style={{gridTemplateColumns:"36px repeat(7,1fr)"}}><div/>{DOW.map(d=><div key={d} className="text-center text-[9px] font-bold text-muted-foreground uppercase tracking-wider py-1">{d}</div>)}</div>
                      {Array.from({length:24},(_,h)=>(
                        <div key={h} className="grid gap-0.5 mb-0.5" style={{gridTemplateColumns:"36px repeat(7,1fr)"}}>
                          <div className="text-[9px] font-bold text-muted-foreground flex items-center justify-end pr-1.5">{h%6===0?`${String(h).padStart(2,"0")}h`:""}</div>
                          {DOW.map((_,dow)=>{const cell=agg.heatmap.find(c=>c.hour===h&&c.dow===dow),count=cell?.orders??0,intensity=Math.min(count/heatmapMax,1);return<div key={dow} className="rounded-sm h-4 transition-colors cursor-default" style={{background:count===0?"hsl(var(--muted)/0.2)":`hsl(var(--primary) / ${0.1+intensity*0.85})`}} title={`${DOW[dow]} ${String(h).padStart(2,"0")}:00 — ${count} orders`}/>;})}</div>))}
                      <div className="flex items-center gap-2 mt-3"><span className="text-[9px] text-muted-foreground font-bold">Low</span><div className="flex gap-0.5">{[0.1,0.3,0.5,0.7,0.9].map(o=><div key={o} className="w-4 h-3 rounded-sm" style={{background:`hsl(var(--primary) / ${o})`}}/>)}</div><span className="text-[9px] text-muted-foreground font-bold">High</span></div>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid xl:grid-cols-2 gap-4">
                  <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl"><CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Order Channels</CardTitle></CardHeader><CardContent className="px-2 pb-6"><ResponsiveContainer width="100%" height={200}><RBarChart data={agg.typeMix} margin={{left:4,right:8}}><CartesianGrid strokeDasharray="3 3" opacity={0.07}/><XAxis dataKey="type" tick={{fontSize:10,fontWeight:600}} tickLine={false} axisLine={false}/><YAxis tick={{fontSize:9}} tickLine={false} axisLine={false} tickFormatter={(v:number)=>formatINRCompact(v)} width={48}/><Tooltip formatter={(v:unknown)=>formatINR(Number(v))} contentStyle={{borderRadius:10,fontSize:11,fontWeight:600}}/><Bar dataKey="net" name="Revenue" fill="hsl(var(--primary))" radius={[6,6,0,0]}/></RBarChart></ResponsiveContainer></CardContent></Card>
                  <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl"><CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Discount &amp; Void Analysis</CardTitle></CardHeader>
                    <CardContent className="px-6 pb-6 space-y-4">
                      <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-amber-500/5 border border-amber-500/15 p-4"><p className="text-[10px] font-bold uppercase text-amber-600/60 tracking-widest mb-1">Total Discounts</p><p className="text-xl font-semibold text-amber-600">{formatINR(agg.discount)}</p></div><div className="rounded-xl bg-red-500/5 border border-red-500/15 p-4"><p className="text-[10px] font-bold uppercase text-red-500/60 tracking-widest mb-1">Voided Orders</p><p className="text-xl font-semibold text-red-500">{agg.cancelledOrders}</p></div></div>
                      <div className="space-y-2"><div className="flex justify-between text-xs font-semibold"><span className="text-muted-foreground">Discount Rate</span><span>{agg.gross>0?`${((agg.discount/agg.gross)*100).toFixed(1)}%`:"—"}</span></div><Progress value={agg.gross>0?(agg.discount/agg.gross)*100:0} className="h-2"/><div className="flex justify-between text-xs font-semibold"><span className="text-muted-foreground">Void Rate</span><span>{agg.orders+agg.cancelledOrders>0?`${((agg.cancelledOrders/(agg.orders+agg.cancelledOrders))*100).toFixed(1)}%`:"—"}</span></div><Progress value={agg.orders+agg.cancelledOrders>0?(agg.cancelledOrders/(agg.orders+agg.cancelledOrders))*100:0} className="h-2"/></div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* ── MENU (ITEMS) ──────────────────────────────────────── */}
              <TabsContent value="items" className="mt-4 space-y-4">
                {menuEngineering.length>=2&&(
                  <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                    <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Menu Engineering Matrix</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">Stars · Plowhorses · Puzzles · Dogs</CardDescription></CardHeader>
                    <CardContent className="px-6 pb-6">
                      <div className="grid grid-cols-2 gap-3">
                        {(["star","puzzle","plowhorse","dog"] as const).map(q=>{
                          const config={star:{title:"Stars",sub:"High pop · High profit",bg:"bg-emerald-500/8 border-emerald-500/20",tc:"text-emerald-700",icon:<Star className="w-3.5 h-3.5"/>},puzzle:{title:"Puzzles",sub:"Low pop · High profit",bg:"bg-blue-500/8 border-blue-500/20",tc:"text-blue-700",icon:<Zap className="w-3.5 h-3.5"/>},plowhorse:{title:"Plowhorses",sub:"High pop · Low profit",bg:"bg-amber-500/8 border-amber-500/20",tc:"text-amber-700",icon:<TrendingUp className="w-3.5 h-3.5"/>},dog:{title:"Dogs",sub:"Low pop · Low profit",bg:"bg-red-500/8 border-red-500/20",tc:"text-red-600",icon:<AlertTriangle className="w-3.5 h-3.5"/>}}[q];
                          const items=menuEngineering.filter(x=>x.quadrant===q).slice(0,5);
                          return(
                            <div key={q} className={cn("rounded-xl border p-4 space-y-3",config.bg)}>
                              <div className="flex items-center gap-2"><span className={config.tc}>{config.icon}</span><div><p className={cn("text-xs font-bold",config.tc)}>{config.title}</p><p className="text-[9px] text-muted-foreground font-semibold">{config.sub}</p></div><span className={cn("ml-auto text-xs font-bold rounded-full px-2 py-0.5 bg-white/60",config.tc)}>{items.length}</span></div>
                              {items.length===0?<p className="text-[10px] text-muted-foreground italic">No items</p>:<div className="space-y-1.5">{items.map(it=><div key={it.name} className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-foreground truncate flex-1">{it.name}</span><span className="text-[10px] text-muted-foreground font-bold whitespace-nowrap">{formatINRCompact(it.revenue)}</span></div>)}</div>}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-3 font-semibold">★ Stars = promote heavily · Puzzles = improve visibility · Plowhorses = improve margin · Dogs = consider removing</p>
                    </CardContent>
                  </Card>
                )}
                <div className="grid xl:grid-cols-2 gap-4">
                  <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                    <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Top Selling Items</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">Ranked by revenue</CardDescription></CardHeader>
                    <CardContent className="px-0 pb-6">
                      {agg.topItems.length===0?<div className="flex flex-col items-center justify-center py-10 text-muted-foreground/40"><ShoppingBag className="w-8 h-8 mb-2"/><p className="text-xs">No items sold</p></div>:(
                        <div className="divide-y divide-border/30">
                          <div className="grid px-6 py-2" style={{gridTemplateColumns:"28px 1fr 56px 80px 56px"}}>{["#","Item","Qty","Revenue","Share"].map(h=><div key={h} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{h}</div>)}</div>
                          {agg.topItems.slice(0,15).map((it,idx)=>(
                            <motion.div key={it.name} initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{delay:idx*0.03}} className="grid items-center px-6 py-2.5 hover:bg-muted/10 transition-colors" style={{gridTemplateColumns:"28px 1fr 56px 80px 56px"}}>
                              <span className="text-[10px] font-bold text-muted-foreground">{idx+1}</span>
                              <div className="min-w-0"><p className="text-xs font-semibold truncate pr-2">{it.name}</p><div className="h-1 rounded-full mt-1 bg-primary/20 overflow-hidden" style={{width:"80%"}}><div className="h-full bg-primary rounded-full" style={{width:`${it.pct}%`}}/></div></div>
                              <span className="text-xs font-semibold text-muted-foreground">{it.qty}</span>
                              <span className="text-xs font-bold">{formatINR(it.revenue)}</span>
                              <span className="text-[10px] font-bold text-muted-foreground">{it.pct.toFixed(1)}%</span>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <div className="space-y-4">
                    <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                      <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Category Mix</CardTitle></CardHeader>
                      <CardContent className="px-6 pb-6">
                        {agg.categoryMix.length===0?<div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40"><BarChart3 className="w-8 h-8 mb-2"/><p className="text-xs">No data</p></div>:<div className="space-y-3">{agg.categoryMix.map((cat,i)=><div key={cat.category} className="space-y-1"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:PALETTE[i%PALETTE.length]}}/><span className="text-xs font-semibold">{cat.category}</span></div><div className="flex items-center gap-3"><span className="text-[10px] text-muted-foreground font-bold">{cat.units} units</span><span className="text-xs font-bold w-20 text-right">{formatINR(cat.net)}</span></div></div><Progress value={cat.pct} className="h-1.5"/></div>)}</div>}
                      </CardContent>
                    </Card>
                    <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl p-5">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-primary/5 border border-primary/10 p-3"><p className="text-[9px] font-bold uppercase tracking-widest text-primary/60 mb-1">Best Item</p><p className="text-xs font-bold truncate">{agg.topItems[0]?.name??"—"}</p><p className="text-[10px] text-muted-foreground font-semibold">{agg.topItems[0]?formatINR(agg.topItems[0].revenue):""}</p></div>
                        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-3"><p className="text-[9px] font-bold uppercase tracking-widest text-emerald-600/60 mb-1">Top Category</p><p className="text-xs font-bold truncate">{agg.categoryMix[0]?.category??"—"}</p><p className="text-[10px] text-muted-foreground font-semibold">{agg.categoryMix[0]?formatINR(agg.categoryMix[0].net):""}</p></div>
                        <div className="rounded-xl bg-muted/20 border border-border/30 p-3"><p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1">Items Sold</p><p className="text-xs font-bold">{agg.units.toLocaleString(locale)}</p></div>
                        <div className="rounded-xl bg-muted/20 border border-border/30 p-3"><p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1">Unique Items</p><p className="text-xs font-bold">{agg.topItems.length.toLocaleString(locale)}</p></div>
                      </div>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              {/* ── TABLES ───────────────────────────────────────────── */}
              <TabsContent value="tables" className="mt-4 space-y-4">
                {agg.tableMix.length===0?(
                  <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/40"><Grid3X3 className="w-10 h-10 mb-3"/><h4 className="text-sm font-semibold text-muted-foreground mb-1">No table data</h4><p className="text-xs text-center max-w-xs">Table performance appears when orders include a table number.</p></div>
                ):(
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {agg.tableMix.slice(0,3).map((t,i)=>(
                        <Card key={t.table} className={cn("rounded-2xl border",i===0?"bg-primary/5 border-primary/20":"border-border/30 bg-card/50 backdrop-blur-xl")}>
                          <CardContent className="p-5">
                            <div className="flex items-center justify-between mb-2"><span className={cn("text-[9px] font-bold uppercase tracking-widest",i===0?"text-primary":"text-muted-foreground")}>#{i+1} Best</span>{i===0&&<Star className="w-3.5 h-3.5 text-primary fill-primary"/>}</div>
                            <p className="text-sm font-bold">{t.table}</p>
                            <p className={cn("text-xl font-semibold",i===0?"text-primary":"text-foreground")}>{formatINRCompact(t.net)}</p>
                            <p className="text-[10px] text-muted-foreground font-semibold mt-1">{t.orders} orders · AOV {formatINR(t.aov)}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                      <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Revenue by Table</CardTitle></CardHeader>
                      <CardContent className="px-2 pb-6">
                        <ResponsiveContainer width="100%" height={Math.max(200,agg.tableMix.slice(0,12).length*36)}>
                          <RBarChart data={agg.tableMix.slice(0,12)} layout="vertical" margin={{left:8,right:60}}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.07} horizontal={false}/>
                            <XAxis type="number" tick={{fontSize:9}} tickLine={false} axisLine={false} tickFormatter={(v:number)=>formatINRCompact(v)}/>
                            <YAxis type="category" dataKey="table" tick={{fontSize:10,fontWeight:600}} tickLine={false} axisLine={false} width={80}/>
                            <Tooltip formatter={(v:unknown)=>formatINR(Number(v))} contentStyle={{borderRadius:10,fontSize:11,fontWeight:600}}/>
                            <Bar dataKey="net" name="Revenue" radius={[0,6,6,0]}>{agg.tableMix.slice(0,12).map((_,i)=><Cell key={i} fill={i===0?"hsl(var(--primary))":PALETTE[i%PALETTE.length]}/>)}</Bar>
                          </RBarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                    <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                      <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">All Tables</CardTitle></CardHeader>
                      <CardContent className="px-0 pb-6">
                        <div className="divide-y divide-border/30">
                          <div className="grid px-6 py-2" style={{gridTemplateColumns:"28px 1fr 72px 100px 100px"}}>{["#","Table","Orders","Revenue","Avg Bill"].map(h=><div key={h} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{h}</div>)}</div>
                          {agg.tableMix.map((t,idx)=>(
                            <motion.div key={t.table} initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{delay:idx*0.03}} className="grid items-center px-6 py-3 hover:bg-muted/10 transition-colors" style={{gridTemplateColumns:"28px 1fr 72px 100px 100px"}}>
                              <span className="text-[10px] font-bold text-muted-foreground">{idx+1}</span>
                              <span className="text-xs font-semibold">{t.table}</span>
                              <span className="text-xs font-semibold text-muted-foreground">{t.orders}</span>
                              <span className="text-xs font-bold">{formatINR(t.net)}</span>
                              <span className="text-xs text-muted-foreground font-semibold">{formatINR(t.aov)}</span>
                            </motion.div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </TabsContent>

              {/* ── TAX ──────────────────────────────────────────────── */}
              <TabsContent value="gst" className="mt-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    {label:"Total Tax Collected",value:formatINR(agg.tax),sub:isGST?"CGST + SGST":"Tax receipts",cls:"bg-emerald-500/5 border-emerald-500/20 text-emerald-700"},
                    ...(isGST ? [
                      {label:"CGST (50%)",value:formatINR(agg.tax/2),sub:"Central GST",cls:"bg-blue-500/5 border-blue-500/20 text-blue-700"},
                      {label:"SGST (50%)",value:formatINR(agg.tax/2),sub:"State GST",cls:"bg-purple-500/5 border-purple-500/20 text-purple-700"},
                    ] : []),
                    {label:"Net Sales (Ex-Tax)",value:formatINR(agg.net),sub:"Taxable turnover",cls:"bg-primary/5 border-primary/20 text-primary"},
                  ].map(c=><div key={c.label} className={cn("rounded-2xl border p-5",c.cls)}><p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-2">{c.label}</p><p className="text-2xl font-semibold">{c.value}</p><p className="text-[10px] opacity-60 font-semibold mt-1">{c.sub}</p></div>)}
                </div>
                {isGST&&restaurantProfile.gstin&&<div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-3 flex items-center gap-3"><FileText className="w-4 h-4 text-emerald-600 flex-shrink-0"/><div><p className="text-xs font-bold text-emerald-700">GSTIN: {restaurantProfile.gstin}</p><p className="text-[10px] text-emerald-600/70 font-semibold">Registered — eligible for GSTR-1 filing</p></div></div>}
                <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                  <CardHeader className="px-6 pt-6 pb-4">
                    <div className="flex items-center justify-between">
                      <div><CardTitle className="text-sm font-semibold">Daily {taxLabel} Breakdown</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">{isGST?"GSTR-1 ready · ":""}{rangeLabel}</CardDescription></div>
                      <Button size="sm" variant="outline" className="rounded-xl h-8 gap-1.5 text-xs font-semibold" onClick={handleExportTax}><FileDown className="w-3.5 h-3.5"/>Export {taxLabel} CSV</Button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-0 pb-6">
                    {agg.daily.length===0?<div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40"><FileText className="w-8 h-8 mb-2"/><p className="text-xs">No {taxLabel} data</p></div>:(
                      <div className="divide-y divide-border/30">
                        <div className="grid px-6 py-2" style={{gridTemplateColumns:isGST?"1fr 56px 100px 100px 100px 100px":"1fr 56px 100px 100px"}}>{(isGST?["Date","Orders","Net Sales","CGST","SGST","Total Tax"]:["Date","Orders","Net Sales","Total Tax"]).map(h=><div key={h} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{h}</div>)}</div>
                        {agg.daily.map((d,idx)=>(
                          <div key={d.date} className={cn("grid items-center px-6 py-3 hover:bg-muted/10 transition-colors",idx%2===0?"":"bg-muted/5")} style={{gridTemplateColumns:isGST?"1fr 56px 100px 100px 100px 100px":"1fr 56px 100px 100px"}}>
                            <span className="text-xs font-semibold">{d.date}</span>
                            <span className="text-xs text-muted-foreground font-semibold">{d.orders}</span>
                            <span className="text-xs font-bold">{formatINR(d.net)}</span>
                            {isGST && <span className="text-xs font-semibold text-blue-600">{formatINR(d.tax/2)}</span>}
                            {isGST && <span className="text-xs font-semibold text-purple-600">{formatINR(d.tax/2)}</span>}
                            <span className="text-xs font-bold text-emerald-600">{formatINR(d.tax)}</span>
                          </div>
                        ))}
                        <div className="grid items-center px-6 py-3 bg-muted/20 font-bold" style={{gridTemplateColumns:isGST?"1fr 56px 100px 100px 100px 100px":"1fr 56px 100px 100px"}}>
                          <span className="text-xs font-bold">TOTAL</span>
                          <span className="text-xs">{agg.orders}</span>
                          <span className="text-xs">{formatINR(agg.net)}</span>
                          {isGST && <span className="text-xs text-blue-600">{formatINR(agg.tax/2)}</span>}
                          {isGST && <span className="text-xs text-purple-600">{formatINR(agg.tax/2)}</span>}
                          <span className="text-xs text-emerald-600">{formatINR(agg.tax)}</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                {isGST && <p className="text-[10px] text-muted-foreground font-semibold px-1">ℹ️ GST split assumes intrastate (CGST 50% + SGST 50%). For interstate, full amount is IGST. Consult your CA for filing.</p>}
              </TabsContent>

              {/* ── BILLS REGISTER ───────────────────────────────────── */}
              <TabsContent value="bills" className="mt-4 space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/><Input placeholder="Search bill #, table, amount…" className="pl-9 h-10 rounded-xl text-xs font-semibold" value={billSearch} onChange={e=>setBillSearch(e.target.value)}/>{billSearch&&<button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={()=>setBillSearch("")}><X className="w-3.5 h-3.5 text-muted-foreground"/></button>}</div>
                  <div className="flex gap-2 flex-wrap">{["all","completed","cancelled","preparing"].map(s=><button key={s} onClick={()=>setBillStatusFilter(s)} className={cn("h-10 px-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border",billStatusFilter===s?"bg-primary text-primary-foreground border-primary":"bg-muted/30 text-muted-foreground border-border/40 hover:text-foreground")}>{s}</button>)}</div>
                </div>
                <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                  <CardHeader className="px-6 pt-6 pb-4">
                    <div className="flex items-center justify-between">
                      <div><CardTitle className="text-sm font-semibold">Bill Register</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">{filteredBills.length} of {rawOrders.length} bills · {rangeLabel}</CardDescription></div>
                      <Button size="sm" variant="outline" className="rounded-xl h-8 gap-1.5 text-xs font-semibold" onClick={handleExportCSV}><FileDown className="w-3.5 h-3.5"/>Export</Button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-0 pb-6 overflow-x-auto">
                    {filteredBills.length===0?<div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40"><Receipt className="w-8 h-8 mb-2"/><p className="text-xs">No bills found</p></div>:(
                      <div className="divide-y divide-border/30 min-w-[640px]">
                        <div className="grid px-6 py-2" style={{gridTemplateColumns:"80px 90px 110px 90px 80px 90px 40px"}}>{["Bill #","Table","Date/Time","Status","Payment","Amount",""].map(h=><div key={h} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">{h}</div>)}</div>
                        {filteredBills.slice(0,100).map((o,idx)=>{
                          const d=asDate(o.timestamp),status=(o.status??"").toLowerCase();
                          const sc=status==="completed"||status==="paid"?"text-emerald-600":status==="cancelled"||status==="canceled"?"text-red-500":"text-amber-600";
                          const sb=status==="completed"||status==="paid"?"bg-emerald-500/10":status==="cancelled"||status==="canceled"?"bg-red-500/10":"bg-amber-500/10";
                          return(
                            <motion.div key={idx} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:Math.min(idx*0.01,0.3)}} className="grid items-center px-6 py-2.5 hover:bg-muted/10 transition-colors" style={{gridTemplateColumns:"80px 90px 110px 90px 80px 90px 40px"}}>
                              <span className="text-xs font-bold text-primary">#{o.orderNumber??idx+1}</span>
                              <span className="text-xs font-semibold text-muted-foreground">{o.table ? (/^\d+$/.test(String(o.table)) ? `T${o.table}` : o.table) : "—"}</span>
                              <div><p className="text-[10px] font-semibold">{d.toLocaleDateString(locale,{day:"numeric",month:"short"})}</p><p className="text-[9px] text-muted-foreground">{d.toLocaleTimeString(locale,{hour:"2-digit",minute:"2-digit"})}</p></div>
                              <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full",sc,sb)}>{(o.status??"pending").charAt(0).toUpperCase()+(o.status??"pending").slice(1)}</span>
                              <span className="text-[10px] font-semibold text-muted-foreground">{normalizePayment(o.paymentMethod??o.payment)}</span>
                              <span className="text-xs font-bold">{formatINR(orderTotal(o))}</span>
                              <button onClick={()=>printBill(o)} title="Print bill" className="w-7 h-7 rounded-lg bg-muted/20 hover:bg-primary/10 hover:text-primary flex items-center justify-center transition-colors"><Printer className="w-3 h-3"/></button>
                            </motion.div>
                          );
                        })}
                        {filteredBills.length>100&&<p className="text-center text-[10px] text-muted-foreground font-semibold py-3">Showing 100 of {filteredBills.length} bills. Export CSV for full data.</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── STAFF ─────────────────────────────────────────────── */}
              <TabsContent value="staff" className="mt-4">
                <Card className="rounded-2xl border-border/30 bg-card/50 backdrop-blur-xl">
                  <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="text-sm font-semibold">Staff Performance</CardTitle><CardDescription className="text-[10px] uppercase font-bold tracking-widest opacity-50 mt-0.5">Orders handled and revenue managed</CardDescription></CardHeader>
                  <CardContent className="px-0 pb-6">
                    {agg.staffPerf.length===0?(
                      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/40 px-6"><Users className="w-10 h-10 mb-3"/><h4 className="text-sm font-semibold text-muted-foreground mb-1">No staff data</h4><p className="text-xs text-center max-w-xs">Staff performance appears when orders include a <code className="text-[10px] font-bold">staffName</code> or <code className="text-[10px] font-bold">server</code> field.</p></div>
                    ):(
                      <div className="divide-y divide-border/30">
                        <div className="grid px-6 py-2" style={{gridTemplateColumns:"28px 1fr 80px 100px 100px"}}>{["#","Name","Orders","Revenue","Avg/Order"].map(h=><div key={h} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{h}</div>)}</div>
                        {agg.staffPerf.map((s,idx)=>(
                          <motion.div key={s.name} initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{delay:idx*0.04}} className="grid items-center px-6 py-3 hover:bg-muted/10 transition-colors" style={{gridTemplateColumns:"28px 1fr 80px 100px 100px"}}>
                            <span className="text-[10px] font-bold text-muted-foreground">{idx+1}</span>
                            <div className="flex items-center gap-2.5"><div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">{s.name.charAt(0).toUpperCase()}</div><span className="text-xs font-semibold truncate">{s.name}</span></div>
                            <span className="text-xs font-semibold text-muted-foreground">{s.orders}</span>
                            <span className="text-xs font-bold">{formatINR(s.revenue)}</span>
                            <span className="text-xs font-semibold text-muted-foreground">{s.orders>0?formatINR(s.revenue/s.orders):"—"}</span>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Custom date dialog */}
        <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
          <DialogContent className="rounded-2xl max-w-md">
            <DialogHeader>
              <DialogTitle className="font-semibold text-base flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary"/>Custom Date Range
              </DialogTitle>
              <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-50">Pick a start and end date for your report.</DialogDescription>
            </DialogHeader>

            {/* Quick shortcuts */}
            <div className="flex flex-wrap gap-1.5 pt-2 pb-1">
              {[
                {label:"Last 7 days",fn:()=>{const e=new Date();const s=new Date();s.setDate(s.getDate()-6);setCustomStart(toIsoDate(s));setCustomEnd(toIsoDate(e));}},
                {label:"Last 14 days",fn:()=>{const e=new Date();const s=new Date();s.setDate(s.getDate()-13);setCustomStart(toIsoDate(s));setCustomEnd(toIsoDate(e));}},
                {label:"Last 30 days",fn:()=>{const e=new Date();const s=new Date();s.setDate(s.getDate()-29);setCustomStart(toIsoDate(s));setCustomEnd(toIsoDate(e));}},
                {label:"Last 90 days",fn:()=>{const e=new Date();const s=new Date();s.setDate(s.getDate()-89);setCustomStart(toIsoDate(s));setCustomEnd(toIsoDate(e));}},
                {label:"This month",fn:()=>{const e=new Date();const s=new Date();s.setDate(1);setCustomStart(toIsoDate(s));setCustomEnd(toIsoDate(e));}},
                {label:"Last month",fn:()=>{const s=new Date();s.setDate(1);s.setMonth(s.getMonth()-1);const e=new Date();e.setDate(0);setCustomStart(toIsoDate(s));setCustomEnd(toIsoDate(e));}},
                {label:"This year",fn:()=>{const s=new Date(new Date().getFullYear(),0,1);setCustomStart(toIsoDate(s));setCustomEnd(toIsoDate(new Date()));}},
              ].map(s=>(
                <button key={s.label} onClick={s.fn} className="h-7 px-2.5 rounded-md bg-muted/30 border border-border/30 hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-colors text-[10px] font-bold uppercase tracking-wider">{s.label}</button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">From</p>
                <Input type="date" value={customStart} max={customEnd||toIsoDate(new Date())} onChange={e=>setCustomStart(e.target.value)} className="h-11 rounded-xl font-semibold text-xs"/>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">To</p>
                <Input type="date" value={customEnd} min={customStart} max={toIsoDate(new Date())} onChange={e=>setCustomEnd(e.target.value)} className="h-11 rounded-xl font-semibold text-xs"/>
              </div>
            </div>

            {/* Live summary */}
            {customStart && customEnd && (
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-2 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-primary shrink-0"/>
                <p className="text-[11px] font-semibold text-foreground">
                  {(()=>{const s=new Date(customStart),e=new Date(customEnd);const days=Math.round((e.getTime()-s.getTime())/(24*60*60*1000))+1;return `${days} ${days===1?"day":"days"} selected`;})()}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button variant="outline" className="flex-1 rounded-xl font-bold text-xs h-10" onClick={()=>setCustomDialogOpen(false)}>Cancel</Button>
              <Button
                className="flex-1 rounded-xl font-bold text-xs h-10"
                disabled={!customStart||!customEnd||new Date(customStart)>new Date(customEnd)}
                onClick={()=>{setPreset("custom");setCustomDialogOpen(false);toast.success("Custom range applied");}}
              >Apply Range</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </FeatureGate>
  );
}
