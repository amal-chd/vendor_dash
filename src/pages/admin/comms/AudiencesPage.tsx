import { useEffect, useState } from "react";
import { listenCollection } from "@/hooks/useLiveCollection";
import { comms, commsOp, loadCatalog, num, type Catalog, type SegmentField } from "./commsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Users, Pencil, RefreshCw } from "lucide-react";
import { ConditionsEditor, describeCondition as describe, loadFacets, type Condition, type Facets } from "./ConditionsEditor";

interface Segment { id: string; name: string; description?: string; conditions: Condition[] }
interface Estimate {
  matched: number; scanned: number; optedIn: number; capped: boolean; ordered?: number;
  sample: { email: string; name: string; city: string }[];
  byZone?: { name: string; value: number }[]; byUserType?: { name: string; value: number }[];
}
/** Saved audiences. Matching runs when a campaign sends; only opted-in people are ever mailed. */
export default function AudiencesPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [counts, setCounts] = useState<Record<string, Estimate | "loading">>({});

  useEffect(() => listenCollection<Segment>("emailSegments", { orderByField: "name", orderDir: "asc", limit: 300 }, setSegments), []);
  const [facets, setFacets] = useState<Facets | null>(null);
  useEffect(() => { loadCatalog().then(setCatalog).catch(() => {}); loadFacets().then(setFacets).catch(() => {}); }, []);

  const estimate = async (s: Segment) => {
    setCounts((c) => ({ ...c, [s.id]: "loading" }));
    try {
      const r = await comms<Estimate>("estimateSegment", { conditions: s.conditions });
      setCounts((c) => ({ ...c, [s.id]: r }));
    } catch {
      setCounts((c) => { const n = { ...c }; delete n[s.id]; return n; });
    }
  };

  const fields = catalog?.segmentFields || [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Audiences</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Saved groups for campaigns. Everyone in a count has opted in to offers — people who haven't are never included, however well they match.
          </p>
        </div>
        <Button onClick={() => setEditing({ id: "", name: "", conditions: [{ field: "userType", op: "eq", value: "CUSTOMER" }] })}>
          <Plus className="h-4 w-4 mr-2" />New audience
        </Button>
      </div>

      {segments.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Users className="h-7 w-7 mx-auto mb-2 opacity-40" />
          <p className="font-semibold text-foreground">No audiences yet</p>
          <p className="text-sm mt-1">Start with something like “Customers in Kochi who haven't ordered in 30 days”.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {segments.map((s) => {
            const est = counts[s.id];
            return (
              <Card key={s.id} className="rounded-2xl"><CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold truncate">{s.name}</p>
                    {s.description && <p className="text-xs text-muted-foreground truncate">{s.description}</p>}
                  </div>
                  <div className="flex shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      if (confirm(`Delete "${s.name}"?`)) commsOp("deleteSegment", { id: s.id }, "Audience deleted.");
                    }}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(s.conditions || []).map((c, i) => <Badge key={i} variant="outline" className="text-[10px] font-medium">{describe(c, fields, facets)}</Badge>)}
                </div>
                <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
                  {est === "loading" ? <span className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Counting…</span>
                    : est ? <span className="text-xs"><b className="text-base font-black">{num(est.matched)}</b>{est.capped ? "+" : ""} people can receive this</span>
                    : <span className="text-xs text-muted-foreground">Size not counted yet</span>}
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => estimate(s)}><RefreshCw className="h-3 w-3 mr-1" />Count</Button>
                </div>
              </CardContent></Card>
            );
          })}
        </div>
      )}

      {editing && <SegmentDialog segment={editing} fields={fields} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SegmentDialog({ segment, fields, onClose }: { segment: Segment; fields: SegmentField[]; onClose: () => void }) {
  const [name, setName] = useState(segment.name);
  const [description, setDescription] = useState(segment.description || "");
  const [conditions, setConditions] = useState<Condition[]>(segment.conditions.map((c) => ({ ...c, op: c.op || "eq" })));
  const [est, setEst] = useState<Estimate | null>(null);
  const [counting, setCounting] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-count as the conditions change (debounced).
  useEffect(() => {
    const h = setTimeout(async () => {
      setCounting(true);
      try { setEst(await comms<Estimate>("estimateSegment", { conditions })); } catch { setEst(null); } finally { setCounting(false); }
    }, 600);
    return () => clearTimeout(h);
  }, [JSON.stringify(conditions)]);


  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{segment.id ? "Edit audience" : "New audience"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lapsed Kochi customers" /></div>
            <div><Label>Note for your team</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></div>
          </div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground pt-1">People who match all of these</p>
          <ConditionsEditor fields={fields} conditions={conditions} onChange={setConditions} />

          <div className="rounded-xl border bg-muted/30 p-3">
            {counting && !est ? <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Counting…</p>
              : est ? (
                <>
                  <p className="text-sm">
                    <b className="text-lg font-black">{num(est.matched)}{est.capped ? "+" : ""}</b> people match
                    <span className="text-muted-foreground"> · out of {num(est.optedIn)} opted in{est.capped ? ` (counted the first ${num(est.scanned)})` : ""}</span>
                    {counting && <Loader2 className="inline h-3 w-3 animate-spin ml-2" />}
                  </p>
                  {!!est.byZone?.length && (
                    <div className="mt-2 space-y-1">
                      {est.byZone.map((z) => (
                        <div key={z.name} className="flex items-center gap-2 text-[11px]">
                          <span className="w-32 truncate text-muted-foreground">{z.name}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary/70" style={{ width: `${Math.max(3, (z.value / Math.max(1, est.matched)) * 100)}%` }} /></div>
                          <span className="w-10 text-right tabular-nums">{num(z.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {est.ordered !== undefined && est.matched > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">{num(est.ordered)} of them have ordered before.</p>
                  )}
                  {est.sample.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">For example: {est.sample.map((x) => `${x.name || x.email}${x.city ? ` (${x.city})` : ""}`).join(", ")}</p>
                  )}
                </>
              ) : <p className="text-xs text-muted-foreground">Couldn't count right now.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !name.trim()} onClick={async () => {
            const r = await commsOp("saveSegment", { id: segment.id || undefined, name, description, conditions }, "Audience saved.", setBusy);
            if (r) onClose();
          }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save audience"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
