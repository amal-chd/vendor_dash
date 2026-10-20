import { motion, AnimatePresence } from "framer-motion";
import { 
  AlertTriangle, Package, Truck, Search, Plus, 
  Download, History,
  RefreshCw, Clock, TrendingUp, TrendingDown,
  DollarSign, Activity, Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/lib/firebase";
import { useCurrency } from "@/lib/currency";
import { PageLoading } from "@/components/dashboard/PageLoading";
import { Timestamp, collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc, orderBy, limit } from "firebase/firestore";
import { toast } from "sonner";
import { ExportHelper } from "@/lib/helpers";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  Tabs, 
  TabsContent, 
  TabsList, 
  TabsTrigger 
} from "@/components/ui/tabs";

type InventoryItem = {
  id: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
  min: number;
  price: number;
  supplier: string;
  status: 'critical' | 'low' | 'ok';
  lastRestock: Timestamp | Date | null;
  prediction: string;
};

type InventoryLog = {
  id: string;
  itemId: string;
  itemName: string;
  type: 'addition' | 'reduction' | 'adjustment';
  quantity: number;
  timestamp: Timestamp;
};

const transition = { duration: 0.4, ease: [0.2, 0, 0, 1] as const };

export default function InventoryPage() {
  const { user, restaurantId, activeRestaurantId, billingAccountId } = useAuth();
  const effectiveInventoryId = activeRestaurantId;
  const { format, symbol } = useCurrency();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newItem, setNewItem] = useState({
    name: "",
    category: "Protein",
    stock: 0,
    unit: "kg",
    min: 5,
    supplier: "",
    price: 0
  });

  useEffect(() => {
    if (!user) return;

    const qInventory = query(
      collection(db, "inventory"),
      where("restaurantId", "==", effectiveInventoryId),
      limit(500),
    );

    const unsubscribeInventory = onSnapshot(qInventory, (snapshot) => {
      const inventoryData = snapshot.docs.map(doc => {
        const data = doc.data();
        const stockValue = Number(data.stock) || 0;
        const minValue = Number(data.min) || 0;
        let statusValue: 'critical' | 'low' | 'ok' = 'ok';
        
        if (stockValue <= minValue * 0.5) statusValue = 'critical';
        else if (stockValue <= minValue) statusValue = 'low';

        return {
          id: doc.id,
          ...data,
          stock: stockValue,
          min: minValue,
          price: Number(data.price) || 0,
          status: statusValue,
          prediction: statusValue === 'critical' ? 'Depletes soon' : statusValue === 'low' ? 'Refill needed' : 'Stable'
        } as InventoryItem;
      });
      setItems(inventoryData);
      setLoading(false);
    }, (err) => console.error("[InventoryPage] qInventory listener failed", err));

    const qLogs = query(
      collection(db, "inventory_logs"),
      where("restaurantId", "==", effectiveInventoryId),
      orderBy("timestamp", "desc"),
      limit(20)
    );

    const unsubscribeLogs = onSnapshot(qLogs, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as InventoryLog[];
      setLogs(logsData);
    }, (err) => console.error("[InventoryPage] qLogs listener failed", err));

    return () => {
      unsubscribeInventory();
      unsubscribeLogs();
    };
  }, [user, restaurantId]);

  const recordLog = async (item: Partial<InventoryItem>, type: 'addition' | 'reduction' | 'adjustment', quantity: number) => {
    if (!user) return;
    await addDoc(collection(db, "inventory_logs"), {
      restaurantId: effectiveInventoryId,
      itemId: item.id,
      itemName: item.name,
      type,
      quantity,
      timestamp: serverTimestamp()
    });
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, "inventory"), {
        ...newItem,
        restaurantId: effectiveInventoryId,
        timestamp: serverTimestamp(),
      });

      await recordLog({ id: docRef.id, name: newItem.name }, 'addition', newItem.stock);
      
      toast.success("Item added to inventory");
      setAddItemOpen(false);
      setNewItem({
        name: "",
        category: "Protein",
        stock: 0,
        unit: "kg",
        min: 5,
        supplier: "",
        price: 0
      });
    } catch (error) {
      toast.error("Failed to add item");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStock = async (item: InventoryItem, newStock: number) => {
    try {
      const diff = newStock - item.stock;
      if (diff === 0) return;
      const type = diff > 0 ? 'addition' : 'reduction';
      
      await updateDoc(doc(db, "inventory", item.id), {
        stock: newStock,
        lastRestock: diff > 0 ? serverTimestamp() : item.lastRestock
      });
      
      await recordLog(item, type, Math.abs(diff));
      toast.success("Stock updated");
    } catch (error) {
      toast.error("Adjustment failed");
    }
  };

  const handleDeleteItem = async (item: InventoryItem) => {
    if (!confirm("Remove target supply?")) return;
    try {
      await deleteDoc(doc(db, "inventory", item.id));
      if (item.stock > 0) {
        await recordLog(item, "reduction", item.stock);
      }
      toast.success("Item removed");
    } catch (error) {
      console.error(error);
      toast.error("Failed to remove item");
    }
  };

  const totalValuation = items.reduce((acc, item) => acc + (item.stock * item.price), 0);
  const criticalItems = items.filter(i => i.status === 'critical');
  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    item.category.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <PageLoading stats={4} chart={false} rows={8} />;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mt-2">
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
            Stock <span className="text-primary">Vault</span>
          </h1>
          <p className="text-sm text-muted-foreground font-medium flex items-center gap-2">
            <Package className="w-4 h-4" /> Track resources and assets
          </p>
        </div>

        <div className="flex items-center gap-3 w-full lg:w-auto">
           <Button 
              variant="outline" 
              className="rounded-xl font-semibold h-11 border-border/40 hover:bg-muted/50"
              onClick={() => ExportHelper.downloadCSV(items, "inventory_vault.csv")}
           >
             <Download className="w-4 h-4 mr-2" /> Export
           </Button>
           <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-xl font-semibold bg-primary text-primary-foreground h-11 shadow-sm">
                  <Plus className="w-4 h-4 mr-2" /> New Entry
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl p-6 max-w-md border-border/40 shadow-xl bg-card">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-xl font-bold">Add Supply</DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">Register a new resource in the vault</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddItem} className="space-y-5 pt-2">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground ml-1">Item Name</Label>
                      <Input value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="rounded-xl h-11 font-medium bg-muted/30 border-none px-4 focus:ring-1 focus:ring-primary" placeholder="Basmati Rice" required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1">Category</Label>
                        <select className="w-full rounded-xl h-11 font-medium bg-muted/30 border-none px-4 text-sm focus:ring-1 focus:ring-primary" value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})}>
                          <option>Protein</option><option>Vegetables</option><option>Dairy</option><option>Grains</option><option>Spices</option><option>Packaging</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1">Purchase Price ({symbol})</Label>
                        <Input type="number" value={newItem.price || ''} onChange={e => setNewItem({...newItem, price: Number(e.target.value)})} className="rounded-xl h-11 font-medium bg-muted/30 border-none px-4 text-sm focus:ring-1 focus:ring-primary" required />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                       <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1">Qty</Label>
                        <Input type="number" value={newItem.stock || ''} onChange={e => setNewItem({...newItem, stock: Number(e.target.value)})} className="rounded-xl h-11 font-medium bg-muted/30 border-none px-4 text-sm focus:ring-1 focus:ring-primary" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1">Unit</Label>
                        <Input value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} className="rounded-xl h-11 font-medium bg-muted/30 border-none px-4 text-sm focus:ring-1 focus:ring-primary" placeholder="kg" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1">Min Alert</Label>
                        <Input type="number" value={newItem.min || ''} onChange={e => setNewItem({...newItem, min: Number(e.target.value)})} className="rounded-xl h-11 font-medium bg-muted/30 border-none px-4 text-sm focus:ring-1 focus:ring-primary" required />
                      </div>
                    </div>
                  </div>
                  <Button type="submit" disabled={saving} className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold shadow-sm mt-4">
                    {saving ? "Registering..." : "Confirm Registration"}
                  </Button>
                </form>
              </DialogContent>
           </Dialog>
        </div>
      </div>

      {/* Strategic Summaries */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
         <Card className="rounded-2xl border-none bg-primary text-primary-foreground shadow-sm">
            <div className="p-6">
               <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><DollarSign className="w-5 h-5 text-white" /></div>
               </div>
               <p className="text-xs font-medium text-primary-foreground/80 mb-1">Total Valuation</p>
               <h3 className="text-2xl sm:text-3xl font-bold">{format(totalValuation)}</h3>
            </div>
         </Card>

         <Card className="rounded-2xl border border-destructive/20 bg-destructive/5 shadow-sm">
            <div className="p-6">
               <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
                  {criticalItems.length > 0 && (
                     <span className="flex w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
                  )}
               </div>
               <p className="text-xs font-medium text-destructive/80 mb-1">Stock Alerts</p>
               <h3 className="text-2xl sm:text-3xl font-bold text-foreground">{criticalItems.length} <span className="text-destructive text-sm font-medium ml-1">Critical</span></h3>
            </div>
         </Card>

         <Card className="rounded-2xl border border-border/40 bg-card shadow-sm">
            <div className="p-6">
               <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><Package className="w-5 h-5 text-blue-500" /></div>
               </div>
               <p className="text-xs font-medium text-muted-foreground mb-1">Total Items</p>
               <h3 className="text-2xl sm:text-3xl font-bold text-foreground">{items.length} <span className="text-blue-500 text-sm font-medium ml-1">SKUs</span></h3>
            </div>
         </Card>

         <Card className="rounded-2xl border border-border/40 bg-card shadow-sm">
            <div className="p-6 text-foreground">
               <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center"><Truck className="w-5 h-5 text-emerald-500" /></div>
               </div>
               <p className="text-xs font-medium text-muted-foreground mb-1">Suppliers</p>
               <h3 className="text-2xl sm:text-3xl font-bold text-foreground">{Array.from(new Set(items.map(i => i.supplier).filter(Boolean))).length || 0} <span className="text-emerald-500 text-sm font-medium ml-1">Active</span></h3>
            </div>
         </Card>
      </div>

      <Tabs defaultValue="inventory" className="w-full">
         <TabsList className="bg-muted p-1 rounded-xl h-12 w-full sm:w-fit mb-6">
            <TabsTrigger value="inventory" className="rounded-lg h-10 px-6 font-medium text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
               Inventory List
            </TabsTrigger>
            <TabsTrigger value="logs" className="rounded-lg h-10 px-6 font-medium text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
               Action History
            </TabsTrigger>
         </TabsList>

         <TabsContent value="inventory" className="space-y-6">
            <Card className="rounded-2xl border-border/40 shadow-sm bg-card overflow-hidden">
               <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 border-b border-border/20">
                  <div className="space-y-1">
                     <CardTitle className="text-lg font-bold">Vault Live</CardTitle>
                     <CardDescription className="text-sm">Real-time resource tracking</CardDescription>
                  </div>
                  <div className="relative w-full sm:w-72">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                     <Input 
                        placeholder="Search resource..." 
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="rounded-xl h-11 pl-9 bg-muted/50 border-border/40 focus:ring-1 focus:ring-primary"
                     />
                  </div>
               </CardHeader>
               
               <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-1 gap-3">
                     <AnimatePresence>
                        {filteredItems.map((item, i) => (
                           <motion.div 
                              key={item.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ ...transition, delay: i * 0.05 }}
                              className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-card border border-border/40 hover:border-border/80 transition-all gap-4 shadow-sm"
                           >
                              <div className="flex items-center gap-4 flex-1">
                                 <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                    <Package className="w-5 h-5 text-muted-foreground" />
                                 </div>
                                 <div>
                                    <p className="text-base font-semibold text-foreground">{item.name}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                       <span className="text-xs text-muted-foreground font-medium">{item.category}</span>
                                       <span className="w-1 h-1 rounded-full bg-border" />
                                       <span className="text-xs text-muted-foreground">{format(item.price)} / {item.unit}</span>
                                    </div>
                                 </div>
                              </div>
                              
                              <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-8 w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-border/10">
                                 {/* Health Status */}
                                 <div className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border",
                                    item.status === 'critical' ? "bg-red-500/10 text-red-500 border-red-500/20" :
                                    item.status === 'low' ? "bg-orange-500/10 text-orange-500 border-orange-500/20" :
                                    "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                 )}>
                                    <span className={cn("w-1.5 h-1.5 rounded-full", 
                                       item.status === 'critical' ? "bg-red-500 animate-pulse" :
                                       item.status === 'low' ? "bg-orange-500" : "bg-emerald-500"
                                    )} />
                                    <span className="capitalize">{item.status}</span>
                                 </div>

                                 {/* Stock Adjuster */}
                                 <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-lg border border-border/40">
                                    <button 
                                       onClick={() => handleUpdateStock(item, Math.max(0, item.stock - 1))}
                                       className="w-8 h-8 rounded-md bg-background hover:bg-muted flex items-center justify-center transition-colors shadow-sm"
                                    >
                                       <TrendingDown className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                    </button>
                                    <div className="text-center min-w-[48px]">
                                       <p className="text-sm font-bold text-foreground leading-none">{item.stock}</p>
                                       <p className="text-[10px] text-muted-foreground mt-0.5">{item.unit}</p>
                                    </div>
                                    <button 
                                       onClick={() => handleUpdateStock(item, item.stock + 1)}
                                       className="w-8 h-8 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center transition-colors shadow-sm"
                                    >
                                       <TrendingUp className="w-4 h-4" />
                                    </button>
                                 </div>

                                 {/* Actions */}
                                 <div className="flex sm:hidden group-hover:flex items-center justify-end transition-opacity">
                                    <Button
                                       variant="ghost"
                                       size="icon"
                                       className="h-9 w-9 rounded-lg text-destructive hover:bg-destructive/10"
                                       onClick={() => handleDeleteItem(item)}
                                    >
                                       <Trash2 className="w-4 h-4" />
                                    </Button>
                                 </div>
                              </div>
                           </motion.div>
                        ))}
                     </AnimatePresence>
                     {filteredItems.length === 0 && !loading && (
                        <div className="py-16 text-center flex flex-col items-center justify-center">
                           <Package className="w-12 h-12 mb-3 text-muted-foreground/50" />
                           <p className="text-sm font-medium text-muted-foreground">No Items Found</p>
                        </div>
                     )}
                  </div>
               </div>
            </Card>
         </TabsContent>

         <TabsContent value="logs">
            <Card className="rounded-2xl border-border/40 shadow-sm bg-card overflow-hidden">
               <CardHeader className="p-6 border-b border-border/20">
                  <CardTitle className="text-lg font-bold">Vault Journal</CardTitle>
                  <CardDescription className="text-sm">Historical resource movement</CardDescription>
               </CardHeader>
               <CardContent className="p-4 sm:p-6">
                  <div className="space-y-3">
                     {logs.map((log) => {
                        const isAdd = log.type === "addition";
                        const isAdjust = log.type === "adjustment";
                        const badgeClass = isAdjust
                           ? "bg-primary/10 border-primary/20 text-primary"
                           : isAdd
                           ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                           : "bg-red-500/10 border-red-500/20 text-red-500";
                        return (
                          <div key={log.id} className="p-4 flex items-center justify-between bg-card hover:bg-muted/30 rounded-xl border border-border/40 transition-colors">
                             <div className="flex items-center gap-4">
                                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center border", badgeClass)}>
                                   {isAdjust ? (
                                      <RefreshCw className="w-4 h-4" />
                                   ) : isAdd ? (
                                      <TrendingUp className="w-4 h-4" />
                                   ) : (
                                      <TrendingDown className="w-4 h-4" />
                                   )}
                                </div>
                                <div>
                                   <p className="text-sm font-semibold text-foreground">
                                      {isAdjust ? 'Adjusted' : isAdd ? 'Restocked' : 'Reduced'}{' '}
                                      <span className="font-medium text-muted-foreground ml-1">{log.itemName}</span>
                                   </p>
                                   <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                      <Clock className="w-3 h-3" /> 
                                      {log.timestamp instanceof Timestamp ? log.timestamp.toDate().toLocaleString() : 'Just now'}
                                   </p>
                                </div>
                             </div>
                             <div className="text-right">
                                <p className={cn("text-lg font-bold", isAdjust ? "text-primary" : isAdd ? "text-emerald-500" : "text-red-500")}>
                                   {isAdjust ? `${log.quantity}` : `${isAdd ? '+' : '-'}${log.quantity}`}
                                </p>
                             </div>
                          </div>
                        );
                     })}
                     {logs.length === 0 && (
                        <div className="py-16 text-center flex flex-col items-center justify-center">
                           <History className="w-12 h-12 mb-3 text-muted-foreground/50" />
                           <p className="text-sm font-medium text-muted-foreground">No Logs Found</p>
                        </div>
                     )}
                  </div>
               </CardContent>
            </Card>
         </TabsContent>
      </Tabs>
    </div>
  );
}
