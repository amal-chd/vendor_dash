import { useEffect, useState } from "react";
import {
  Plus, Trash2, Loader2, ImageIcon, Tag, Settings, Layers, Puzzle, Star, AlertCircle, Sparkles, X, Info
} from "lucide-react";
import { toast } from "sonner";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage, functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import { motion, AnimatePresence } from "framer-motion";

export type MenuItem = {
  id?: string; name: string; image?: string; imageUrl?: string; price: number; category: string; desc?: string;
  prepTime?: string; calories?: string; isAvailable?: boolean; isRecommended?: boolean; isVeg?: boolean;
  variants?: { name: string; price: number; isDefault?: boolean }[];
  addons?: { name: string; price: number }[];
  variantGroupRequired?: boolean; addonsMin?: number; addonsMax?: number;
  spiceLevel?: "none" | "mild" | "medium" | "hot" | "extra-hot";
  tags?: string[]; allergens?: string[]; gstRate?: number;
  channels?: { dineIn?: boolean; qr?: boolean; swiggy?: boolean; zomato?: boolean }; displayOrder?: number;
};

const DEFAULT_CATEGORIES = ["Starters", "Soups", "Salads", "Main Course", "Breads", "Rice & Biryani", "Noodles & Pasta", "Seafood", "Grill & BBQ", "Combos", "Sides", "Beverages", "Desserts"];
const TAG_OPTIONS = ["bestseller", "new", "chef-special", "must-try", "popular", "jain", "gluten-free", "low-cal", "high-protein", "vegan", "eggless"];
const ALLERGEN_OPTIONS = ["nuts", "peanuts", "dairy", "eggs", "gluten", "soy", "fish", "shellfish", "sesame", "mustard"];
const SPICE_LABELS: Record<NonNullable<MenuItem["spiceLevel"]>, string> = { none: "Not spicy", mild: "Mild 🌶", medium: "Medium 🌶🌶", hot: "Hot 🌶🌶🌶", "extra-hot": "Extra hot 🌶🌶🌶🌶" };

interface Props { open: boolean; onOpenChange: (open: boolean) => void; existing?: MenuItem | null; restaurantId: string; knownCategories?: string[]; }
const emptyItem: MenuItem = { name: "", price: 0, category: "Main Course", desc: "", prepTime: "15 min", calories: "", isAvailable: true, isRecommended: false, isVeg: true, variants: [], addons: [], variantGroupRequired: false, addonsMin: 0, addonsMax: 0, spiceLevel: "none", tags: [], allergens: [], gstRate: 5, channels: { dineIn: true, qr: true, swiggy: false, zomato: false }, displayOrder: 0 };

