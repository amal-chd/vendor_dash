import { useEffect, useState } from "react";
import { runOp } from "@/lib/opFeedback";
import { collection, doc, getCountFromServer, onSnapshot, query, setDoc, serverTimestamp, Timestamp, where } from "firebase/firestore";
import { Crown, Save } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/firebase";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

const DEFAULTS = {
  earnPerHundred: 5,
  redeemValuePaise: 100,
  referralBonus: 50,
  referredBonus: 50,
  goldMonthlyPrice: 99,
  goldQuarterlyPrice: 249,
  goldYearlyPrice: 799,
};

export default function LoyaltyPage() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  // Exact count of members whose Gold hasn't lapsed (gold.ts writes goldUntil
  // as a Timestamp). Was a filter over the newest 500 customers only.
  const [goldNow, setGoldNow] = useState<number | null>(null);
  useEffect(() => {
    getCountFromServer(query(collection(db, "customer_users"), where("goldUntil", ">", Timestamp.now())))
      .then((s) => setGoldNow(s.data().count))
      .catch((err) => console.error("[LoyaltyPage] gold count failed", err));
  }, []);

  useEffect(() => {
    return onSnapshot(
      doc(db, "config", "loyalty"),
      (snap) => {
        if (snap.exists()) setCfg({ ...DEFAULTS, ...(snap.data() as typeof DEFAULTS) });
      },
      (err) => {
        console.error("[LoyaltyPage] config/loyalty listener failed", err);
        toast.error("Couldn't load loyalty config — showing defaults.");
      },
    );
  }, []);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Loyalty, referrals & Gold"
        description="Points earned on orders, referral bonuses and Gold membership prices. Changes apply in the apps as soon as you save."
        icon={Crown}
        badge={
          goldNow !== null ? (
            <Badge variant="secondary" className="ml-1 font-medium">
              {goldNow.toLocaleString("en-IN")} active Gold member{goldNow === 1 ? "" : "s"}
            </Badge>
          ) : undefined
        }
        actions={
          <Button
            disabled={!dirty}
            onClick={async () => {
              const ok = await runOp(
                () =>
                  setDoc(
                    doc(db, "config", "loyalty"),
                    { ...cfg, updatedAt: serverTimestamp() },
                    { merge: true },
                  ),
                "Loyalty config published",
                { failure: "Couldn't publish the loyalty config" },
              );
              // Keep the unsaved marker on failure — the edits are still local.
              if (ok) setDirty(false);
            }}
          >
            <Save className="h-4 w-4 mr-1" /> Save
          </Button>
        }
      />
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Points</CardTitle>
            <CardDescription>Restaurant POS loyalty already writes loyalty_wallets. These rates are the platform default.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div><Label>Points earned per ₹100</Label><Input type="number" value={cfg.earnPerHundred} onChange={(e) => { setCfg({ ...cfg, earnPerHundred: Number(e.target.value) }); setDirty(true); }} /></div>
            <div><Label>1 point value (paise)</Label><Input type="number" value={cfg.redeemValuePaise} onChange={(e) => { setCfg({ ...cfg, redeemValuePaise: Number(e.target.value) }); setDirty(true); }} /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Referrals</CardTitle>
            <CardDescription>Wallet credits when a referred customer completes first order (hook in order complete later if not already).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div><Label>Referrer bonus ₹</Label><Input type="number" value={cfg.referralBonus} onChange={(e) => { setCfg({ ...cfg, referralBonus: Number(e.target.value) }); setDirty(true); }} /></div>
            <div><Label>New user bonus ₹</Label><Input type="number" value={cfg.referredBonus} onChange={(e) => { setCfg({ ...cfg, referredBonus: Number(e.target.value) }); setDirty(true); }} /></div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Kada Gold prices</CardTitle>
            <CardDescription>purchaseGoldMembership reads this document; hardcoded fallbacks remain if unset.</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-3 gap-3">
            <div><Label>1 month ₹</Label><Input type="number" value={cfg.goldMonthlyPrice} onChange={(e) => { setCfg({ ...cfg, goldMonthlyPrice: Number(e.target.value) }); setDirty(true); }} /></div>
            <div><Label>3 months ₹</Label><Input type="number" value={cfg.goldQuarterlyPrice} onChange={(e) => { setCfg({ ...cfg, goldQuarterlyPrice: Number(e.target.value) }); setDirty(true); }} /></div>
            <div><Label>12 months ₹</Label><Input type="number" value={cfg.goldYearlyPrice} onChange={(e) => { setCfg({ ...cfg, goldYearlyPrice: Number(e.target.value) }); setDirty(true); }} /></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
