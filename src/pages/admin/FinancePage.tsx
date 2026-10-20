import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import {
  TrendingUp,
  Wallet,
  Store,
  RotateCcw,
  CreditCard,
  AlertTriangle,
  Activity,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { functions } from "@/lib/firebase";
import { formatMoney } from "@/lib/currency";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLiveCollection } from "@/hooks/useLiveCollection";

interface FinanceSummary {
  rangeDays: number;
  generatedAt: number;
  // `orders` = ONLINE marketplace only. In-store (walk-in POS + QR) is
  // reported separately so it never inflates GMV headlines.
  orders: { gmv: number; orderCount: number; discountGiven: number; deliveryFees: number };
  inStore?: { gmv: number; orderCount: number };
  allChannels?: { gmv: number; orderCount: number };
  revenue: { commission: number; deliveryFees: number; ads: number; stayCommission: number; gatewayFees: number; gross: number };
  payouts: { vendorPaid: number; vendorPending: number; riderPaid: number; riderPending: number; hostPaid: number; hostPending: number };
  leakage: { refunds: number; refundCount: number; discounts: number };
  liabilities: { wallet: number; giftCards: number; giftCardCount: number; goldMembers: number };
  pending: { adCharges: number };
  netEarnings: number;
}

interface EarningsBreakdown {
  vendors: Array<{
    restaurantId: string; restaurantName: string; grossSales: number; commission: number;
    gatewayFee: number; tax: number; adDeductions: number; adjustments: number;
    refundOffsets: number; net: number; paid: number; pending: number;
  }>;
  riders: Array<{
    riderId: string; riderName: string; deliveries: number; earned: number;
    tips: number; codCollected: number;
  }>;
  platform: { commission: number; deliveryFees: number; ads: number; gross: number; riderPayout: number; net: number };
  cod: { outstanding: number };
}

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

const money = (n: number) => formatMoney(n ?? 0);

