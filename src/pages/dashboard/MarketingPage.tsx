import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Image as ImageIcon
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { db, storage } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, Timestamp, updateDoc, where } from "firebase/firestore";
import { toast } from "sonner";
import { FeatureGate } from "@/components/FeatureGate";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type MenuAd = {
  id: string;
  restaurantId: string;
  title: string;
  message?: string;
  imageUrl?: string;
  ctaText?: string;
  linkUrl?: string;
  enabled: boolean;
  priority?: number;
  startAt?: Timestamp;
  endAt?: Timestamp;
  showOncePerDay?: boolean;
  cooldownMinutes?: number;
  placement?: "popup" | "banner";
};

function tsToLocalInput(ts?: Timestamp) {
  if (!ts) return "";
  const d = ts.toDate();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function localInputToTs(v: string) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

export default function MarketingPage() {
  const { user, restaurantId , activeRestaurantId } = useAuth();
  const [menuAds, setMenuAds] = useState<MenuAd[]>([]);
  const [adDialogOpen, setAdDialogOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<MenuAd | null>(null);
  const [uploadingAdImage, setUploadingAdImage] = useState(false);
  const [adImageFile, setAdImageFile] = useState<File | null>(null);
  const [adForm, setAdForm] = useState({
    title: "",
    message: "",
    enabled: true,
    ctaText: "",
    linkUrl: "",
    priority: 0,
    showOncePerDay: true,
    cooldownMinutes: 0,
    startAtLocal: "",
    endAtLocal: "",
    imageUrl: "",
  });

  useEffect(() => {
    if (!user) return;
    const qAds = query(collection(db, "menu_ads"), where("restaurantId", "==", activeRestaurantId));
    const unsub = onSnapshot(
      qAds,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as MenuAd[];
        setMenuAds(next);
      },
      (err) => {
        console.error(err);
        toast.error("Failed to load menu ads");
      }
    );
    return () => unsub();
  }, [user, activeRestaurantId]);

  const openNewAd = () => {
    setEditingAd(null);
    setAdImageFile(null);
    setAdForm({
      title: "",
      message: "",
      enabled: true,
      ctaText: "View Offer",
      linkUrl: "",
      priority: 0,
      showOncePerDay: true,
      cooldownMinutes: 0,
      startAtLocal: "",
      endAtLocal: "",
      imageUrl: "",
    });
    setAdDialogOpen(true);
  };

  const openEditAd = (ad: MenuAd) => {
    setEditingAd(ad);
    setAdImageFile(null);
    setAdForm({
      title: ad.title || "",
      message: ad.message || "",
      enabled: !!ad.enabled,
      ctaText: ad.ctaText || "",
      linkUrl: ad.linkUrl || "",
      priority: Number(ad.priority) || 0,
      showOncePerDay: !!ad.showOncePerDay,
      cooldownMinutes: Number(ad.cooldownMinutes) || 0,
      startAtLocal: tsToLocalInput(ad.startAt),
      endAtLocal: tsToLocalInput(ad.endAt),
      imageUrl: ad.imageUrl || "",
    });
    setAdDialogOpen(true);
  };

  const uploadAdImageIfNeeded = async () => {
    if (!user) return adForm.imageUrl || "";
    if (!adImageFile) return adForm.imageUrl || "";
    setUploadingAdImage(true);
    try {
      const storageRef = ref(storage, `ads/${activeRestaurantId}/${Date.now()}_${adImageFile.name}`);
      const snapshot = await uploadBytes(storageRef, adImageFile);
      const url = await getDownloadURL(snapshot.ref);
      return url;
    } finally {
      setUploadingAdImage(false);
    }
  };

  const saveAd = async () => {
    if (!user) return;
    const title = adForm.title.trim();
    if (title.length < 2) {
      toast.error("Ad title is required");
      return;
    }
    try {
      const imageUrl = await uploadAdImageIfNeeded();
      const startAt = localInputToTs(adForm.startAtLocal);
      const endAt = localInputToTs(adForm.endAtLocal);
      const payload = {
        restaurantId: activeRestaurantId,
        placement: "popup",
        title,
        message: adForm.message.trim() || "",
        enabled: !!adForm.enabled,
        imageUrl: imageUrl || "",
        ctaText: adForm.ctaText.trim() || "",
        linkUrl: adForm.linkUrl.trim() || "",
        priority: Number(adForm.priority) || 0,
        showOncePerDay: !!adForm.showOncePerDay,
        cooldownMinutes: Math.max(0, Number(adForm.cooldownMinutes) || 0),
        ...(startAt ? { startAt } : {}),
        ...(endAt ? { endAt } : {}),
        updatedAt: serverTimestamp(),
      };

      if (editingAd) {
        await updateDoc(doc(db, "menu_ads", editingAd.id), payload);
        toast.success("Ad updated");
      } else {
        await addDoc(collection(db, "menu_ads"), { ...payload, createdAt: serverTimestamp() });
        toast.success("Ad created");
      }
      setAdDialogOpen(false);
      setEditingAd(null);
      setAdImageFile(null);
    } catch (e) {
      console.error(e);
      toast.error("Failed to save ad");
    }
  };

  const deleteAd = async (ad: MenuAd) => {
    if (!confirm(`Delete ad "${ad.title}"?`)) return;
    try {
      await deleteDoc(doc(db, "menu_ads", ad.id));
      toast.success("Ad deleted");
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete ad");
    }
  };

  const toggleAdEnabled = async (ad: MenuAd, enabled: boolean) => {
    try {
      await updateDoc(doc(db, "menu_ads", ad.id), { enabled, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      toast.error("Failed to update ad");
    }
  };

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 mt-2">
        <div className="space-y-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <h1 className="text-3xl sm:text-4xl font-black text-foreground tracking-tight uppercase italic">Growth <span className="text-primary not-italic">Hub</span></h1>

          </div>
          <p className="text-xs sm:text-sm text-muted-foreground font-medium italic opacity-60">
            Create ad popups and offers for your digital menu.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          {user && (
            <a
              href={`/menu?restaurantId=${activeRestaurantId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto"
            >
              <Button variant="outline" className="w-full rounded-xl h-11 font-black uppercase tracking-widest text-[10px] border-border/40 gap-2 px-6 shadow-sm">
                <ExternalLink className="w-4 h-4" /> Open Menu
              </Button>
            </a>
          )}
        </div>
      </div>

      <Tabs defaultValue="menuAds" className="space-y-8">
        <TabsList className="w-full sm:w-auto rounded-2xl bg-muted/20 border border-border/30 p-1">
          <TabsTrigger value="menuAds" className="rounded-xl font-black uppercase tracking-widest text-[10px] px-4 h-10">
            Digital Menu Ads
          </TabsTrigger>
        </TabsList>

        <TabsContent value="menuAds" className="space-y-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-black tracking-tight uppercase italic">Digital Menu <span className="text-primary not-italic">Ads</span></h2>
              <p className="text-xs text-muted-foreground font-medium italic opacity-70">
                Create popup offers that show on your public menu.
              </p>
            </div>
            <Button
              onClick={openNewAd}
              className="rounded-xl h-11 font-black uppercase tracking-widest text-[10px] shadow-lg shadow-primary/20 gap-2 px-6 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" /> New Ad
            </Button>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
            {menuAds
              .slice()
              .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))
              .map((ad) => (
                <Card key={ad.id} className="rounded-[2rem] border-none shadow-2xl bg-card/40 backdrop-blur-xl overflow-hidden">
                  <div className="h-40 bg-muted/20 relative">
                    {ad.imageUrl ? (
                      <img loading="lazy" src={ad.imageUrl} alt={ad.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="absolute top-3 left-3 flex items-center gap-2">
                      <Badge className={cn("rounded-full text-[9px] font-black uppercase tracking-widest", ad.enabled ? "bg-success/15 text-success" : "bg-muted/30 text-muted-foreground")}>
                        {ad.enabled ? "Live" : "Paused"}
                      </Badge>
                      {(Number(ad.priority) || 0) > 0 && (
                        <Badge variant="outline" className="rounded-full text-[9px] font-black uppercase tracking-widest">
                          Priority {Number(ad.priority) || 0}
                        </Badge>
                      )}
                    </div>
                    <div className="absolute top-3 right-3">
                      <Switch checked={!!ad.enabled} onCheckedChange={(v) => toggleAdEnabled(ad, v)} />
                    </div>
                  </div>
                  <CardHeader className="p-6 pb-3">
                    <CardTitle className="text-base font-black tracking-tight uppercase italic">{ad.title}</CardTitle>
                    <CardDescription className="text-xs font-medium opacity-70 line-clamp-2">
                      {ad.message || "No message"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-6 pb-6 space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                      <span>{ad.showOncePerDay ? "Once per day" : "Repeatable"}</span>
                      <span>{(Number(ad.cooldownMinutes) || 0) > 0 ? `${Number(ad.cooldownMinutes)}m cooldown` : "No cooldown"}</span>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1 rounded-xl h-11 font-black uppercase tracking-widest text-[10px] gap-2 border-border/40"
                        onClick={() => openEditAd(ad)}
                      >
                        <Pencil className="w-4 h-4" /> Edit
                      </Button>
                      <Button
                        variant="destructive"
                        className="rounded-xl h-11 font-black uppercase tracking-widest text-[10px] gap-2"
                        onClick={() => deleteAd(ad)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            {menuAds.length === 0 && (
              <Card className="rounded-[2rem] border border-border/40 bg-card/30 backdrop-blur-xl p-10 md:col-span-2 xl:col-span-3 text-center">
                <Sparkles className="w-10 h-10 mx-auto mb-4 opacity-30" />
                <div className="text-sm font-black uppercase tracking-widest opacity-70">No ads yet</div>
                <div className="text-xs text-muted-foreground mt-2 italic">Create your first popup offer for the menu.</div>
              </Card>
            )}
          </div>

          <Dialog open={adDialogOpen} onOpenChange={setAdDialogOpen}>
            <DialogContent className="rounded-3xl max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-black uppercase tracking-tight">
                  {editingAd ? "Edit Ad" : "Create Ad"}
                </DialogTitle>
                <DialogDescription className="text-xs font-bold uppercase tracking-widest">
                  This popup will appear on your public digital menu.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-5 pt-2">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Title</Label>
                    <Input
                      value={adForm.title}
                      onChange={(e) => setAdForm((p) => ({ ...p, title: e.target.value }))}
                      className="h-11 rounded-2xl font-bold"
                      placeholder="Weekend Offer"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Priority</Label>
                    <Input
                      type="number"
                      value={adForm.priority}
                      onChange={(e) => setAdForm((p) => ({ ...p, priority: Number(e.target.value) }))}
                      className="h-11 rounded-2xl font-bold"
                      min={0}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest">Message</Label>
                  <Textarea
                    value={adForm.message}
                    onChange={(e) => setAdForm((p) => ({ ...p, message: e.target.value }))}
                    className="rounded-2xl min-h-[120px] font-medium"
                    placeholder="Try our chef's special today and get 10% off..."
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">CTA Text</Label>
                    <Input
                      value={adForm.ctaText}
                      onChange={(e) => setAdForm((p) => ({ ...p, ctaText: e.target.value }))}
                      className="h-11 rounded-2xl font-bold"
                      placeholder="View Offer"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Link URL</Label>
                    <Input
                      value={adForm.linkUrl}
                      onChange={(e) => setAdForm((p) => ({ ...p, linkUrl: e.target.value }))}
                      className="h-11 rounded-2xl font-bold"
                      placeholder="https://..."
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-5 items-start">
                  <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Ad Image</Label>
                    <div className="flex gap-4 items-center">
                      <div className="w-20 h-20 rounded-2xl bg-muted border-2 border-dashed border-border flex items-center justify-center overflow-hidden relative">
                        {adImageFile ? (
                          <img loading="lazy" src={URL.createObjectURL(adImageFile)} alt="Ad creative preview" className="w-full h-full object-cover" />
                        ) : adForm.imageUrl ? (
                          <img loading="lazy" src={adForm.imageUrl} alt="Ad creative" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
                        )}
                        {uploadingAdImage && (
                          <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                            <Plus className="w-4 h-4 animate-spin" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <Input
                          id="ad-image-input"
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => setAdImageFile(e.target.files?.[0] ?? null)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full rounded-xl font-bold h-10 text-xs"
                          onClick={() => document.getElementById("ad-image-input")?.click()}
                          disabled={uploadingAdImage}
                        >
                          {adImageFile || adForm.imageUrl ? "Change Image" : "Upload Image"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 pt-1">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-black uppercase tracking-widest">Enabled</div>
                        <div className="text-[11px] text-muted-foreground italic">Show on menu</div>
                      </div>
                      <Switch checked={adForm.enabled} onCheckedChange={(v) => setAdForm((p) => ({ ...p, enabled: v }))} />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-black uppercase tracking-widest">Once Per Day</div>
                        <div className="text-[11px] text-muted-foreground italic">Avoid spamming guests</div>
                      </div>
                      <Switch checked={adForm.showOncePerDay} onCheckedChange={(v) => setAdForm((p) => ({ ...p, showOncePerDay: v }))} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest">Cooldown (minutes)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={adForm.cooldownMinutes}
                        onChange={(e) => setAdForm((p) => ({ ...p, cooldownMinutes: Number(e.target.value) }))}
                        className="h-11 rounded-2xl font-bold"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Start At (optional)</Label>
                    <Input
                      type="datetime-local"
                      value={adForm.startAtLocal}
                      onChange={(e) => setAdForm((p) => ({ ...p, startAtLocal: e.target.value }))}
                      className="h-11 rounded-2xl font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">End At (optional)</Label>
                    <Input
                      type="datetime-local"
                      value={adForm.endAtLocal}
                      onChange={(e) => setAdForm((p) => ({ ...p, endAtLocal: e.target.value }))}
                      className="h-11 rounded-2xl font-bold"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="rounded-2xl font-black uppercase tracking-widest text-[10px] h-11 px-5"
                    onClick={() => setAdDialogOpen(false)}
                    disabled={uploadingAdImage}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="rounded-2xl font-black uppercase tracking-widest text-[10px] h-11 px-5"
                    onClick={saveAd}
                    disabled={uploadingAdImage}
                  >
                    {editingAd ? "Save Changes" : "Create Ad"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
