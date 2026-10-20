import { useMemo, useState, useEffect } from "react";
import {
  Plus, Search, ChefHat, Grid, List, CheckSquare, Square, Power, PowerOff,
  Trash2, TrendingUp, Sparkles, Image as ImageIcon, Star,
  Loader2, Pencil
} from "lucide-react";
import { RecipeDialog } from "@/components/dashboard/RecipeDialog";
import { PageLoading } from "@/components/dashboard/PageLoading";
import { MenuItemDialog } from "@/components/dashboard/MenuItemDialog";
import { AiMenuImportDialog } from "@/components/dashboard/AiMenuImportDialog";
import { Timestamp, writeBatch } from "firebase/firestore";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/lib/currency";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, limit, orderBy } from "firebase/firestore";
import { toast } from "sonner";

type MenuItem = {
  id: string;
  name: string;
  image?: string;
  imageUrl?: string;
  price: number;
  category: string;
  tag: string;
  tags?: string[];
  allergens?: string[];
  stock: number;
  desc: string;
  prepTime: string;
  calories: string;
  isAvailable: boolean;
  isRecommended: boolean;
  variants: { name: string; price: number }[];
  addons: { name: string; price: number }[];
  rating: number;
  isFeatured?: boolean;
  isVeg?: boolean;
};

const defaultCategories = [
  { name: "Starters", icon: "🥗" },
  { name: "Soups", icon: "🍜" },
  { name: "Salads", icon: "🥬" },
  { name: "Main Course", icon: "🍲" },
  { name: "Breads", icon: "🫓" },
  { name: "Rice & Biryani", icon: "🍚" },
  { name: "Noodles & Pasta", icon: "🍝" },
  { name: "Seafood", icon: "🦐" },
  { name: "Grill & BBQ", icon: "🍖" },
  { name: "Combos", icon: "🍱" },
  { name: "Sides", icon: "🍟" },
  { name: "Beverages", icon: "🥤" },
  { name: "Desserts", icon: "🍰" },
];

