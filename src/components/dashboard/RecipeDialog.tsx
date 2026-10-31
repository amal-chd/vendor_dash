import { useEffect, useMemo, useState } from "react";
import { ChefHat, Plus, Trash2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MenuItemLite = {
  id: string;
  name: string;
  price?: number;
};

type Ingredient = {
  inventoryItemId?: string;
  inventoryItemName: string;
  quantity: number;
  unit: string;
};

type InventoryItem = {
  id: string;
  name: string;
  unit?: string;
};

type RecipeDoc = {
  id: string;
  menuItemId: string;
  menuItemName: string;
  ingredients: Ingredient[];
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuItem: MenuItemLite | null;
  restaurantId: string;
}

export function RecipeDialog({ open, onOpenChange, menuItem, restaurantId }: Props) {
  const [recipe, setRecipe] = useState<RecipeDoc | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Load inventory list for autocomplete
  useEffect(() => {
    if (!open || !restaurantId) return;
    const q = query(
      collection(db, "inventory"),
      where("restaurantId", "==", restaurantId),
      limit(500),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setInventory(
          snap.docs.map((d) => ({
            id: d.id,
            name: (d.data().name as string) || "",
            unit: (d.data().unit as string) || "",
          })),
        );
      },
      () => setInventory([]),
    );
    return () => unsub();
  }, [open, restaurantId]);

  // Load the recipe for this menu item (if it exists)
  useEffect(() => {
    if (!open || !menuItem) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, "recipes"),
            where("restaurantId", "==", restaurantId),
            where("menuItemId", "==", menuItem.id),
            limit(1),
          ),
        );
        if (cancelled) return;
        if (snap.empty) {
          setRecipe(null);
          setIngredients([]);
        } else {
          const d = snap.docs[0];
          const data = d.data();
          setRecipe({
            id: d.id,
            menuItemId: menuItem.id,
            menuItemName: menuItem.name,
            ingredients: (data.ingredients as Ingredient[]) || [],
          });
          setIngredients((data.ingredients as Ingredient[]) || []);
        }
      } catch (e) {
        console.error("Failed to load recipe:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, menuItem, restaurantId]);

  const inventoryNames = useMemo(() => inventory.map((i) => i.name), [inventory]);

  const addRow = () => {
    setIngredients((prev) => [
      ...prev,
      { inventoryItemName: "", quantity: 0, unit: "" },
    ]);
  };

  const updateRow = (idx: number, patch: Partial<Ingredient>) => {
    setIngredients((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      // Auto-fill unit + inventoryItemId if the name matches a known item
      if (patch.inventoryItemName !== undefined) {
        const match = inventory.find(
          (i) => i.name.toLowerCase() === (patch.inventoryItemName || "").toLowerCase(),
        );
        if (match) {
          next[idx].inventoryItemId = match.id;
          if (!next[idx].unit) next[idx].unit = match.unit || "";
        } else {
          next[idx].inventoryItemId = undefined;
        }
      }
      return next;
    });
  };

  const removeRow = (idx: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
  };

  const generateWithAI = async () => {
    if (!menuItem) return;
    setGenerating(true);
    try {
      const call = httpsCallable(functions, "generateRecipe", { timeout: 120_000 });
      const res: any = await call({
        menuItemName: menuItem.name,
        inventoryItems: inventoryNames,
      });
      const generated = res?.data?.result;
      if (Array.isArray(generated) && generated.length > 0) {
        const newIngredients = generated.map((ing: any) => {
          let inventoryItemId = undefined;
          let unit = ing.unit || "";
          if (ing.inventoryItemName) {
            const match = inventory.find(
              (i) => i.name.toLowerCase() === (ing.inventoryItemName || "").toLowerCase(),
            );
            if (match) {
              inventoryItemId = match.id;
              if (!unit) unit = match.unit || "";
            }
          }
          return {
            inventoryItemName: ing.inventoryItemName || "",
            quantity: Number(ing.quantity) || 0,
            unit,
            inventoryItemId,
          };
        });
        setIngredients(newIngredients);
        toast.success("Recipe generated successfully!");
      } else {
        toast.error("AI couldn't generate a recipe. Try adding ingredients manually.");
      }
    } catch (e: any) {
      console.error("AI Generate Failed:", e);
      toast.error(e?.message || "Failed to generate recipe");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!menuItem) return;
    const valid = ingredients.filter(
      (i) => i.inventoryItemName.trim() && i.quantity > 0,
    );
    if (valid.length === 0) {
      toast.error("Add at least one ingredient with quantity > 0");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        restaurantId,
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        menuItemPrice: menuItem.price ?? 0,
        ingredients: valid,
        updatedAt: serverTimestamp(),
      };
      if (recipe) {
        await updateDoc(doc(db, "recipes", recipe.id), payload);
      } else {
        await addDoc(collection(db, "recipes"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      toast.success(recipe ? "Recipe updated" : "Recipe added");
      onOpenChange(false);
    } catch (e: any) {
      console.error("Save recipe failed:", e);
      toast.error(e?.message || "Failed to save recipe");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!recipe) return;
    if (!confirm("Delete this recipe? This cannot be undone.")) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "recipes", recipe.id));
      toast.success("Recipe deleted");
      setRecipe(null);
      setIngredients([]);
      onOpenChange(false);
    } catch (e: any) {
      console.error("Delete recipe failed:", e);
      toast.error(e?.message || "Failed to delete recipe");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] rounded-[2rem] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <ChefHat className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-black tracking-tight">
                Recipe for {menuItem?.name || "Dish"}
              </DialogTitle>
              <DialogDescription className="text-xs font-semibold text-muted-foreground">
                Link inventory ingredients to this dish for stock deduction & cost tracking.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary opacity-60" />
          </div>
        ) : (
          <div className="space-y-4 pt-4">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">
                Ingredients
              </Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-[10px] font-black uppercase tracking-widest text-primary border-primary/20 bg-primary/5 hover:bg-primary/10"
                  onClick={generateWithAI}
                  disabled={generating || loading || saving}
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  AI Generate
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-[10px] font-black uppercase tracking-widest"
                  onClick={addRow}
                  disabled={generating || saving}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>
            </div>

            {ingredients.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-border/60 p-8 text-center">
                <ChefHat className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm font-bold text-muted-foreground">
                  No ingredients yet
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Tap "Add" to start building the recipe.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <datalist id="recipe-inventory-options">
                  {inventoryNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                {ingredients.map((ing, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 p-2 rounded-xl bg-muted/40 border border-border/40"
                  >
                    <Input
                      list="recipe-inventory-options"
                      placeholder="Ingredient name"
                      value={ing.inventoryItemName}
                      onChange={(e) =>
                        updateRow(idx, { inventoryItemName: e.target.value })
                      }
                      className="flex-1 h-10 rounded-lg text-sm font-bold"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Qty"
                      value={ing.quantity || ""}
                      onChange={(e) =>
                        updateRow(idx, { quantity: Number(e.target.value) || 0 })
                      }
                      className="w-20 h-10 rounded-lg text-sm font-bold"
                    />
                    <Input
                      placeholder="Unit"
                      value={ing.unit}
                      onChange={(e) => updateRow(idx, { unit: e.target.value })}
                      className="w-20 h-10 rounded-lg text-sm font-bold"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 rounded-lg text-destructive hover:bg-destructive/10"
                      onClick={() => removeRow(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-4 border-t border-border/40">
              {recipe ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive font-bold rounded-xl"
                  onClick={handleDelete}
                  disabled={saving}
                >
                  Delete recipe
                </Button>
              ) : null}
              <div className="flex-1" />
              <Button
                type="button"
                variant="outline"
                className="rounded-xl font-bold"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-xl font-black uppercase tracking-widest"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Saving
                  </>
                ) : (
                  "Save recipe"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
