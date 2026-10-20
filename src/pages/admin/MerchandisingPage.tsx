import { useMemo, useState } from "react";
import { Layers, Plus, Trash2 } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { adminActionToast } from "@/lib/admin-ops";

interface Col {
  id: string;
  title?: string;
  subtitle?: string;
  kind?: string;
  cuisine?: string;
  imageUrl?: string;
  sortOrder?: number;
  active?: boolean;
  restaurantIds?: string[];
}

export default function MerchandisingPage() {
  const { rows, loading } = useLiveCollection<Col>("home_collections", { orderByField: "sortOrder", orderDir: "asc" });
  const restaurants = useLiveCollection<{ id: string; name?: string; isDeleted?: boolean }>("restaurants", { limit: 400 });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Col>>({ kind: "restaurants", sortOrder: 10, active: true, restaurantIds: [] });
  const [pick, setPick] = useState("");

  const partners = restaurants.rows.filter((r) => !r.isDeleted).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const columns: ColumnDef<Col>[] = useMemo(
    () => [
      { accessorKey: "sortOrder", header: "#" },
      { accessorKey: "title", header: "Collection" },
      { accessorKey: "kind", header: "Kind" },
      { accessorKey: "cuisine", header: "Cuisine" },
      {
        id: "count",
        header: "Venues",
        cell: ({ row }) => row.original.restaurantIds?.length ?? 0,
      },
      {
        accessorKey: "active",
        header: "Live",
        cell: ({ row }) => (
          <Switch
            checked={row.original.active !== false}
            onCheckedChange={(v) => adminActionToast("upsertHomeCollection", { ...row.original, id: row.original.id, active: v }, v ? "Live on home" : "Hidden")}
          />
        ),
      },
      {
        id: "a",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setDraft({ ...row.original, restaurantIds: row.original.restaurantIds || [] }); setOpen(true); }}>Edit</Button>
            <Button aria-label="Delete" size="icon" variant="ghost" className="text-rose-500" onClick={() => adminActionToast("deleteHomeCollection", { id: row.original.id }, "Removed")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  const ids = draft.restaurantIds || [];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Home merchandising"
        description="Editorial rails on customer home. Pick live restaurants instead of pasting IDs. Inactive collections stay in this list but drop off the app."
        icon={Layers}
        stats={[
          { label: "Collections", value: loading ? "—" : String(rows.length) },
          { label: "Live", value: String(rows.filter((r) => r.active !== false).length) },
        ]}
        actions={<Button onClick={() => { setDraft({ kind: "restaurants", sortOrder: rows.length + 1, active: true, restaurantIds: [] }); setOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Add</Button>}
      />
      <DataTable columns={columns} data={rows} searchPlaceholder="Search collections…" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Collection</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Title</Label><Input value={draft.title || ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
            <div><Label>Subtitle</Label><Input value={draft.subtitle || ""} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} /></div>
            <div><Label>Cover image URL</Label><Input value={draft.imageUrl || ""} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Kind</Label>
                <Select value={draft.kind || "restaurants"} onValueChange={(v) => setDraft({ ...draft, kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restaurants">Restaurants</SelectItem>
                    <SelectItem value="cuisine">Cuisine</SelectItem>
                    <SelectItem value="offers">Offers</SelectItem>
                    <SelectItem value="stay">Stay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Cuisine tag</Label><Input value={draft.cuisine || ""} onChange={(e) => setDraft({ ...draft, cuisine: e.target.value })} /></div>
            </div>
            <div>
              <Label>Restaurants in this rail</Label>
              <div className="flex gap-2 mt-1">
                <Select value={pick} onValueChange={setPick}>
                  <SelectTrigger><SelectValue placeholder="Add a restaurant" /></SelectTrigger>
                  <SelectContent>
                    {partners.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name || r.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!pick || ids.includes(pick)) return;
                    setDraft({ ...draft, restaurantIds: [...ids, pick] });
                    setPick("");
                  }}
                >
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {ids.map((id) => (
                  <Badge key={id} variant="outline" className="gap-1">
                    {partners.find((p) => p.id === id)?.name || id}
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground"
                      onClick={() => setDraft({ ...draft, restaurantIds: ids.filter((x) => x !== id) })}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
            <div><Label>Sort</Label><Input type="number" value={draft.sortOrder ?? 10} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} /></div>
            <div className="flex justify-between items-center"><Label>Active</Label><Switch checked={draft.active !== false} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /></div>
          </div>
          <DialogFooter>
            <Button onClick={() => adminActionToast("upsertHomeCollection", { ...draft, id: draft.id }, "Collection live").then(() => setOpen(false))}>Publish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
