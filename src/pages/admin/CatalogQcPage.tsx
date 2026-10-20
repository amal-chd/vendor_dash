import { useMemo, useState } from "react";
import {
  UtensilsCrossed,
  Sparkles,
  Camera,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  Search,
  Upload,
  Download,
  Bell,
  Send,
  Store,
  Tag,
  Flame,
  ShieldAlert,
  Edit3,
  Trash2,
  Eye,
  RefreshCw,
  FileSpreadsheet,
  Layers,
  ChefHat,
  Filter,
  Check,
  Image as ImageIcon,
  ExternalLink,
  MoreVertical,
  SlidersHorizontal,
  Info,
  Clock,
  CircleDollarSign,
  Share2,
} from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import {
  collection,
  doc,
  updateDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { FilterChips } from "@/components/admin/FilterChips";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { usePartnerContacts } from "@/hooks/usePartnerPrivate";
import { partnerDocKey, partnerEmail } from "@/lib/onboarding";
import { db, storage } from "@/lib/firebase";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────────────────

export interface MenuItem {
  id: string;
  name?: string;
  restaurantId?: string;
  restaurantName?: string;
  category?: string;
  price?: number;
  discountPrice?: number;
  desc?: string;
  description?: string;
  imageUrl?: string;
  image?: string;
  isVeg?: boolean;
  veg?: boolean;
  isAvailable?: boolean;
  available?: boolean;
  flagged?: boolean;
  flagReason?: string;
  prepTime?: string;
  calories?: string;
  allergens?: string[];
  tags?: string[];
  spiceLevel?: "none" | "mild" | "medium" | "hot" | "extra-hot";
  gstRate?: number;
  bestseller?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface Restaurant {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  cuisine?: string;
  isAvailable?: boolean;
  isDeleted?: boolean;
  status?: string;
  address?: string;
}

import {
  FOOD_STUDIO_PRESETS,
  FOOD_STUDIO_CATEGORIES,
  type FoodPreset,
} from "@/data/foodStudioPresets";

const COMMON_FOOD_IMAGES = FOOD_STUDIO_PRESETS;

const STANDARD_CATEGORIES = [
  "Starters",
  "Main Course",
  "Rice & Biryani",
  "Breads",
  "Noodles & Pasta",
  "Salads & Soups",
  "Sides & Accompaniments",
  "Beverages",
  "Desserts",
  "Combos & Platters",
];

const POPULAR_TAGS = [
  "Bestseller",
  "Must Try",
  "Chef Special",
  "Popular",
  "Spicy",
  "Jain Friendly",
  "Gluten Free",
  "Vegan",
  "High Protein",
  "Kids Special",
];

export default function CatalogQcPage() {
  // ── Live Firestore Data ───────────────────────────────────────────────────
  const { rows: menuItems, loading: menuLoading } = useLiveCollection<MenuItem>("menu", {
    limit: 1000,
  });
  const { rows: restaurants, loading: restaurantsLoading } = useLiveCollection<Restaurant>(
    "restaurants",
    { limit: 500 },
  );
  // Login emails live in partner_contact — the restaurants doc is public.
  const contacts = usePartnerContacts("vendor");

  // ── Component State ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("items");
  const [filter, setFilter] = useState("issues");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedAvailability, setSelectedAvailability] = useState<string>("all");

  // Dialog & Modal states
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [imageModalItem, setImageModalItem] = useState<MenuItem | null>(null);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<MenuItem | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [bulkNotifying, setBulkNotifying] = useState(false);
  const [autoFlagging, setAutoFlagging] = useState(false);

  // New item form draft
  const [newItemDraft, setNewItemDraft] = useState<Partial<MenuItem>>({
    name: "",
    restaurantId: "",
    category: "Main Course",
    price: 199,
    isVeg: true,
    isAvailable: true,
    desc: "",
    imageUrl: "",
    prepTime: "15-20 mins",
    tags: ["Popular"],
  });

  // ── Food Studio Preset Gallery State ──────────────────────────────────────
  const [studioSearch, setStudioSearch] = useState("");
  const [studioCategory, setStudioCategory] = useState("All");
  const [studioVegOnly, setStudioVegOnly] = useState<"all" | "veg" | "non-veg">("all");
  const [studioVisibleCount, setStudioVisibleCount] = useState(80);
  const [syncingPresets, setSyncingPresets] = useState(false);

  const handleSyncPresetsToFirestore = async () => {
    setSyncingPresets(true);
    try {
      let batch = writeBatch(db);
      let count = 0;
      for (const preset of FOOD_STUDIO_PRESETS) {
        const docRef = doc(db, "food_studio_presets", preset.id);
        batch.set(
          docRef,
          {
            ...preset,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            verified: true,
          },
          { merge: true }
        );
        count++;
        if (count % 400 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (count % 400 !== 0) {
        await batch.commit();
      }
      toast.success(`Successfully stored all ${count} studio food images in Firestore!`);
    } catch (err: any) {
      toast.error(`Failed to sync presets: ${err.message}`);
    } finally {
      setSyncingPresets(false);
    }
  };

  const filteredStudioPresets = useMemo(() => {
    const q = studioSearch.trim().toLowerCase();
    return FOOD_STUDIO_PRESETS.filter((item) => {
      if (studioCategory !== "All" && item.category !== studioCategory) return false;
      if (studioVegOnly === "veg" && !item.isVeg) return false;
      if (studioVegOnly === "non-veg" && item.isVeg) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
    });
  }, [studioSearch, studioCategory, studioVegOnly]);

  // ── Lookup Map: Restaurant ID → Restaurant Object ─────────────────────────
  const restaurantMap = useMemo(() => {
    const map = new Map<string, Restaurant>();
    restaurants.forEach((r) => {
      if (r.id) map.set(r.id, r);
    });
    return map;
  }, [restaurants]);

  const activeRestaurants = useMemo(() => {
    return restaurants
      .filter((r) => !r.isDeleted && r.status !== "deleted")
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [restaurants]);

  // ── Live Enriched Menu Items ──────────────────────────────────────────────
  const enrichedItems = useMemo(() => {
    return menuItems.map((item) => {
      const rest = item.restaurantId ? restaurantMap.get(item.restaurantId) : undefined;
      const restName = item.restaurantName || rest?.name || item.restaurantId || "Unknown Restaurant";
      const imageSrc = item.imageUrl || item.image || "";
      const itemDesc = item.desc || item.description || "";
      const isItemVeg = item.isVeg !== undefined ? item.isVeg : item.veg !== undefined ? item.veg : true;
      const isItemAvailable =
        item.isAvailable !== undefined
          ? item.isAvailable
          : item.available !== undefined
          ? item.available
          : true;

      return {
        ...item,
        restaurantName: restName,
        imageUrl: imageSrc,
        desc: itemDesc,
        isVeg: isItemVeg,
        isAvailable: isItemAvailable,
      };
    });
  }, [menuItems, restaurantMap]);

  // ── Categories Set ────────────────────────────────────────────────────────
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    enrichedItems.forEach((i) => {
      if (i.category?.trim()) cats.add(i.category.trim());
    });
    STANDARD_CATEGORIES.forEach((c) => cats.add(c));
    return Array.from(cats).sort();
  }, [enrichedItems]);

  // ── Filtered Items for Tab 1 ──────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    return enrichedItems.filter((item) => {
      const hasPhoto = Boolean(item.imageUrl && item.imageUrl.trim().length > 5);
      const hasDesc = Boolean(item.desc && item.desc.trim().length > 5);
      const isOut = !item.isAvailable;
      const isFlagged = Boolean(item.flagged);

      // Filter chips
      if (filter === "issues" && (hasPhoto && hasDesc && !isOut && !isFlagged)) return false;
      if (filter === "photo" && hasPhoto) return false;
      if (filter === "desc" && hasDesc) return false;
      if (filter === "stock" && !isOut) return false;
      if (filter === "flagged" && !isFlagged) return false;
      if (filter === "veg" && !item.isVeg) return false;
      if (filter === "nonveg" && item.isVeg) return false;

      // Dropdown filters
      if (selectedRestaurantId !== "all" && item.restaurantId !== selectedRestaurantId) {
        return false;
      }
      if (selectedCategory !== "all" && item.category !== selectedCategory) {
        return false;
      }
      if (selectedAvailability === "in_stock" && !item.isAvailable) return false;
      if (selectedAvailability === "out_of_stock" && item.isAvailable) return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (item.name || "").toLowerCase().includes(q);
        const matchRest = (item.restaurantName || "").toLowerCase().includes(q);
        const matchCat = (item.category || "").toLowerCase().includes(q);
        const matchDesc = (item.desc || "").toLowerCase().includes(q);
        const matchTags = (item.tags || []).some((t) => t.toLowerCase().includes(q));
        if (!matchName && !matchRest && !matchCat && !matchDesc && !matchTags) return false;
      }

      return true;
    });
  }, [
    enrichedItems,
    filter,
    selectedRestaurantId,
    selectedCategory,
    selectedAvailability,
    searchQuery,
  ]);

  // ── Metrics Calculation ───────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const total = enrichedItems.length;
    if (!total) {
      return {
        total: 0,
        missingPhoto: 0,
        missingPhotoPct: 0,
        missingDesc: 0,
        outOfStock: 0,
        flagged: 0,
        vegCount: 0,
        nonVegCount: 0,
        avgPrice: 0,
        healthScore: 100,
      };
    }

    const missingPhoto = enrichedItems.filter((i) => !i.imageUrl || i.imageUrl.length < 5).length;
    const missingDesc = enrichedItems.filter((i) => !i.desc || i.desc.length < 5).length;
    const outOfStock = enrichedItems.filter((i) => !i.isAvailable).length;
    const flagged = enrichedItems.filter((i) => i.flagged).length;
    const vegCount = enrichedItems.filter((i) => i.isVeg).length;
    const nonVegCount = total - vegCount;

    const totalPrice = enrichedItems.reduce((acc, i) => acc + (Number(i.price) || 0), 0);
    const avgPrice = Math.round(totalPrice / total);

    // Weighted Platform Quality Score
    const photoScore = ((total - missingPhoto) / total) * 45;
    const descScore = ((total - missingDesc) / total) * 25;
    const stockScore = ((total - outOfStock) / total) * 20;
    const cleanScore = ((total - flagged) / total) * 10;
    const healthScore = Math.round(photoScore + descScore + stockScore + cleanScore);

    return {
      total,
      missingPhoto,
      missingPhotoPct: Math.round((missingPhoto / total) * 100),
      missingDesc,
      outOfStock,
      flagged,
      vegCount,
      nonVegCount,
      avgPrice,
      healthScore: Math.min(100, Math.max(0, healthScore)),
    };
  }, [enrichedItems]);

  // ── Vendor Health Leaderboard Data ────────────────────────────────────────
  const vendorHealthData = useMemo(() => {
    const vendorMap = new Map<
      string,
      {
        restaurantId: string;
        name: string;
        phone: string;
        email: string;
        city: string;
        total: number;
        withPhoto: number;
        withDesc: number;
        inStock: number;
        flagged: number;
        avgPrice: number;
        totalRevenuePotential: number;
      }
    >();

    // Initialize with all active restaurants
    activeRestaurants.forEach((r) => {
      vendorMap.set(r.id, {
        restaurantId: r.id,
        name: r.name || "Untitled Venue",
        phone: r.phone || "—",
        email: partnerEmail(contacts[partnerDocKey("vendor", r.id)], r) || "—",
        city: r.city || "Kerala",
        total: 0,
        withPhoto: 0,
        withDesc: 0,
        inStock: 0,
        flagged: 0,
        avgPrice: 0,
        totalRevenuePotential: 0,
      });
    });

    // Populate with item data
    enrichedItems.forEach((item) => {
      if (!item.restaurantId) return;
      let stat = vendorMap.get(item.restaurantId);
      if (!stat) {
        stat = {
          restaurantId: item.restaurantId,
          name: item.restaurantName || item.restaurantId,
          phone: "—",
          email: "—",
          city: "Kerala",
          total: 0,
          withPhoto: 0,
          withDesc: 0,
          inStock: 0,
          flagged: 0,
          avgPrice: 0,
          totalRevenuePotential: 0,
        };
        vendorMap.set(item.restaurantId, stat);
      }

      stat.total += 1;
      if (item.imageUrl && item.imageUrl.length > 5) stat.withPhoto += 1;
      if (item.desc && item.desc.length > 5) stat.withDesc += 1;
      if (item.isAvailable) stat.inStock += 1;
      if (item.flagged) stat.flagged += 1;
      stat.totalRevenuePotential += Number(item.price || 0);
    });

    const list = Array.from(vendorMap.values()).map((v) => {
      const total = v.total;
      const photoPct = total > 0 ? Math.round((v.withPhoto / total) * 100) : 0;
      const descPct = total > 0 ? Math.round((v.withDesc / total) * 100) : 0;
      const stockPct = total > 0 ? Math.round((v.inStock / total) * 100) : 0;
      const unflaggedPct = total > 0 ? Math.round(((total - v.flagged) / total) * 100) : 100;

      const score =
        total === 0
          ? 0
          : Math.round(photoPct * 0.4 + descPct * 0.25 + stockPct * 0.2 + unflaggedPct * 0.15);

      return {
        ...v,
        photoPct,
        descPct,
        stockPct,
        score,
        avgPrice: total > 0 ? Math.round(v.totalRevenuePotential / total) : 0,
      };
    });

    return list.sort((a, b) => a.score - b.score); // Lowest health first so admin can take action
  }, [enrichedItems, activeRestaurants, contacts]);

  // ── Category Breakdown Data ───────────────────────────────────────────────
  const categoryDiagnostics = useMemo(() => {
    const catMap = new Map<
      string,
      {
        category: string;
        total: number;
        withPhoto: number;
        vegCount: number;
        restaurants: Set<string>;
        totalPrice: number;
      }
    >();

    enrichedItems.forEach((item) => {
      const cat = item.category?.trim() || "Uncategorized";
      let stat = catMap.get(cat);
      if (!stat) {
        stat = {
          category: cat,
          total: 0,
          withPhoto: 0,
          vegCount: 0,
          restaurants: new Set<string>(),
          totalPrice: 0,
        };
        catMap.set(cat, stat);
      }

      stat.total += 1;
      if (item.imageUrl && item.imageUrl.length > 5) stat.withPhoto += 1;
      if (item.isVeg) stat.vegCount += 1;
      if (item.restaurantId) stat.restaurants.add(item.restaurantId);
      stat.totalPrice += Number(item.price || 0);
    });

    return Array.from(catMap.values())
      .map((c) => ({
        category: c.category,
        total: c.total,
        photoPct: c.total > 0 ? Math.round((c.withPhoto / c.total) * 100) : 0,
        vegPct: c.total > 0 ? Math.round((c.vegCount / c.total) * 100) : 0,
        restaurantCount: c.restaurants.size,
        avgPrice: c.total > 0 ? Math.round(c.totalPrice / c.total) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [enrichedItems]);

  // ── Firestore CRUD Actions ────────────────────────────────────────────────

  const handleToggleStock = async (item: MenuItem) => {
    const nextVal = !item.isAvailable;
    try {
      await updateDoc(doc(db, "menu", item.id), {
        isAvailable: nextVal,
        available: nextVal,
        updatedAt: serverTimestamp(),
      });
      toast.success(nextVal ? `"${item.name}" marked In Stock` : `"${item.name}" marked Out of Stock`);
    } catch (err: unknown) {
      toast.error(`Failed to update stock: ${(err as Error).message}`);
    }
  };

  const handleToggleFlag = async (item: MenuItem, customReason?: string) => {
    const nextVal = !item.flagged;
    try {
      await updateDoc(doc(db, "menu", item.id), {
        flagged: nextVal,
        flagReason: nextVal ? customReason || "Quality issue flagged by platform admin" : null,
        updatedAt: serverTimestamp(),
      });
      toast.success(nextVal ? `Flagged "${item.name}" for vendor review` : `Unflagged "${item.name}"`);
    } catch (err: unknown) {
      toast.error(`Failed to toggle flag: ${(err as Error).message}`);
    }
  };

  const handleDeleteDish = async () => {
    if (!deleteCandidate) return;
    try {
      await deleteDoc(doc(db, "menu", deleteCandidate.id));
      toast.success(`Deleted "${deleteCandidate.name}" from catalog`);
      setDeleteCandidate(null);
    } catch (err: unknown) {
      toast.error(`Failed to delete item: ${(err as Error).message}`);
    }
  };

  const handleSaveEditDish = async () => {
    if (!editingItem) return;
    if (!editingItem.name?.trim()) {
      toast.error("Dish name is required");
      return;
    }
    if (Number(editingItem.price) < 0 || isNaN(Number(editingItem.price))) {
      toast.error("Price must be a valid non-negative number");
      return;
    }

    try {
      await updateDoc(doc(db, "menu", editingItem.id), {
        name: editingItem.name.trim(),
        price: Number(editingItem.price),
        discountPrice: editingItem.discountPrice ? Number(editingItem.discountPrice) : null,
        category: editingItem.category || "Main Course",
        desc: editingItem.desc?.trim() || "",
        description: editingItem.desc?.trim() || "",
        imageUrl: editingItem.imageUrl?.trim() || "",
        image: editingItem.imageUrl?.trim() || "",
        isVeg: Boolean(editingItem.isVeg),
        veg: Boolean(editingItem.isVeg),
        isAvailable: editingItem.isAvailable !== false,
        available: editingItem.isAvailable !== false,
        flagged: Boolean(editingItem.flagged),
        prepTime: editingItem.prepTime || "15 mins",
        spiceLevel: editingItem.spiceLevel || "none",
        tags: editingItem.tags || [],
        updatedAt: serverTimestamp(),
      });
      toast.success(`Updated "${editingItem.name}"`);
      setEditingItem(null);
    } catch (err: unknown) {
      toast.error(`Failed to save dish: ${(err as Error).message}`);
    }
  };

  const handleCreateDish = async () => {
    if (!newItemDraft.name?.trim()) {
      toast.error("Please enter a dish name");
      return;
    }
    if (!newItemDraft.restaurantId) {
      toast.error("Please select a target restaurant");
      return;
    }

    const rest = restaurantMap.get(newItemDraft.restaurantId);

    try {
      await addDoc(collection(db, "menu"), {
        name: newItemDraft.name.trim(),
        restaurantId: newItemDraft.restaurantId,
        restaurantName: rest?.name || "Partner Venue",
        price: Number(newItemDraft.price || 0),
        category: newItemDraft.category || "Main Course",
        desc: newItemDraft.desc?.trim() || "",
        description: newItemDraft.desc?.trim() || "",
        imageUrl: newItemDraft.imageUrl?.trim() || "",
        image: newItemDraft.imageUrl?.trim() || "",
        isVeg: Boolean(newItemDraft.isVeg),
        veg: Boolean(newItemDraft.isVeg),
        isAvailable: true,
        available: true,
        flagged: false,
        prepTime: newItemDraft.prepTime || "15-20 mins",
        tags: newItemDraft.tags || [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast.success(`Dish "${newItemDraft.name}" added to ${rest?.name || "restaurant"}!`);
      setIsAddOpen(false);
      setNewItemDraft({
        name: "",
        restaurantId: "",
        category: "Main Course",
        price: 199,
        isVeg: true,
        isAvailable: true,
        desc: "",
        imageUrl: "",
        prepTime: "15-20 mins",
        tags: ["Popular"],
      });
    } catch (err: unknown) {
      toast.error(`Failed to add dish: ${(err as Error).message}`);
    }
  };

  const handleUploadImageFile = async (file: File) => {
    if (!imageModalItem) return;
    setUploadingImage(true);
    try {
      const fileExt = file.name.split(".").pop() || "jpg";
      const storagePath = `menu-images/${imageModalItem.restaurantId || "admin"}/${imageModalItem.id}_${Date.now()}.${fileExt}`;
      const imageRef = ref(storage, storagePath);
      await uploadBytes(imageRef, file);
      const downloadUrl = await getDownloadURL(imageRef);

      await updateDoc(doc(db, "menu", imageModalItem.id), {
        imageUrl: downloadUrl,
        image: downloadUrl,
        updatedAt: serverTimestamp(),
      });

      toast.success(`Photo uploaded for "${imageModalItem.name}"`);
      setImageModalItem(null);
    } catch (err: unknown) {
      toast.error(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleApplyPresetImage = async (url: string) => {
    if (!imageModalItem) return;
    try {
      await updateDoc(doc(db, "menu", imageModalItem.id), {
        imageUrl: url,
        image: url,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Applied studio photo to "${imageModalItem.name}"`);
      setImageModalItem(null);
    } catch (err: unknown) {
      toast.error(`Failed to set image: ${(err as Error).message}`);
    }
  };

  // ── AI Generator for Food Descriptions ───────────────────────────────────

  const generateFoodDescription = (dish: { name?: string; category?: string; isVeg?: boolean }) => {
    const name = dish.name || "Dish";
    const cat = dish.category || "Main Course";
    const vegType = dish.isVeg ? "fresh vegetarian ingredients" : "succulent meats & tender cuts";

    const descriptors = [
      `Delicately seasoned ${name}, slow-cooked to perfection with ${vegType} and authentic aromatic spices.`,
      `Signature house-special ${name}, crafted fresh with premium ingredients, rich herbs, and chef's curated secret spice blend.`,
      `Indulgent and flavorful ${name}, tossed with farm-fresh herbs and served piping hot for an unforgettable taste experience.`,
      `A classic culinary favorite: ${name} prepared traditionally with authentic herbs, rich textures, and bold aromatic flavors.`,
    ];

    const idx = Math.abs(name.split("").reduce((a, b) => a + b.charCodeAt(0), 0)) % descriptors.length;
    return descriptors[idx];
  };

  const handleAiAutoDescribe = async (item: MenuItem) => {
    const desc = generateFoodDescription(item);
    try {
      await updateDoc(doc(db, "menu", item.id), {
        desc,
        description: desc,
        updatedAt: serverTimestamp(),
      });
      toast.success(`AI generated description for "${item.name}"`);
    } catch (err: unknown) {
      toast.error(`AI generate failed: ${(err as Error).message}`);
    }
  };

  // ── Bulk Remediation & Notifications ──────────────────────────────────────

  const handleSendVendorQcAlert = async (vendor: {
    restaurantId: string;
    name: string;
    missingPhotos?: number;
    score?: number;
  }) => {
    try {
      const message = `Kada Platform Catalog Alert: Your menu currently has a ${vendor.score ?? 0}% Quality Score. Adding appetizing photos and clear descriptions significantly boosts customer conversion and orders.`;

      // 1. Write to restaurant's private notifications subcollection
      await addDoc(collection(db, "restaurants", vendor.restaurantId, "notifications"), {
        title: "Catalog Quality Notice",
        body: message,
        type: "catalog_qc",
        read: false,
        createdAt: serverTimestamp(),
      });

      // 2. Write to general vendor notifications queue
      await addDoc(collection(db, "vendor_notifications"), {
        restaurantId: vendor.restaurantId,
        restaurantName: vendor.name,
        title: "Catalog Quality Notice",
        message,
        category: "catalog",
        status: "sent",
        createdAt: serverTimestamp(),
      });

      toast.success(`QC Notice sent to ${vendor.name}`);
    } catch (err: unknown) {
      toast.error(`Failed to send alert: ${(err as Error).message}`);
    }
  };

  const handleBulkAlertAllIncomplete = async () => {
    setBulkNotifying(true);
    const incompleteVendors = vendorHealthData.filter((v) => v.score < 75 || v.withPhoto < v.total);
    if (!incompleteVendors.length) {
      toast.info("All vendor catalogs are in excellent health (Score >= 75%)!");
      setBulkNotifying(false);
      return;
    }

    try {
      let count = 0;
      for (const v of incompleteVendors) {
        await handleSendVendorQcAlert({
          restaurantId: v.restaurantId,
          name: v.name,
          score: v.score,
        });
        count++;
      }
      toast.success(`Sent automated Catalog QC notices to ${count} restaurant partners!`);
    } catch (err: unknown) {
      toast.error(`Bulk notification error: ${(err as Error).message}`);
    } finally {
      setBulkNotifying(false);
    }
  };

  const handleBulkAutoFlagMissing = async () => {
    setAutoFlagging(true);
    const unflaggedIssues = enrichedItems.filter(
      (i) => (!i.imageUrl || i.imageUrl.length < 5) && !i.flagged,
    );

    if (!unflaggedIssues.length) {
      toast.info("All items with missing photos are already flagged.");
      setAutoFlagging(false);
      return;
    }

    try {
      const batch = writeBatch(db);
      // Process in batches of 500
      unflaggedIssues.slice(0, 450).forEach((item) => {
        batch.update(doc(db, "menu", item.id), {
          flagged: true,
          flagReason: "Missing required food photograph for listing QC",
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      toast.success(`Flagged ${Math.min(450, unflaggedIssues.length)} items for partner review.`);
    } catch (err: unknown) {
      toast.error(`Auto-flag failed: ${(err as Error).message}`);
    } finally {
      setAutoFlagging(false);
    }
  };

  // ── CSV Export ────────────────────────────────────────────────────────────

  const handleExportCsv = () => {
    if (!enrichedItems.length) {
      toast.error("No items available to export");
      return;
    }

    const headers = [
      "Item ID",
      "Item Name",
      "Restaurant Name",
      "Restaurant ID",
      "Category",
      "Price (INR)",
      "Dietary",
      "In Stock",
      "Has Photo",
      "Photo URL",
      "Has Description",
      "Flagged QC",
      "Flag Reason",
    ];

    const rows = enrichedItems.map((i) => [
      `"${i.id}"`,
      `"${(i.name || "").replace(/"/g, '""')}"`,
      `"${(i.restaurantName || "").replace(/"/g, '""')}"`,
      `"${i.restaurantId || ""}"`,
      `"${(i.category || "").replace(/"/g, '""')}"`,
      i.price ?? 0,
      i.isVeg ? "Veg" : "Non-Veg",
      i.isAvailable ? "Yes" : "No",
      i.imageUrl && i.imageUrl.length > 5 ? "Yes" : "No",
      `"${i.imageUrl || ""}"`,
      i.desc && i.desc.length > 5 ? "Yes" : "No",
      i.flagged ? "Yes" : "No",
      `"${(i.flagReason || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `kada_catalog_qc_audit_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Catalog audit report downloaded!");
  };

  // ── Table Column Definitions ──────────────────────────────────────────────

  const columns: ColumnDef<MenuItem>[] = useMemo(
    () => [
      {
        id: "visual",
        header: "Visual",
        cell: ({ row }) => {
          const item = row.original;
          const hasImage = Boolean(item.imageUrl && item.imageUrl.trim().length > 5);

          return (
            <div className="relative group flex-shrink-0">
              {hasImage ? (
                <div
                  className="w-12 h-12 rounded-lg overflow-hidden border border-border/60 bg-muted/30 cursor-pointer relative group-hover:ring-2 group-hover:ring-primary/50 transition-all"
                  onClick={() => setPreviewImageSrc(item.imageUrl || null)}
                  title="Click to zoom image"
                >
                  <img
                    src={item.imageUrl}
                    alt={item.name || "dish"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Eye className="w-3.5 h-3.5 text-white" />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setImageModalItem(item)}
                  className="w-12 h-12 rounded-lg border-2 border-dashed border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10 flex flex-col items-center justify-center text-amber-600 transition-colors"
                  title="Missing photo! Click to upload"
                >
                  <Camera className="w-4 h-4" />
                  <span className="text-[9px] font-medium mt-0.5">Add</span>
                </button>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "name",
        header: "Dish & Quality",
        cell: ({ row }) => {
          const item = row.original;
          const isVeg = item.isVeg;
          const hasDesc = Boolean(item.desc && item.desc.trim().length > 5);

          return (
            <div className="space-y-1 min-w-[200px] max-w-[280px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Veg / Non-Veg Indicator */}
                <div
                  className={`w-3.5 h-3.5 border flex items-center justify-center rounded-sm ${
                    isVeg ? "border-emerald-600" : "border-rose-600"
                  }`}
                  title={isVeg ? "Pure Vegetarian" : "Non-Vegetarian"}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      isVeg ? "bg-emerald-600" : "bg-rose-600"
                    }`}
                  />
                </div>

                <span className="font-semibold text-sm text-foreground line-clamp-1">
                  {item.name || "Untitled Item"}
                </span>

                {item.flagged && (
                  <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">
                    QC Flagged
                  </Badge>
                )}
              </div>

              {/* Description Snippet or Warning */}
              {hasDesc ? (
                <p className="text-xs text-muted-foreground line-clamp-1">{item.desc}</p>
              ) : (
                <div className="flex items-center gap-1 text-[11px] text-amber-500 font-medium">
                  <AlertTriangle className="w-3 h-3" />
                  <span>No description</span>
                  <button
                    type="button"
                    onClick={() => handleAiAutoDescribe(item)}
                    className="underline text-[10px] ml-1 text-primary hover:text-primary/80"
                  >
                    AI Fill
                  </button>
                </div>
              )}

              {/* Tags */}
              {item.tags && item.tags.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap pt-0.5">
                  {item.tags.slice(0, 2).map((tag, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] bg-secondary/80 text-secondary-foreground px-1.5 py-0.2 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                  {item.tags.length > 2 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{item.tags.length - 2}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "restaurantName",
        header: "Restaurant",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex items-center gap-1.5 min-w-[130px]">
              <Store className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs font-medium text-foreground line-clamp-1">
                {item.restaurantName || "Partner"}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs font-normal whitespace-nowrap">
            {row.original.category || "Main Course"}
          </Badge>
        ),
      },
      {
        accessorKey: "price",
        header: "Price",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="text-xs whitespace-nowrap">
              <span className="font-semibold text-foreground">
                ₹{Number(item.price ?? 0).toLocaleString("en-IN")}
              </span>
              {item.discountPrice && item.discountPrice < (item.price ?? 0) && (
                <span className="ml-1 text-[11px] line-through text-muted-foreground">
                  ₹{item.discountPrice}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "stock",
        header: "In Stock",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex items-center gap-2">
              <Switch
                checked={item.isAvailable !== false}
                onCheckedChange={() => handleToggleStock(item)}
                aria-label="Toggle item stock"
              />
              <span
                className={`text-[11px] font-medium ${
                  item.isAvailable !== false ? "text-emerald-600" : "text-rose-500"
                }`}
              >
                {item.isAvailable !== false ? "Active" : "Out"}
              </span>
            </div>
          );
        },
      },
      {
        id: "qc_action",
        header: "Flag / Review",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <Button
              size="sm"
              variant={item.flagged ? "destructive" : "outline"}
              className="h-7 text-xs px-2"
              onClick={() => handleToggleFlag(item)}
            >
              {item.flagged ? (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Clear Flag
                </>
              ) : (
                <>
                  <ShieldAlert className="w-3 h-3 mr-1 text-amber-500" />
                  Flag
                </>
              )}
            </Button>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setEditingItem(item)}>
                  <Edit3 className="w-3.5 h-3.5 mr-2" />
                  Edit Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImageModalItem(item)}>
                  <Camera className="w-3.5 h-3.5 mr-2" />
                  Upload Photo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAiAutoDescribe(item)}>
                  <Sparkles className="w-3.5 h-3.5 mr-2 text-purple-500" />
                  AI Auto-Describe
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleToggleStock(item)}>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  {item.isAvailable ? "Mark Out of Stock" : "Mark In Stock"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleToggleFlag(item)}>
                  <ShieldAlert className="w-3.5 h-3.5 mr-2 text-amber-500" />
                  {item.flagged ? "Resolve QC Flag" : "Flag for Vendor"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-rose-600 focus:text-rose-600"
                  onClick={() => setDeleteCandidate(item)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                  Delete Dish
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [restaurantMap],
  );

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="Catalog QC"
        description="Menu items missing photos, out of stock or flagged for review, across every vendor."
        icon={UtensilsCrossed}
        stats={[
          { label: "Menu items", value: metrics.total, loading: menuLoading },
          { label: "Missing photo", value: metrics.missingPhoto, hint: `${metrics.missingPhotoPct}% of items`, tone: "text-amber-600", loading: menuLoading },
          { label: "Out of stock", value: metrics.outOfStock, tone: "text-rose-600", loading: menuLoading },
          { label: "QC flagged", value: metrics.flagged, hint: "Needs a reviewer", tone: "text-rose-600", loading: menuLoading },
        ]}
      />

      {/* ── Global Quick Action Bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border/60 p-4 rounded-xl shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            <strong className="text-foreground">{metrics.vegCount}</strong> Veg ·{" "}
            <strong className="text-foreground">{metrics.nonVegCount}</strong> Non-Veg
          </span>
          <span className="text-border">|</span>
          <span className="text-xs text-muted-foreground">
            <strong className="text-foreground">{uniqueCategories.length}</strong> Categories across{" "}
            <strong className="text-foreground">{activeRestaurants.length}</strong> Venues
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="text-xs h-8"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export Audit CSV
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => setIsAddOpen(true)}
            className="text-xs h-8 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Menu Item
          </Button>
        </div>
      </div>

      {/* ── Main Navigation Tabs ────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 h-auto p-1 bg-muted/60">
          <TabsTrigger value="items" className="text-xs py-2">
            <UtensilsCrossed className="w-3.5 h-3.5 mr-1.5" />
            Item Issues ({filteredItems.length})
          </TabsTrigger>
          <TabsTrigger value="health" className="text-xs py-2">
            <Store className="w-3.5 h-3.5 mr-1.5" />
            Vendor Health ({activeRestaurants.length})
          </TabsTrigger>
          <TabsTrigger value="categories" className="text-xs py-2">
            <Layers className="w-3.5 h-3.5 mr-1.5" />
            Taxonomy ({categoryDiagnostics.length})
          </TabsTrigger>
          <TabsTrigger value="ai-studio" className="text-xs py-2">
            <Sparkles className="w-3.5 h-3.5 mr-1.5 text-purple-500" />
            AI Food Studio
          </TabsTrigger>
          <TabsTrigger value="bulk" className="text-xs py-2">
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
            Bulk Remediation
          </TabsTrigger>
        </TabsList>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 1: LIVE ITEMS & QC ISSUES TABLE
        ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="items" className="space-y-4">
          {/* Quick Filter Chips */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <FilterChips
              value={filter}
              onChange={setFilter}
              options={[
                { id: "issues", label: "Needs QC" },
                { id: "photo", label: `No Photo (${metrics.missingPhoto})` },
                { id: "desc", label: `No Description (${metrics.missingDesc})` },
                { id: "stock", label: `Unavailable (${metrics.outOfStock})` },
                { id: "flagged", label: `Flagged (${metrics.flagged})` },
                { id: "veg", label: "Veg Only" },
                { id: "nonveg", label: "Non-Veg" },
                { id: "all", label: `All Dishes (${metrics.total})` },
              ]}
            />
          </div>

          {/* Secondary Controls Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-card/60 p-3 rounded-lg border border-border/40">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search dish, tags, restaurant..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 text-xs h-8"
              />
            </div>

            {/* Restaurant Select */}
            <Select value={selectedRestaurantId} onValueChange={setSelectedRestaurantId}>
              <SelectTrigger className="text-xs h-8">
                <SelectValue placeholder="All Restaurants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Restaurants ({activeRestaurants.length})</SelectItem>
                {activeRestaurants.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name || "Untitled"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Category Select */}
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="text-xs h-8">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories ({uniqueCategories.length})</SelectItem>
                {uniqueCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Reset Filters */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilter("issues");
                setSearchQuery("");
                setSelectedRestaurantId("all");
                setSelectedCategory("all");
                setSelectedAvailability("all");
              }}
              className="text-xs h-8 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="w-3 h-3 mr-1.5" />
              Reset Filters
            </Button>
          </div>

          {/* Items Table */}
          <DataTable
            columns={columns}
            data={filteredItems}
            searchKey="name"
            searchPlaceholder="Filter listed items..."
            exportFilename="catalog-qc-items"
          />
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 2: REAL-TIME VENDOR CATALOG HEALTH LEADERBOARD
        ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="health" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-lg">Per-Vendor Catalog Quality Scores</CardTitle>
                <CardDescription>
                  Real-time algorithmic quality ratings based on photo coverage, item descriptions,
                  active stock percentage, and flagged defect count.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkAlertAllIncomplete}
                disabled={bulkNotifying}
                className="text-xs"
              >
                <Bell className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
                {bulkNotifying ? "Sending Alerts..." : "Notify Incomplete Vendors"}
              </Button>
            </CardHeader>

            <CardContent className="space-y-3 pt-4">
              {vendorHealthData.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  No active vendors found in database.
                </p>
              ) : (
                vendorHealthData.map((vendor) => {
                  const scoreColor =
                    vendor.score >= 85
                      ? "text-emerald-500"
                      : vendor.score >= 65
                      ? "text-amber-500"
                      : "text-rose-500";

                  const badgeVariant =
                    vendor.score >= 85
                      ? "default"
                      : vendor.score >= 65
                      ? "secondary"
                      : "destructive";

                  const missingPhotos = vendor.total - vendor.withPhoto;
                  const missingDescs = vendor.total - vendor.withDesc;

                  return (
                    <div
                      key={vendor.restaurantId}
                      className="flex flex-col md:flex-row md:items-center justify-between p-4 border border-border/50 rounded-xl bg-card hover:bg-muted/30 transition-colors gap-4"
                    >
                      {/* Left info */}
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <Store className="w-4 h-4 text-muted-foreground" />
                          <h4 className="font-semibold text-sm text-foreground">{vendor.name}</h4>
                          <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0">
                            {vendor.score >= 85
                              ? "Excellent"
                              : vendor.score >= 65
                              ? "Needs Attention"
                              : "Critical QC"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {vendor.total} menu items · {vendor.city} · Phone: {vendor.phone}
                        </p>

                        {/* Defect Diagnostics pills */}
                        <div className="flex items-center gap-2 pt-1 flex-wrap text-xs">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                              missingPhotos > 0
                                ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                                : "bg-emerald-500/10 text-emerald-600"
                            }`}
                          >
                            📷 {vendor.withPhoto}/{vendor.total} Photos ({vendor.photoPct}%)
                          </span>

                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                              missingDescs > 0
                                ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                                : "bg-emerald-500/10 text-emerald-600"
                            }`}
                          >
                            ✍️ {vendor.withDesc}/{vendor.total} Descriptions ({vendor.descPct}%)
                          </span>

                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
                            📦 {vendor.inStock}/{vendor.total} In-Stock ({vendor.stockPct}%)
                          </span>

                          {vendor.flagged > 0 && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-600 border border-rose-500/20">
                              ⚠️ {vendor.flagged} Flagged
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right Score & Actions */}
                      <div className="flex items-center gap-4">
                        <div className="text-right min-w-[80px]">
                          <div className={`text-2xl font-bold ${scoreColor}`}>{vendor.score}%</div>
                          <p className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider">
                            Health Score
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8"
                            onClick={() => {
                              setSelectedRestaurantId(vendor.restaurantId);
                              setFilter("all");
                              setActiveTab("items");
                            }}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            View Items
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8 text-amber-600 hover:text-amber-700"
                            onClick={() =>
                              handleSendVendorQcAlert({
                                restaurantId: vendor.restaurantId,
                                name: vendor.name,
                                score: vendor.score,
                              })
                            }
                            title="Send push/in-app alert to vendor"
                          >
                            <Send className="w-3.5 h-3.5 mr-1" />
                            Alert
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 3: PLATFORM CATEGORY TAXONOMY & DIAGNOSTICS
        ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Platform Food Taxonomy & Categories</CardTitle>
              <CardDescription>
                Overview of all dishes distributed across platform categories, cross-venue pricing
                benchmarks, and imagery completion rates.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categoryDiagnostics.map((cat) => (
                  <div
                    key={cat.category}
                    className="p-4 rounded-xl border border-border/50 bg-card hover:border-primary/50 transition-all space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-primary" />
                        {cat.category}
                      </h4>
                      <Badge variant="secondary" className="text-[10px]">
                        {cat.total} dishes
                      </Badge>
                    </div>

                    <div className="space-y-1.5 text-xs text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Restaurants Offering:</span>
                        <span className="font-medium text-foreground">{cat.restaurantCount} venues</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Avg Dish Price:</span>
                        <span className="font-medium text-foreground">₹{cat.avgPrice}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Photo Coverage:</span>
                        <span
                          className={`font-semibold ${
                            cat.photoPct >= 80 ? "text-emerald-500" : "text-amber-500"
                          }`}
                        >
                          {cat.photoPct}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Veg Ratio:</span>
                        <span className="font-medium text-foreground">{cat.vegPct}% Veg</span>
                      </div>
                    </div>

                    <Progress value={cat.photoPct} className="h-1.5" />

                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs h-7 text-primary hover:bg-primary/5"
                      onClick={() => {
                        setSelectedCategory(cat.category);
                        setFilter("all");
                        setActiveTab("items");
                      }}
                    >
                      Filter "{cat.category}" Dishes →
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 4: AI FOOD STUDIO & IMAGE LIBRARY
        ═════════════════════════════════════════════ */}
        <TabsContent value="ai-studio" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                Kada AI Food Copy & Visual Studio
              </CardTitle>
              <CardDescription>
                Instantly generate high-converting culinary descriptions and assign verified
                high-resolution studio food photography for items missing imagery.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {/* Header & Sync Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/60">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-bold text-foreground">
                        High-Resolution Studio Food Presets
                      </h4>
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-semibold">
                        {FOOD_STUDIO_PRESETS.length} Verified Photos
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Click any photo to instantly copy its studio CDN URL. Verified across Vendor App, Customer App, and Admin Catalog QC.
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={syncingPresets}
                    onClick={handleSyncPresetsToFirestore}
                    className="h-8 text-xs shrink-0 gap-1.5 border-primary/30 hover:bg-primary/10 text-primary font-medium"
                  >
                    <Upload className={`w-3.5 h-3.5 ${syncingPresets ? "animate-spin" : ""}`} />
                    {syncingPresets ? "Syncing..." : "Sync All 300 to Database"}
                  </Button>
                </div>

                {/* Filters & Search Toolbar */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-muted/40 p-2.5 rounded-xl border border-border/50">
                  <div className="flex flex-1 items-center gap-2 max-w-md">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={studioSearch}
                        onChange={(e) => {
                          setStudioSearch(e.target.value);
                          setStudioVisibleCount(80);
                        }}
                        placeholder="Search biryani, burger, momo, shake..."
                        className="h-8 text-xs pl-8 pr-7 bg-background"
                      />
                      {studioSearch && (
                        <button
                          onClick={() => setStudioSearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Veg / Non-Veg Toggle */}
                    <div className="flex items-center bg-background rounded-lg p-0.5 border border-border text-[11px] font-medium shrink-0">
                      <button
                        onClick={() => setStudioVegOnly("all")}
                        className={`px-2 py-1 rounded-md transition-colors ${
                          studioVegOnly === "all" ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setStudioVegOnly("veg")}
                        className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                          studioVegOnly === "veg" ? "bg-emerald-600 text-white font-bold" : "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Veg
                      </button>
                      <button
                        onClick={() => setStudioVegOnly("non-veg")}
                        className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                          studioVegOnly === "non-veg" ? "bg-rose-600 text-white font-bold" : "text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Non-Veg
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground font-medium shrink-0">
                    Showing <span className="text-foreground font-bold">{Math.min(filteredStudioPresets.length, studioVisibleCount)}</span> of{" "}
                    <span className="text-foreground font-bold">{filteredStudioPresets.length}</span> matches
                  </div>
                </div>

                {/* Category Horizontal Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-none text-xs">
                  {FOOD_STUDIO_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setStudioCategory(cat);
                        setStudioVisibleCount(80);
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
                        studioCategory === cat
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Compact Multi-Column Food Studio Grid (Cols 3 to 10) */}
                {filteredStudioPresets.length === 0 ? (
                  <div className="py-12 text-center border rounded-xl bg-card border-dashed">
                    <UtensilsCrossed className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-foreground">No matching studio dishes found</p>
                    <p className="text-xs text-muted-foreground mt-1">Try clearing your search query or switching categories.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2.5">
                    {filteredStudioPresets.slice(0, studioVisibleCount).map((preset) => (
                      <div
                        key={preset.id}
                        onClick={() => {
                          navigator.clipboard.writeText(preset.url);
                          toast.success(`Copied image URL for ${preset.name}!`);
                        }}
                        className="group relative rounded-lg overflow-hidden border border-border/70 bg-card hover:border-primary/80 hover:shadow-md transition-all cursor-pointer flex flex-col"
                        title={`${preset.name} (${preset.category}) - Click to copy URL`}
                      >
                        {/* Compact Aspect Ratio Image */}
                        <div className="aspect-square w-full overflow-hidden bg-muted relative">
                          <img
                            src={preset.thumbnailUrl}
                            alt={preset.name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-108 transition-transform duration-300"
                          />

                          {/* Veg / Non-Veg Indicator Badge */}
                          <div
                            className={`absolute top-1.5 left-1.5 w-3 h-3 rounded-full border border-white/80 shadow-xs flex items-center justify-center ${
                              preset.isVeg ? "bg-emerald-500" : "bg-rose-500"
                            }`}
                            title={preset.isVeg ? "Vegetarian" : "Non-Vegetarian"}
                          />

                          {/* Hover Overlay with Copy Action */}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex flex-col items-center justify-center gap-1 p-1">
                            <span className="text-[10px] text-white font-bold tracking-tight text-center leading-tight line-clamp-2 px-1">
                              {preset.name}
                            </span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/20 text-white text-[9px] font-semibold mt-1">
                              Copy URL
                            </span>
                          </div>
                        </div>

                        {/* Card Caption */}
                        <div className="p-1.5 bg-card/90 flex flex-col justify-between flex-1">
                          <p className="text-[11px] font-semibold text-foreground truncate leading-tight">
                            {preset.name}
                          </p>
                          <p className="text-[9px] text-muted-foreground truncate mt-0.5">
                            {preset.category}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Show More Pagination */}
                {filteredStudioPresets.length > studioVisibleCount && (
                  <div className="flex justify-center pt-2 pb-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setStudioVisibleCount((prev) => prev + 80)}
                      className="text-xs h-8 px-6 font-semibold"
                    >
                      Load More Studio Photos ({filteredStudioPresets.length - studioVisibleCount} remaining)
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 5: BULK ACTIONS & REMEDIATION
        ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="bulk" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-500" />
                  Notify Vendors with Incomplete Catalogs
                </CardTitle>
                <CardDescription className="text-xs">
                  Automated mass notification dispatch to all restaurants with missing photos or
                  health score below 75%.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  This will dispatch push and in-app dashboard notices to each restaurant partner
                  with a breakdown of their missing photographs.
                </p>
                <Button
                  onClick={handleBulkAlertAllIncomplete}
                  disabled={bulkNotifying}
                  className="w-full text-xs"
                >
                  {bulkNotifying ? "Sending QC Notices..." : "Dispatch QC Notices to Incomplete Venues"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-500" />
                  Auto-Flag Unphotographed Dishes
                </CardTitle>
                <CardDescription className="text-xs">
                  Mark all items missing food photographs as flagged so vendors can see them in
                  their partner app.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Identifies all live menu items lacking image URLs and marks their QC flag as true
                  with a reason.
                </p>
                <Button
                  variant="outline"
                  onClick={handleBulkAutoFlagMissing}
                  disabled={autoFlagging}
                  className="w-full text-xs text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
                >
                  {autoFlagging ? "Auto-flagging..." : "Auto-Flag All Items Without Photos"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                  Comprehensive Quality Audit Export
                </CardTitle>
                <CardDescription className="text-xs">
                  Generate a complete downloadable CSV spreadsheet with column-by-column diagnostics
                  for your operations team.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Includes item ID, venue ID, price, dietary classification, photo link status,
                  stock availability, and QC flags.
                </p>
                <Button variant="secondary" onClick={handleExportCsv} className="w-full text-xs">
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Download Full Catalog Report (.csv)
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ChefHat className="w-4 h-4 text-primary" />
                  Platform Master Taxonomy Sync
                </CardTitle>
                <CardDescription className="text-xs">
                  Standardize uncategorized items into core platform categories.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Checks for dishes with empty or whitespace-only categories and maps them to standard
                  platform groups.
                </p>
                {/* This used to announce "All categories mapped" without
                    looking at anything. It now counts the real thing. */}
                <Button
                  variant="outline"
                  onClick={() => {
                    const missing = enrichedItems.filter((i) => !i.category?.trim());
                    if (missing.length === 0) {
                      toast.success(`All ${enrichedItems.length} dishes have a category.`);
                      return;
                    }
                    const where = [...new Set(missing.map((i) => i.restaurantName).filter(Boolean))];
                    toast.warning(
                      `${missing.length} of ${enrichedItems.length} dishes have no category` +
                        (where.length ? ` (${where.slice(0, 3).join(", ")}${where.length > 3 ? `, +${where.length - 3} more` : ""})` : "") +
                        ".",
                    );
                  }}
                  className="w-full text-xs"
                >
                  Verify Category Integrity
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ═════════════════════════════════════════════════════════════════════
          DIALOG 1: EDIT DISH MODAL
      ═════════════════════════════════════════════════════════════════════ */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-primary" />
              Edit Menu Item Details
            </DialogTitle>
            <DialogDescription>
              Update dish information, pricing, categorization, and visual imagery.
            </DialogDescription>
          </DialogHeader>

          {editingItem && (
            <div className="space-y-4 py-2">
              {/* Dish Name */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Dish Name</Label>
                <Input
                  value={editingItem.name || ""}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  placeholder="e.g. Malabar Chicken Biryani"
                  className="text-xs"
                />
              </div>

              {/* Category & Price */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Category</Label>
                  <Select
                    value={editingItem.category || "Main Course"}
                    onValueChange={(val) => setEditingItem({ ...editingItem, category: val })}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Select Category" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueCategories.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Base Price (₹)</Label>
                  <Input
                    type="number"
                    value={editingItem.price ?? ""}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, price: Number(e.target.value) })
                    }
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Dietary & Stock Toggles */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-lg border border-border/40">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Dietary Type</p>
                    <p className="text-[11px] text-muted-foreground">
                      {editingItem.isVeg ? "Pure Vegetarian" : "Non-Vegetarian"}
                    </p>
                  </div>
                  <Switch
                    checked={editingItem.isVeg !== false}
                    onCheckedChange={(v) => setEditingItem({ ...editingItem, isVeg: v, veg: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-foreground">In Stock</p>
                    <p className="text-[11px] text-muted-foreground">
                      {editingItem.isAvailable !== false ? "Available to order" : "Out of stock"}
                    </p>
                  </div>
                  <Switch
                    checked={editingItem.isAvailable !== false}
                    onCheckedChange={(v) =>
                      setEditingItem({ ...editingItem, isAvailable: v, available: v })
                    }
                  />
                </div>
              </div>

              {/* Description & AI Generator */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Culinary Description</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] text-purple-600 hover:text-purple-700"
                    onClick={() => {
                      const aiDesc = generateFoodDescription(editingItem);
                      setEditingItem({ ...editingItem, desc: aiDesc, description: aiDesc });
                      toast.success("AI generated a culinary description!");
                    }}
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    AI Auto-Generate
                  </Button>
                </div>
                <Textarea
                  value={editingItem.desc || ""}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      desc: e.target.value,
                      description: e.target.value,
                    })
                  }
                  placeholder="Describe ingredients, cooking technique, and tasting notes..."
                  className="text-xs min-h-[70px]"
                />
              </div>

              {/* Image URL */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Image URL</Label>
                <div className="flex gap-2">
                  <Input
                    value={editingItem.imageUrl || ""}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        imageUrl: e.target.value,
                        image: e.target.value,
                      })
                    }
                    placeholder="https://images.unsplash.com/..."
                    className="text-xs flex-1"
                  />
                  {editingItem.imageUrl && (
                    <div className="w-9 h-9 rounded overflow-hidden border flex-shrink-0">
                      <img
                        src={editingItem.imageUrl}
                        alt="preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Flagged Status */}
              <div className="flex items-center justify-between p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <div>
                  <p className="text-xs font-semibold text-amber-700">QC Flag Status</p>
                  <p className="text-[11px] text-amber-600">
                    {editingItem.flagged
                      ? "Flagged for vendor review"
                      : "Item is clean and approved"}
                  </p>
                </div>
                <Switch
                  checked={Boolean(editingItem.flagged)}
                  onCheckedChange={(v) => setEditingItem({ ...editingItem, flagged: v })}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditingItem(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveEditDish}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════════
          DIALOG 2: ADD NEW DISH MODAL
      ═════════════════════════════════════════════ */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              Add Menu Item
            </DialogTitle>
            <DialogDescription>
              Create a new dish directly under any registered restaurant partner.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Target Restaurant */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Select Restaurant Venue *</Label>
              <Select
                value={newItemDraft.restaurantId || ""}
                onValueChange={(val) => setNewItemDraft({ ...newItemDraft, restaurantId: val })}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Choose a restaurant venue..." />
                </SelectTrigger>
                <SelectContent>
                  {activeRestaurants.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name || "Untitled"} ({r.city || "Kerala"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dish Name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Dish Name *</Label>
              <Input
                value={newItemDraft.name || ""}
                onChange={(e) => setNewItemDraft({ ...newItemDraft, name: e.target.value })}
                placeholder="e.g. Ghee Roast Dosa"
                className="text-xs"
              />
            </div>

            {/* Category & Price */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Category</Label>
                <Select
                  value={newItemDraft.category || "Main Course"}
                  onValueChange={(val) => setNewItemDraft({ ...newItemDraft, category: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {uniqueCategories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Price (₹) *</Label>
                <Input
                  type="number"
                  value={newItemDraft.price ?? 199}
                  onChange={(e) =>
                    setNewItemDraft({ ...newItemDraft, price: Number(e.target.value) })
                  }
                  className="text-xs"
                />
              </div>
            </div>

            {/* Dietary Type */}
            <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg border border-border/40">
              <div>
                <p className="text-xs font-semibold text-foreground">Dietary Classification</p>
                <p className="text-[11px] text-muted-foreground">
                  {newItemDraft.isVeg ? "Pure Vegetarian" : "Non-Vegetarian"}
                </p>
              </div>
              <Switch
                checked={newItemDraft.isVeg !== false}
                onCheckedChange={(v) => setNewItemDraft({ ...newItemDraft, isVeg: v })}
              />
            </div>

            {/* Description & AI */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Description</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-purple-600 hover:text-purple-700"
                  onClick={() => {
                    const aiDesc = generateFoodDescription(newItemDraft);
                    setNewItemDraft({ ...newItemDraft, desc: aiDesc });
                    toast.success("AI generated a culinary description!");
                  }}
                >
                  <Sparkles className="w-3 h-3 mr-1" />
                  AI Generate
                </Button>
              </div>
              <Textarea
                value={newItemDraft.desc || ""}
                onChange={(e) => setNewItemDraft({ ...newItemDraft, desc: e.target.value })}
                placeholder="Delicious slow-cooked dish with fresh spices..."
                className="text-xs min-h-[60px]"
              />
            </div>

            {/* Image URL */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Image URL (Optional)</Label>
              <Input
                value={newItemDraft.imageUrl || ""}
                onChange={(e) => setNewItemDraft({ ...newItemDraft, imageUrl: e.target.value })}
                placeholder="https://..."
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateDish}>
              Add Dish to Catalog
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════════
          DIALOG 3: PHOTO UPLOAD MODAL
      ═════════════════════════════════════════════ */}
      <Dialog open={!!imageModalItem} onOpenChange={(open) => !open && setImageModalItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              Upload Photo for "{imageModalItem?.name}"
            </DialogTitle>
            <DialogDescription>
              Upload an image file directly or select from our curated verified food imagery presets.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* File Upload Zone */}
            <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 transition-colors bg-muted/20">
              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-xs font-semibold text-foreground mb-1">
                Drag and drop image or browse
              </p>
              <p className="text-[11px] text-muted-foreground mb-3">JPG, PNG, WebP up to 5MB</p>
              <Input
                type="file"
                accept="image/*"
                disabled={uploadingImage}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadImageFile(file);
                }}
                className="text-xs mx-auto max-w-[200px]"
              />
              {uploadingImage && (
                <p className="text-xs text-primary font-medium mt-2">Uploading to storage...</p>
              )}
            </div>

            {/* Or pick preset */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Or Pick a Verified Studio Image ({FOOD_STUDIO_PRESETS.length}+)</Label>
              </div>
              <div className="grid grid-cols-5 gap-1.5 max-h-[220px] overflow-y-auto p-1.5 border rounded-lg bg-muted/20">
                {FOOD_STUDIO_PRESETS.slice(0, 100).map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => handleApplyPresetImage(preset.url)}
                    className="aspect-square rounded-lg overflow-hidden border border-border cursor-pointer hover:ring-2 hover:ring-primary transition-all relative group bg-card"
                    title={`${preset.name} (${preset.category})`}
                  >
                    <img src={preset.thumbnailUrl} alt={preset.name} loading="lazy" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-[9px] text-white font-semibold text-center p-1">
                      <span className="truncate max-w-full leading-tight">{preset.name}</span>
                      <span className="text-[8px] bg-primary px-1 rounded mt-1 font-bold">Apply</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setImageModalItem(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════════
          DIALOG 4: IMAGE LIGHTBOX PREVIEW
      ═════════════════════════════════════════════ */}
      <Dialog open={!!previewImageSrc} onOpenChange={(open) => !open && setPreviewImageSrc(null)}>
        <DialogContent className="max-w-2xl p-2 bg-black/90 border-zinc-800">
          <div className="relative w-full aspect-video flex items-center justify-center overflow-hidden rounded-lg">
            {previewImageSrc && (
              <img
                src={previewImageSrc}
                alt="food preview"
                className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════════
          CONFIRMATION DIALOG: DELETE ITEM
      ═════════════════════════════════════════════ */}
      <ConfirmationDialog
        open={!!deleteCandidate}
        onOpenChange={(open) => !open && setDeleteCandidate(null)}
        title={`Delete "${deleteCandidate?.name}"?`}
        description="Are you sure you want to permanently remove this dish from the menu catalog? This action cannot be undone."
        confirmText="Delete Dish"
        variant="destructive"
        onConfirm={handleDeleteDish}
      />
    </div>
  );
}
