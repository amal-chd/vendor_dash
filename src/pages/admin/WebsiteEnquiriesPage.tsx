import { useEffect, useMemo, useState } from "react";
import { arrayUnion, collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, limit } from "firebase/firestore";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Globe, Mail, MessageCircle, Phone, Rocket, Inbox } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { PageSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { DataTable } from "@/components/admin/ui/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Project enquiries from the KadaVerse website (thekada.in → Start a project
 * and Contact). The site writes them to `contact_requests` with
 * `source: "kadaverse-website"`; the Kada Verse app (Clients › Enquiries)
 * reads and updates the same documents, so status and notes stay in step.
 */
const ENQUIRY_SOURCE = "kadaverse-website";

type Status = "new" | "contacted" | "qualified" | "proposal_sent" | "won" | "lost";

const STATUSES: { value: Status; label: string; tone: string }[] = [
  { value: "new", label: "New", tone: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  { value: "contacted", label: "Contacted", tone: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  // Kada Verse's pipeline adds this stage (discovery call done).
  { value: "qualified", label: "Qualified", tone: "bg-teal-500/10 text-teal-600 border-teal-500/20" },
  { value: "proposal_sent", label: "Proposal sent", tone: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
  { value: "won", label: "Won", tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  { value: "lost", label: "Lost", tone: "bg-muted text-muted-foreground border-border/40" },
];
const statusInfo = (s?: string) => STATUSES.find((x) => x.value === s) ?? STATUSES[0];

interface EnquiryNote { text: string; by: string; at: string }

interface Enquiry {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  company?: string;
  needs?: string[];
  budget?: string;
  timeline?: string;
  page?: string;
  referenceId?: string;
  status?: Status;
  notes?: EnquiryNote[];
  clientId?: string;
  createdAt?: { toMillis?: () => number };
  createdAtIso?: string;
}

const timeOf = (e: Enquiry) => e.createdAt?.toMillis?.() ?? (e.createdAtIso ? Date.parse(e.createdAtIso) : 0);
const when = (ms: number) => (ms ? new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
};

export default function WebsiteEnquiriesPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Single equality filter — served by the automatic index; sorted client-side.
    const q = query(collection(db, "contact_requests"), where("source", "==", ENQUIRY_SOURCE), limit(500));
    return onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Enquiry).sort((a, b) => timeOf(b) - timeOf(a)));
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error("[WebsiteEnquiries] listener failed", err);
        setError(String((err as { code?: string }).code ?? "").includes("permission-denied")
          ? `Website enquiries are blocked for ${user?.email ?? "this account"}. Sign in with an approved admin email.`
          : "Could not load website enquiries. Refresh to try again.");
        setLoading(false);
      },
    );
  }, [user?.email]);

  const open = rows.find((r) => r.id === openId) ?? null;
  const actor = user?.email ?? "admin";

  const update = async (id: string, patch: Record<string, unknown>, done: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "contact_requests", id), { ...patch, updatedAt: serverTimestamp(), updatedBy: actor });
      toast.success(done);
    } catch (err) {
      console.error(err);
      toast.error("That did not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = (e: Enquiry, s: Status) => update(e.id, { status: s }, `Moved to ${statusInfo(s).label}`);
  const addNote = async (e: Enquiry) => {
    if (note.trim().length < 2) return;
    await update(e.id, { notes: arrayUnion({ text: note.trim(), by: actor, at: new Date().toISOString() }) }, "Note added");
    setNote("");
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status ?? "new"] = (c[r.status ?? "new"] ?? 0) + 1;
    return c;
  }, [rows]);

  const columns: ColumnDef<Enquiry>[] = useMemo(() => [
    {
      accessorKey: "name",
      header: "Enquiry",
      cell: ({ row }) => {
        const e = row.original;
        return (
          <button type="button" className="flex items-start gap-3 text-left" onClick={() => setOpenId(e.id)}>
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {e.page === "contact" ? <Mail className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-foreground">{e.company ? `${e.company} · ${e.name}` : e.name}</span>
              <span className="line-clamp-1 block max-w-[420px] text-xs text-muted-foreground">{e.message}</span>
            </span>
          </button>
        );
      },
    },
    {
      accessorKey: "needs",
      header: "Needs",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{(row.original.needs ?? []).slice(0, 2).join(", ") || "—"}</span>,
    },
    {
      accessorKey: "budget",
      header: "Budget",
      cell: ({ row }) => <span className="text-xs">{row.original.budget || "—"}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = statusInfo(row.original.status);
        return <Badge variant="outline" className={cn("rounded-lg text-[10px] font-semibold uppercase", s.tone)}>{s.label}</Badge>;
      },
    },
    {
      id: "received",
      header: "Received",
      accessorFn: (e) => timeOf(e),
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{when(timeOf(row.original))}</span>,
    },
  ], []);

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUSES.map((s) => (
          <Card key={s.value} className="rounded-2xl">
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-bold">{counts[s.value] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-primary" /> Website enquiries
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Start a project and Contact forms on thekada.in. Also in the Kada Verse app under Clients › Enquiries.
          </p>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
              <Inbox className="h-8 w-8" />
              <p className="font-medium text-foreground">No website enquiries yet</p>
              <p className="text-sm">They appear here the moment someone sends the form on thekada.in.</p>
            </div>
          ) : (
            <DataTable columns={columns} data={rows} searchKey="name" searchPlaceholder="Search by name…" exportFilename="website-enquiries" getRowId={(r) => r.id} />
          )}
        </CardContent>
      </Card>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>{open.company || open.name}</SheetTitle>
                <SheetDescription>
                  {open.page === "contact" ? "Contact form" : "Start a project"} · {open.referenceId ?? open.id} · {when(timeOf(open))}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-5 flex flex-wrap gap-2">
                {open.phone && (
                  <>
                    <Button asChild size="sm" variant="outline"><a href={`tel:${open.phone.replace(/\s/g, "")}`}><Phone className="mr-1.5 h-4 w-4" />Call</a></Button>
                    <Button asChild size="sm" variant="outline">
                      <a href={`https://wa.me/${waNumber(open.phone)}?text=${encodeURIComponent(`Hi ${open.name}, this is KadaVerse about your project enquiry.`)}`} target="_blank" rel="noreferrer">
                        <MessageCircle className="mr-1.5 h-4 w-4" />WhatsApp
                      </a>
                    </Button>
                  </>
                )}
                <Button asChild size="sm" variant="outline">
                  <a href={`mailto:${open.email}?subject=${encodeURIComponent("Your project enquiry · KadaVerse")}`}><Mail className="mr-1.5 h-4 w-4" />Email</a>
                </Button>
              </div>

              <div className="mt-6 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What they need</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{open.message}</p>
                {!!open.needs?.length && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {open.needs.map((n) => <Badge key={n} variant="secondary" className="rounded-md text-[11px]">{n}</Badge>)}
                  </div>
                )}
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  ["Contact", open.name],
                  ["Company", open.company || "—"],
                  ["Email", open.email],
                  ["Phone", open.phone || "—"],
                  ["Budget", open.budget || "—"],
                  ["Timeline", open.timeline || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="truncate font-medium">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
                <div className="flex flex-wrap gap-2">
                  {STATUSES.map((s) => (
                    <Button
                      key={s.value}
                      size="sm"
                      variant={(open.status ?? "new") === s.value ? "default" : "outline"}
                      disabled={saving || (open.status ?? "new") === s.value}
                      onClick={() => setStatus(open, s.value)}
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
                {open.clientId && <p className="mt-3 text-xs text-emerald-600">Turned into a client in Kada Verse.</p>}
              </div>

              <div className="mt-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
                <div className="space-y-2">
                  {(open.notes ?? []).slice().reverse().map((n, i) => (
                    <div key={i} className="rounded-xl border bg-muted/30 p-3 text-sm">
                      <p>{n.text}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{n.by} · {when(Date.parse(n.at))}</p>
                    </div>
                  ))}
                  {!open.notes?.length && <p className="text-sm text-muted-foreground">No notes yet — log calls and follow-ups so the team sees them.</p>}
                </div>
                <Textarea className="mt-3" rows={3} placeholder="Add a note…" value={note} onChange={(ev) => setNote(ev.target.value)} />
                <Button className="mt-2" size="sm" disabled={saving || note.trim().length < 2} onClick={() => addNote(open)}>Add note</Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