export default function MenuPage() {
  const { user, activeRestaurantId, billingAccountId } = useAuth();
  const effectiveMenuId = activeRestaurantId;
  const { format } = useCurrency();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [filterVeg, setFilterVeg] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [bulkProgress, setBulkProgress] = useState<{current: number, total: number} | null>(null);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editItemOpen, setEditItemOpen] = useState(false);
  const [aiImportOpen, setAiImportOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [recipeItem, setRecipeItem] = useState<MenuItem | null>(null);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [recipeMap, setRecipeMap] = useState<Record<string, true>>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [orderCounts, setOrderCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user || !effectiveMenuId) return;
    const q = query(collection(db, "menu"), where("restaurantId", "==", effectiveMenuId));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const menuData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MenuItem));
        setItems(menuData);
        setLoading(false);
      },
      (err) => {
        console.error("Menu sync failed:", err);
        toast.error("Couldn't sync menu items.");
        setLoading(false);
      },
    );

    const qRecipes = query(collection(db, "recipes"), where("restaurantId", "==", effectiveMenuId), limit(1000));
    const unsubRecipes = onSnapshot(
      qRecipes,
      (snap) => {
        const map: Record<string, true> = {};
        for (const d of snap.docs) {
          const id = d.data().menuItemId as string | undefined;
          if (id) map[id] = true;
        }
        setRecipeMap(map);
      },
      () => setRecipeMap({}),
    );

    if (activeRestaurantId) {
      const sevenDaysAgo = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const qOrders = query(collection(db, "orders"), where("restaurantId", "==", activeRestaurantId), where("timestamp", ">=", sevenDaysAgo), orderBy("timestamp", "desc"), limit(2000));
      const unsubOrders = onSnapshot(
        qOrders,
        (snap) => {
          const counts: Record<string, number> = {};
          for (const d of snap.docs) {
            const items = (d.data().items || []) as Array<{ name?: string; quantity?: number }>;
            for (const it of items) {
              const key = (it.name || "").trim().toLowerCase();
              if (!key) continue;
              counts[key] = (counts[key] || 0) + (Number(it.quantity) || 1);
            }
          }
          setOrderCounts(counts);
        },
        () => setOrderCounts({}),
      );
      return () => { unsubscribe(); unsubRecipes(); unsubOrders(); };
    }
    return () => { unsubscribe(); unsubRecipes(); };
  }, [user, activeRestaurantId, effectiveMenuId]);

  const filtered = useMemo(() => items.filter((item) => {
    const matchCategory = activeCategory === "All" || item.category === activeCategory;
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase());
    const matchVeg = filterVeg === null || item.isVeg === filterVeg;
    return matchCategory && matchSearch && matchVeg;
  }), [items, activeCategory, search, filterVeg]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of items) {
      const k = it.category || "Uncategorized";
      map[k] = (map[k] || 0) + 1;
    }
    return map;
  }, [items]);

  const popularityFor = (name: string) => orderCounts[(name || "").trim().toLowerCase()] || 0;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());
  const selectAllVisible = () => setSelected(new Set(filtered.map((i) => i.id)));

  const bulkSetAvailability = async (next: boolean) => {
    if (selected.size === 0) return;
    try {
      const batch = writeBatch(db);
      for (const id of selected) batch.update(doc(db, "menu", id), { isAvailable: next });
      await batch.commit();
      toast.success(`${selected.size} items updated`);
      clearSelection();
    } catch (e: any) { toast.error(e?.message || "Update failed"); }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} items?`)) return;
    try {
      const batch = writeBatch(db);
      for (const id of selected) batch.delete(doc(db, "menu", id));
      await batch.commit();
      toast.success(`${selected.size} items deleted`);
      clearSelection();
    } catch (e: any) { toast.error(e?.message || "Delete failed"); }
  };

  const bulkOptimizeMenu = async () => {
    if (!confirm(`AI optimize all ${items.length} dishes?`)) return;
    setBulkProgress({ current: 0, total: items.length });
    const optimizeFn = httpsCallable(functions, "optimizeMenuItem");
    let successCount = 0;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const result = await optimizeFn({
          name: item.name,
          currentDesc: item.desc,
          category: item.category,
          price: item.price,
          variants: item.variants || [],
          addons: item.addons || [],
          restaurantId: effectiveMenuId,
        });
        const data = (result.data as any)?.result;
        if (data) {
          const newVariants = [...(item.variants || [])];
          if (data.variants && Array.isArray(data.variants)) {
            data.variants.forEach((v: any) => {
              if (!newVariants.find(existing => existing.name.toLowerCase() === v.name.toLowerCase())) {
                newVariants.push({ name: v.name, price: v.price || 0 });
              }
            });
          }
          const newAddons = [...(item.addons || [])];
          if (data.addons && Array.isArray(data.addons)) {
            data.addons.forEach((a: any) => {
              if (!newAddons.find(existing => existing.name.toLowerCase() === a.name.toLowerCase())) {
                newAddons.push({ name: a.name, price: a.price || 0 });
              }
            });
          }
          await updateDoc(doc(db, "menu", item.id), {
            name: data.optimizedName || item.name,
            desc: data.optimizedDescription || item.desc,
            isVeg: data.isVeg ?? item.isVeg,
            allergens: data.allergens || item.allergens || [],
            tags: data.dietaryTags || item.tags || [],
            variants: newVariants,
            addons: newAddons,
          });
          successCount++;
        }
      } catch (e) {
        // Ignore individual optimization error and proceed
      }
      setBulkProgress({ current: i + 1, total: items.length });
      await new Promise(res => setTimeout(res, 500));
    }
    setBulkProgress(null);
    toast.success(`Optimized ${successCount}/${items.length} items`);
  };

  const toggleAvailability = async (item: MenuItem) => {
    try { await updateDoc(doc(db, "menu", item.id), { isAvailable: !item.isAvailable }); }
    catch (e) { toast.error("Failed to update availability"); }
  };

  if (loading) return <PageLoading stats={3} chart={false} rows={8} />;

  return (
    <div className="space-y-8 pb-32">
      {/* Header & Stats */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
        <div className="space-y-4">
          <h1 className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">Menu Management</h1>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="bg-primary/10 text-primary border border-primary/20 px-4 py-2 rounded-2xl flex items-center gap-3">
              <span className="font-black text-xl leading-none">{items.length}</span>
              <span className="text-xs font-bold uppercase tracking-widest opacity-80">Total Dishes</span>
            </div>
            <div className="bg-amber-500/10 text-amber-600 border border-amber-500/20 px-4 py-2 rounded-2xl flex items-center gap-3">
              <span className="font-black text-xl leading-none">{Object.keys(recipeMap).length}</span>
              <span className="text-xs font-bold uppercase tracking-widest opacity-80">Recipes</span>
            </div>
            <div className="bg-destructive/10 text-destructive border border-destructive/20 px-4 py-2 rounded-2xl flex items-center gap-3">
              <span className="font-black text-xl leading-none">{items.filter(i => !i.isAvailable).length}</span>
              <span className="text-xs font-bold uppercase tracking-widest opacity-80">Out of Stock</span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" className="rounded-2xl font-bold border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-600 hover:bg-fuchsia-500/10 h-12 px-5 transition-transform hover:-translate-y-0.5" onClick={bulkOptimizeMenu} disabled={bulkProgress !== null}>
            {bulkProgress !== null ? (
              <span className="flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Optimizing... {Math.round((bulkProgress.current / bulkProgress.total) * 100)}%</span>
            ) : (
              <span className="flex items-center"><Sparkles className="w-4 h-4 mr-2" /> Bulk Optimize</span>
            )}
          </Button>
          <Button variant="outline" className="rounded-2xl font-bold border-violet-500/30 bg-violet-500/5 text-violet-600 hover:bg-violet-500/10 h-12 px-5 transition-transform hover:-translate-y-0.5" onClick={() => setAiImportOpen(true)} disabled={bulkProgress !== null}>
            <Sparkles className="w-4 h-4 mr-2" /> Import with AI
          </Button>
          <Button className="rounded-2xl font-black h-12 px-7 shadow-xl shadow-primary/25 bg-primary text-primary-foreground hover:scale-105 transition-all" onClick={() => { setEditingItem(null); setAddItemOpen(true); }}>
            <Plus className="w-5 h-5 mr-2" /> New Dish
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Animated Category Pills */}
        <LayoutGroup>
          <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
            {[{ name: "All", icon: "🍱" }, ...defaultCategories].map((cat) => {
              const count = cat.name === "All" ? items.length : (categoryCounts[cat.name] || 0);
              const active = activeCategory === cat.name;
              return (
                <button
                  key={cat.name}
                  onClick={() => setActiveCategory(cat.name)}
                  className={cn(
                    "relative px-5 py-3 rounded-2xl whitespace-nowrap transition-all flex items-center gap-2.5 outline-none",
                    active ? "text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="activeMenuCategory"
                      className="absolute inset-0 bg-primary rounded-2xl shadow-lg shadow-primary/25"
                      initial={false}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10 text-lg">{cat.icon}</span>
                  <span className={cn("relative z-10 font-bold text-sm tracking-tight", active && "text-primary-foreground")}>{cat.name}</span>
                  <span className={cn("relative z-10 text-[10px] font-black tabular-nums px-2 py-0.5 rounded-full min-w-[24px] text-center transition-colors", active ? "bg-white/20 text-white" : "bg-muted-foreground/10 text-muted-foreground")}>{count}</span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input placeholder="Search dishes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-12 h-14 text-base bg-card rounded-2xl border-border/40 font-bold focus:ring-primary shadow-sm" />
          </div>
          <div className="flex bg-card p-1.5 rounded-2xl border border-border/40 h-14 items-center gap-1 shadow-sm">
            <Button variant={filterVeg === null ? "secondary" : "ghost"} className="rounded-xl h-full font-black text-xs px-4" onClick={() => setFilterVeg(null)}>ALL</Button>
            <Button variant={filterVeg === true ? "outline" : "ghost"} className={cn("rounded-xl h-full font-black text-xs px-4", filterVeg === true && "bg-success/10 text-success border-success/30")} onClick={() => setFilterVeg(true)}>VEG</Button>
            <Button variant={filterVeg === false ? "outline" : "ghost"} className={cn("rounded-xl h-full font-black text-xs px-4", filterVeg === false && "bg-destructive/10 text-destructive border-destructive/30")} onClick={() => setFilterVeg(false)}>NON-VEG</Button>
          </div>
          <div className="flex bg-card p-1.5 rounded-2xl border border-border/40 h-14 items-center shadow-sm">
            <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" className="h-full w-12 rounded-xl" onClick={() => setViewMode("grid")}>
              <Grid className="h-5 w-5" />
            </Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" className="h-full w-12 rounded-xl" onClick={() => setViewMode("list")}>
              <List className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Empty State */}
        {filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-[2.5rem] border-2 border-dashed border-border/60 bg-card/40 p-20 text-center">
            <div className="mx-auto w-20 h-20 rounded-[2rem] bg-muted flex items-center justify-center mb-6">
              <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
            </div>
            <h3 className="text-2xl font-black tracking-tight mb-2">{items.length === 0 ? "Your menu is empty" : "No dishes found"}</h3>
            <p className="text-base font-medium text-muted-foreground mb-8 max-w-sm mx-auto">
              {items.length === 0 ? "Add your first delicious dish to get started." : "Try adjusting your search or category filters."}
            </p>
            {items.length === 0 ? (
              <Button className="rounded-2xl font-black h-14 px-8 shadow-xl shadow-primary/25 bg-primary text-primary-foreground text-base" onClick={() => setAddItemOpen(true)}>
                <Plus className="w-5 h-5 mr-2" /> Add First Dish
              </Button>
            ) : (
              <Button variant="outline" className="rounded-2xl font-bold h-12 px-6" onClick={() => { setActiveCategory("All"); setSearch(""); setFilterVeg(null); }}>
                Clear Filters
              </Button>
            )}
          </motion.div>
        ) : viewMode === "grid" ? (
          <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            <AnimatePresence mode="popLayout">
              {filtered.map(item => {
                const isSelected = selected.has(item.id);
                const orders7d = popularityFor(item.name);
                return (
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    key={item.id}
                    className={cn(
                      "group relative overflow-hidden rounded-[2rem] bg-card border transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5 hover:-translate-y-1",
                      isSelected ? "border-primary shadow-lg shadow-primary/10 ring-2 ring-primary/30" : "border-border/40"
                    )}
                  >
                    {/* Image Section */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                      {item.image || item.imageUrl ? (
                        <img loading="lazy" src={item.image || item.imageUrl} alt={item.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="h-12 w-12 text-muted-foreground/20" />
                        </div>
                      )}
                      
                      {/* Out of Stock Overlay */}
                      {!item.isAvailable && (
                        <div className="absolute inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-10">
                          <div className="bg-destructive text-destructive-foreground font-black text-xs uppercase tracking-widest px-4 py-2 rounded-xl rotate-[-12deg] shadow-2xl">
                            Sold Out
                          </div>
                        </div>
                      )}

                      {/* Top Badges */}
                      <div className="absolute top-3 left-3 right-3 flex justify-between items-start z-20">
                        <button
                          onClick={() => toggleSelect(item.id)}
                          className={cn(
                            "h-9 w-9 rounded-xl flex items-center justify-center transition-all shadow-sm backdrop-blur-md",
                            isSelected ? "bg-primary text-primary-foreground" : "bg-black/20 text-white hover:bg-black/40 border border-white/20"
                          )}
                        >
                          {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                        </button>
                        <div className="flex flex-col gap-1.5 items-end">
                          <Badge className={cn("text-[9px] font-black uppercase shadow-sm px-2 py-1", item.isVeg ? "bg-success text-success-foreground border-none" : "bg-destructive text-destructive-foreground border-none")}>{item.isVeg ? 'Veg' : 'Non-Veg'}</Badge>
                          {item.isRecommended && (
                            <Badge className="text-[9px] font-black uppercase bg-amber-500 text-white border-none gap-1 shadow-sm px-2 py-1">
                              <Star className="w-3 h-3 fill-current" /> Best
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Hover Actions Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 flex items-end justify-center pb-5 gap-3">
                        <Button variant="secondary" size="icon" title="Recipe" onClick={() => { setRecipeItem(item); setRecipeOpen(true); }} className={cn("h-12 w-12 rounded-xl shadow-xl transition-transform hover:scale-110 border-none", recipeMap[item.id] ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-white text-black hover:bg-white")}>
                          <ChefHat className="w-5 h-5" />
                        </Button>
                        <Button variant="secondary" size="icon" title="Edit" onClick={() => { setEditingItem(item); setEditItemOpen(true); }} className="h-12 w-12 rounded-xl shadow-xl transition-transform hover:scale-110 bg-white text-black hover:bg-white border-none">
                          <Pencil className="w-5 h-5" />
                        </Button>
                        <Button variant="destructive" size="icon" title="Delete" onClick={() => { if(confirm("Delete item?")) deleteDoc(doc(db, "menu", item.id)); }} className="h-12 w-12 rounded-xl shadow-xl transition-transform hover:scale-110 border-none">
                          <Trash2 className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>

                    {/* Content Section */}
                    <div className="p-5">
                      <div className="flex justify-between items-start mb-1">
                        <h3 className="text-lg font-black truncate leading-tight flex-1" title={item.name}>{item.name}</h3>
                        <p className="text-xl font-black text-primary ml-3">{format(item.price)}</p>
                      </div>
                      <p className="text-xs text-muted-foreground font-semibold truncate mb-4">{item.category}</p>
                      
                      <div className="flex items-center justify-between pt-4 border-t border-border/40">
                        {orders7d > 0 ? (
                          <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 px-2.5 py-1 rounded-lg">
                            <TrendingUp className="h-3.5 w-3.5" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">{orders7d} Sold</span>
                          </div>
                        ) : (
                          <div />
                        )}
                        
                        <button
                          onClick={() => toggleAvailability(item)}
                          role="switch"
                          aria-checked={item.isAvailable}
                          className={cn(
                            "relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            item.isAvailable ? "bg-success" : "bg-muted-foreground/30",
                          )}
                        >
                          <span className={cn(
                              "inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform",
                              item.isAvailable ? "translate-x-6" : "translate-x-1",
                            )}
                          />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        ) : (
          <div className="rounded-[2rem] border border-border/40 bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto w-full">
              <div className="min-w-[900px]">
                <div className="grid grid-cols-[48px_64px_2fr_1fr_120px_140px_160px] gap-4 px-6 py-4 border-b border-border/40 bg-muted/30 text-[10px] font-black uppercase tracking-widest text-muted-foreground items-center">
                  <span></span>
                  <span></span>
                  <span>Dish</span>
                  <span>Category</span>
                  <span>Price</span>
                  <span>7d Orders</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-border/40">
                  {filtered.map(item => {
                    const isSelected = selected.has(item.id);
                    const orders7d = popularityFor(item.name);
                    return (
                      <div key={item.id} className={cn("grid grid-cols-[48px_64px_2fr_1fr_120px_140px_160px] gap-4 px-6 py-3 items-center hover:bg-muted/30 transition-colors", isSelected && "bg-primary/5", !item.isAvailable && "opacity-70")}>
                        <button onClick={() => toggleSelect(item.id)} className="h-6 w-6 rounded-md bg-card border border-border/60 flex items-center justify-center hover:border-primary transition-colors">
                          {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground/40" />}
                        </button>
                        {(item.image || item.imageUrl) ? (
                          <div className="w-14 h-14 rounded-[1rem] overflow-hidden border border-border/50 shadow-sm">
                            <img loading="lazy" src={item.image || item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="w-14 h-14 rounded-[1rem] bg-muted flex items-center justify-center border border-border/50 shadow-sm">
                            <ImageIcon className="w-5 h-5 opacity-20" />
                          </div>
                        )}
                        <div className="min-w-0 pr-4">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-black truncate">{item.name}</h3>
                            <Badge className={cn("text-[9px] font-black uppercase shrink-0 px-1.5 py-0 h-4 border-none", item.isVeg ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive")}>{item.isVeg ? 'V' : 'NV'}</Badge>
                            {recipeMap[item.id] && <ChefHat className="h-3.5 w-3.5 text-primary" />}
                            {item.isRecommended && <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />}
                          </div>
                        </div>
                        <span className="text-sm font-bold text-muted-foreground truncate">{item.category}</span>
                        <span className="text-sm font-black text-primary">{format(item.price)}</span>
                        <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                          {orders7d > 0 ? (
                            <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-md">
                              <TrendingUp className="h-3 w-3" /> {orders7d}
                            </div>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </span>
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => toggleAvailability(item)} role="switch" aria-checked={item.isAvailable} className={cn("relative inline-flex h-6 w-10 items-center rounded-full transition-colors mr-2", item.isAvailable ? "bg-success" : "bg-muted-foreground/30")} title={item.isAvailable ? "Mark out of stock" : "Mark available"}>
                            <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform", item.isAvailable ? "translate-x-5" : "translate-x-1")} />
                          </button>
                          <Button variant="ghost" size="icon" title={recipeMap[item.id] ? "Edit recipe" : "Add recipe"} onClick={() => { setRecipeItem(item); setRecipeOpen(true); }} className={cn("h-9 w-9 rounded-xl transition-colors", recipeMap[item.id] ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-muted")}>
                            <ChefHat className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => { setEditingItem(item); setEditItemOpen(true); }} className="h-9 w-9 rounded-xl hover:bg-primary hover:text-primary-foreground transition-colors">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Delete" onClick={() => { if(confirm("Delete item?")) deleteDoc(doc(db, "menu", item.id)); }} className="h-9 w-9 rounded-xl hover:bg-destructive hover:text-destructive-foreground transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Bulk Action Bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-full border border-primary/30 bg-background/80 backdrop-blur-xl px-6 py-4 shadow-2xl shadow-primary/20"
          >
            <div className="flex items-center gap-3 border-r border-border/50 pr-4">
              <div className="bg-primary text-primary-foreground font-black text-sm w-8 h-8 rounded-full flex items-center justify-center">
                {selected.size}
              </div>
              <span className="text-sm font-black hidden sm:block">Selected</span>
            </div>
            
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="rounded-xl font-bold text-xs" onClick={selectAllVisible}>Select All</Button>
              <Button size="sm" variant="ghost" className="rounded-xl font-bold text-xs text-muted-foreground hover:text-foreground" onClick={clearSelection}>Clear</Button>
            </div>
            
            <div className="h-8 w-px bg-border/50 mx-2 hidden sm:block" />
            
            <div className="flex items-center gap-2">
              <Button size="sm" variant="default" className="rounded-xl font-bold bg-success hover:bg-success/90 text-success-foreground" onClick={() => bulkSetAvailability(true)}>
                <Power className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">In Stock</span>
              </Button>
              <Button size="sm" variant="secondary" className="rounded-xl font-bold" onClick={() => bulkSetAvailability(false)}>
                <PowerOff className="h-4 w-4 sm:mr-2 text-destructive" /> <span className="hidden sm:inline">Out of Stock</span>
              </Button>
              <Button size="sm" variant="destructive" className="rounded-xl font-bold" onClick={bulkDelete}>
                <Trash2 className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Delete</span>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <MenuItemDialog
        open={addItemOpen || editItemOpen}
        onOpenChange={(o) => {
          if (!o) { setAddItemOpen(false); setEditItemOpen(false); setEditingItem(null); }
        }}
        existing={editItemOpen ? (editingItem as any) : null}
        restaurantId={effectiveMenuId ?? ""}
        knownCategories={Array.from(new Set(items.map(i => i.category).filter(Boolean) as string[]))}
      />

      <AiMenuImportDialog
        open={aiImportOpen}
        onOpenChange={setAiImportOpen}
        restaurantId={effectiveMenuId ?? ""}
      />

      <RecipeDialog
        open={recipeOpen}
        onOpenChange={(o) => { setRecipeOpen(o); if (!o) setRecipeItem(null); }}
        menuItem={recipeItem ? { id: recipeItem.id, name: recipeItem.name, price: recipeItem.price } : null}
        restaurantId={effectiveMenuId ?? ""}
      />
    </div>
  );
}
