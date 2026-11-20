import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { indiaStates } from "@/constants/indiaData";
import {
  Plus, Pencil, Trash2, MapPin, Phone, User, Store,
  Info, Mail, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import {
  collection, onSnapshot, doc, query, orderBy, serverTimestamp, Timestamp, getDoc, setDoc, deleteDoc, updateDoc
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { cn } from "@/lib/utils";
import { useGeoData } from "@/hooks/useGeoData";
import PhoneInput, { isValidPhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { useSubscription } from "@/hooks/useSubscription";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { OpeningHoursClockPicker } from "@/components/common";

// ── Types ────────────────────────────────────────────────────────────────────

interface Outlet {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  state: string;
  district: string;
  countryCode?: string;
  hours: string;
  managerName: string;
  isActive: boolean;
  createdAt?: Timestamp;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OutletsPage() {
  const { toast } = useToast();
  const { user, activeRestaurantId, isStaffOutlet, primaryOutletId, isImpersonating, impersonatedRestaurantId, isMess } = useAuth();
  const geo = useGeoData();
  const { plan } = useSubscription();

  // Outlets belong to the parent restaurant account (never a branch outlet UID)
  const ownerId = (isImpersonating && impersonatedRestaurantId) 
    ? impersonatedRestaurantId 
    : (primaryOutletId || user?.uid || activeRestaurantId);
  const uid = ownerId;
  const isOutletView = isStaffOutlet;

  const [outlets, setOutlets]         = useState<Outlet[]>([]);
  const [loading, setLoading]         = useState(true);
  const [formOpen, setFormOpen]       = useState(false);
  const [editOutlet, setEditOutlet]   = useState<Outlet | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Outlet | null>(null);
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);

  // Form fields aligned with restaurant onboarding
  const [fname, setFname]             = useState("");
  const [femail, setFemail]           = useState("");
  const [fpassword, setFpassword]     = useState("");
  const [createAccount, setCreateAccount] = useState(false);
  const [fphone, setFphone]           = useState("");
  const [faddr, setFaddr]             = useState("");
  const [fstate, setFstate]           = useState("");
  const [fdistrict, setFdistrict]     = useState("");
  const [fcountryCode, setFcountryCode] = useState("IN");
  const [fhours, setFhours]           = useState("");
  const [fmanager, setFmanager]       = useState("");
  const [saving, setSaving]           = useState(false);

  // Calculate allowed additional outlets based on total outlet limit (Starter: 1, Growth: 5, Custom: Unlimited)
  const allowedOutlets = plan.maxOutlets === Infinity ? Infinity : plan.maxOutlets - 1;

  // ── Firestore listener ────────────────────────────────────────────────────

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "restaurants", uid, "outlets"),
      orderBy("createdAt"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setOutlets(
        snap.docs
          .filter(d => !d.data().isDeleted)
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Outlet, "id">) }))
      );
      setLoading(false);
    }, (err) => console.error("[OutletsPage] q listener failed", err));
    return unsub;
  }, [uid]);

  // ── Open / close form ────────────────────────────────────────────────────

  function openAdd() {
    if (outlets.length >= allowedOutlets) {
      setUpgradeDialogOpen(true);
      return;
    }
    setEditOutlet(null);
    setFname("");
    setFemail("");
    setFpassword("");
    setCreateAccount(false);
    setFphone("");
    setFaddr("");
    setFstate("");
    setFdistrict("");
    setFcountryCode("IN");
    setFhours("");
    setFmanager("");
    setFormOpen(true);
  }

  function openEdit(o: Outlet) {
    setEditOutlet(o);
    setFname(o.name || "");
    setFemail(o.email || o.outletEmail || "");
    setFpassword(""); // We don't show password on edit
    setCreateAccount(Boolean(o.outletUid || o.outletEmail));
    setFphone(o.phone || "");
    setFaddr(o.address || "");
    setFstate(o.state || "");
    setFdistrict(o.district || "");
    setFcountryCode(o.countryCode || "IN");
    setFhours(o.hours || "");
    setFmanager(o.managerName || "");
    setFormOpen(true);
  }

  // ── Save outlet ───────────────────────────────────────────────────────────

  async function saveOutlet() {
    if (!uid || !fname.trim()) return;

    if (!editOutlet && outlets.length >= allowedOutlets) {
      setUpgradeDialogOpen(true);
      return;
    }

    // Basic required details
    if (
      !fname.trim() ||
      !fphone.trim() ||
      !faddr.trim() ||
      !fstate ||
      !fdistrict ||
      !fhours.trim() ||
      !fmanager.trim()
    ) {
      toast({
        title: "Validation Error",
        description: "Please complete Outlet Name, Manager, Phone, Address, State, City, and Opening Hours.",
        variant: "destructive",
      });
      return;
    }

    if (fphone && !isValidPhoneNumber(fphone)) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid international phone number.",
        variant: "destructive",
      });
      return;
    }

    // Account creation validation
    if (createAccount) {
      if (!femail.trim()) {
        toast({
          title: "Email Required",
          description: "A login email is required when 'Create login account' is enabled.",
          variant: "destructive",
        });
        return;
      }
      if (!editOutlet && (!fpassword.trim() || fpassword.length < 6)) {
        toast({
          title: "Password Required",
          description: "Password must be at least 6 characters.",
          variant: "destructive",
        });
        return;
      }
      if (user?.email && femail.trim().toLowerCase() === user.email.toLowerCase()) {
        toast({
          title: "Email Already In Use",
          description: "The outlet login email cannot be the same as your primary account email. Please use a unique email or disable 'Create login account'.",
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);
    try {
      const baseData: Record<string, any> = {
        name: fname.trim(),
        email: femail.trim() || null,
        phone: fphone.trim(),
        address: faddr.trim(),
        state: fstate,
        district: fdistrict,
        countryCode: fcountryCode || "IN",
        hours: fhours.trim(),
        managerName: fmanager.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editOutlet) {
        const outletId = editOutlet.id;

        // If credentials are being assigned or modified via Auth
        if (createAccount && (fpassword.trim() || femail.trim() !== (editOutlet.email || editOutlet.outletEmail || ''))) {
          const createAccountFn = httpsCallable(functions, "createOutletAccount");
          
          await createAccountFn({
            outletId,
            parentId: uid,
            restaurantId: uid,
            email: femail.trim(),
            password: fpassword.trim() ? fpassword : undefined,
            name: fname.trim(),
            phone: fphone.trim(),
            address: faddr.trim(),
            state: fstate,
            district: fdistrict,
            countryCode: fcountryCode,
            hours: fhours.trim(),
            managerName: fmanager.trim(),
          });
        } else {
          // Direct subcollection & root sync
          await updateDoc(doc(db, "restaurants", uid, "outlets", outletId), baseData);
          if (editOutlet.outletUid) {
            await updateDoc(doc(db, "restaurants", outletId), baseData).catch(() => {});
          }
          if (isMess) {
            await updateDoc(doc(db, "mess_kitchens", uid, "outlets", outletId), baseData).catch(() => {});
          }
        }

        toast({ title: "Outlet updated successfully" });
      } else {
        // New Outlet Creation
        if (createAccount) {
          const createAccountFn = httpsCallable(functions, "createOutletAccount");
          
          await createAccountFn({
            parentId: uid,
            restaurantId: uid,
            email: femail.trim(),
            password: fpassword,
            name: fname.trim(),
            phone: fphone.trim(),
            address: faddr.trim(),
            state: fstate,
            district: fdistrict,
            countryCode: fcountryCode,
            hours: fhours.trim(),
            managerName: fmanager.trim(),
            createAccount: true
          });

          toast({ title: "Outlet and login account created successfully" });
        } else {
          // Direct Firestore creation: no external Cloud Function dependency needed!
          const newDocRef = doc(collection(db, "restaurants", uid, "outlets"));
          const newId = newDocRef.id;

          const newOutletData = {
            ...baseData,
            id: newId,
            outletUid: "",
            outletEmail: "",
            isActive: true,
            createdAt: serverTimestamp(),
          };

          await setDoc(newDocRef, newOutletData);
          if (isMess) {
            await setDoc(doc(db, "mess_kitchens", uid, "outlets", newId), newOutletData).catch(() => {});
          }

          toast({ title: "Outlet created successfully" });
        }
      }
      setFormOpen(false);
    } catch (e: any) {
      console.error("[OutletsPage] Save outlet error:", e);
      let errMsg = e?.message || String(e);
      if (errMsg.includes("already-exists") || errMsg.includes("already in use") || errMsg.includes("email-already-exists")) {
        errMsg = `The email ${femail} is already in use by another account. Please use a unique email for this branch login, or disable 'Create login account'.`;
      }
      toast({ title: "Error Saving Outlet", description: errMsg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // ── Toggle active ─────────────────────────────────────────────────────────

  async function toggleActive(o: Outlet) {
    if (!uid) return;
    const nextActive = !o.isActive;
    try {
      await updateDoc(doc(db, "restaurants", uid, "outlets", o.id), {
        isActive: nextActive,
      });
      await updateDoc(doc(db, "restaurants", o.id), {
        isActive: nextActive,
      });
      toast({ title: nextActive ? "Outlet opened" : "Outlet closed" });
    } catch (e) {
      toast({
        title: "Toggle error",
        description: String(e),
        variant: "destructive",
      });
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!uid || !deleteTarget) return;
    try {
      await updateDoc(doc(db, "restaurants", uid, "outlets", deleteTarget.id), { isDeleted: true });
      await updateDoc(doc(db, "restaurants", deleteTarget.id), { isDeleted: true });
      toast({ title: "Outlet removed successfully" });
    } catch (e) {
      toast({
        title: "Delete error",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setDeleteTarget(null);
    }
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total  = outlets.length;
  const active = outlets.filter((o) => o.isActive).length;

  // Validation helper
  const formIsValid = Boolean(
    fname.trim() &&
    (!createAccount || femail.trim()) &&
    fphone.trim() &&
    faddr.trim() &&
    fstate &&
    fdistrict &&
    fhours.trim() &&
    fmanager.trim()
  );

  if (isOutletView) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8 space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
          <Store className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-2xl font-black text-foreground">Not Authorized</h2>
        <p className="text-muted-foreground font-medium max-w-md">
          Outlet accounts cannot create or manage other outlets. Please switch to the main restaurant account to manage outlets.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">
            Outlets
          </h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground max-w-lg">
            Manage multiple physical locations under your restaurant group — each
            outlet has its own staff, tables, and order tracking.
          </p>
        </div>
        <Button onClick={openAdd} className="gap-2 rounded-xl font-bold shrink-0">
          <Plus className="h-4 w-4" />
          Add Outlet
        </Button>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <p className="text-sm font-semibold text-sky-800">
          <strong>Multi-Outlet Management:</strong> Each outlet operates independently
          with its own team and tables, while you get a unified view of revenue and
          performance across all locations.
        </p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Outlets" value={total} />
        <KpiCard label="Open" value={active} color="text-emerald-600" />
        <KpiCard label="Closed" value={total - active} color="text-slate-400" />
      </div>

      {/* Outlet List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : outlets.length === 0 ? (
        <EmptyState onAdd={openAdd} />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {outlets.map((o) => (
              <motion.div
                key={o.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className={cn(
                  "rounded-2xl border bg-card p-5 shadow-sm transition-opacity",
                  !o.isActive && "opacity-60",
                )}
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-100">
                    <Store className="h-6 w-6 text-sky-600" />
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-foreground text-base truncate">
                        {o.name}
                      </span>
                      <Badge
                        variant={o.isActive ? "default" : "secondary"}
                        className="text-[10px] font-bold px-1.5"
                      >
                        {o.isActive ? "OPEN" : "CLOSED"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {o.address && (
                        <InfoChip
                          icon={<MapPin className="h-3 w-3" />}
                          label={`${o.address}, ${o.district || ""}, ${o.state || ""}`}
                        />
                      )}
                      {o.phone && (
                        <InfoChip icon={<Phone className="h-3 w-3" />} label={o.phone} />
                      )}
                      {o.email && (
                        <InfoChip icon={<Mail className="h-3 w-3" />} label={o.email} />
                      )}
                      {o.hours && (
                        <InfoChip icon={<Clock className="h-3 w-3" />} label={o.hours} />
                      )}
                      {o.managerName && (
                        <InfoChip icon={<User className="h-3 w-3" />} label={o.managerName} />
                      )}
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={o.isActive}
                      onCheckedChange={() => toggleActive(o)}
                    />
                    <button
                      onClick={() => openEdit(o)}
                      className="rounded-lg p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(o)}
                      className="rounded-lg p-2 hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="rounded-[28px] max-w-lg overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">
              {editOutlet ? "Edit Outlet" : "New Outlet"}
            </DialogTitle>
            <DialogDescription>
              {editOutlet
                ? "Update your outlet profile details below."
                : "Fill out the required onboarding details to configure your new outlet location."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Outlet Name"
                value={fname}
                onChange={setFname}
                placeholder="e.g. Main Branch"
                autoFocus
              />
              <FormField
                label="Manager Name"
                value={fmanager}
                onChange={setFmanager}
                placeholder="Full name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 [&_.PhoneInputInput]:h-10 [&_.PhoneInputInput]:rounded-xl [&_.PhoneInputInput]:bg-background [&_.PhoneInputInput]:border [&_.PhoneInputInput]:border-input [&_.PhoneInputInput]:px-3 [&_.PhoneInputInput]:text-sm [&_.PhoneInputInput]:focus-visible:outline-none [&_.PhoneInputInput]:focus-visible:ring-2 [&_.PhoneInputInput]:focus-visible:ring-ring [&_.PhoneInputInput]:focus-visible:ring-offset-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Phone Number</Label>
                <PhoneInput
                  maxLength={15}
                  international
                  defaultCountry="IN"
                  value={fphone}
                  onChange={(val) => setFphone(val || "")}
                  className="w-full"
                />
              </div>
              <FormField
                label="Contact Email (Optional)"
                value={femail}
                onChange={setFemail}
                placeholder="e.g. info@branch.com"
                type="email"
              />
            </div>

            <FormField
              label="Address"
              value={faddr}
              onChange={setFaddr}
              placeholder="Floor, building, street name…"
            />

            {/* Separate Login Credentials Toggle */}
            <div className="rounded-2xl border border-border/40 p-4 bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-foreground">Separate Login Account</p>
                  <p className="text-xs text-muted-foreground">
                    Allow this branch to log in to the vendor portal with its own email & password.
                  </p>
                </div>
                <Switch
                  checked={createAccount}
                  onCheckedChange={setCreateAccount}
                />
              </div>

              {createAccount && (
                <div className="pt-2 space-y-3 border-t border-border/30">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      label="Login Email *"
                      value={femail}
                      onChange={setFemail}
                      placeholder="branch.login@restaurant.com"
                      type="email"
                    />
                    <FormField
                      label="Login Password *"
                      value={fpassword}
                      onChange={setFpassword}
                      placeholder={editOutlet ? "Leave blank to keep current" : "Min 6 characters"}
                      type="password"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    ⚠️ Must be a unique email (not your main owner account email).
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Country
                </Label>
                <select
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none bg-card"
                  value={fcountryCode}
                  onChange={(e) => {
                    setFcountryCode(e.target.value);
                    setFstate("");
                    setFdistrict("");
                  }}
                >
                  {(geo?.Country.getAllCountries() ?? []).map((c) => (
                    <option key={c.isoCode} value={c.isoCode}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  State
                </Label>
                <select
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none bg-card"
                  value={fstate}
                  disabled={!fcountryCode}
                  onChange={(e) => {
                    setFstate(e.target.value);
                    setFdistrict("");
                  }}
                >
                  <option value="">Select State</option>
                  {fcountryCode === "IN" ? (
                    indiaStates.map((s) => (
                      <option key={s.state} value={s.state}>
                        {s.state}
                      </option>
                    ))
                  ) : (
                    (geo?.State.getStatesOfCountry(fcountryCode) ?? []).map((s) => (
                      <option key={s.isoCode} value={s.isoCode}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  District
                </Label>
                <select
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none disabled:opacity-40 bg-card"
                  value={fdistrict}
                  disabled={!fstate}
                  onChange={(e) => setFdistrict(e.target.value)}
                >
                  <option value="">Select District</option>
                  {fcountryCode === "IN" ? (
                    indiaStates.find(s => s.state === fstate)?.districts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    )) || []
                  ) : (
                    (geo?.City.getCitiesOfState(fcountryCode, fstate) ?? []).map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    )) || []
                  )}
                </select>
              </div>
            </div>

            <OpeningHoursClockPicker
              label="Opening Hours"
              value={fhours}
              onChange={setFhours}
              required
            />

            <Button
              onClick={saveOutlet}
              disabled={saving || !formIsValid}
              className="w-full rounded-xl h-12 font-bold mt-2"
            >
              {saving
                ? "Saving…"
                : editOutlet
                ? "Update Outlet Profile"
                : "Add Outlet Location"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="rounded-[28px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Outlet</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{deleteTarget?.name}</strong>? Existing orders and data
              linked to this outlet will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upgrade Plan Dialog */}
      <Dialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen}>
        <DialogContent className="rounded-[28px] max-w-md p-6 text-center space-y-6">
          <DialogHeader>
            <div className="relative mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary/20 to-violet-500/20 flex items-center justify-center border border-primary/20 animate-pulse">
              <Store className="w-8 h-8 text-primary" />
              <Lock className="absolute -bottom-1 -right-1 w-4 h-4 text-amber-500 bg-background border rounded-full p-0.5" />
            </div>
            <DialogTitle className="text-xl font-black mt-4">Outlet Limit Reached</DialogTitle>
            <DialogDescription className="text-sm font-semibold text-muted-foreground mt-2 leading-relaxed">
              Your current <strong>{plan.name} Plan</strong> allows a maximum of <strong>{plan.maxOutlets} outlet{plan.maxOutlets > 1 ? 's' : ''}</strong>. 
              To add more locations and manage them from a unified dashboard, please upgrade your subscription.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setUpgradeDialogOpen(false)} className="flex-1 rounded-xl h-11 font-bold">
              Dismiss
            </Button>
            <Button asChild className="flex-1 rounded-xl h-11 font-bold bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 text-white border-0">
              <Link to="/dashboard/settings?tab=billing" onClick={() => setUpgradeDialogOpen(false)}>
                Upgrade Plan
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className={cn("text-3xl font-black", color ?? "text-foreground")}>
        {value}
      </p>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-1">
        {label}
      </p>
    </div>
  );
}

function InfoChip({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-slate-50 border px-2 py-1 rounded-lg">
      {icon}
      <span>{label}</span>
    </span>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1.5 flex-1">
      <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-xl h-10"
        autoFocus={autoFocus}
      />
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 rounded-3xl border-2 border-dashed border-border py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100">
        <Store className="h-8 w-8 text-sky-600" />
      </div>
      <div>
        <p className="font-black text-lg text-foreground">No outlets yet</p>
        <p className="text-sm text-muted-foreground font-medium mt-1 max-w-xs">
          Add your first outlet location to manage multiple branches from one
          dashboard.
        </p>
      </div>
      <Button onClick={onAdd} className="gap-2 rounded-xl">
        <Plus className="h-4 w-4" />
        Add First Outlet
      </Button>
    </div>
  );
}
