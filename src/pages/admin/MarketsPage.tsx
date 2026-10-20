import { useMemo, useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { adminActionToast } from "@/lib/admin-ops";
import { Badge as UiBadge } from "@/components/ui/badge";

interface Market {
  id: string;
  name?: string;
  city?: string;
  state?: string;
  status?: string;
  serviceRadiusKm?: number;
  deliveryEnabled?: boolean;
  stayEnabled?: boolean;
  lat?: number;
  lng?: number;
}

export default function MarketsPage() {
  const { rows, loading } = useLiveCollection<Market>("markets");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Market>>({ status: "active", serviceRadiusKm: 7, deliveryEnabled: true, stayEnabled: true });

  const columns: ColumnDef<Market>[] = useMemo(
    () => [
      { accessorKey: "name", header: "Market", cell: ({ row }) => <span className="font-semibold">{row.original.name}</span> },
      { accessorKey: "city", header: "City" },
      { accessorKey: "state", header: "State" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <UiBadge variant="outline" className="uppercase text-[10px] font-bold">
            {row.original.status || "active"}
          </UiBadge>
        ),
      },
      { accessorKey: "serviceRadiusKm", header: "Radius km" },
      {
        id: "flags",
        header: "Modules",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.deliveryEnabled !== false ? "Delivery" : ""}{" "}
            {row.original.stayEnabled !== false ? "Stay" : ""}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex gap-1 justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = row.original.status === "active" ? "paused" : "active";
                adminActionToast("upsertMarket", { ...row.original, id: row.original.id, status: next }, next === "active" ? "Market live" : "Market paused");
              }}
            >
              {row.original.status === "paused" ? "Go live" : "Pause"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(row.original);
                setOpen(true);
              }}
            >
              Edit
            </Button>
            <Button aria-label="Delete"
              size="icon"
              variant="ghost"
              className="text-rose-500"
              onClick={() => adminActionToast("deleteMarket", { id: row.original.id }, "Market removed")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  const save = async () => {
    await adminActionToast(
      "upsertMarket",
      {
        id: draft.id,
        name: draft.name,
        city: draft.city,
        state: draft.state,
        status: draft.status,
        serviceRadiusKm: Number(draft.serviceRadiusKm) || 7,
        lat: Number(draft.lat) || 0,
        lng: Number(draft.lng) || 0,
        deliveryEnabled: draft.deliveryEnabled !== false,
        stayEnabled: draft.stayEnabled !== false,
      },
      "Market published to customer, rider & stay apps",
    );
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Markets & cities"
        description="Launch or pause cities the way Swiggy / DoorDash ops does. Inactive markets hide from discovery once restaurants are tagged to that city."
        icon={MapPin}
        stats={[
          { label: "Markets", value: loading ? "—" : String(rows.length) },
          { label: "Live", value: String(rows.filter((r) => r.status === "active").length) },
          { label: "Coming soon", value: String(rows.filter((r) => r.status === "coming_soon").length) },
        ]}
        actions={
          <Button
            onClick={() => {
              setDraft({ status: "active", serviceRadiusKm: 7, deliveryEnabled: true, stayEnabled: true });
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Add market
          </Button>
        }
      />
      <DataTable columns={columns} data={rows} searchPlaceholder="Search markets…" exportFilename="markets" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit market" : "New market"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              {[
                { name: "Kochi", city: "Kochi", state: "Kerala", lat: 9.9312, lng: 76.2673, serviceRadiusKm: 12 },
                { name: "Edachira / Kakkanad", city: "Kochi", state: "Kerala", lat: 10.0278, lng: 76.3639, serviceRadiusKm: 8 },
                { name: "Thiruvananthapuram", city: "Thiruvananthapuram", state: "Kerala", lat: 8.5241, lng: 76.9366, serviceRadiusKm: 10 },
              ].map((p) => (
                <Button key={p.name} type="button" size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, ...p }))}>
                  {p.name}
                </Button>
              ))}
            </div>
            <div>
              <Label>Name</Label>
              <Input value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>City</Label>
                <Input value={draft.city || ""} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
              </div>
              <div>
                <Label>State</Label>
                <Input value={draft.state || ""} onChange={(e) => setDraft({ ...draft, state: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Lat</Label>
                <Input type="number" value={draft.lat ?? ""} onChange={(e) => setDraft({ ...draft, lat: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Lng</Label>
                <Input type="number" value={draft.lng ?? ""} onChange={(e) => setDraft({ ...draft, lng: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Radius km</Label>
                <Input type="number" value={draft.serviceRadiusKm ?? 7} onChange={(e) => setDraft({ ...draft, serviceRadiusKm: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={draft.status || "active"} onValueChange={(v) => setDraft({ ...draft, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="coming_soon">Coming soon</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Delivery live</Label>
              <Switch checked={draft.deliveryEnabled !== false} onCheckedChange={(v) => setDraft({ ...draft, deliveryEnabled: v })} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Stay live</Label>
              <Switch checked={draft.stayEnabled !== false} onCheckedChange={(v) => setDraft({ ...draft, stayEnabled: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={save}>Publish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
