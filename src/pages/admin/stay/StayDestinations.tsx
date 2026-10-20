import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import { useMemo, useState } from "react";
import { runOp } from "@/lib/opFeedback";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ColumnDef } from "@tanstack/react-table";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { toast } from "sonner";

interface Dest {
  id: string;
  name?: string;
  state?: string;
  imageUrl?: string;
  isFeatured?: boolean;
  propertyCount?: number;
}

export default function StayDestinations() {
  const { rows, loading } = useLiveCollection<Dest>("stay_destinations");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Dest>>({});

  const save = async () => {
    try {
      if (!draft.name?.trim()) {
        toast.error("Name is required");
        return;
      }
      const payload = {
        name: draft.name.trim(),
        state: draft.state || "",
        imageUrl: draft.imageUrl || "",
        isFeatured: !!draft.isFeatured,
        propertyCount: Number(draft.propertyCount) || 0,
        updatedAt: serverTimestamp(),
      };
      if (draft.id) await updateDoc(doc(db, "stay_destinations", draft.id), payload);
      else await addDoc(collection(db, "stay_destinations"), { ...payload, createdAt: serverTimestamp() });
      toast.success("Destination saved");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const columns: ColumnDef<Dest>[] = useMemo(
    () => [
      { accessorKey: "name", header: "Destination" },
      { accessorKey: "state", header: "State" },
      { accessorKey: "propertyCount", header: "Properties" },
      { accessorKey: "isFeatured", header: "Featured", cell: ({ row }) => (row.original.isFeatured ? "Yes" : "No") },
      {
        id: "a",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setDraft(row.original); setOpen(true); }}>
              Edit
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-rose-500"
              aria-label={`Delete ${row.original.name || "destination"}`}
              onClick={async () => {
                if (
                  !(await confirmDialog({
                    title: `Delete ${row.original.name || "this destination"}?`,
                    description: "It disappears from the KadaStay explorer. Properties in that city are unaffected.",
                    confirmLabel: "Delete",
                    destructive: true,
                  }))
                )
                  return;
                runOp(
                  () => deleteDoc(doc(db, "stay_destinations", row.original.id)),
                  "Destination deleted",
                  { failure: "Couldn't delete this destination" },
                );
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Destinations"
        description="Featured cities shown in the KadaStay explorer."
        icon={MapPin}
        actions={
          <Button onClick={() => { setDraft({ isFeatured: false }); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add destination
          </Button>
        }
      />
      <DataTable columns={columns} data={rows} searchPlaceholder="Search destinations…" exportFilename="stay-destinations" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit destination" : "New destination"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name</Label>
              <Input value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div>
              <Label>State</Label>
              <Input value={draft.state || ""} onChange={(e) => setDraft({ ...draft, state: e.target.value })} />
            </div>
            <div>
              <Label>Image URL</Label>
              <Input value={draft.imageUrl || ""} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Featured</Label>
              <Switch checked={!!draft.isFeatured} onCheckedChange={(v) => setDraft({ ...draft, isFeatured: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