export default function FinancePage() {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [breakdown, setBreakdown] = useState<EarningsBreakdown | null>(null);
  const [bdTab, setBdTab] = useState<"vendors" | "riders">("vendors");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pull live vendor settlements to show recent transactions natively
  const settlements = useLiveCollection<any>("vendor_settlements", { limit: 10, orderByField: "createdAt", orderDir: "desc" });

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable<{ days: number }, FinanceSummary>(functions, "getFinanceSummary");
      const res = await fn({ days: d });
      setData(res.data);
      // Per-entity breakdown (vendor / rider / platform), same window.
      try {
        const bfn = httpsCallable<{ days: number }, EarningsBreakdown>(functions, "getEarningsBreakdown");
        const bres = await bfn({ days: d });
        setBreakdown(bres.data);
      } catch {
        setBreakdown(null); // breakdown is additive — never block the summary
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the finance summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  // Six cards in reading order: what flowed through → what Kada kept → what
  // is still owed out. Each money card drills into the tab that explains it.
  const kpis = useMemo(() => {
    if (!data) return [];
    const payoutObligations = (data.payouts?.vendorPending || 0) + (data.payouts?.riderPending || 0) + (data.payouts?.hostPending || 0);
    const unpaidSettlements = settlements.rows.filter((r) => r.status !== "paid").length;
    return [
      { label: "Online GMV", value: money(data.orders?.gmv || 0), icon: TrendingUp,
        hint: `${data.orders?.orderCount || 0} orders · excludes walk-in/QR` },
      { label: "Gross revenue", value: money(data.revenue?.gross || 0), tone: "text-emerald-600", icon: Wallet,
        hint: "Everything Kada earned" },
      { label: "Commission", value: money(data.revenue?.commission || 0), tone: "text-indigo-600", icon: Store,
        hint: "Share of order value" },
      { label: "Refunds", value: money(data.leakage?.refunds || 0), tone: "text-rose-600", icon: RotateCcw,
        hint: "Returned to customers", onClick: () => navigate("/admin/finance?tab=refunds") },
      { label: "Net revenue", value: money(data.netEarnings || 0), tone: (data.netEarnings || 0) >= 0 ? "text-emerald-600" : "text-rose-600", icon: Wallet,
        hint: "After refunds and costs" },
      { label: "Owed to partners", value: money(payoutObligations), tone: "text-amber-600", icon: CreditCard,
        hint: `${unpaidSettlements} settlement${unpaidSettlements === 1 ? "" : "s"} unpaid`, onClick: () => navigate("/admin/finance?tab=settlements") },
    ];
  }, [data, settlements.rows, navigate]);

  // Derive stats from live settlements for true accuracy
  const totalPaidSettlements = settlements.rows.filter(s => s.status === 'paid').length;
  const payoutCompletionRate = settlements.rows.length ? Math.round((totalPaidSettlements / settlements.rows.length) * 100) : 100;
  
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Finance overview"
        description="The whole-ecosystem P&L — revenue, payouts, leakage and liabilities across all verticals."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border/60 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setDays(r.days)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    days === r.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => load(days)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/30">
          <CardContent className="py-4 text-sm text-red-700 dark:text-red-300">{error}</CardContent>
        </Card>
      )}

      {/* Anomaly Alerts */}
      {data && (data.leakage?.refunds || 0) > 50000 && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-600 px-4 py-3 rounded-xl flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="flex-1">
            <h4 className="text-sm font-bold">Anomaly Detected: Refund Spike</h4>
            <p className="text-xs font-medium opacity-90">Unusual volume of refunds processed in the selected period. Totaling {money(data.leakage.refunds)}.</p>
          </div>
          <Button variant="outline" size="sm" className="border-rose-500/30 text-rose-700" asChild><Link to="/admin/finance?tab=refunds">View Details</Link></Button>
        </div>
      )}

      <StatCards
        loading={loading && !kpis.length}
        stats={
          kpis.length
            ? kpis
            : ["Online GMV", "Gross revenue", "Commission", "Refunds", "Net revenue", "Owed to partners"].map(
                (label) => ({ label, value: "—" }),
              )
        }
      />

      {/* ── Walk-in & QR (in-store) — deliberately SEPARATE from GMV ──────────
          This is the restaurant's own counter/table revenue flowing through
          Kada's POS. It is excluded from Online GMV, order counts and every
          marketplace headline above, because counting it as GMV would overstate
          the marketplace and distort take-rate and growth reporting. */}
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-bold tracking-tight flex items-center gap-2">
              <Store className="h-4 w-4 text-muted-foreground" />
              Walk-in &amp; QR orders
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">
                In-store
              </span>
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-prose">
              Counter (POS) and QR table orders. Tracked separately — these are
              <strong> not</strong> included in Online GMV or marketplace order counts.
            </p>
          </div>
          <div className="flex gap-8">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">In-store sales</p>
              <p className="text-2xl font-bold tracking-tight mt-1">
                {loading ? "…" : money(data?.inStore?.gmv || 0)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Orders</p>
              <p className="text-2xl font-bold tracking-tight mt-1">
                {loading ? "…" : (data?.inStore?.orderCount || 0).toLocaleString("en-IN")}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">All channels</p>
              <p className="text-2xl font-bold tracking-tight mt-1 text-muted-foreground">
                {loading ? "…" : money(data?.allChannels?.gmv || 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Earnings breakdown: gross → deductions → net, per entity ─────────
          Every figure comes from the ledger that actually governs the payout
          (vendor_settlements / orders.riderEarning), never a rate × volume
          shortcut — so these reconcile with what is really paid out. */}
      {breakdown && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-base">Earnings breakdown</CardTitle>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Platform net</p>
                  <p className="text-lg font-bold">{formatMoney(breakdown.platform.net)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">COD outstanding</p>
                  <p className={`text-lg font-bold ${breakdown.cod.outstanding > 0 ? "text-amber-600" : ""}`}>
                    {formatMoney(breakdown.cod.outstanding)}
                  </p>
                </div>
                <div className="flex rounded-lg border overflow-hidden">
                  {(["vendors", "riders"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setBdTab(t)}
                      className={`px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                        bdTab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {bdTab === "vendors" ? (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-y">
                    <tr className="text-left">
                      <th className="px-4 py-2 font-medium">Vendor</th>
                      <th className="px-4 py-2 font-medium text-right">Gross</th>
                      <th className="px-4 py-2 font-medium text-right">Commission</th>
                      <th className="px-4 py-2 font-medium text-right">Gateway</th>
                      <th className="px-4 py-2 font-medium text-right">Tax</th>
                      <th className="px-4 py-2 font-medium text-right">Ads</th>
                      <th className="px-4 py-2 font-medium text-right">Adjust.</th>
                      <th className="px-4 py-2 font-medium text-right">Net</th>
                      <th className="px-4 py-2 font-medium text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {breakdown.vendors.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No settlements in this period.</td></tr>
                    ) : breakdown.vendors.map((v) => (
                      <tr key={v.restaurantId} className="hover:bg-muted/40">
                        <td className="px-4 py-2 font-medium">
                          <Link to={`/admin/vendors/${v.restaurantId}`} className="hover:underline">{v.restaurantName}</Link>
                        </td>
                        <td className="px-4 py-2 text-right">{formatMoney(v.grossSales)}</td>
                        <td className="px-4 py-2 text-right text-rose-600">-{formatMoney(v.commission)}</td>
                        <td className="px-4 py-2 text-right text-rose-600">-{formatMoney(v.gatewayFee)}</td>
                        <td className="px-4 py-2 text-right text-rose-600">-{formatMoney(v.tax)}</td>
                        <td className="px-4 py-2 text-right text-rose-600">{v.adDeductions ? `-${formatMoney(v.adDeductions)}` : "—"}</td>
                        <td className={`px-4 py-2 text-right ${v.adjustments >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {v.adjustments ? formatMoney(v.adjustments) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-bold text-emerald-600">{formatMoney(v.net)}</td>
                        <td className="px-4 py-2 text-right text-amber-600">{v.pending ? formatMoney(v.pending) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-y">
                    <tr className="text-left">
                      <th className="px-4 py-2 font-medium">Delivery partner</th>
                      <th className="px-4 py-2 font-medium text-right">Deliveries</th>
                      <th className="px-4 py-2 font-medium text-right">Earned</th>
                      <th className="px-4 py-2 font-medium text-right">Tips</th>
                      <th className="px-4 py-2 font-medium text-right">COD collected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {breakdown.riders.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No completed deliveries in this period.</td></tr>
                    ) : breakdown.riders.map((r) => (
                      <tr key={r.riderId} className="hover:bg-muted/40">
                        <td className="px-4 py-2 font-medium">
                          <Link to={`/admin/riders/${r.riderId}`} className="hover:underline">{r.riderName}</Link>
                        </td>
                        <td className="px-4 py-2 text-right">{r.deliveries}</td>
                        <td className="px-4 py-2 text-right font-bold text-emerald-600">{formatMoney(r.earned)}</td>
                        <td className="px-4 py-2 text-right">{r.tips ? formatMoney(r.tips) : "—"}</td>
                        <td className="px-4 py-2 text-right">{r.codCollected ? formatMoney(r.codCollected) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Financial Health Indicators */}
        <Card className="rounded-2xl lg:col-span-3">
           <CardHeader className="pb-3">
             <CardTitle className="text-base flex items-center gap-2">
               <Activity className="h-4 w-4 text-primary" /> Financial Health Indicators
             </CardTitle>
           </CardHeader>
           <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
             {data && (
               <>
                 <div className="p-4 rounded-xl border border-border/50 bg-muted/20">
                   <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Reconciliation</p>
                   <p className={`text-xl font-bold ${payoutCompletionRate > 90 ? "text-emerald-600" : "text-amber-600"}`}>
                     {payoutCompletionRate > 90 ? "Healthy" : "Attention Needed"}
                   </p>
                 </div>
                 <div className="p-4 rounded-xl border border-border/50 bg-muted/20">
                   <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Gift Card Liabilities</p>
                   <p className="text-xl font-bold text-foreground">{money(data.liabilities?.giftCards || 0)}</p>
                 </div>
                 <div className="p-4 rounded-xl border border-border/50 bg-muted/20">
                   <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Live Payout Completion</p>
                   <p className="text-xl font-bold text-emerald-600">{payoutCompletionRate}%</p>
                 </div>
               </>
             )}
           </CardContent>
        </Card>

        {/* Live Settlements - Real data from firestore */}
        <Card className="rounded-2xl lg:col-span-3">
          <CardHeader className="pb-3 border-b border-border/40">
             <CardTitle className="text-base flex items-center justify-between">
               <span className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-sky-600" /> Recent Payout Batches</span>
               <Button variant="ghost" size="sm" className="text-xs h-7" asChild><Link to="/admin/finance?tab=settlements">View All in Settlements</Link></Button>
             </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
               <div className="divide-y divide-border/40">
                 {settlements.rows.map(txn => (
                   <div key={txn.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                     <div>
                       <p className="text-sm font-semibold">{txn.restaurantName || "Vendor Payout"}</p>
                       <p className="text-xs text-muted-foreground mt-0.5">{txn.id} • {txn.period || "Current Cycle"}</p>
                     </div>
                     <div className="text-right">
                       <p className="text-sm font-bold tabular-nums">{money(txn.netPayout || txn.grossSales || 0)}</p>
                       <Badge variant="outline" className={`mt-1 text-[10px] ${txn.status === 'paid' ? 'text-emerald-600 border-emerald-500/30' : 'text-amber-600 border-amber-500/30'}`}>
                         {txn.status || 'pending'}
                       </Badge>
                     </div>
                   </div>
                 ))}
                 {!settlements.loading && settlements.rows.length === 0 && (
                   <div className="p-6 text-center text-muted-foreground text-sm">No recent payout data found.</div>
                 )}
               </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
