import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Plus } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Timeline } from "@/components/admin/entity360";
import { FilterChips } from "@/components/admin/FilterChips";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { adminActionToast } from "@/lib/admin-ops";

interface Incident {
  id: string;
  title?: string;
  severity?: string;
  status?: string;
  impact?: string;
  affectedEntities?: number;
  timeline?: { status: string, time: string }[];
}

const INCIDENT_STAGES: [string, string][] = [
  ["detected", "Detected"],
  ["investigating", "Investigating"],
  ["identified", "Root cause identified"],
  ["mitigating", "Mitigating"],
  ["resolved", "Resolved"],
  ["postmortem", "Postmortem"],
];

const SEV_CLASS: Record<string, string> = {
  minor: "border-sky-500/30 text-sky-700",
  major: "border-amber-500/40 text-amber-700",
  critical: "border-rose-500/40 text-rose-700",
};

export default function IncidentsPage() {
  const { rows, loading } = useLiveCollection<Incident>("ops_incidents", { orderByField: "createdAt" });
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("open");
  const [draft, setDraft] = useState<Partial<Incident>>({ severity: "minor", status: "detected" });
  useEffect(() => {
    if (searchParams.get("action") !== "new") return;
    setDraft({ severity: "major", status: "detected" });
    setOpen(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("action");
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const columns: ColumnDef<Incident>[] = useMemo(
    () => [
      { accessorKey: "title", header: "Incident" },
      {
        accessorKey: "severity",
        header: "Severity",
        cell: ({ row }) => (
          <Badge variant="outline" className={SEV_CLASS[row.original.severity || ""] || ""}>
            {row.original.severity}
          </Badge>
        ),
      },
      { accessorKey: "status", header: "Status" },
            { accessorKey: "impact", header: "Impact" },
      { accessorKey: "affectedEntities", header: "Affected Entities", cell: ({ row }) => row.original.affectedEntities || 0 },

      {
        id: "a",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {row.original.status !== "resolved" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => adminActionToast("upsertIncident", { ...row.original, id: row.original.id, status: "resolved" }, "Resolved")}
              >
                Resolve
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setDraft(row.original); setOpen(true); }}>
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  // A postmortem happens after resolution — it isn't an open incident.
  const isClosed = (r: { status?: string }) => r.status === "resolved" || r.status === "postmortem";
  const visible = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "open") return !isClosed(r);
    return r.status === filter;
  });
  const openCount = rows.filter((r) => !isClosed(r)).length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Incidents"
        description="Internal status log for payments, dispatch, or Stay outages. Resolve when the customer-facing impact is gone."
        icon={AlertTriangle}
        stats={[
          { label: "Open", value: openCount, hint: "Customer impact ongoing", tone: "text-amber-600", loading, onClick: () => setFilter("open"), active: filter === "open" },
          { label: "Critical", value: rows.filter((r) => r.severity === "critical" && !isClosed(r)).length, hint: "Open and critical", tone: "text-rose-600", loading },
          { label: "Resolved", value: rows.filter((r) => r.status === "resolved").length, hint: `${rows.length} logged in total`, tone: "text-emerald-600", loading, onClick: () => setFilter("resolved"), active: filter === "resolved" },
        ]}
        actions={<Button onClick={() => { setDraft({ severity: "minor", status: "detected" }); setOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Log incident</Button>}
      />
      <FilterChips
        value={filter}
        onChange={setFilter}
                options={[
          { id: "open", label: "Open" },
          { id: "detected", label: "Detected" },
          { id: "investigating", label: "Investigating" },
          { id: "identified", label: "Identified" },
          { id: "mitigating", label: "Mitigating" },
          { id: "resolved", label: "Resolved" },
          { id: "postmortem", label: "Postmortem" },
          { id: "all", label: "All" },
        ]}
      />
      <DataTable columns={columns} data={visible} searchPlaceholder="Search incidents…" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Incident</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Title</Label><Input value={draft.title || ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Severity</Label>
                <Select value={draft.severity || "minor"} onValueChange={(v) => setDraft({ ...draft, severity: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minor">Minor</SelectItem>
                    <SelectItem value="major">Major</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={draft.status || "investigating"} onValueChange={(v) => setDraft({ ...draft, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                                        <SelectItem value="detected">Detected</SelectItem>
                    <SelectItem value="investigating">Investigating</SelectItem>
                    <SelectItem value="identified">Identified</SelectItem>
                    <SelectItem value="mitigating">Mitigating</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="postmortem">Postmortem</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Customer impact</Label><Textarea value={draft.impact || ""} onChange={(e) => setDraft({ ...draft, impact: e.target.value })} placeholder="Who is affected and what they see" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Affected Entities Count</Label>
                <Input type="number" value={draft.affectedEntities || 0} onChange={(e) => setDraft({ ...draft, affectedEntities: parseInt(e.target.value) })} />
              </div>
            </div>
            {draft.id && (
              <div className="mt-4 border-t pt-4">
                <Label className="mb-2 block">Incident Timeline</Label>
                {/* Stages reached so far, with the time each was logged when the
                    incident doc records it — no invented times or sources. */}
                <Timeline
                  items={(() => {
                    const cur = INCIDENT_STAGES.findIndex(([k]) => k === draft.status);
                    return INCIDENT_STAGES.slice(0, Math.max(cur, 0) + 1).map(([key, label]) => ({
                      title: label,
                      timestamp: draft.timeline?.find((t) => t.status === key)?.time ?? "",
                      active: key === draft.status,
                    }));
                  })()}
                />
              </div>
            )}

          </div>
          <DialogFooter>
            <Button onClick={() => adminActionToast("upsertIncident", { ...draft, id: draft.id }, "Incident saved").then(() => setOpen(false))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
