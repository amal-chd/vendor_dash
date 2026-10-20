/**
 * A bill exactly as a person saw it — the customer's "Bill details" or the
 * restaurant's payout statement for one order (functions/src/pricing/bill.ts).
 * Admin shows both so support can answer "why was I charged X" and "why did
 * I get paid Y" from the same screen.
 */
export interface AdminBillRow {
  key: string;
  label: string;
  amountPaise: number;
  originalPaise?: number;
  free?: boolean;
  note?: string;
  children?: AdminBillRow[];
}

const inr = (paise: number) => {
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(Math.abs(paise) / 100);
};

function Row({ r, nested = false }: { r: AdminBillRow; nested?: boolean }) {
  const negative = r.amountPaise < 0;
  return (
    <>
      <div className={`flex items-start justify-between gap-3 ${nested ? "pl-4 text-xs text-muted-foreground" : "text-sm"}`}>
        <div className="min-w-0">
          <p className={nested ? "" : "font-medium"}>{r.label}</p>
          {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
          {r.originalPaise != null && r.originalPaise !== r.amountPaise && (
            <span className="text-xs text-muted-foreground line-through">{inr(r.originalPaise)}</span>
          )}
          <span className={negative || r.free ? "font-medium text-emerald-600" : nested ? "" : "font-medium"}>
            {r.free ? "FREE" : `${negative ? "− " : ""}${inr(r.amountPaise)}`}
          </span>
        </div>
      </div>
      {r.children?.map((c) => <Row key={c.key} r={c} nested />)}
    </>
  );
}

export function BillTable({
  title,
  rows,
  totalLabel,
  totalPaise,
  footnote,
  memos = [],
}: {
  title: string;
  rows: AdminBillRow[];
  totalLabel: string;
  totalPaise: number;
  footnote?: string;
  memos?: AdminBillRow[];
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <Row key={r.key} r={r} />
        ))}
        {memos.map((m) => (
          <div key={m.key} className="flex justify-between text-xs text-muted-foreground">
            <span>{m.label}{m.note ? ` · ${m.note}` : ""}</span>
            <span className="tabular-nums">{inr(m.amountPaise)}</span>
          </div>
        ))}
      </div>
      <div className="my-3 h-px bg-border" />
      <div className="flex justify-between text-sm font-semibold">
        <span>{totalLabel}</span>
        <span className="tabular-nums">{inr(totalPaise)}</span>
      </div>
      {footnote && <p className="mt-2 text-xs text-muted-foreground">{footnote}</p>}
    </div>
  );
}
