import { useEffect, useState } from "react";
import { runOp } from "@/lib/opFeedback";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { Smartphone, Save } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/firebase";
import { toast } from "sonner";

const DEFAULTS = {
  customerMinIos: "1.0.0",
  customerMinAndroid: "1.0.0",
  customerLatestIos: "1.0.0",
  customerLatestAndroid: "1.0.0",
  vendorMin: "1.0.0",
  riderMin: "1.0.0",
  hostMin: "1.0.0",
  forceUpdate: false,
  storeUrlIos: "",
  storeUrlAndroid: "",
  releaseNotes: "",
};

export default function AppReleasesPage() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, "config", "app_releases"), (snap) => {
      if (snap.exists()) setCfg({ ...DEFAULTS, ...(snap.data() as typeof DEFAULTS) });
    }, (err) => console.error("[AppReleasesPage] config listener failed", err));
  }, []);

  const set = <K extends keyof typeof DEFAULTS>(k: K, v: (typeof DEFAULTS)[K]) => {
    setCfg((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="App versions & force update"
        description="DoorDash / Swiggy-style minimum version. Customer app reads config/app_releases on splash and blocks outdated binaries when forceUpdate is on."
        icon={Smartphone}
        actions={
          <Button
            disabled={!dirty}
            onClick={async () => {
              // A silent failure here is costly: the apps read this document on
              // splash to block outdated binaries, so "published" when nothing
              // was written means old builds keep running unchallenged.
              const ok = await runOp(
                () =>
                  setDoc(
                    doc(db, "config", "app_releases"),
                    { ...cfg, updatedAt: serverTimestamp() },
                    { merge: true },
                  ),
                "Release policy published",
                { failure: "Couldn't publish the release policy" },
              );
              if (ok) setDirty(false);
            }}
          >
            <Save className="h-4 w-4 mr-1" /> Publish
          </Button>
        }
      />
      <Card>
        <CardHeader><CardTitle className="text-sm">Customer app</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div><Label>Min iOS</Label><Input value={cfg.customerMinIos} onChange={(e) => set("customerMinIos", e.target.value)} /></div>
          <div><Label>Min Android</Label><Input value={cfg.customerMinAndroid} onChange={(e) => set("customerMinAndroid", e.target.value)} /></div>
          <div><Label>Latest iOS</Label><Input value={cfg.customerLatestIos} onChange={(e) => set("customerLatestIos", e.target.value)} /></div>
          <div><Label>Latest Android</Label><Input value={cfg.customerLatestAndroid} onChange={(e) => set("customerLatestAndroid", e.target.value)} /></div>
          <div><Label>App Store URL</Label><Input value={cfg.storeUrlIos} onChange={(e) => set("storeUrlIos", e.target.value)} /></div>
          <div><Label>Play Store URL</Label><Input value={cfg.storeUrlAndroid} onChange={(e) => set("storeUrlAndroid", e.target.value)} /></div>
          <div className="sm:col-span-2 flex items-center justify-between rounded-xl border px-4 py-3">
            <Label>Force update below min version</Label>
            <Switch checked={cfg.forceUpdate} onCheckedChange={(v) => set("forceUpdate", v)} />
          </div>
          <div className="sm:col-span-2"><Label>Release notes</Label><Textarea value={cfg.releaseNotes} onChange={(e) => set("releaseNotes", e.target.value)} /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Partner apps (minimum)</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-4">
          <div><Label>Vendor</Label><Input value={cfg.vendorMin} onChange={(e) => set("vendorMin", e.target.value)} /></div>
          <div><Label>Rider</Label><Input value={cfg.riderMin} onChange={(e) => set("riderMin", e.target.value)} /></div>
          <div><Label>Host</Label><Input value={cfg.hostMin} onChange={(e) => set("hostMin", e.target.value)} /></div>
        </CardContent>
      </Card>
    </div>
  );
}
