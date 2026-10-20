import { useState } from "react";
import { FlaskConical, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePermissions } from "@/hooks/usePermissions";
import { FoodWaterfall, RuleVersions, StayWaterfall } from "./PricingWaterfall";
import { callableError, canSimulate, pricingAdmin, readSimDrafts, writeSimDrafts, type RuleDraft } from "./pricingShared";

interface ItemRow { menuItemId: string; qty: string; variant: string; addons: string }

const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const rupeesToPaise = (v: string) => Math.max(0, Math.round((Number(v) || 0) * 100));

interface SimResult { quote: any; draftProblems: string[] }

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export default function PricingSimulatorPage() {
  const { role } = usePermissions();
  const [mode, setMode] = useState<"food" | "stay">("food");
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => readSimDrafts());
  const [at, setAt] = useState(toLocalInput(Date.now()));
  const [customerUid, setCustomerUid] = useState("");
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [resultMode, setResultMode] = useState<"food" | "stay">("food");

  // Food
  const [restaurantId, setRestaurantId] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ menuItemId: "", qty: "1", variant: "", addons: "" }]);
  const [pickup, setPickup] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [tip, setTip] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [weather, setWeather] = useState(false);
  const [activeOrders, setActiveOrders] = useState("");
  const [riders, setRiders] = useState("");
  const [gold, setGold] = useState(false);
  const [completedOrders, setCompletedOrders] = useState("");
  const [customerState, setCustomerState] = useState("");

  // Stay
  const [hotelId, setHotelId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState("2");

  if (!canSimulate(role)) {
    return <p className="text-sm text-muted-foreground">Your role can't run the pricing simulator.</p>;
  }

  const removeDraft = (ruleId: string) => {
    const next = drafts.filter((d) => d.ruleId !== ruleId);
    setDrafts(next);
    writeSimDrafts(next);
  };

  async function run() {
    setBusy(true);
    setResult(null);
    const atMs = new Date(at).getTime();
    const common = { at: Number.isFinite(atMs) ? atMs : Date.now(), customerUid: customerUid.trim() || undefined, draftRules: drafts };
    try {
      if (mode === "food") {
        const overrides: Record<string, unknown> = { weatherAlert: weather };
        if (zoneId.trim()) overrides.zoneId = zoneId.trim();
        if (distanceKm) overrides.distanceKm = Number(distanceKm);
        if (activeOrders || riders) overrides.demand = { activeOrders: Number(activeOrders) || 0, availableRiders: Number(riders) || 0 };
        if (gold) overrides.isGold = true;
        if (completedOrders !== "") overrides.completedOrders = Number(completedOrders);
        if (customerState.trim()) overrides.customerStateCode = customerState.trim();
        const res = await pricingAdmin<SimResult>("simulateFood", {
          ...common,
          cart: {
            restaurantId: restaurantId.trim(),
            items: items
              .filter((i) => i.menuItemId.trim())
              .map((i) => ({
                menuItemId: i.menuItemId.trim(),
                qty: Number(i.qty) || 1,
                selectedVariant: i.variant.trim() ? { name: i.variant.trim() } : null,
                selectedAddons: i.addons.split(",").map((a) => a.trim()).filter(Boolean).map((name) => ({ name })),
              })),
            fulfilment: pickup ? "pickup" : "delivery",
            drop: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
            couponCode: coupon.trim() || null,
            tipPaise: rupeesToPaise(tip),
          },
          overrides,
        });
        setResult(res);
      } else {
        const res = await pricingAdmin<SimResult>("simulateStay", {
          ...common,
          hotelId: hotelId.trim(),
          roomId: roomId.trim(),
          checkIn,
          checkOut,
          guests: Number(guests) || 1,
          couponCode: coupon.trim() || null,
        });
        setResult(res);
      }
      setResultMode(mode);
    } catch (e) {
      toast.error(callableError(e));
    } finally {
      setBusy(false);
    }
  }

  const q = result?.quote;
  const problems: string[] = [...(result?.draftProblems ?? []), ...(q?.problems ?? []), ...(q?.couponProblem ? [q.couponProblem] : [])];

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Pricing simulator"
        description="Price any cart or stay with the live engine — optionally with unpublished draft rules — and see exactly who gets what. Nothing is saved or charged."
        icon={FlaskConical}
      />

      <div className="flex gap-2">
        <Button size="sm" variant={mode === "food" ? "default" : "outline"} onClick={() => setMode("food")}>Food order</Button>
        <Button size="sm" variant={mode === "stay" ? "default" : "outline"} onClick={() => setMode("stay")}>Stay booking</Button>
      </div>

      <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-4">
        {mode === "food" ? (
          <>
            <Field label="Restaurant id" className="md:col-span-2"><Input value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} /></Field>
            <Field label="Fulfilment">
              <div className="flex h-9 items-center gap-2"><Switch checked={pickup} onCheckedChange={setPickup} /><span className="text-sm">{pickup ? "Pickup" : "Delivery"}</span></div>
            </Field>
            <Field label="Tip (₹)"><Input type="number" min="0" value={tip} onChange={(e) => setTip(e.target.value)} /></Field>
            <div className="space-y-2 md:col-span-4">
              <Label className="text-xs">Items</Label>
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input className="col-span-4" placeholder="Menu item id" value={it.menuItemId} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, menuItemId: e.target.value } : x)))} />
                  <Input className="col-span-1" type="number" min="1" value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                  <Input className="col-span-3" placeholder="Variant name (optional)" value={it.variant} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, variant: e.target.value } : x)))} />
                  <Input className="col-span-3" placeholder="Add-ons, comma separated" value={it.addons} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, addons: e.target.value } : x)))} />
                  <Button aria-label="Delete" className="col-span-1" size="icon" variant="ghost" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setItems([...items, { menuItemId: "", qty: "1", variant: "", addons: "" }])}><Plus className="mr-1 h-4 w-4" /> Item</Button>
            </div>
            {!pickup && (
              <>
                <Field label="Drop latitude"><Input value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
                <Field label="Drop longitude"><Input value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
                <Field label="Override distance (km)"><Input type="number" min="0" step="0.1" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} /></Field>
                <Field label="Override zone id"><Input value={zoneId} onChange={(e) => setZoneId(e.target.value)} /></Field>
                <Field label="Active orders (demand)"><Input type="number" min="0" value={activeOrders} onChange={(e) => setActiveOrders(e.target.value)} /></Field>
                <Field label="Available riders"><Input type="number" min="0" value={riders} onChange={(e) => setRiders(e.target.value)} /></Field>
                <Field label="Weather alert">
                  <div className="flex h-9 items-center"><Switch checked={weather} onCheckedChange={setWeather} /></div>
                </Field>
              </>
            )}
            <Field label="Kada Gold customer"><div className="flex h-9 items-center"><Switch checked={gold} onCheckedChange={setGold} /></div></Field>
            <Field label="Customer's completed orders"><Input type="number" min="0" value={completedOrders} onChange={(e) => setCompletedOrders(e.target.value)} /></Field>
            <Field label="Customer GST state code"><Input placeholder="32" maxLength={2} value={customerState} onChange={(e) => setCustomerState(e.target.value)} /></Field>
          </>
        ) : (
          <>
            <Field label="Property (hotel) id" className="md:col-span-2"><Input value={hotelId} onChange={(e) => setHotelId(e.target.value)} /></Field>
            <Field label="Room id" className="md:col-span-2"><Input value={roomId} placeholder="Blank = the property's first room" onChange={(e) => setRoomId(e.target.value)} /></Field>
            <Field label="Check-in"><Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></Field>
            <Field label="Check-out"><Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></Field>
            <Field label="Guests"><Input type="number" min="1" value={guests} onChange={(e) => setGuests(e.target.value)} /></Field>
          </>
        )}
        <Field label="Coupon code"><Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} /></Field>
        <Field label="Price at (your local time)"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        <Field label="Price as a specific customer (account ID, optional)" className="md:col-span-2"><Input value={customerUid} onChange={(e) => setCustomerUid(e.target.value)} /></Field>

        <div className="space-y-2 md:col-span-4">
          <Label className="text-xs">Draft rules under test</Label>
          {drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground">None. Use "Test in simulator" in the rule editor to try a change before publishing it.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {drafts.map((d) => (
                <span key={d.ruleId} className="inline-flex items-center gap-1 rounded border border-amber-400 px-2 py-0.5 font-mono text-xs text-amber-700 dark:text-amber-400">
                  {d.ruleId}
                  <button aria-label={`Remove ${d.ruleId}`} onClick={() => removeDraft(d.ruleId)}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="md:col-span-4">
          <Button disabled={busy} onClick={run}>{busy ? "Pricing…" : "Run simulation"}</Button>
        </div>
      </div>

      {problems.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {q?.warnings?.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <ul className="list-disc pl-5">{q.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {q && (resultMode === "food" ? <FoodWaterfall quote={q} /> : <StayWaterfall quote={q} />)}
      {q && <RuleVersions versions={q.ruleVersions} />}
    </div>
  );
}
