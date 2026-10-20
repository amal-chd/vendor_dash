import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Trash2, Users, X } from "lucide-react";

interface Condition { field: string; op: string; value: string; }
interface Segment { id: string; name: string; conditions: Condition[]; }

const FIELDS = [
  { v: "userType", label: "User type" },
  { v: "city", label: "City" },
  { v: "minOrders", label: "Min orders" },
  { v: "maxOrders", label: "Max orders" },
  { v: "inactiveDays", label: "Inactive for (days)" },
  { v: "tag", label: "Has tag" },
  { v: "hasActiveSubscription", label: "Active subscription" },
];

export default function AudiencesPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [name, setName] = useState("");
  const [conditions, setConditions] = useState<Condition[]>([{ field: "userType", op: "eq", value: "CUSTOMER" }]);

  useEffect(
    () =>
      listenCollection<Segment>(
        "emailSegments",
        { orderByField: "name", orderDir: "asc", limit: 300 },
        setSegments,
      ),
    [],
  );

  const save = async () => {
    if (!name.trim()) { toast.error("Segment name required."); return; }
    try {
      await addDoc(collection(db, "emailSegments"), {
        name: name.trim(),
        conditions: conditions.map((c) => ({
          ...c,
          value: ["minOrders", "maxOrders", "inactiveDays"].includes(c.field) ? Number(c.value) :
            c.field === "hasActiveSubscription" ? c.value === "true" : c.value,
        })),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      toast.success("Segment saved.");
      setName(""); setConditions([{ field: "userType", op: "eq", value: "CUSTOMER" }]);
    } catch { toast.error("Save failed (admin only)."); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Audiences</h2>
          <p className="text-sm text-muted-foreground">Segments are evaluated when a campaign sends. Marketing still requires an opt-in, even if someone matches.</p>
        </div>
        <Dialog>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New segment</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create audience segment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="e.g. Inactive Kochi Customers" value={name} onChange={(e) => setName(e.target.value)} />
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Conditions (all must match)</p>
              {conditions.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={c.field} onValueChange={(v) => setConditions(conditions.map((x, j) => j === i ? { ...x, field: v } : x))}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>{FIELDS.map((f) => <SelectItem key={f.v} value={f.v}>{f.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {c.field === "userType" ? (
                    <Select value={c.value} onValueChange={(v) => setConditions(conditions.map((x, j) => j === i ? { ...x, value: v } : x))}>
                      <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["CUSTOMER", "VENDOR", "DELIVERY_PARTNER", "HOST"].map((v) => (
                          <SelectItem key={v} value={v}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : c.field === "hasActiveSubscription" ? (
                    <Select value={c.value || "true"} onValueChange={(v) => setConditions(conditions.map((x, j) => j === i ? { ...x, value: v } : x))}>
                      <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input className="flex-1" placeholder={c.field === "city" ? "Kochi" : "value"} value={c.value} onChange={(e) => setConditions(conditions.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                  )}
                  {conditions.length > 1 && <Button aria-label="Remove condition" size="icon" variant="ghost" onClick={() => setConditions(conditions.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setConditions([...conditions, { field: "city", op: "eq", value: "" }])}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add condition
              </Button>
            </div>
            <DialogFooter><Button onClick={save}>Save segment</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {segments.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Users className="h-6 w-6 mx-auto mb-2 opacity-40" />No segments yet.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {segments.map((s) => (
            <Card key={s.id}><CardContent className="p-4">
              <div className="flex items-start justify-between">
                <span className="font-bold">{s.name}</span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button aria-label="Delete" size="icon" variant="ghost" className="h-7 w-7"><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {s.name}?</AlertDialogTitle>
                      <AlertDialogDescription>Draft campaigns that point at this audience will fail their send check.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteDoc(doc(db, "emailSegments", s.id))}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(s.conditions || []).map((c, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] font-mono">{c.field} {c.op} {String(c.value)}</Badge>
                ))}
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}
