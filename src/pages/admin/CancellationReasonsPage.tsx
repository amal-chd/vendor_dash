import { useMemo, useState } from "react";
import { ListX, Plus } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { adminActionToast } from "@/lib/admin-ops";

interface Reason {
  id: string;
  label?: string;
  audience?: string;
  active?: boolean;
  sortOrder?: number;
}

export default function CancellationReasonsPage() {
  const { rows, loading } = useLiveCollection<Reason>("cancellation_reasons", { orderByField: "sortOrder", orderDir: "asc" });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Reason>>({ audience: "customer", active: true, sortOrder: 10 });

  const columns: ColumnDef<Reason>[] = useMemo(
    () => [
      { accessorKey: "sortOrder", header: "#" },
      { accessorKey: "label", header: "Reason" },
      { accessorKey: "audience", header: "Audience" },
      {
        accessorKey: "active",
        header: "Active",
        cell: ({ row }) => (
          <Switch
            checked={row.original.active !== false}
            onCheckedChange={(v) => adminActionToast("upsertCancellationReason", { ...row.original, id: row.original.id, active: v }, v ? "Active" : "Paused")}
          />
        ),
      },
      {
        id: "a",
        cell: ({ row }) => (
          <Button size="sm" variant="ghost" onClick={() => { setDraft(row.original); setOpen(true); }}>Edit</Button>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Cancellation reasons"
        description="Structured reasons for customer / vendor / rider / stay cancellations — required for marketplace analytics and support macros."
        icon={ListX}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => adminActionToast("seedDefaultOps", {}, "Seeded default reasons, flags, Gold prices")}>Seed defaults</Button>
            <Button onClick={() => { setDraft({ audience: "customer", active: true, sortOrder: rows.length + 1 }); setOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Add</Button>
          </div>
        }
      />
      <DataTable columns={columns} data={rows} searchPlaceholder="Search reasons…" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reason</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Label</Label><Input value={draft.label || ""} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></div>
            <div>
              <Label>Audience</Label>
              <Select value={draft.audience || "customer"} onValueChange={(v) => setDraft({ ...draft, audience: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="rider">Rider</SelectItem>
                  <SelectItem value="stay">Stay</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Sort</Label><Input type="number" value={draft.sortOrder ?? 10} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} /></div>
            <div className="flex justify-between"><Label>Active</Label><Switch checked={draft.active !== false} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /></div>
          </div>
          <DialogFooter>
            <Button onClick={() => adminActionToast("upsertCancellationReason", { ...draft, id: draft.id }, "Saved").then(() => setOpen(false))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
