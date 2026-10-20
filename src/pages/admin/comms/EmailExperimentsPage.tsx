import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FlaskConical, Plus, Trash2, Trophy } from "lucide-react";

interface Experiment {
  id: string;
  name: string;
  status?: string;
  variantA?: string;
  variantB?: string;
  splitPercent?: number;
  winner?: string;
}

export default function EmailExperimentsPage() {
  const [rows, setRows] = useState<Experiment[]>([]);
  const [templates, setTemplates] = useState<{ key: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [variantA, setVariantA] = useState("");
  const [variantB, setVariantB] = useState("");
  const [splitPercent, setSplitPercent] = useState(50);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "emailExperiments"), (s) =>
      setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Experiment, "id">) }))),
    );
    const u2 = onSnapshot(collection(db, "emailTemplates"), (s) =>
      setTemplates(s.docs.map((d) => ({ key: (d.data().key as string) || d.id, name: (d.data().name as string) || d.id }))),
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  const create = async () => {
    if (!name.trim() || !variantA || !variantB) {
      toast.error("Name and both variants required");
      return;
    }
    try {
      await addDoc(collection(db, "emailExperiments"), {
        name: name.trim(),
        variantA,
        variantB,
        splitPercent: Number(splitPercent) || 50,
        status: "running",
        createdAt: serverTimestamp(),
      });
      setName("");
      toast.success("Experiment running. Campaigns whose template is variant A or B will split recipients.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">A/B experiments</h2>
        <p className="text-sm text-muted-foreground">
          A running experiment splits recipients when a campaign's template is variant A or variant B.
        </p>
      </div>
      <Card>
        <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Input placeholder="Subject test — Gold push" value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={variantA} onValueChange={setVariantA}>
            <SelectTrigger><SelectValue placeholder="Variant A" /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={variantB} onValueChange={setVariantB}>
            <SelectTrigger><SelectValue placeholder="Variant B" /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={`b-${t.key}`} value={t.key}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="number" min={10} max={90} value={splitPercent} onChange={(e) => setSplitPercent(Number(e.target.value))} />
          <Button onClick={create}><Plus className="h-4 w-4 mr-1" /> Start</Button>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-10 text-center">No experiments yet.</p>
        )}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
            <FlaskConical className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground">A {r.variantA} vs B {r.variantB} · {r.splitPercent ?? 50}% / {100 - (r.splitPercent ?? 50)}%</p>
            </div>
            <Badge variant="outline">{r.status || "running"}</Badge>
            {r.winner && <Badge className="gap-1"><Trophy className="h-3 w-3" /> {r.winner}</Badge>}
            <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, "emailExperiments", r.id), { winner: "A", status: "completed" })}>A wins</Button>
            <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, "emailExperiments", r.id), { winner: "B", status: "completed" })}>B wins</Button>
            <Button aria-label="Delete" size="icon" variant="ghost" onClick={() => deleteDoc(doc(db, "emailExperiments", r.id))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
