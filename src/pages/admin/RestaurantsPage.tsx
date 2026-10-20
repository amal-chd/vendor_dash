import {
  CheckCircle2,
  Clock,
  XCircle,
  ShieldAlert,
  ShieldCheck,
  Mail,
  Phone,
  Copy,
  Trash2,
  MoreHorizontal,
  LogIn,
  AlertTriangle,
  Building2,
  Loader2,
  Ban,
  Unlock,
  MapPinOff,
  CalendarX,
  KeyRound,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { useAdminScope } from "@/hooks/useAdminScope";
import { ZoneBadge, ZoneScopeChip } from "@/components/admin/zones/ZoneScopeBar";
import { HealthChip } from "@/components/admin/ops/OpsAlerts";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { usePartnerContacts } from "@/hooks/usePartnerPrivate";
import { OPS_QUEUE_STATES, partnerDocKey, publicBankLabel } from "@/lib/onboarding";
import { StatCards } from "@/components/admin/StatCards";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { indiaStates } from "@/constants/indiaData";
import { useGeoData } from "@/hooks/useGeoData";
import PhoneInput, { isValidPhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  collection,
  onSnapshot,
  query,
  doc,
  updateDoc,
  writeBatch,
  addDoc,
  serverTimestamp,
  limit,
  getCountFromServer,
  where,
} from "firebase/firestore";
import { db, auth, functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { toast } from "sonner";
import { adminActionToast } from "@/lib/admin-ops";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/admin/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ResetPasswordDialog } from "@/components/admin/vendors/ResetPasswordDialog";
import { VendorContactDialog } from "@/components/admin/vendors/VendorContactDialog";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Restaurant {
  id: string;
  /** Server-resolved service zone. Absent means the vendor is invisible to customers. */
  zoneId?: string | null;
  zoneName?: string | null;
  marketId?: string | null;
  zoneAssignment?: "auto" | "manual";
  name: string;
  email: string;
  phone: string;
  state?: string;
  district?: string;
  subscriptionStatus?: "active" | "trial" | "paused" | "expired" | "pending" | "grace_period" | "cancelled";
  subscriptionType?: "monthly" | "yearly" | "trial";
  planTier?: "starter" | "growth" | "enterprise";
  /** Plan id written by the web checkout (subscriptionBilling.ts). */
  subscriptionPlan?: string;
  /** Absent ⇒ commission (functions/src/billingModel.ts). */
  billingModel?: "commission" | "subscription";
  subscriptionStartDate?: any;
  subscriptionEndDate?: any;
  isBlocked?: boolean;
  isVerified?: boolean;
  kycStatus?: "pending" | "approved" | "rejected";
  /** Onboarding engine state — see src/lib/onboarding.ts. */
  onboarding?: { state?: string };
  kyc?: {
    fssai?: string;
    gst?: string;
  };
  /** Public summary only — full details live in partner_private. */
  bank?: { accountMasked?: string; ifscBank?: string | null; verificationState?: string };
  isDeleted?: boolean;
  isOutlet?: boolean;
  countryCode?: string;
  dialCode?: string;
  currencyCode?: string;
  currencySymbol?: string;
  timezone?: string;
  locale?: string;
  taxConfiguration?: any[];
  parentId?: string;
  createdAt?: any;
  ownerId?: string;
  /** Kada Gold partner discount (%) members get off the food subtotal (0–30). */
  goldDiscountPercent?: number;
  commissionRate?: number;
  outlets?: Restaurant[];
}

type FilterKey = "all" | "active" | "commission" | "trial" | "pending" | "lapsed" | "blocked" | "noZone";
const FILTER_KEYS: FilterKey[] = ["active", "commission", "trial", "pending", "lapsed", "blocked", "noZone"];

// ─── Status config ────────────────────────────────────────────────────────────

const statusConfig: Record<
  string,
  { label: string; icon: any; badgeClass: string; avatarClass: string }
> = {
  active: {
    label: "Active",
    icon: CheckCircle2,
    badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    avatarClass: "bg-emerald-500",
  },
  // Legacy pre-Razorpay status. Displayed for old docs; never assignable.
  trial: {
    label: "Trial (legacy)",
    icon: Clock,
    badgeClass: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    avatarClass: "bg-amber-500",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    badgeClass: "bg-sky-500/10 text-sky-600 border-sky-500/20",
    avatarClass: "bg-sky-500",
  },
  paused: {
    label: "Paused",
    icon: XCircle,
    badgeClass: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    avatarClass: "bg-rose-500",
  },
  expired: {
    label: "Expired",
    icon: XCircle,
    badgeClass: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    avatarClass: "bg-slate-400",
  },
  blocked: {
    label: "Blocked",
    icon: Ban,
    badgeClass: "bg-rose-700/10 text-rose-700 border-rose-700/20",
    avatarClass: "bg-rose-700",
  },
  // Pays per order, never bought a plan — not "pending" anything.
  commission: {
    label: "Commission",
    icon: CheckCircle2,
    badgeClass: "bg-teal-500/10 text-teal-700 border-teal-500/20",
    avatarClass: "bg-teal-500",
  },
  // Past the paid end date, inside the server's 3-day grace window.
  grace_period: {
    label: "Grace period",
    icon: Clock,
    badgeClass: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    avatarClass: "bg-amber-500",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    badgeClass: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    avatarClass: "bg-slate-400",
  },
};

const planConfig: Record<string, { label: string; className: string }> = {
  monthly: { label: "Monthly", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  yearly: { label: "Yearly", className: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  trial: { label: "Trial (legacy)", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
};

const tierConfig: Record<string, { label: string; className: string }> = {
  starter: { label: "Starter", className: "bg-slate-500/10 text-muted-foreground border-slate-500/20" },
  growth: { label: "Growth", className: "bg-primary/10 text-primary border-primary/20" },
  enterprise: { label: "Enterprise", className: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatDate(val: any): string {
  if (!val) return "—";
  try {
    const d = val?.toDate ? val.toDate() : new Date(val);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

function toMillis(val: any): number | null {
  if (!val) return null;
  const ms = val?.toMillis ? val.toMillis() : val?.seconds ? val.seconds * 1000 : new Date(val).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The status an operator should see, not the raw field. The raw field lagged
 * reality two ways: "active" survived the end date (no Dine expiry job existed
 * until hotelSubscriptionExpiryCron covered restaurants), and merchants on the
 * commission model, who never buy a plan, read "Pending".
 */
function getEffectiveStatus(r: Restaurant): string {
  if (r.isBlocked) return "blocked";
  const raw = r.subscriptionStatus;
  if (r.billingModel !== "subscription" && raw !== "active" && raw !== "grace_period") return "commission";
  if (raw === "active") {
    const end = toMillis(r.subscriptionEndDate);
    if (end !== null && end <= Date.now()) {
      // Mirrors the server: 3 days' grace, then expired.
      return Date.now() - end < 3 * 86_400_000 ? "grace_period" : "expired";
    }
  }
  return raw || "pending";
}

/** Tab a status counts under ("Expired" also holds grace and cancelled). */
const tabOf = (status: string) => (status === "grace_period" || status === "cancelled" ? "expired" : status);

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TenantsHub() {
  const navigate = useNavigate();
  const geo = useGeoData();
  const [searchParams, setSearchParams] = useSearchParams();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  // `?filter=noZone` etc. lets dashboard cards and alerts deep-link a slice.
  const [filter, setFilter] = useState<FilterKey>(() => {
    const f = searchParams.get("filter") as FilterKey | null;
    return f && FILTER_KEYS.includes(f) ? f : "all";
  });
  const [searchQuery, setSearchQuery] = useState("");

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [draft, setDraft] = useState<Partial<Restaurant>>({});
  const [saving, setSaving] = useState(false);
  const [orderCount, setOrderCount] = useState<number | null>(null);
  const [orderCountLoading, setOrderCountLoading] = useState(false);
  const [resetPasswordVendor, setResetPasswordVendor] = useState<{ id: string; name: string; email?: string; phone?: string } | null>(null);
  const [contactVendor, setContactVendor] = useState<{ id: string; name: string; email?: string; phone?: string; city?: string } | null>(null);
  const [initialPassword, setInitialPassword] = useState("");

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Restaurant | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [bulkConfirm, setBulkConfirm] = useState<{ action: "suspend" | "activate"; rows: Restaurant[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"soft" | "hard">("soft");

  // ── Latest-state refs (so callbacks have stable identity) ──────────────────
  //
  // Reading `selected` directly inside `handleToggleBlock` forced us to put
  // `selected?.id` in its dep array. Every sheet open then mutated the
  // handler reference, which cascaded into `columns` and `renderMobileCard`,
  // which forced <DataTable> to rebuild every TanStack row model. On mobile
  // that churn — combined with how `useReactTable` reacts to fresh `columns`
  // identity — pushed the page into a re-render storm that overflowed the
  // call stack. Mirroring `selected?.id` into a ref lets the handler stay
  // identity-stable while still acting on the freshest value at call time.
  const selectedIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    selectedIdRef.current = selected?.id;
  }, [selected?.id]);

  // ── Firestore subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, "restaurants"), limit(2000));
    const unsub = onSnapshot(q, (snap) => {
      const rawNodes: Restaurant[] = snap.docs
        .map((d) => {
          const data: any = d.data();
          return {
            id: d.id,
            ...data,
            name: data.name || "Unnamed Shop",
            email: data.email || "",
            phone: data.phone || "",
            state: data.state || "",
            district: data.district || "",
            // No invented defaults: "pending"/"monthly" made every commission
            // merchant look like an unpaid monthly subscriber.
            subscriptionStatus: data.subscriptionStatus || undefined,
            subscriptionType: data.subscriptionType || undefined,
            isBlocked: !!data.isBlocked,
            isDeleted: !!data.isDeleted,
            isOutlet: !!data.isOutlet,
            parentId: data.parentId || undefined,
            outlets: [],
          } as Restaurant;
        })
        .filter((r) => !r.isDeleted); // filter out soft-deleted

      const parentMap = new Map<string, Restaurant>();
      const outletsList: Restaurant[] = [];

      rawNodes.forEach((r) => {
        if (r.isOutlet && r.parentId) {
          outletsList.push(r);
        } else {
          parentMap.set(r.id, r);
        }
      });

      // Link outlets and inherit subscription data
      outletsList.forEach((outlet) => {
        const parent = parentMap.get(outlet.parentId!);
        if (parent) {
          outlet.subscriptionStatus = parent.subscriptionStatus;
          outlet.subscriptionType = parent.subscriptionType;
          outlet.subscriptionEndDate = parent.subscriptionEndDate;
          outlet.subscriptionStartDate = parent.subscriptionStartDate;
          outlet.billingModel = parent.billingModel;
          outlet.subscriptionPlan = parent.subscriptionPlan;
          outlet.isBlocked = parent.isBlocked;
          if (!parent.outlets) parent.outlets = [];
          parent.outlets.push(outlet);
        }
      });

      // We only display the parents in the main list
      setRestaurants(Array.from(parentMap.values()));
      setLoading(false);
    }, (err) => {
      // Silent listener failures on this page silently freeze the vendor
      // directory forever; log + surface via toast so an operator knows.
      console.error("RestaurantsPage snapshot error:", err);
      setLoading(false);
      toast.error("Couldn't load vendors — check your connection.");
    });
    return () => unsub();
  }, []);

  const actionParam = searchParams.get("action");
  // ── Auto-open sheet if action=new ──────────────────────────────────────────
  useEffect(() => {
    if (actionParam !== "new") return;
    setSelected(null);
    setDraft({});
    setSheetOpen(true);
    // Remove param so it doesn't reopen on refresh — this also flips
    // `actionParam` to null on the next render, preventing any re-fire.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("action");
      return next;
    }, { replace: true });
  }, [actionParam, setSearchParams]);

  // ── Load order count when sheet opens ─────────────────────────────────────
  useEffect(() => {
    if (!selected) {
      setOrderCount(null);
      return;
    }
    setOrderCountLoading(true);
    setOrderCount(null);
    const ordersRef = collection(db, "orders");
    // Try to get count — if the collection/query is large, gracefully show N/A
    (async () => {
      try {
        const q = query(ordersRef, limit(1));
        // Use getCountFromServer if available, otherwise skip
        const snap = await getCountFromServer(
          query(collection(db, "orders"), where("restaurantId", "==", selected.id))
        );
        setOrderCount(snap.data().count);
      } catch {
        setOrderCount(null);
      } finally {
        setOrderCountLoading(false);
      }
    })();
  }, [selected]);

  // ── Counts ─────────────────────────────────────────────────────────────────
  // Precomputed by the `recomputeOpsHealth` job. Read as a lookup rather than
  // joined per row, so the table stays a single collection read.
  const { rows: healthRows } = useLiveCollection<any>("vendor_health", { limit: 2000 });
  const healthById = useMemo(
    () => new Map<string, any>(healthRows.map((h) => [h.id, h])),
    [healthRows],
  );

  // Console-wide city/zone scope. Applied before the counts so the tab badges
  // and the table always describe the same set of vendors.
  // Login/owner emails live in partner_contact (admin-only) — the restaurants
  // doc is public. Joined here so the list, search and sheet still show them.
  const contacts = usePartnerContacts("vendor");
  const restaurantsWithContact = useMemo(() => {
    const withEmail = (r: Restaurant): Restaurant => {
      const c = contacts[partnerDocKey("vendor", r.id)];
      const email = c?.email || c?.outletEmail || c?.ownerEmail || r.email || "";
      return email === r.email ? r : { ...r, email };
    };
    return restaurants.map((r) => ({ ...withEmail(r), outlets: r.outlets?.map(withEmail) }));
  }, [restaurants, contacts]);

  const { matches: inScope, isAll: allAreas, zones = [] } = useAdminScope();
  const scopedRestaurants = useMemo(
    () => (allAreas ? restaurantsWithContact : restaurantsWithContact.filter(inScope)),
    [restaurantsWithContact, inScope, allAreas],
  );

  const counts = useMemo(() => {
    const tab = (r: Restaurant) => (r.isBlocked ? "blocked" : tabOf(getEffectiveStatus(r)));
    return {
      total: scopedRestaurants.length,
      outlets: scopedRestaurants.reduce((n, r) => n + (r.outlets?.length ?? 0), 0),
      active: scopedRestaurants.filter((r) => tab(r) === "active").length,
      commission: scopedRestaurants.filter((r) => tab(r) === "commission").length,
      trial: scopedRestaurants.filter((r) => tab(r) === "trial").length,
      pending: scopedRestaurants.filter((r) => tab(r) === "pending").length,
      // Paused, past the end date, in grace or cancelled are one decision for
      // ops: the subscriber stopped paying.
      lapsed: scopedRestaurants.filter((r) => tab(r) === "paused" || tab(r) === "expired").length,
      blocked: scopedRestaurants.filter((r) => !!r.isBlocked).length,
      // Vendors outside every zone are invisible to customers.
      noZone: scopedRestaurants.filter((r) => !r.zoneId).length,
      // Same definition as the Onboarding tab's ops queue and the sidebar badge.
      kycReview: scopedRestaurants.filter((r) =>
        OPS_QUEUE_STATES.includes(r.onboarding?.state as (typeof OPS_QUEUE_STATES)[number]),
      ).length,
    };
  }, [scopedRestaurants]);

  // Legacy buckets only appear while some vendor is still in them.
  const filterTabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.total },
    { key: "active", label: "Subscribed", count: counts.active },
    { key: "commission", label: "Commission", count: counts.commission },
    ...(counts.pending > 0 || filter === "pending" ? [{ key: "pending" as FilterKey, label: "Pending", count: counts.pending }] : []),
    { key: "lapsed", label: "Lapsed", count: counts.lapsed },
    { key: "blocked", label: "Blocked", count: counts.blocked },
    { key: "noZone", label: "No zone", count: counts.noZone },
    ...(counts.trial > 0 || filter === "trial" ? [{ key: "trial" as FilterKey, label: "Trial (legacy)", count: counts.trial }] : []),
  ];

  // ── Filtered + searched data ───────────────────────────────────────────────
  const visibleRestaurants = useMemo(() => {
    let data = scopedRestaurants;

    // Tab filter
    if (filter !== "all") {
      data = data.filter((r) => {
        if (filter === "blocked") return !!r.isBlocked;
        if (filter === "noZone") return !r.zoneId;
        if (r.isBlocked) return false;
        const t = tabOf(getEffectiveStatus(r));
        return filter === "lapsed" ? t === "paused" || t === "expired" : t === filter;
      });
    }

    // Search filter (name, email, phone, location, zone, id)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.email && r.email.toLowerCase().includes(q)) ||
          (r.phone && r.phone.toLowerCase().includes(q)) ||
          (r.district && r.district.toLowerCase().includes(q)) ||
          (r.state && r.state.toLowerCase().includes(q)) ||
          (r.zoneName && r.zoneName.toLowerCase().includes(q)) ||
          r.id.toLowerCase().includes(q)
      );
    }

    return data;
  }, [scopedRestaurants, filter, searchQuery]);

  // ── Sheet helpers ──────────────────────────────────────────────────────────
  const openDetails = useCallback((r: Restaurant) => {
    setSelected(r);
    setDraft({ ...r });
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setSelected(null);
    setDraft({});
    setInitialPassword("");
  }, []);

  const saveDetails = async () => {
    if (draft.phone && !isValidPhoneNumber(draft.phone)) {
      toast.error("Please enter a valid international phone number");
      return;
    }
    setSaving(true);
    try {
      if (selected) {
        const { id, outlets, ...updateData } = draft as any;
        // Email lives in partner_contact; only send it when the admin changed
        // it (the write trigger then moves it off this public doc in seconds).
        if ((updateData.email ?? "") === (selected.email ?? "")) delete updateData.email;
        
        // Firestore rejects undefined values
        Object.keys(updateData).forEach((key) => {
          if (updateData[key] === undefined) {
            delete updateData[key];
          }
        });
        
        await updateDoc(doc(db, "restaurants", selected.id), updateData);
        toast.success("Tenant updated successfully");
      } else {
        const { outlets, ...restDraft } = draft as any;
        const newTenant = {
          ...restDraft,
          createdAt: serverTimestamp(),
          isDeleted: false,
          isBlocked: false,
          subscriptionStatus: "pending",
        };
        
        // Firestore rejects undefined values
        Object.keys(newTenant).forEach((key) => {
          if ((newTenant as any)[key] === undefined) {
            delete (newTenant as any)[key];
          }
        });

        const docRef = await addDoc(collection(db, "restaurants"), newTenant);
        if (initialPassword && draft.email) {
          try {
            await adminActionToast(
              "resetVendorPassword",
              {
                restaurantId: docRef.id,
                mode: "set_password",
                newPassword: initialPassword,
                email: draft.email,
              },
              "Vendor login credentials provisioned!",
            );
          } catch (authErr) {
            console.error("Failed to provision vendor credentials:", authErr);
          }
        }
        toast.success("Tenant created successfully");
      }
      closeSheet();
    } catch (error: any) {
      console.error("Save details error:", error);
      toast.error("Failed to save changes: " + (error.message || "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  // ── Block / Unblock ────────────────────────────────────────────────────────
  //
  // All three of these handlers MUST be identity-stable across renders:
  // they sit inside `columns` (useMemo) and `renderMobileCard` (useCallback)
  // dep arrays, which are then passed as props to <DataTable>. Any time
  // their reference flips, the table rebuilds every row model — on mobile
  // that storm overflows the JS call stack ("Maximum call stack size
  // exceeded"). We read `selected.id` through `selectedIdRef` so this
  // callback's dep array is truly empty.
  const handleToggleBlock = useCallback(async (r: Restaurant) => {
    try {
      await updateDoc(doc(db, "restaurants", r.id), { isBlocked: !r.isBlocked });
      toast.success(r.isBlocked ? `${r.name} unblocked` : `${r.name} blocked`);
      // Also update draft if sheet is open for this restaurant
      if (selectedIdRef.current === r.id) {
        setDraft((p) => ({ ...p, isBlocked: !r.isBlocked }));
      }
    } catch {
      toast.error("Failed to update access status");
    }
  }, []);

  // ── Impersonation ──────────────────────────────────────────────────────────
  // SECURITY: The impersonation ID is stored client-side for convenience only.
  // All data access MUST be gated by Firestore security rules that verify the
  // authenticated user has platformAdmin / superadmin claims — never trust this
  // value alone.
  const handleImpersonate = useCallback((r: Restaurant) => {
    sessionStorage.setItem("kada_impersonate_id", r.id);
    toast.success(`Impersonating ${r.name} — you will see their dashboard`);
    navigate("/dashboard");
  }, [navigate]);

  // ── Delete (soft) ──────────────────────────────────────────────────────────
  const openDeleteDialog = useCallback((r: Restaurant) => {
    setDeleteTarget(r);
    setDeleteConfirmText("");
    setDeleteMode("soft");
    setDeleteDialogOpen(true);
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmText !== deleteTarget.name) {
      toast.error("Restaurant name doesn't match. Please type it exactly.");
      return;
    }
    setDeleting(true);
    try {
      const deleteTenant = httpsCallable(functions, "deleteTenantAccount");
      await deleteTenant({ restaurantId: deleteTarget.id, mode: deleteMode });

      toast.success(deleteMode === "soft" ? "Restaurant soft-deleted." : "Restaurant permanently deleted.");
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeleteConfirmText("");
      if (selected?.id === deleteTarget.id) closeSheet();
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete restaurant. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  // ── Table columns ──────────────────────────────────────────────────────────
  const columns: ColumnDef<Restaurant>[] = useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Tenant",
        cell: ({ row }) => {
          const r = row.original;
          const statusKey = getEffectiveStatus(r);
          const cfg = statusConfig[statusKey] || statusConfig.pending;
          return (
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => openDetails(r)}
            >
              <div
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs text-white shrink-0 transition-transform group-hover:scale-105",
                  cfg.avatarClass
                )}
              >
                {r.name.substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground leading-tight truncate">
                  <Link
                    to={`/admin/vendors/${r.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-primary hover:underline transition-colors"
                  >
                    {r.name}
                  </Link>
                </p>
                <p className="text-xs text-muted-foreground truncate">{r.email || "—"}</p>
              </div>
            </div>
          );
        },
        filterFn: (row, _colId, filterValue) => {
          const r = row.original;
          const q = (filterValue as string).toLowerCase();
          return (
            r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)
          );
        },
      },
      {
        id: "location",
        header: "Location",
        cell: ({ row }) => {
          const r = row.original;
          if (!r.district && !r.state) return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <div className="text-sm">
              {r.district && <p className="font-medium text-foreground">{r.district}</p>}
              {r.state && <p className="text-xs text-muted-foreground">{r.state}</p>}
            </div>
          );
        },
      },
      {
        id: "health",
        header: "Health",
        cell: ({ row }) => {
          const h = healthById.get(row.original.id);
          return <HealthChip score={h?.score} band={h?.band} signals={h?.signals} />;
        },
      },
      {
        id: "zone",
        header: "Zone",
        cell: ({ row }) => (
          <ZoneBadge zoneId={row.original.zoneId} zoneName={row.original.zoneName} />
        ),
      },
      {
        accessorKey: "planTier",
        header: "Tier",
        cell: ({ row }) => {
          const r = row.original;
          // The web checkout writes the plan to subscriptionPlan; planTier is
          // the older admin-set field. A commission merchant has no tier.
          const tier = r.subscriptionPlan || r.planTier;
          if (!tier || getEffectiveStatus(r) === "commission") {
            return <span className="text-muted-foreground text-xs">—</span>;
          }
          const cfg = tierConfig[tier] || { label: tier, className: tierConfig.starter.className };
          return (
            <Badge
              variant="outline"
              className={cn("text-xs font-semibold border", cfg.className)}
            >
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        id: "outlets",
        header: "Outlets",
        cell: ({ row }) => {
          const outlets = row.original.outlets || [];
          if (outlets.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <Badge variant="secondary" className="text-xs font-medium">
              {outlets.length} location{outlets.length !== 1 ? 's' : ''}
            </Badge>
          );
        },
      },
      {
        accessorKey: "subscriptionType",
        header: "Plan",
        cell: ({ row }) => {
          const r = row.original;
          if (getEffectiveStatus(r) === "commission") {
            return (
              <span className="text-xs text-muted-foreground">
                {typeof r.commissionRate === "number" ? `${r.commissionRate}% per order` : "Per order"}
              </span>
            );
          }
          const type = row.getValue("subscriptionType") as string | undefined;
          const cfg = type ? planConfig[type] : undefined;
          if (!cfg) return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <Badge
              variant="outline"
              className={cn("text-xs font-medium border", cfg.className)}
            >
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        accessorKey: "subscriptionStatus",
        header: "Status",
        cell: ({ row }) => {
          const r = row.original;
          const statusKey = getEffectiveStatus(r);
          const cfg = statusConfig[statusKey] || statusConfig.pending;
          const StatusIcon = cfg.icon;
          return (
            <Badge
              variant="outline"
              className={cn("text-xs font-medium border gap-1 pr-2", cfg.badgeClass)}
            >
              <StatusIcon className="w-3 h-3" />
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        accessorKey: "subscriptionEndDate",
        header: "Sub. End",
        cell: ({ row }) => {
          const r = row.original;
          if (getEffectiveStatus(r) === "commission") return <span className="text-muted-foreground text-xs">—</span>;
          const val = row.getValue("subscriptionEndDate");
          const end = toMillis(val);
          const past = end !== null && end <= Date.now();
          return (
            <span className={cn("text-sm", past ? "text-rose-600 font-medium" : "text-muted-foreground")}>
              {formatDate(val)}
            </span>
          );
        },
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0 data-[state=open]:bg-muted">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-xl">
                <DropdownMenuLabel className="text-xs text-muted-foreground font-medium">
                  Actions
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => openDetails(r)}
                  className="text-sm cursor-pointer gap-2"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  View Details
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigate(`/admin/vendors/${r.id}`)}
                  className="text-sm cursor-pointer gap-2"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-blue-600" />
                  Vendor 360 Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setResetPasswordVendor(r)}
                  className="text-sm cursor-pointer gap-2 text-primary font-medium"
                >
                  <KeyRound className="h-3.5 w-3.5 text-primary" />
                  Reset Password
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setContactVendor(r)}
                  className="text-sm cursor-pointer gap-2 text-emerald-700 font-medium"
                >
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                  Contact Vendor
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleImpersonate(r)}
                  className="text-sm cursor-pointer gap-2 text-primary"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Login as User
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleToggleBlock(r)}
                  className={cn(
                    "text-sm cursor-pointer gap-2",
                    r.isBlocked ? "text-emerald-600" : "text-amber-600"
                  )}
                >
                  {r.isBlocked ? (
                    <Unlock className="h-3.5 w-3.5" />
                  ) : (
                    <Ban className="h-3.5 w-3.5" />
                  )}
                  {r.isBlocked ? "Unblock" : "Block"} Tenant
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => openDeleteDialog(r)}
                  className="text-sm cursor-pointer gap-2 text-rose-600 focus:text-rose-600 focus:bg-rose-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Tenant
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [openDetails, handleImpersonate, handleToggleBlock, openDeleteDialog, healthById]
  );

  const renderMobileCard = useCallback((r: Restaurant) => {
    const statusKey = getEffectiveStatus(r);
    const cfg = statusConfig[statusKey] || statusConfig.pending;
    const StatusIcon = cfg.icon;
    const onCommission = statusKey === "commission";
    const plan = onCommission
      ? { label: typeof r.commissionRate === "number" ? `${r.commissionRate}% per order` : "per order" }
      : planConfig[r.subscriptionType || ""] || { label: "—" };
    const tier = onCommission ? "COMMISSION" : (r.subscriptionPlan || r.planTier || "—").toUpperCase();

    return (
      <div className="bg-card rounded-xl border border-border/60 p-4 shadow-sm space-y-3 relative group">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => openDetails(r)}>
            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm text-white shrink-0", cfg.avatarClass)}>
              {r.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 pr-2">
              <h4 className="font-semibold text-sm leading-tight text-foreground truncate">{r.name}</h4>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.email || "No email"}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0 shrink-0">
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => openDetails(r)} className="gap-2 text-sm"><Building2 className="h-3.5 w-3.5" />View Details</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(`/admin/vendors/${r.id}`)} className="gap-2 text-sm"><ExternalLink className="h-3.5 w-3.5 text-blue-600" />Vendor 360</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setResetPasswordVendor(r)} className="gap-2 text-sm text-primary font-medium"><KeyRound className="h-3.5 w-3.5" />Reset Password</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setContactVendor(r)} className="gap-2 text-sm text-emerald-700 font-medium"><MessageSquare className="h-3.5 w-3.5 text-emerald-600" />Contact</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleImpersonate(r)} className="gap-2 text-sm text-primary"><LogIn className="h-3.5 w-3.5" />Login as User</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleToggleBlock(r)} className={cn("gap-2 text-sm", r.isBlocked ? "text-emerald-600" : "text-amber-600")}>
                {r.isBlocked ? <Unlock className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                {r.isBlocked ? "Unblock" : "Block"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openDeleteDialog(r)} className="gap-2 text-sm text-rose-600"><Trash2 className="h-3.5 w-3.5" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs bg-muted/40 p-2.5 rounded-lg">
          <div className="flex flex-col gap-1 overflow-hidden">
            <span className="text-muted-foreground font-medium">Location</span>
            <span className="font-semibold text-foreground truncate">{r.district || r.state || "—"}</span>
          </div>
          <div className="flex flex-col gap-1 overflow-hidden">
            <span className="text-muted-foreground font-medium">Plan</span>
            <span className="font-semibold text-foreground truncate">{tier} ({plan.label})</span>
          </div>
        </div>

        {(r.kyc || r.kycStatus) && (
          <div className="bg-muted/40 p-2.5 rounded-lg text-[10px] space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-wide font-semibold text-muted-foreground">KYC</span>
              <span className={cn("px-1.5 py-0.5 rounded font-bold uppercase",
                r.kycStatus === "approved" ? "bg-emerald-500/10 text-emerald-600" :
                r.kycStatus === "rejected" ? "bg-rose-500/10 text-rose-600" :
                "bg-amber-500/10 text-amber-600")}>{r.kycStatus || "pending"}</span>
            </div>
            {r.kyc?.fssai && <p className="font-bold text-muted-foreground">FSSAI: {r.kyc.fssai}</p>}
            {r.bank?.accountMasked && <p className="font-bold text-muted-foreground truncate">Bank: {publicBankLabel(r.bank)}</p>}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Badge variant="outline" className={cn("text-[10px] gap-1 px-1.5 py-0 border", cfg.badgeClass)}>
            <StatusIcon className="w-3 h-3" />
            {cfg.label}
          </Badge>
          <div className="flex gap-1.5">
             <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] rounded-full gap-1 border-border/60 text-primary" onClick={() => setResetPasswordVendor(r)}>
                <KeyRound className="h-3 w-3" /> Password
             </Button>
             <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] rounded-full gap-1 border-border/60" onClick={() => handleImpersonate(r)}>
                <LogIn className="h-3 w-3 text-primary" /> Login
             </Button>
             <Button variant="outline" size="sm" className="h-7 w-7 p-0 rounded-full border-border/60" onClick={() => handleToggleBlock(r)}>
                {r.isBlocked ? <Unlock className="h-3.5 w-3.5 text-emerald-600" /> : <Ban className="h-3.5 w-3.5 text-amber-600" />}
             </Button>
          </div>
        </div>
      </div>
    );
  }, [openDetails, handleImpersonate, handleToggleBlock, openDeleteDialog, navigate]);

  // ─────────────────────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 p-1">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="Vendor directory"
        description="Restaurant partners, how they pay, their zone and KYC."
        icon={Building2}
        actions={
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <ZoneScopeChip />
            <Input
              placeholder="Search name or email…"
              aria-label="Search vendors by name or email"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full text-sm sm:w-56"
            />
            <Button
              className="h-9 shrink-0 gap-1.5"
              onClick={() => {
                setSelected(null);
                setDraft({});
                setSheetOpen(true);
              }}
            >
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">Add vendor</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        }
      />

      {/* One row, every card actionable: clicking applies the matching filter. */}
      <StatCards
        items={[
          {
            label: "Subscribed",
            value: counts.active,
            hint: `of ${counts.total} vendor${counts.total === 1 ? "" : "s"}${counts.outlets ? ` · ${counts.outlets} outlet${counts.outlets === 1 ? "" : "s"}` : ""}`,
            icon: CheckCircle2,
            tone: "text-emerald-600",
            onClick: () => setFilter(filter === "active" ? "all" : "active"),
            active: filter === "active",
          },
          {
            label: "Commission",
            value: counts.commission,
            hint: "Pays per order, no plan",
            icon: Clock,
            tone: "text-teal-600",
            onClick: () => setFilter(filter === "commission" ? "all" : "commission"),
            active: filter === "commission",
          },
          {
            label: "Lapsed",
            value: counts.lapsed,
            hint: "Plan ended or paused",
            icon: CalendarX,
            tone: "text-amber-600",
            onClick: () => setFilter(filter === "lapsed" ? "all" : "lapsed"),
            active: filter === "lapsed",
          },
          {
            label: "Blocked",
            value: counts.blocked,
            hint: "Suspended by admin",
            icon: Ban,
            tone: "text-rose-600",
            onClick: () => setFilter(filter === "blocked" ? "all" : "blocked"),
            active: filter === "blocked",
          },
          {
            label: "No zone",
            value: counts.noZone,
            hint: "Hidden from customers",
            icon: MapPinOff,
            tone: "text-amber-600",
            onClick: () => setFilter(filter === "noZone" ? "all" : "noZone"),
            active: filter === "noZone",
          },
          {
            label: "KYC review",
            value: counts.kycReview,
            hint: "Open onboarding queue",
            icon: ShieldAlert,
            tone: "text-blue-600",
            onClick: () => navigate("/admin/vendors?tab=onboarding"),
          },
        ]}
      />

      {/* ── Filter Tabs ────────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide flex-wrap">
        {filterTabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-all border shrink-0",
              filter === key
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground"
            )}
          >
            {label}
            <span
              className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                filter === key
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* ── DataTable ──────────────────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={visibleRestaurants}
        exportFilename="tenants"
        renderMobileCard={renderMobileCard}
        bulkActions={[
          {
            label: "Suspend Selected",
            destructive: true,
            icon: XCircle,
            onSelected: (rows) => {
              setBulkConfirm({ action: "suspend", rows });
            }
          },
          {
            label: "Activate Selected",
            icon: CheckCircle2,
            onSelected: (rows) => {
              setBulkConfirm({ action: "activate", rows });
            }
          }
        ]}
      />

      {/* ── Tenant Detail Sheet ────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg p-0 flex flex-col overflow-hidden"
        >
          {/* Sheet Header */}
          <div className="px-6 py-5 border-b border-border/60 bg-muted/20 shrink-0">
            <SheetHeader>
              {selected ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {(() => {
                      const statusKey = getEffectiveStatus(selected);
                      const cfg = statusConfig[statusKey] || statusConfig.pending;
                      return (
                        <div
                          className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs text-white shrink-0",
                            cfg.avatarClass
                          )}
                        >
                          {selected.name.substring(0, 2).toUpperCase()}
                        </div>
                      );
                    })()}
                    <div className="min-w-0">
                      <SheetTitle className="text-base font-semibold leading-tight truncate">
                        {selected.name}
                      </SheetTitle>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        ID: {selected.id}
                      </p>
                    </div>
                  </div>
                  {(() => {
                    const statusKey = getEffectiveStatus(selected);
                    const cfg = statusConfig[statusKey] || statusConfig.pending;
                    return (
                      <Badge
                        variant="outline"
                        className={cn("text-xs border shrink-0", cfg.badgeClass)}
                      >
                        {cfg.label}
                      </Badge>
                    );
                  })()}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center font-bold text-xs text-primary shrink-0">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <SheetTitle className="text-base font-semibold leading-tight">
                      Add New Vendor
                    </SheetTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Onboard a new restaurant partner to Kada Dine
                    </p>
                  </div>
                </div>
              )}
            </SheetHeader>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* Business Info */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Business Info
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Name</label>
                  <Input
                    value={draft.name || ""}
                    onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5 [&_.PhoneInputInput]:h-9 [&_.PhoneInputInput]:rounded-md [&_.PhoneInputInput]:bg-background [&_.PhoneInputInput]:border [&_.PhoneInputInput]:border-input [&_.PhoneInputInput]:px-3 [&_.PhoneInputInput]:text-sm [&_.PhoneInputInput]:outline-none [&_.PhoneInputInput]:focus:ring-2 [&_.PhoneInputInput]:focus:ring-ring/30 [&_.PhoneInputInput]:transition-colors">
                  <label className="text-xs text-muted-foreground">Phone</label>
                  <PhoneInput
                    maxLength={15}
                    international
                    defaultCountry="IN"
                    value={draft.phone}
                    onChange={(val) => setDraft((p) => ({ ...p, phone: val || "" }))}
                    className="w-full"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs text-muted-foreground">Email</label>
                  <Input
                    value={draft.email || ""}
                    onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Country</label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 appearance-none"
                    value={draft.countryCode || "IN"}
                    onChange={(e) => setDraft((p) => ({ ...p, countryCode: e.target.value, state: "", district: "" }))}
                  >
                    {(geo?.Country.getAllCountries() ?? []).map((c) => (
                      <option key={c.isoCode} value={c.isoCode}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">State</label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 appearance-none"
                    value={draft.state || ""}
                    disabled={!draft.countryCode}
                    onChange={(e) => setDraft((p) => ({ ...p, state: e.target.value, district: "" }))}
                  >
                    <option value="">— Select state —</option>
                    {draft.countryCode === "IN" ? (
                      indiaStates.map((s) => (
                        <option key={s.state} value={s.state}>
                          {s.state}
                        </option>
                      ))
                    ) : (
                      (geo?.State.getStatesOfCountry(draft.countryCode || "IN") ?? []).map((s) => (
                        <option key={s.isoCode} value={s.name}>
                          {s.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">District</label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 appearance-none"
                    value={draft.district || ""}
                    disabled={!draft.state}
                    onChange={(e) => setDraft((p) => ({ ...p, district: e.target.value }))}
                  >
                    <option value="">— Select district —</option>
                    {draft.countryCode === "IN" ? (
                      indiaStates.find(s => s.state === draft.state)?.districts.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      )) || []
                    ) : (
                      (geo?.City.getCitiesOfState(
                          draft.countryCode || "IN",
                          geo?.State.getStatesOfCountry(draft.countryCode || "IN").find(s => s.name === draft.state)?.isoCode || draft.state || ""
                        ) || []
                      ).map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs text-muted-foreground">Service Zone</label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 appearance-none bg-card"
                    value={draft.zoneId || ""}
                    onChange={(e) => {
                      const zId = e.target.value;
                      const z = zones.find((item) => item.id === zId);
                      setDraft((p) => ({
                        ...p,
                        zoneId: zId || null,
                        zoneName: z?.name || null,
                        marketId: z?.marketId || null,
                      }));
                    }}
                  >
                    <option value="">— Unassigned (No zone) —</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name || z.id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Account Credentials / Initial Password for New Vendor */}
            {!selected && (
              <>
                <Separator />
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Login Credentials (Optional)
                    </h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] text-primary px-2"
                      onClick={() => {
                        const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789@#$!";
                        let pwd = "";
                        for (let i = 0; i < 12; i++) {
                          pwd += chars.charAt(Math.floor(Math.random() * chars.length));
                        }
                        setInitialPassword(pwd);
                        toast.success("Generated random password");
                      }}
                    >
                      Generate Secure Password
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Initial Admin Password</label>
                    <Input
                      type="text"
                      placeholder="e.g. KadaVendor#2026"
                      value={initialPassword}
                      onChange={(e) => setInitialPassword(e.target.value)}
                      className="h-9 text-sm font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      If provided along with an email, a login account will be automatically provisioned in Firebase Auth so the vendor can log in immediately.
                    </p>
                  </div>
                </section>
              </>
            )}

            <Separator />

            {/* Subscription */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Subscription
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Plan Tier</label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 appearance-none bg-card"
                    value={draft.planTier || "starter"}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, planTier: e.target.value as any }))
                    }
                  >
                    <option value="starter">Starter</option>
                    <option value="growth">Growth</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Plan Type</label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 appearance-none bg-card"
                    value={draft.subscriptionType || "monthly"}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, subscriptionType: e.target.value as any }))
                    }
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs text-muted-foreground">Status</label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 appearance-none bg-card"
                    value={draft.subscriptionStatus || "pending"}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, subscriptionStatus: e.target.value as any }))
                    }
                  >
                    <option value="pending">Pending</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs text-muted-foreground">Subscription End Date</label>
                  <Input
                    type="date"
                    value={
                      draft.subscriptionEndDate
                        ? (() => {
                            try {
                              const d = draft.subscriptionEndDate?.toDate
                                ? draft.subscriptionEndDate.toDate()
                                : new Date(draft.subscriptionEndDate);
                              return d.toISOString().split("T")[0];
                            } catch {
                              return "";
                            }
                          })()
                        : ""
                    }
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        subscriptionEndDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                      }))
                    }
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Kada Gold Partner */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Kada Gold Partner
              </h3>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  Member discount (%) — 0 disables partner status (members get the base 10%). Max 30.
                </label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={draft.goldDiscountPercent ?? 0}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const clamped = Number.isFinite(raw)
                      ? Math.max(0, Math.min(30, raw))
                      : 0;
                    setDraft((p) => ({ ...p, goldDiscountPercent: clamped }));
                  }}
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Gold members get this % off the food subtotal at checkout (capped ₹200). 0 = not a partner.
                </p>
              </div>
            </section>

            {selected && (
              <>
                <Separator />

                {/* Quick Stats */}
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Quick Stats
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Orders</p>
                      <p className="text-lg font-semibold mt-0.5">
                        {orderCountLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        ) : orderCount !== null ? (
                          orderCount
                        ) : (
                          "—"
                        )}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Member since</p>
                      <p className="text-sm font-medium mt-0.5">
                        {formatDate(selected.createdAt)}
                      </p>
                    </div>
                  </div>
                </section>

                <Separator />

                {/* Quick Actions */}
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Quick Actions
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => navigate(`/admin/vendors/${selected.id}`)}
                      className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Vendor 360
                    </button>
                    <button
                      onClick={() => setResetPasswordVendor(selected)}
                      className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      <KeyRound className="h-3.5 w-3.5 text-amber-500" />
                      Reset Password
                    </button>
                    <button
                      onClick={() => setContactVendor(selected)}
                      className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5 text-emerald-500" />
                      Contact
                    </button>
                    <a
                      href={`mailto:${draft.email || selected.email || ""}`}
                      className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Email
                    </a>
                    <a
                      href={`tel:${(draft.phone || selected.phone || "").replace(/\s+/g, "")}`}
                      className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Call
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selected.id);
                        toast.success("Restaurant ID copied");
                      }}
                      className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy ID
                    </button>
                    <button
                      onClick={() => handleImpersonate(selected)}
                      className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      Login as User
                    </button>
                  </div>
                </section>

                <Separator />

                {/* Outlets */}
                {selected.outlets && selected.outlets.length > 0 && (
                  <>
                    <section className="space-y-3">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Outlets / Locations
                      </h3>
                      <div className="grid gap-2">
                        {selected.outlets.map((outlet) => (
                          <div
                            key={outlet.id}
                            className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/20"
                          >
                            <div>
                              <p className="text-sm font-medium">{outlet.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {outlet.district ? `${outlet.district}, ` : ''}{outlet.state || ''}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                navigator.clipboard.writeText(outlet.id);
                                toast.success("Outlet ID copied");
                              }}
                            >
                              Copy ID
                            </Button>
                          </div>
                        ))}
                      </div>
                    </section>
                    <Separator />
                  </>
                )}

                {/* Access Control & Credentials */}
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Access Control & Credentials
                  </h3>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/20">
                    <div>
                      <p className="text-sm font-medium">
                        {draft.isBlocked ? "Account blocked" : "Account active"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {draft.isBlocked
                          ? "This tenant cannot access their dashboard"
                          : "This tenant has full access"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-8 text-xs gap-1.5",
                        draft.isBlocked
                          ? "text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                          : "text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                      )}
                      onClick={() => {
                        handleToggleBlock({ ...selected, isBlocked: !!draft.isBlocked });
                        setDraft((p) => ({ ...p, isBlocked: !p.isBlocked }));
                      }}
                    >
                      {draft.isBlocked ? (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      ) : (
                        <ShieldAlert className="h-3.5 w-3.5" />
                      )}
                      {draft.isBlocked ? "Unblock" : "Block"}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/20">
                    <div className="space-y-0.5 min-w-0 pr-2">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        Account Credentials & Password
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Login: {draft.email || selected.email || "No email linked"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1.5 shrink-0"
                      onClick={() => setResetPasswordVendor(selected)}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Reset Password
                    </Button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/20 gap-3">
                    <div>
                      <p className="text-sm font-medium">Marketplace commission %</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Used when generating vendor settlements</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        className="w-20 h-8"
                        value={draft.commissionRate ?? 5}
                        onChange={(e) => setDraft((p) => ({ ...p, commissionRate: Number(e.target.value) }))}
                      />
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() =>
                          adminActionToast(
                            "setCommission",
                            { restaurantId: selected.id, rate: Number(draft.commissionRate) || 0 },
                            "Commission updated",
                          )
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </section>

                {/* Danger Zone */}
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold text-rose-600 uppercase tracking-wide">
                    Danger Zone
                  </h3>
                  <div className="p-3 rounded-lg border border-rose-500/20 bg-rose-500/5">
                    <p className="text-xs text-muted-foreground mb-3">
                      Deleting this tenant will soft-delete all associated data. This action is
                      logged and data is preserved for 30 days.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1.5 text-rose-600 border-rose-500/30 hover:bg-rose-500/10"
                      onClick={() => openDeleteDialog(selected)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Tenant
                    </Button>
                  </div>
                </section>
              </>
            )}

            {!selected && (
              <>
                <Separator />
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Commission & Settlement
                  </h3>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/20 gap-3">
                    <div>
                      <p className="text-sm font-medium">Marketplace commission %</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Default commission rate for orders</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        className="w-20 h-8"
                        value={draft.commissionRate ?? 5}
                        onChange={(e) => setDraft((p) => ({ ...p, commissionRate: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>

          {/* Sheet Footer */}
          <div className="px-6 py-4 border-t border-border/60 bg-background shrink-0">
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-9 text-sm"
                onClick={closeSheet}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-9 text-sm gap-2"
                onClick={saveDetails}
                disabled={saving}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving
                  ? "Saving..."
                  : selected
                  ? "Save Changes"
                  : "Create Vendor"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Safe Delete AlertDialog ────────────────────────────────────────── */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => !open && setDeleteDialogOpen(false)}>
        <AlertDialogContent className="max-w-md rounded-2xl">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <AlertDialogTitle className="text-base font-semibold">
                Delete &ldquo;{deleteTarget?.name}&rdquo;?
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-sm mt-3">
                
                <div className="flex gap-2">
                  <Button 
                    type="button" 
                    variant={deleteMode === "soft" ? "default" : "outline"}
                    className={cn("flex-1", deleteMode === "soft" && "bg-rose-600 hover:bg-rose-700")}
                    onClick={() => setDeleteMode("soft")}
                  >
                    Soft Delete
                  </Button>
                  <Button 
                    type="button" 
                    variant={deleteMode === "hard" ? "default" : "outline"}
                    className={cn("flex-1", deleteMode === "hard" && "bg-rose-600 hover:bg-rose-700")}
                    onClick={() => setDeleteMode("hard")}
                  >
                    Hard Delete
                  </Button>
                </div>

                <p className="text-muted-foreground">
                  {deleteMode === "soft" ? 
                    <>This will soft-delete <strong className="text-foreground">{deleteTarget?.name}</strong>. Their data will be preserved but they will be blocked from accessing the system.</> : 
                    <>This will <strong className="text-rose-600 font-bold">PERMANENTLY</strong> delete <strong className="text-foreground">{deleteTarget?.name}</strong> and purge ALL associated data across the entire system. This action cannot be undone.</>
                  }
                </p>

                {/* Dependency list */}
                {deleteMode === "hard" && (
                  <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-rose-700 mb-2">This will permanently purge:</p>
                    {[
                      "Menus, Orders, & Recipes",
                      "Inventory & Staff accounts",
                      "Support tickets & Loyalty data",
                      "KYC documents & Subscriptions",
                      "Analytics & Storage files",
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className="w-1 h-1 rounded-full bg-rose-400 shrink-0" />
                        {item}
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5 pt-2">
                  <p className="text-xs text-muted-foreground">
                    Type{" "}
                    <strong className="text-foreground font-semibold select-all">
                      {deleteTarget?.name}
                    </strong>{" "}
                    to confirm:
                  </p>
                  <Input
                    placeholder={deleteTarget?.name || ""}
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className="h-9 text-sm font-medium"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && deleteConfirmText === deleteTarget?.name) {
                        handleDelete();
                      }
                    }}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel
              className="h-9 text-sm"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteConfirmText("");
              }}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              className="h-9 text-sm gap-2"
              disabled={deleteConfirmText !== deleteTarget?.name || deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {deleting ? "Deleting..." : "Delete Tenant"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmationDialog
        open={!!bulkConfirm}
        onOpenChange={(v) => !v && setBulkConfirm(null)}
        title={bulkConfirm ? (bulkConfirm.action === "suspend" ? `Suspend ${bulkConfirm.rows.length} vendors?` : `Activate ${bulkConfirm.rows.length} vendors?`) : ""}
        description={bulkConfirm?.action === "suspend" ? "This will immediately hide these vendors from the customer apps and stop incoming orders." : "This will immediately restore these vendors to the platform and allow them to receive orders."}
        confirmLabel={bulkConfirm?.action === "suspend" ? "Suspend Vendors" : "Activate Vendors"}
        variant={bulkConfirm?.action === "suspend" ? "destructive" : "default"}
        requireReason={true}
        onConfirm={async (reason) => {
          if (!bulkConfirm) return;
          try {
            await Promise.all(
              bulkConfirm.rows.map(r => updateDoc(doc(db, "restaurants", r.id), { isBlocked: bulkConfirm.action === "suspend" }))
            );
            toast.success(`${bulkConfirm.action === "suspend" ? "Suspended" : "Activated"} ${bulkConfirm.rows.length} vendors`);
            setBulkConfirm(null);
          } catch (err) {
            toast.error("Failed to update vendors");
          }
        }}
      />

      {/* ── Dialogs: Password Reset & Direct Contact ─────────────────────── */}
      <ResetPasswordDialog
        open={!!resetPasswordVendor}
        onOpenChange={(open) => !open && setResetPasswordVendor(null)}
        vendor={resetPasswordVendor}
      />

      <VendorContactDialog
        open={!!contactVendor}
        onOpenChange={(open) => !open && setContactVendor(null)}
        vendor={contactVendor}
      />

    </div>
  );
}