export function MenuItemDialog({ open, onOpenChange, existing, restaurantId, knownCategories }: Props) {
  const { symbol } = useCurrency();
  const [form, setForm] = useState<MenuItem>(emptyItem);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const isEdit = !!existing?.id;

  const [showPricingWizard, setShowPricingWizard] = useState(false);
  const [wizardSuggestions, setWizardSuggestions] = useState<{
    variants: { name: string; price: number; selected: boolean; isDefault?: boolean }[];
    addons: { name: string; price: number; selected: boolean }[];
  } | null>(null);

  useEffect(() => { if (open) setForm({ ...emptyItem, ...(existing || {}) }); }, [open, existing]);

  const categories = Array.from(new Set([...DEFAULT_CATEGORIES, ...(knownCategories || [])]));
  const update = (patch: Partial<MenuItem>) => setForm((prev) => ({ ...prev, ...patch }));

  const generateSuggestions = () => {
    if (!form.price || form.price <= 0) {
      toast.error("Please enter a base price first");
      return;
    }
    const base = form.price;
    const roundTo5 = (val: number) => Math.round(val / 5) * 5;
    
    const calculatedVariants = [
      { name: "Quarter", price: roundTo5(base * 0.35), selected: true },
      { name: "Half", price: roundTo5(base * 0.60), selected: true },
      { name: "Full", price: base, selected: true, isDefault: true },
      { name: "Combo (Fries + Drink)", price: roundTo5(base * 1.45), selected: false },
      { name: "Family Pack", price: roundTo5(base * 1.85), selected: false },
    ];

    const calculatedAddons = [
      { name: "Extra Cheese", price: 30, selected: true },
      { name: "Extra Mayo", price: 15, selected: true },
      { name: "French Fries (Side Portion)", price: 60, selected: false },
      { name: "Extra Egg", price: 15, selected: false },
      { name: "Extra Chicken Topping", price: 80, selected: false },
    ];

    setWizardSuggestions({ variants: calculatedVariants, addons: calculatedAddons });
    setShowPricingWizard(true);
  };

  const handleImage = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const storageRef = ref(storage, `menu/${restaurantId}/${Date.now()}_${file.name}`);
      const snap = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snap.ref);
      update({ image: url });
      toast.success("Image uploaded");
    } catch (e: any) { toast.error(e?.message || "Image upload failed"); }
    finally { setUploading(false); }
  };

  const toggleArrayValue = (key: "tags" | "allergens", value: string) => {
    const arr = form[key] || [];
    const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
    update({ [key]: next } as any);
  };

  const addVariant = () => update({ variants: [...(form.variants || []), { name: "", price: 0 }] });
  const updateVariant = (idx: number, patch: Partial<NonNullable<MenuItem["variants"]>[number]>) => {
    const next = [...(form.variants || [])]; next[idx] = { ...next[idx], ...patch }; update({ variants: next });
  };
  const removeVariant = (idx: number) => { const next = [...(form.variants || [])]; next.splice(idx, 1); update({ variants: next }); };

  const addAddon = () => update({ addons: [...(form.addons || []), { name: "", price: 0 }] });
  const updateAddon = (idx: number, patch: Partial<NonNullable<MenuItem["addons"]>[number]>) => {
    const next = [...(form.addons || [])]; next[idx] = { ...next[idx], ...patch }; update({ addons: next });
  };
  const removeAddon = (idx: number) => { const next = [...(form.addons || [])]; next.splice(idx, 1); update({ addons: next }); };

  const handleOptimize = async () => {
    if (!form.name.trim()) { toast.error("Please enter a dish name first"); return; }
    setOptimizing(true);
    try {
      const optimizeFn = httpsCallable(functions, "optimizeMenuItem");
      const result = await optimizeFn({
        name: form.name,
        currentDesc: form.desc,
        category: form.category,
        price: form.price,
        variants: form.variants || [],
        addons: form.addons || [],
        restaurantId
      });
      const data = (result.data as any)?.result;
      if (data) {
        const newVariants = [...(form.variants || [])];
        if (data.variants) data.variants.forEach((v: any) => { if (!newVariants.find(e => e.name.toLowerCase() === v.name.toLowerCase())) newVariants.push({ name: v.name, price: v.price || 0 }); });
        const newAddons = [...(form.addons || [])];
        if (data.addons) data.addons.forEach((a: any) => { if (!newAddons.find(e => e.name.toLowerCase() === a.name.toLowerCase())) newAddons.push({ name: a.name, price: a.price || 0 }); });
        update({
          name: data.optimizedName || form.name,
          desc: data.optimizedDescription || form.desc,
          isVeg: data.isVeg ?? form.isVeg,
          allergens: data.allergens || form.allergens,
          tags: data.dietaryTags || form.tags,
          variants: data.variants && Array.isArray(data.variants) && data.variants.length > 0 ? data.variants : newVariants,
          addons: data.addons && Array.isArray(data.addons) && data.addons.length > 0 ? data.addons : newAddons
        });
        toast.success("Item optimized with AI!");
      }
    } catch (e: any) { toast.error(e?.message || "AI optimization failed"); }
    finally { setOptimizing(false); }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Dish name is required");
    if (!(form.price >= 0)) return toast.error("Price must be a non-negative number");
    setSaving(true);
    try {
      const cleanVariants = (form.variants || []).map((v) => ({ name: (v.name || "").trim(), price: Number(v.price) || 0, ...(v.isDefault ? { isDefault: true } : {}) })).filter((v) => v.name);
      const cleanAddons = (form.addons || []).map((a) => ({ name: (a.name || "").trim(), price: Number(a.price) || 0 })).filter((a) => a.name);
      const payload = { ...form, name: form.name.trim(), price: Number(form.price) || 0, variants: cleanVariants, addons: cleanAddons, restaurantId, updatedAt: serverTimestamp() };
      delete (payload as any).id;
      if (isEdit && existing?.id) { await updateDoc(doc(db, "menu", existing.id), payload as any); toast.success("Dish updated"); }
      else { await addDoc(collection(db, "menu"), { ...payload, timestamp: serverTimestamp(), createdAt: serverTimestamp() }); toast.success("Dish added"); }
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message || "Failed to save dish"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] p-0 rounded-[2.5rem] border-0 overflow-hidden bg-background shadow-2xl">
        {/* Header Section */}
        <div className="bg-muted/30 px-8 py-6 border-b border-border/40 relative">
          <div className="absolute top-0 right-0 p-3 pointer-events-none opacity-10">
            <Sparkles className="w-32 h-32" />
          </div>
          <DialogTitle className="text-3xl font-black tracking-tight flex items-center justify-between relative z-10">
            <span className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
              {isEdit ? `Edit ${existing?.name || "Dish"}` : "Create New Dish"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOptimize}
              disabled={optimizing || !form.name.trim()}
              className="rounded-xl h-10 px-4 font-black uppercase tracking-widest bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 text-violet-600 border-violet-500/30 hover:bg-violet-500/20 shadow-sm"
            >
              {optimizing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              AI Optimize
            </Button>
          </DialogTitle>
          <DialogDescription className="text-sm font-bold text-muted-foreground mt-2 relative z-10">
            {isEdit ? "Update your dish details, pricing, and availability." : "Add a new dish to your menu with variants and AI optimization."}
          </DialogDescription>
        </div>

        <Tabs defaultValue="basic" className="flex flex-col md:flex-row h-[60vh] md:h-[65vh]">
          {/* Sidebar Tabs */}
          <TabsList className="flex md:flex-col h-auto w-full md:w-[180px] justify-start bg-muted/10 p-4 gap-2 border-b md:border-b-0 md:border-r border-border/40 overflow-x-auto md:overflow-visible rounded-none">
            <TabsTrigger value="basic" className="w-full justify-start rounded-xl text-xs font-black uppercase tracking-widest h-11 data-[state=active]:bg-background data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-border/40">
              <Tag className="h-4 w-4 mr-2.5" /> Basic
            </TabsTrigger>
            <TabsTrigger value="variants" className="w-full justify-start rounded-xl text-xs font-black uppercase tracking-widest h-11 data-[state=active]:bg-background data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-border/40">
              <Layers className="h-4 w-4 mr-2.5" /> Sizes
            </TabsTrigger>
            <TabsTrigger value="addons" className="w-full justify-start rounded-xl text-xs font-black uppercase tracking-widest h-11 data-[state=active]:bg-background data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-border/40">
              <Puzzle className="h-4 w-4 mr-2.5" /> Extras
            </TabsTrigger>
            <TabsTrigger value="attrs" className="w-full justify-start rounded-xl text-xs font-black uppercase tracking-widest h-11 data-[state=active]:bg-background data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-border/40">
              <Star className="h-4 w-4 mr-2.5" /> Tags
            </TabsTrigger>
            <TabsTrigger value="advanced" className="w-full justify-start rounded-xl text-xs font-black uppercase tracking-widest h-11 data-[state=active]:bg-background data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-border/40">
              <Settings className="h-4 w-4 mr-2.5" /> Advanced
            </TabsTrigger>
          </TabsList>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            <TabsContent value="basic" className="space-y-6 mt-0">
              <div className="flex flex-col sm:flex-row gap-6">
                <div className="w-full sm:w-[140px] shrink-0">
                  <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3 block">Photo</Label>
                  <div className="group relative w-full aspect-square rounded-[1.5rem] bg-muted/50 border-2 border-dashed border-border/60 flex flex-col items-center justify-center overflow-hidden transition-all hover:bg-muted hover:border-primary/50 cursor-pointer" onClick={() => document.getElementById("dish-photo-input")?.click()}>
                    {form.image || form.imageUrl ? (
                      <>
                        <img loading="lazy" src={form.image || form.imageUrl} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                          <span className="text-white text-xs font-bold uppercase">Change</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <ImageIcon className="w-10 h-10 text-muted-foreground/30 mb-2 transition-transform group-hover:scale-110" />
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Upload</span>
                      </>
                    )}
                    {uploading && (
                      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    )}
                  </div>
                  <Input type="file" accept="image/*" id="dish-photo-input" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImage(f); }} />
                  {(form.image || form.imageUrl) && (
                    <Button type="button" variant="ghost" className="w-full mt-2 rounded-xl text-destructive font-bold text-xs" onClick={(e) => { e.stopPropagation(); update({ image: "", imageUrl: "" }); }}>
                      Remove Photo
                    </Button>
                  )}
                </div>

                <div className="flex-1 space-y-5">
                  <div>
                    <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 block">Dish Name *</Label>
                    <Input className="h-14 rounded-2xl font-bold text-lg px-4 bg-muted/20 border-border/60 focus:bg-background shadow-sm" placeholder="e.g. Classic Margherita Pizza" value={form.name} onChange={(e) => update({ name: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 block">Base Price ({symbol}) *</Label>
                      <Input type="number" min="0" step="0.01" className="h-14 rounded-2xl font-black text-lg text-primary px-4 bg-muted/20 border-border/60 focus:bg-background shadow-sm" value={form.price} onChange={(e) => update({ price: Number(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 block">Category</Label>
                      <div className="relative">
                        <select className="w-full h-14 rounded-2xl bg-muted/20 border border-border/60 px-4 text-sm font-bold appearance-none outline-none focus:ring-2 focus:ring-ring focus:bg-background shadow-sm" value={form.category} onChange={(e) => update({ category: e.target.value })}>
                          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 block">Dietary Preference</Label>
                <div className="flex gap-3 bg-muted/30 p-1.5 rounded-[1.25rem] border border-border/40">
                  <Button type="button" variant={form.isVeg ? "default" : "ghost"} className={cn("flex-1 rounded-xl font-black h-12 transition-all", form.isVeg ? "bg-success text-success-foreground shadow-md" : "text-muted-foreground")} onClick={() => update({ isVeg: true })}>
                    <div className="w-3 h-3 rounded-sm border-2 border-current flex items-center justify-center mr-2"><div className="w-1.5 h-1.5 rounded-full bg-current" /></div>
                    Vegetarian
                  </Button>
                  <Button type="button" variant={!form.isVeg ? "default" : "ghost"} className={cn("flex-1 rounded-xl font-black h-12 transition-all", !form.isVeg ? "bg-destructive text-destructive-foreground shadow-md" : "text-muted-foreground")} onClick={() => update({ isVeg: false })}>
                    <div className="w-3 h-3 rounded-sm border-2 border-current flex items-center justify-center mr-2"><div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[5px] border-b-current" /></div>
                    Non-Veg
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 block">Description</Label>
                <Textarea className="rounded-2xl font-medium p-4 bg-muted/20 border-border/60 focus:bg-background shadow-sm resize-none" rows={4} placeholder="Describe the dish... (e.g. Wood-fired thin crust topped with San Marzano tomato, fresh mozzarella and basil.)" value={form.desc || ""} onChange={(e) => update({ desc: e.target.value })} />
              </div>
            </TabsContent>

            <TabsContent value="variants" className="space-y-6 mt-0">
              <div className="flex items-start justify-between bg-muted/30 p-4 rounded-2xl border border-border/40">
                <div>
                  <h4 className="text-sm font-black text-foreground">Portions & Sizes</h4>
                  <p className="text-xs text-muted-foreground font-medium mt-1">Add different sizes (e.g., Half/Full, Small/Large). The customer must pick exactly one.</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={generateSuggestions}
                    disabled={!form.price || form.price <= 0}
                    className="rounded-xl font-black uppercase tracking-widest text-[10px] bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 text-violet-600 border-violet-500/30 hover:bg-violet-500/20 h-10 px-3 shadow-sm"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5 animate-pulse text-violet-600" />
                    Auto-Scale Sizes
                  </Button>
                  <Button type="button" size="sm" className="rounded-xl font-black h-10 px-4" onClick={addVariant}>
                    <Plus className="h-4 w-4 mr-1.5" /> Add Size
                  </Button>
                </div>
              </div>

              {/* AI Pricing Estimator Inline Wizard */}
              <AnimatePresence>
                {showPricingWizard && wizardSuggestions && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: -10 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -10 }}
                    className="overflow-hidden bg-gradient-to-br from-violet-500/5 to-fuchsia-500/5 border border-violet-500/20 rounded-[2rem] p-6 space-y-5 shadow-inner"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Sparkles className="h-5 w-5 text-violet-600 animate-pulse" />
                        <div>
                          <h4 className="text-sm font-black text-foreground">AI Pricing Suggestions</h4>
                          <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Estimated logically from base price: {symbol}{form.price}</p>
                        </div>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted" onClick={() => setShowPricingWizard(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-6">
                      {/* Sizes Column */}
                      <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Suggested Portion Sizes</Label>
                        <div className="space-y-2.5 bg-background/50 p-4 rounded-[1.5rem] border border-border/40">
                          {wizardSuggestions.variants.map((v, i) => (
                            <div key={i} className="flex items-center justify-between text-xs p-1 hover:bg-muted/40 rounded-xl transition-all">
                              <label className="flex items-center gap-2.5 font-bold cursor-pointer min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  checked={v.selected}
                                  onChange={(e) => {
                                    const next = [...wizardSuggestions.variants];
                                    next[i].selected = e.target.checked;
                                    setWizardSuggestions({ ...wizardSuggestions, variants: next });
                                  }}
                                  className="h-4.5 w-4.5 rounded-lg border-border/60 text-violet-600 focus:ring-violet-500 bg-background shadow-sm"
                                />
                                <span className="truncate">{v.name}</span>
                              </label>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="font-black text-primary/80">{symbol}</span>
                                <input
                                  type="number"
                                  value={v.price}
                                  onChange={(e) => {
                                    const next = [...wizardSuggestions.variants];
                                    next[i].price = Number(e.target.value) || 0;
                                    setWizardSuggestions({ ...wizardSuggestions, variants: next });
                                  }}
                                  className="w-20 h-9 text-center text-xs font-black rounded-xl border border-border/60 bg-background focus:ring-2 focus:ring-violet-500"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Add-ons Column */}
                      <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Suggested Add-ons (Standard Costs)</Label>
                        <div className="space-y-2.5 bg-background/50 p-4 rounded-[1.5rem] border border-border/40">
                          {wizardSuggestions.addons.map((a, i) => (
                            <div key={i} className="flex items-center justify-between text-xs p-1 hover:bg-muted/40 rounded-xl transition-all">
                              <label className="flex items-center gap-2.5 font-bold cursor-pointer min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  checked={a.selected}
                                  onChange={(e) => {
                                    const next = [...wizardSuggestions.addons];
                                    next[i].selected = e.target.checked;
                                    setWizardSuggestions({ ...wizardSuggestions, addons: next });
                                  }}
                                  className="h-4.5 w-4.5 rounded-lg border-border/60 text-violet-600 focus:ring-violet-500 bg-background shadow-sm"
                                />
                                <span className="truncate">{a.name}</span>
                              </label>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="font-black text-primary/80">+{symbol}</span>
                                <input
                                  type="number"
                                  value={a.price}
                                  onChange={(e) => {
                                    const next = [...wizardSuggestions.addons];
                                    next[i].price = Number(e.target.value) || 0;
                                    setWizardSuggestions({ ...wizardSuggestions, addons: next });
                                  }}
                                  className="w-20 h-9 text-center text-xs font-black rounded-xl border border-border/60 bg-background focus:ring-2 focus:ring-violet-500"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-border/20">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPricingWizard(false)}
                        className="rounded-xl font-bold text-xs"
                      >
                        Discard
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          const finalVariants = wizardSuggestions.variants
                            .filter(v => v.selected)
                            .map(v => ({ name: v.name, price: v.price, isDefault: v.isDefault || false }));
                          const finalAddons = wizardSuggestions.addons
                            .filter(a => a.selected)
                            .map(a => ({ name: a.name, price: a.price }));
                          
                          update({
                            variants: finalVariants,
                            addons: [...(form.addons || []), ...finalAddons].filter(
                              (addon, index, self) => index === self.findIndex(t => t.name.toLowerCase() === addon.name.toLowerCase())
                            )
                          });
                          setShowPricingWizard(false);
                          toast.success("Applied pricing recommendations!");
                        }}
                        className="rounded-xl font-black uppercase tracking-widest text-[10px] bg-violet-600 text-white hover:bg-violet-700 shadow-md h-10 px-4 active:scale-95 hover:scale-[1.01] transition-transform"
                      >
                        Apply pricing recommendations
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="popLayout">
                {(form.variants || []).length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-[2rem] border-2 border-dashed border-border/60 p-10 text-center bg-card/40">
                    <Layers className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-base font-black text-muted-foreground">No variants added</p>
                    <p className="text-sm font-medium text-muted-foreground/70 mt-1 max-w-[250px] mx-auto">Leave this empty if the dish only comes in one standard size.</p>
                  </motion.div>
                ) : (
                  <div className="space-y-3">
                    {(form.variants || []).map((v, idx) => (
                      <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} key={idx} className={cn("flex flex-wrap sm:flex-nowrap items-center gap-3 p-3 rounded-2xl border transition-all", v.isDefault ? "bg-primary/5 border-primary/30" : "bg-card border-border/60")}>
                        <Input placeholder="Size name (e.g. Large)" value={v.name} onChange={(e) => updateVariant(idx, { name: e.target.value })} className="flex-1 h-12 rounded-xl font-bold bg-background shadow-sm" />
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">{symbol}</div>
                          <Input type="number" min="0" step="0.01" placeholder="Price" value={v.price} onChange={(e) => updateVariant(idx, { price: Number(e.target.value) || 0 })} className="w-28 pl-8 h-12 rounded-xl font-black text-primary bg-background shadow-sm" />
                        </div>
                        <Button type="button" variant={v.isDefault ? "default" : "outline"} className={cn("h-12 rounded-xl font-bold text-xs px-4", v.isDefault && "bg-primary text-primary-foreground")} onClick={() => { const next = (form.variants || []).map((x, i) => ({ ...x, isDefault: i === idx ? !x.isDefault : false })); update({ variants: next }); }}>
                          {v.isDefault ? "Default" : "Set Default"}
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="h-12 w-12 rounded-xl text-destructive hover:bg-destructive/10" onClick={() => removeVariant(idx)}>
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </AnimatePresence>
            </TabsContent>

            <TabsContent value="addons" className="space-y-6 mt-0">
              <div className="flex items-start justify-between bg-muted/30 p-4 rounded-2xl border border-border/40">
                <div>
                  <h4 className="text-sm font-black text-foreground">Add-ons & Extras</h4>
                  <p className="text-xs text-muted-foreground font-medium mt-1">Optional extras customers can add (e.g., Extra Cheese, Mayo).</p>
                </div>
                <Button type="button" size="sm" className="rounded-xl font-black h-10 px-4" onClick={addAddon}>
                  <Plus className="h-4 w-4 mr-1.5" /> Add Extra
                </Button>
              </div>

              <AnimatePresence mode="popLayout">
                {(form.addons || []).length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-[2rem] border-2 border-dashed border-border/60 p-10 text-center bg-card/40">
                    <Puzzle className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-base font-black text-muted-foreground">No add-ons added</p>
                  </motion.div>
                ) : (
                  <div className="space-y-3">
                    {(form.addons || []).map((a, idx) => (
                      <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} key={idx} className="flex flex-wrap sm:flex-nowrap items-center gap-3 p-3 rounded-2xl bg-card border border-border/60 shadow-sm">
                        <Input placeholder="Extra name (e.g. Extra Mayo)" value={a.name} onChange={(e) => updateAddon(idx, { name: e.target.value })} className="flex-1 h-12 rounded-xl font-bold bg-background" />
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">+{symbol}</div>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={a.price} onChange={(e) => updateAddon(idx, { price: Number(e.target.value) || 0 })} className="w-28 pl-9 h-12 rounded-xl font-black text-primary bg-background" />
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-12 w-12 rounded-xl text-destructive hover:bg-destructive/10" onClick={() => removeAddon(idx)}>
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </motion.div>
                    ))}
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/40 mt-6">
                      <div>
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 block">Min Selectable</Label>
                        <Input type="number" min="0" className="h-12 rounded-xl font-bold bg-muted/20" value={form.addonsMin || 0} onChange={(e) => update({ addonsMin: Number(e.target.value) || 0 })} />
                      </div>
                      <div>
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 block">Max Selectable (0 = No limit)</Label>
                        <Input type="number" min="0" className="h-12 rounded-xl font-bold bg-muted/20" value={form.addonsMax || 0} onChange={(e) => update({ addonsMax: Number(e.target.value) || 0 })} />
                      </div>
                    </div>
                  </div>
                )}
              </AnimatePresence>
            </TabsContent>

            <TabsContent value="attrs" className="space-y-8 mt-0">
              <div>
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3 block">Spice Level</Label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {(Object.keys(SPICE_LABELS) as Array<NonNullable<MenuItem["spiceLevel"]>>).map((lvl) => {
                    const active = form.spiceLevel === lvl;
                    return (
                      <button key={lvl} type="button" onClick={() => update({ spiceLevel: lvl })} className={cn("h-14 rounded-2xl text-xs font-black transition-all border", active ? "bg-red-500/10 text-red-600 border-red-500/30 shadow-inner" : "bg-card text-muted-foreground border-border/60 hover:bg-muted/50")}>
                        {SPICE_LABELS[lvl]}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3 block">Dietary & Marketing Tags</Label>
                <div className="flex flex-wrap gap-2.5">
                  {TAG_OPTIONS.map((t) => {
                    const active = form.tags?.includes(t);
                    return (
                      <button key={t} type="button" onClick={() => toggleArrayValue("tags", t)} className={cn("px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border transition-all duration-200", active ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20 -translate-y-0.5" : "bg-card text-muted-foreground border-border/60 hover:bg-muted")}>
                        {t.replace("-", " ")}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3 block">Allergen Information</Label>
                <div className="flex flex-wrap gap-2.5">
                  {ALLERGEN_OPTIONS.map((a) => {
                    const active = form.allergens?.includes(a);
                    return (
                      <button key={a} type="button" onClick={() => toggleArrayValue("allergens", a)} className={cn("px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border transition-all duration-200 flex items-center gap-2", active ? "bg-amber-500/10 text-amber-700 border-amber-500/30 shadow-inner" : "bg-card text-muted-foreground border-border/60 hover:bg-muted")}>
                        {active && <AlertCircle className="h-3.5 w-3.5" />}
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-6 mt-0">
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="bg-muted/20 p-5 rounded-2xl border border-border/40">
                  <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 block">Preparation Time</Label>
                  <Input className="h-12 rounded-xl font-bold bg-background shadow-sm" placeholder="e.g. 15-20 min" value={form.prepTime || ""} onChange={(e) => update({ prepTime: e.target.value })} />
                </div>
                <div className="bg-muted/20 p-5 rounded-2xl border border-border/40">
                  <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 block">Nutritional Info</Label>
                  <Input className="h-12 rounded-xl font-bold bg-background shadow-sm" placeholder="e.g. 350 kcal" value={form.calories || ""} onChange={(e) => update({ calories: e.target.value })} />
                </div>
              </div>
              
              <div className="bg-muted/20 p-5 rounded-2xl border border-border/40">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Label className="text-sm font-black text-foreground">Menu Highlights</Label>
                    <p className="text-xs text-muted-foreground font-medium mt-1">Make this dish stand out on the menu.</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Button type="button" variant={form.isAvailable ? "default" : "outline"} className={cn("h-14 rounded-xl font-black text-sm", form.isAvailable && "bg-success text-success-foreground hover:bg-success/90")} onClick={() => update({ isAvailable: !form.isAvailable })}>
                    {form.isAvailable ? "🟢 Currently In Stock" : "🔴 Marked Out of Stock"}
                  </Button>
                  <Button type="button" variant={form.isRecommended ? "default" : "outline"} className={cn("h-14 rounded-xl font-black text-sm", form.isRecommended && "bg-amber-500 text-white hover:bg-amber-600")} onClick={() => update({ isRecommended: !form.isRecommended })}>
                    <Star className={cn("h-5 w-5 mr-2", form.isRecommended && "fill-current")} />
                    {form.isRecommended ? "Featured as Recommended" : "Mark as Recommended"}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {/* Footer Actions */}
        <div className="bg-muted/10 px-8 py-5 border-t border-border/40 flex items-center justify-between">
          <p className="text-xs font-bold text-muted-foreground hidden sm:block">All changes auto-sync to all devices.</p>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <Button type="button" variant="outline" className="rounded-xl font-bold h-12 flex-1 sm:flex-none" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" className="rounded-xl font-black uppercase tracking-widest h-12 px-8 flex-1 sm:flex-none shadow-xl shadow-primary/20 hover:scale-105 transition-all" onClick={handleSave} disabled={saving || uploading}>
              {saving ? <><Loader2 className="h-5 w-5 animate-spin mr-2" /> Saving</> : isEdit ? "Save Changes" : "Create Dish"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
