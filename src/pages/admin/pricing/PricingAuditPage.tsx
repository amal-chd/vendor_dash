import { Fragment, useMemo, useState } from "react";
import { History, ChevronDown, ChevronRight } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { KIND_LABELS, flatten, fmtWhen } from "./pricingShared";

interface AuditRow {
  id: string;
  action?: "rule_created" | "rule_version_published" | "rule_deactivated";
  ruleId?: string;
  kind?: string;
  fromVersion?: number | null;
  toVersion?: number;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown>;
  reason?: string;
  actor?: { uid?: string; email?: string; role?: string };
  at?: { toDate?: () => Date };
}

const ACTION_LABEL: Record<string, string> = {
  rule_created: "Created",
  rule_version_published: "New version",
  rule_deactivated: "Deactivated",
};

/** Field-level diff of two rule versions, so a reviewer sees exactly what moved. */
function diff(oldV: Record<string, unknown> | null | undefined, newV: Record<string, unknown> | undefined) {
  const a = flatten(oldV ?? {});
  const b = flatten(newV ?? {});
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ key: k, from: a[k], to: b[k] }));
}

const show = (v: unknown) => (v === undefined ? "—" : JSON.stringify(v));

export default function PricingAuditPage() {
  const { rows, loading, error } = useLiveCollection<AuditRow>("pricing_audit", { orderByField: "at", limit: 300 });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.ruleId, r.kind, r.reason, r.actor?.email, r.actor?.role].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Pricing audit log"
        description="Every pricing, tax, fee, commission and promotion change: who, when, why, and the exact values before and after. Append-only."
        icon={History}
      />
      <Input placeholder="Search rule, kind, reason or person…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>When</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">No pricing changes yet. Live pricing still comes from the legacy configuration.</TableCell></TableRow>
            )}
            {filtered.map((r) => {
              const isOpen = open === r.id;
              const changes = isOpen ? diff(r.oldValue, r.newValue) : [];
              return (
                <Fragment key={r.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : r.id)}>
                    <TableCell>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtWhen(r.at?.toDate?.())}</TableCell>
                    <TableCell>
                      <Badge variant={r.action === "rule_deactivated" ? "destructive" : r.action === "rule_created" ? "default" : "secondary"}>
                        {ACTION_LABEL[r.action ?? ""] ?? r.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{r.ruleId}</div>
                      <div className="text-xs text-muted-foreground">{KIND_LABELS[r.kind ?? ""] ?? r.kind}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.fromVersion ? `v${r.fromVersion} → ` : ""}v{r.toVersion}</TableCell>
                    <TableCell>
                      <div className="text-sm">{r.actor?.email || r.actor?.uid}</div>
                      <div className="text-xs text-muted-foreground">{r.actor?.role?.replace(/_/g, " ")}</div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={r.reason}>{r.reason}</TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow>
                      <TableCell />
                      <TableCell colSpan={6}>
                        {changes.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No field changed (republished as-is).</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground"><th className="py-1 pr-4">Field</th><th className="py-1 pr-4">Before</th><th className="py-1">After</th></tr>
                            </thead>
                            <tbody>
                              {changes.map((c) => (
                                <tr key={c.key} className="border-t">
                                  <td className="py-1 pr-4 font-mono">{c.key}</td>
                                  <td className="py-1 pr-4 font-mono text-red-600 dark:text-red-400 break-all">{show(c.from)}</td>
                                  <td className="py-1 font-mono text-emerald-700 dark:text-emerald-400 break-all">{show(c.to)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
