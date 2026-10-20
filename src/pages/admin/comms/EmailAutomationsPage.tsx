import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import { useEffect, useState } from "react";
import { runOp } from "@/lib/opFeedback";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Zap } from "lucide-react";

const TRIGGERS = [
  { v: "user.signup", label: "Customer signed up" },
  { v: "order.placed", label: "Order placed" },
  { v: "order.delivered", label: "Order delivered" },
  { v: "cart.abandoned", label: "Cart abandoned" },
  { v: "subscription.expiring", label: "Subscription expiring" },
  { v: "stay.booked", label: "Stay booked" },
  { v: "wallet.low", label: "Wallet low balance" },
];

interface Automation {
  id: string;
  name: string;
  trigger: string;
  templateKey: string;
  delayMinutes?: number;
  enabled?: boolean;
}

export default function EmailAutomationsPage() {
  const [rows, setRows] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<{ key: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("user.signup");
  const [templateKey, setTemplateKey] = useState("");
  const [delayMinutes, setDelayMinutes] = useState(0);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "emailAutomations"), (s) =>
      setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Automation, "id">) }))),
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
    if (!name.trim() || !templateKey) {
      toast.error("Name and template are required");
      return;
    }
    try {
      await addDoc(collection(db, "emailAutomations"), {
        name: name.trim(),
        trigger,
        templateKey,
        delayMinutes: Number(delayMinutes) || 0,
        enabled: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setName("");
      toast.success("Automation saved — producers can match this trigger key");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Automations</h2>
        <p className="text-sm text-muted-foreground">
          Behaviour-triggered email journeys. Enable/disable live; the send pipeline matches `trigger` keys from Cloud Functions producers.
        </p>
      </div>
      <Card>
        <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Input placeholder="Welcome series" value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={trigger} onValueChange={setTrigger}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TRIGGERS.map((t) => (
                <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={templateKey} onValueChange={setTemplateKey}>
            <SelectTrigger><SelectValue placeholder="Template" /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="number" min={0} value={delayMinutes} onChange={(e) => setDelayMinutes(Number(e.target.value))} placeholder="Delay (min)" />
          <Button onClick={create}><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-10 text-center">No automations yet. Add one above.</p>
        )}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-xl border px-4 py-3">
            <Zap className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground">{r.trigger} → {r.templateKey}{r.delayMinutes ? ` · +${r.delayMinutes}m` : ""}</p>
            </div>
            <Badge variant="outline">{r.enabled === false ? "paused" : "live"}</Badge>
            <Switch
              checked={r.enabled !== false}
              onCheckedChange={(v) =>
                // Said nothing either way. On a rejected write the switch
                // snapped back with no explanation; on success there was no
                // confirmation that an automation now emails real customers.
                runOp(
                  () =>
                    updateDoc(doc(db, "emailAutomations", r.id), {
                      enabled: v,
                      updatedAt: serverTimestamp(),
                    }),
                  v ? `"${r.name}" is live` : `"${r.name}" paused`,
                  { failure: "Couldn't change this automation" },
                )
              }
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete ${r.name}`}
              onClick={async () => {
                // One click deleted an automation outright, with no confirm and
                // no feedback — including when the delete was refused.
                if (
                  !(await confirmDialog({
                    title: `Delete the "${r.name}" automation?`,
                    description: "Emails it would have sent stop immediately. This can't be undone.",
                    confirmLabel: "Delete",
                    destructive: true,
                  }))
                )
                  return;
                runOp(
                  () => deleteDoc(doc(db, "emailAutomations", r.id)),
                  `"${r.name}" deleted`,
                  { failure: "Couldn't delete this automation" },
                );
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
