import { useEffect, useState } from "react";
import { comms, type SegmentField } from "./commsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";

export interface Condition { field: string; op?: string; value: unknown }
export interface Facets { markets: { id: string; name: string }[]; zones: { id: string; name: string; marketId: string }[]; vendors: { id: string; name: string; zoneId: string }[] }

let facetsPromise: Promise<Facets> | null = null;
export const loadFacets = () => (facetsPromise ||= comms<Facets>("audienceFacets").catch((e) => { facetsPromise = null; throw e; }));

export const USER_TYPES = [
  { v: "CUSTOMER", label: "Customers" },
  { v: "VENDOR", label: "Restaurants & mess kitchens" },
  { v: "DELIVERY_PARTNER", label: "Riders" },
  { v: "HOST", label: "Stay hosts" },
];

/** Plain-English summary of one condition ("No order for 30 days"). */
export function describeCondition(c: Condition, fields: SegmentField[], facets?: Facets | null): string {
  const f = fields.find((x) => x.key === c.field);
  const id = String(c.value ?? "");
  const v = f?.kind === "userType" ? USER_TYPES.find((u) => u.v === c.value)?.label || id
    : f?.kind === "boolean" ? (c.value ? "yes" : "no")
    : f?.kind === "market" ? facets?.markets.find((m) => m.id === id)?.name || id
    : f?.kind === "zone" ? facets?.zones.find((z) => z.id === id)?.name || id
    : f?.kind === "vendor" ? facets?.vendors.find((x) => x.id === id)?.name || id
    : f?.kind === "choice" ? (f.options?.find((o) => o.value === id)?.label || id).split(" — ")[0]
    : id;
  return `${f?.label || c.field}${c.op === "neq" ? " is not" : ":"} ${v}`;
}

/** Rows of "field · is/is not · value" — the audience vocabulary shared by segments and journeys. */
export function ConditionsEditor({ fields, conditions, onChange }: {
  fields: SegmentField[];
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
}) {
  const [facets, setFacets] = useState<Facets | null>(null);
  useEffect(() => { loadFacets().then(setFacets).catch(() => {}); }, []);
  const pickedMarket = String(conditions.find((c) => c.field === "market")?.value || "");
  const update = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-2">
      {conditions.map((c, i) => {
        const f = fields.find((x) => x.key === c.field);
        return (
          <div key={i} className="flex flex-wrap gap-2 items-center">
            <Select value={c.field} onValueChange={(v) => {
              const nf = fields.find((x) => x.key === v);
              update(i, { field: v, op: "eq", value: nf?.kind === "userType" ? "CUSTOMER" : nf?.kind === "boolean" ? true : nf?.kind === "number" ? 30 : nf?.kind === "choice" ? nf.options?.[0]?.value ?? "" : "" });
            }}>
              <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
              <SelectContent>{fields.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
            </Select>
            {(f?.kind === "userType" || f?.kind === "text" || f?.kind === "zone" || f?.kind === "market" || f?.kind === "vendor" || f?.kind === "choice") && (
              <Select value={c.op || "eq"} onValueChange={(v) => update(i, { op: v })}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="eq">is</SelectItem><SelectItem value="neq">is not</SelectItem></SelectContent>
              </Select>
            )}
            {f?.kind === "market" || f?.kind === "zone" || f?.kind === "vendor" ? (
              <Select value={String(c.value || "")} onValueChange={(v) => update(i, { value: v })}>
                <SelectTrigger className="flex-1 min-w-[10rem]"><SelectValue placeholder={facets ? "Choose…" : "Loading…"} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {(f.kind === "market" ? facets?.markets
                    : f.kind === "zone" ? facets?.zones.filter((z) => !pickedMarket || z.marketId === pickedMarket)
                    : facets?.vendors)?.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : f?.kind === "userType" ? (
              <Select value={String(c.value)} onValueChange={(v) => update(i, { value: v })}>
                <SelectTrigger className="flex-1 min-w-[10rem]"><SelectValue /></SelectTrigger>
                <SelectContent>{USER_TYPES.map((u) => <SelectItem key={u.v} value={u.v}>{u.label}</SelectItem>)}</SelectContent>
              </Select>
            ) : f?.kind === "choice" ? (
              <Select value={String(c.value || "")} onValueChange={(v) => update(i, { value: v })}>
                <SelectTrigger className="flex-1 min-w-[10rem]"><SelectValue /></SelectTrigger>
                <SelectContent>{(f.options || []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            ) : f?.kind === "boolean" ? (
              <Select value={c.value ? "true" : "false"} onValueChange={(v) => update(i, { value: v === "true" })}>
                <SelectTrigger className="flex-1 min-w-[10rem]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent>
              </Select>
            ) : (
              <Input className="flex-1 min-w-[8rem]" type={f?.kind === "number" ? "number" : "text"} placeholder={f?.hint || ""} value={String(c.value ?? "")}
                onChange={(e) => update(i, { value: f?.kind === "number" ? Number(e.target.value) : e.target.value })} />
            )}
            {conditions.length > 1 && (
              <Button size="icon" variant="ghost" aria-label="Remove condition" onClick={() => onChange(conditions.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={() => onChange([...conditions, { field: "city", op: "eq", value: "" }])}>
        <Plus className="h-3.5 w-3.5 mr-1" />Add condition
      </Button>
    </div>
  );
}
