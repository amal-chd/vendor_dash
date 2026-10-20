import { useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { ImagePlus, Loader2 } from "lucide-react";
import { auth, db, storage } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Kind = "logo" | "cover";

/**
 * Logo + cover photo for a mess kitchen — what customers see on Kada Mess.
 * Saved on the kitchen doc as `logoUrl` / `coverImage`. The kitchen uploads
 * into its own folder; an admin (who can't write there) uploads into theirs.
 */
export function KitchenPhotos({
  kitchenId,
  logoUrl,
  coverImage,
  asAdmin = false,
}: {
  kitchenId: string;
  logoUrl?: string | null;
  coverImage?: string | null;
  asAdmin?: boolean;
}) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [urls, setUrls] = useState<{ logo?: string | null; cover?: string | null }>({ logo: logoUrl, cover: coverImage });

  const upload = async (kind: Kind, file: File) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return toast.error("Sign in again to upload.");
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file.");
    if (file.size > 8 * 1024 * 1024) return toast.error("Images must be under 8 MB.");
    setBusy(kind);
    try {
      const folder = asAdmin ? `ads/${uid}/mess/${kitchenId}` : `mess_kitchens/${kitchenId}`;
      const r = ref(storage, `${folder}/${kind}_${Date.now()}.${file.name.split(".").pop() || "jpg"}`);
      await uploadBytes(r, file, { contentType: file.type });
      const url = await getDownloadURL(r);
      await updateDoc(doc(db, "mess_kitchens", kitchenId), {
        [kind === "logo" ? "logoUrl" : "coverImage"]: url,
        updatedAt: serverTimestamp(),
      });
      setUrls((u) => ({ ...u, [kind]: url }));
      toast.success(kind === "logo" ? "Logo updated" : "Cover photo updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const slot = (kind: Kind, label: string, hint: string, url?: string | null) => (
    <label className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 p-3 cursor-pointer hover:bg-muted/50">
      <div className={`${kind === "logo" ? "w-14" : "w-24"} h-14 rounded-xl overflow-hidden bg-background border border-border/50 flex items-center justify-center shrink-0`}>
        {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <ImagePlus className="w-5 h-5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={busy !== null} asChild>
        <span>{busy === kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : url ? "Change" : "Upload"}</span>
      </Button>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(kind, f);
        }}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      {slot("logo", "Logo", "Square — shown on the kitchen card", urls.logo)}
      {slot("cover", "Cover photo", "Wide — top of the kitchen page", urls.cover)}
    </div>
  );
}
