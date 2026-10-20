/**
 * Financial waterfalls rendered from a backend price snapshot (an order's
 * `pricing` field, a Stay booking's `pricing`, or a simulator result).
 * Nothing here recomputes a price; it only lays out what the engine decided.
 */
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { inr, pct } from "./pricingShared";

type Paise = number;
interface Row { key: string; label: string; amountPaise: Paise }
interface Tax {
  component?: string;
  taxCategoryId?: string;
  taxable?: Paise;
  rateBps?: number;
  cgst?: Paise;
  sgst?: Paise;
  utgst?: Paise;
  igst?: Paise;
  total?: Paise;
  nature?: string;
  liability?: string;
  supplier?: string;
  inclusive?: boolean;
}

export type FoodSnapshot = any;
export type StaySnapshot = any;

function Line({ label, value, strong, sub, tone }: { label: string; value: string; strong?: boolean; sub?: boolean; tone?: "neg" | "pos" }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 ${sub ? "pl-4 text-xs text-muted-foreground" : "text-sm"} ${strong ? "border-t pt-2 font-semibold" : ""}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${tone === "neg" ? "text-red-600 dark:text-red-400" : tone === "pos" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{value}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

export function BillRows({ rows, title = "Customer bill" }: { rows: Row[]; title?: string }) {
  return (
    <Card title={title}>
      {rows.map((r, i) => (
        <Line key={`${r.key}-${i}`} label={r.label} value={inr(r.amountPaise)} strong={i === rows.length - 1} tone={r.amountPaise < 0 ? "pos" : undefined} />
      ))}
    </Card>
  );
}

function Identity({ parts, total }: { parts: [string, Paise][]; total: Paise }) {
  const sum = parts.reduce((s, [, v]) => s + (Number(v) || 0), 0);
  const ok = sum === total;
  return (
    <div className={`mt-3 flex items-start gap-2 rounded-md p-2 text-xs ${ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"}`}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>
        {parts.map(([l, v]) => `${l} ${inr(v)}`).join(" + ")} = {inr(sum)} {ok ? "matches" : "does NOT match"} the customer total {inr(total)}.
      </span>
    </div>
  );
}

export function TaxTable({ taxes }: { taxes: Tax[] }) {
  if (!taxes?.length) return null;
  return (
    <Card title="GST">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-3">Component</th><th className="py-1 pr-3">Category</th><th className="py-1 pr-3 text-right">Taxable</th>
              <th className="py-1 pr-3 text-right">Rate</th><th className="py-1 pr-3 text-right">CGST</th><th className="py-1 pr-3 text-right">SGST/UTGST</th>
              <th className="py-1 pr-3 text-right">IGST</th><th className="py-1 pr-3">Liability</th>
            </tr>
          </thead>
          <tbody>
            {taxes.map((t, i) => (
              <tr key={i} className="border-t">
                <td className="py-1 pr-3">{t.component ?? "—"}{t.inclusive ? " (incl.)" : ""}</td>
                <td className="py-1 pr-3 font-mono">{t.taxCategoryId}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{inr(t.taxable)}</td>
                <td className="py-1 pr-3 text-right">{pct(t.rateBps)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{inr(t.cgst)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{inr((t.sgst ?? 0) + (t.utgst ?? 0))}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{inr(t.igst)}</td>
                <td className="py-1 pr-3">{t.liability === "platform_eco" ? "Kada (9(5))" : t.supplier === "platform" ? "Kada" : "Seller"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function FoodWaterfall({ quote }: { quote: FoodSnapshot }) {
  const s = quote?.settlement;
  const t = quote?.totals;
  if (!s || !t) return null;
  const taxes: Tax[] = [
    ...(quote.lines ?? []).filter((l: { tax: Tax | null }) => l.tax).map((l: { name: string; tax: Tax }) => ({ ...l.tax, component: `item: ${l.name}` })),
    ...(quote.charges ?? []).filter((c: { tax: Tax | null }) => c.tax).map((c: { label: string; tax: Tax }) => ({ ...c.tax, component: c.label })),
    ...(s.commissionTax ? [{ ...s.commissionTax, component: "commission" }] : []),
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <BillRows rows={quote.display ?? []} />
      <Card title="Restaurant payout">
        <Line label="Items (after restaurant-funded offers)" value={inr(s.vendorItemsValuePaise)} />
        <Line label="Packaging" value={inr(s.packagingToVendorPaise)} />
        <Line label="GST collected for restaurant" value={inr(s.vendorTaxCollectedPaise)} />
        <Line label="Commission" value={`− ${inr(s.commissionPaise)}`} tone="neg" />
        {s.commissionTax && <Line label="GST on commission" value={`− ${inr(s.commissionTax.total)}`} tone="neg" />}
        {s.vendorFundedDiscountPaise > 0 && <Line label="Restaurant-funded discounts" value={`− ${inr(s.vendorFundedDiscountPaise)}`} sub />}
        {s.vendorFundedDeliveryPaise > 0 && <Line label="Restaurant-funded delivery" value={`− ${inr(s.vendorFundedDeliveryPaise)}`} tone="neg" />}
        <Line label="Restaurant payout" value={inr(s.vendorPayoutPaise)} strong />
      </Card>
      <Card title="Delivery partner">
        <Line label="Base pay" value={inr(s.rider.basePaise)} />
        <Line label="Distance pay" value={inr(s.rider.distancePaise)} />
        <Line label="Surge share" value={inr(s.rider.surgeSharePaise)} />
        <Line label="Incentives" value={inr(s.rider.incentivePaise)} />
        <Line label="Tip (100% to rider)" value={inr(s.rider.tipPaise)} />
        <Line label="Rider earnings" value={inr(s.rider.totalPaise)} strong />
      </Card>
      <Card title="Kada">
        <Line label="Platform revenue" value={inr(s.platformRevenuePaise)} />
        {s.platformFundedDiscountPaise > 0 && <Line label="includes Kada-funded discounts" value={`− ${inr(s.platformFundedDiscountPaise)}`} sub />}
        <Line label="GST Kada pays under section 9(5)" value={inr(s.taxLiability.platformEcoPaise)} />
        <Line label="GST on Kada's own fees" value={inr(s.taxLiability.platformOwnPaise)} />
        {t.donationPaise > 0 && <Line label="Donation (passed through)" value={inr(t.donationPaise)} />}
        <Identity
          total={t.totalPaise}
          parts={[
            ["restaurant", s.vendorPayoutPaise],
            ["rider", s.rider.totalPaise],
            ["Kada", s.platformRevenuePaise],
            ["GST 9(5)", s.taxLiability.platformEcoPaise],
            ["GST own", s.taxLiability.platformOwnPaise],
            ["donation", t.donationPaise],
          ]}
        />
      </Card>
      <div className="lg:col-span-2"><TaxTable taxes={taxes} /></div>
    </div>
  );
}

export function StayWaterfall({ quote }: { quote: StaySnapshot }) {
  const h = quote?.host;
  if (!h || !quote?.totals) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <BillRows rows={quote.display ?? []} title="Guest bill" />
      <BillRows rows={h.display ?? []} title="Host payout" />
      <Card title="Kada">
        <Line label="Platform revenue" value={inr(quote.platformRevenuePaise)} />
        <Line label="GST Kada pays under section 9(5)" value={inr(quote.taxLiability?.platformEcoPaise)} />
        <Line label="GST on Kada's own fees" value={inr(quote.taxLiability?.platformOwnPaise)} />
        <Identity
          total={quote.totals.totalPaise}
          parts={[
            ["host", h.netPayoutPaise],
            ["Kada", quote.platformRevenuePaise],
            ["GST 9(5)", quote.taxLiability?.platformEcoPaise ?? 0],
            ["GST own", quote.taxLiability?.platformOwnPaise ?? 0],
          ]}
        />
      </Card>
      <Card title="Nights">
        {(quote.nights ?? []).map((n: { date: string; ratePaise: Paise; extraGuestPaise: Paise; rateRuleId: string | null }) => (
          <Line key={n.date} label={`${n.date}${n.rateRuleId ? ` · ${n.rateRuleId}` : ""}`} value={inr(n.ratePaise + n.extraGuestPaise)} />
        ))}
      </Card>
      <div className="lg:col-span-2"><TaxTable taxes={quote.taxes ?? []} /></div>
    </div>
  );
}

export function RuleVersions({ versions }: { versions: Record<string, number> | undefined }) {
  const entries = Object.entries(versions ?? {});
  if (!entries.length) return null;
  return (
    <Card title="Rules applied">
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([id, v]) => (
          <span key={id} className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${id.startsWith("legacy-") ? "text-muted-foreground" : v >= 1_000_000 ? "border-amber-400 text-amber-700 dark:text-amber-400" : ""}`}>
            {id} {v >= 1_000_000 ? "draft" : `v${v}`}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Grey ids come from the legacy live configuration. Amber ids are unpublished drafts under test.</p>
    </Card>
  );
}
