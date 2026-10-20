import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { useEffect, useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, query, doc, updateDoc, limit, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

// UI components
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/admin/ui/data-table";

// Icons
import {
  Ticket,
  ShieldAlert,
  Clock,
  MessageSquare,
  Mail,
  Phone,
  MoreHorizontal,
  X,
  StickyNote,
  Users,
  TrendingUp,
  Loader2,
  CheckCircle2,
  Circle,
  TimerReset,
  Lock,
} from "lucide-react";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface TicketNote {
  id: string;
  text: string;
  createdAtIso: string;
}

interface SupportTicket {
  id: string;
  restaurantId?: string;
  restaurantName: string;
  subject: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  status: "Open" | "In Progress" | "Resolved" | "Closed";
  createdAt: any;
  notes?: TicketNote[];
  slaTimer?: number;
  assignedTo?: string;
  department?: string;
}

interface ContactRequest {
  id: string;
  name: string;
  email: string;
  phone: string;
  topic: string;
  message: string;
  status?: "new" | "working" | "done" | "closed";
  createdAt?: any;
  createdAtIso?: string;
  source?: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getTimestamp(createdAt?: any, createdAtIso?: string): number {
  if (createdAt?.toMillis) return createdAt.toMillis();
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === "string") {
    const p = Date.parse(createdAt);
    if (!Number.isNaN(p)) return p;
  }
  if (createdAtIso) {
    const p = Date.parse(createdAtIso);
    if (!Number.isNaN(p)) return p;
  }
  return 0;
}

function formatDate(val: any): string {
  const ms = getTimestamp(val);
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isToday(val: any, iso?: string): boolean {
  const ms = getTimestamp(val, iso);
  if (!ms) return false;
  const d = new Date(ms);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

const PRIORITY_STYLES: Record<SupportTicket["priority"], string> = {
  Urgent: "bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-400",
  High: "bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400",
  Medium: "bg-blue-500/10 border-blue-500/25 text-blue-600 dark:text-blue-400",
  Low: "bg-muted border-border/40 text-muted-foreground",
};

const STATUS_STYLES: Record<SupportTicket["status"], string> = {
  Open: "bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400",
  "In Progress": "bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400",
  Resolved: "bg-blue-500/10 border-blue-500/25 text-blue-600 dark:text-blue-400",
  Closed: "bg-muted border-border/40 text-muted-foreground",
};

const CONTACT_STATUS_STYLES: Record<NonNullable<ContactRequest["status"]>, string> = {
  new: "bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400",
  working: "bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400",
  done: "bg-blue-500/10 border-blue-500/25 text-blue-600 dark:text-blue-400",
  closed: "bg-muted border-border/40 text-muted-foreground",
};

function buildMailto(r: ContactRequest): string {
  const subject = encodeURIComponent(`Re: Kada Dine (${r.topic || "Contact"})`);
  const body = encodeURIComponent(
    `Hi ${r.name || "there"},\n\nThanks for contacting Kada Dine.\nWe received your message and will help you shortly.\n\nRegards,\nKada Dine Team`
  );
  return `mailto:${encodeURIComponent(r.email || "")}?subject=${subject}&body=${body}`;
}

function formatLeadError(err: unknown, email?: string | null): string {
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  if (code.includes("permission-denied")) {
    return email
      ? `Access blocked for ${email}. Sign in with an approved admin email.`
      : "Access blocked. Sign in with an approved admin email.";
  }
  return "Failed to load data. Please refresh and try again.";
}

// ─────────────────────────────────────────────
// Ticket Detail Panel
// ─────────────────────────────────────────────

interface TicketDetailProps {
  ticket: SupportTicket;
  onClose: () => void;
  onStatusChange: (ticketId: string, status: SupportTicket["status"]) => Promise<void>;
  onAddNote: (ticketId: string, note: string) => Promise<void>;
  onAssign: (ticketId: string, assignee: string) => Promise<void>;
  onEscalate: (ticketId: string) => Promise<void>;
  currentUserEmail?: string;
}

function TicketDetail({ ticket, onClose, onStatusChange, onAddNote, onAssign, onEscalate, currentUserEmail }: TicketDetailProps) {
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [escalating, setEscalating] = useState(false);

  const sortedNotes = useMemo(
    () => [...(ticket.notes ?? [])].sort((a, b) => Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso)),
    [ticket.notes]
  );

  async function handleStatusChange(status: SupportTicket["status"]) {
    setChangingStatus(true);
    try {
      await onStatusChange(ticket.id, status);
    } finally {
      setChangingStatus(false);
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) {
      toast.error("Enter a note first");
      return;
    }
    setSaving(true);
    try {
      await onAddNote(ticket.id, noteText.trim());
      setNoteText("");
    } finally {
      setSaving(false);
    }
  }

  const statusButtons: { label: string; value: SupportTicket["status"]; icon: React.ReactNode }[] = [
    { label: "Open", value: "Open", icon: <Circle className="h-3 w-3" /> },
    { label: "In Progress", value: "In Progress", icon: <TimerReset className="h-3 w-3" /> },
    { label: "Resolved", value: "Resolved", icon: <CheckCircle2 className="h-3 w-3" /> },
    { label: "Closed", value: "Closed", icon: <Lock className="h-3 w-3" /> },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
              #{ticket.id.slice(-6).toUpperCase()}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-semibold rounded-md px-2 py-0.5 border",
                STATUS_STYLES[ticket.status]
              )}
            >
              {ticket.status}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-semibold rounded-md px-2 py-0.5 border",
                PRIORITY_STYLES[ticket.priority]
              )}
            >
              {ticket.priority}
            </Badge>
          </div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">{ticket.subject}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">{ticket.restaurantName}</p>
        </div>
        <Button aria-label="Close ticket"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-5 py-4 space-y-5">
          {/* Status Change */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">
              Change Status
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {statusButtons.map(({ label, value, icon }) => (
                <Button
                  key={value}
                  variant={ticket.status === value ? "default" : "outline"}
                  size="sm"
                  disabled={changingStatus}
                  className={cn(
                    "h-8 text-xs font-medium rounded-lg gap-1.5 justify-start",
                    ticket.status !== value && "border-border/50 text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => handleStatusChange(value)}
                >
                  {icon}
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <Separator className="border-border/40" />

          {/* Meta info & Assignment */}
          <div className="space-y-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>Opened {formatDate(ticket.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 shrink-0" />
                <span>Assign to:</span>
                <select
                  className="bg-muted border border-border/40 rounded-md px-1.5 py-1 text-foreground"
                  value={ticket.assignedTo || ""}
                  onChange={(e) => onAssign(ticket.id, e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {currentUserEmail && (
                    <option value={currentUserEmail}>{currentUserEmail} (me)</option>
                  )}
                  {ticket.assignedTo && ticket.assignedTo !== currentUserEmail && (
                    <option value={ticket.assignedTo}>{ticket.assignedTo}</option>
                  )}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-[10px] w-full"
                disabled={escalating || ticket.priority === "Urgent"}
                onClick={async () => {
                  setEscalating(true);
                  try {
                    await onEscalate(ticket.id);
                  } finally {
                    setEscalating(false);
                  }
                }}
              >
                <ShieldAlert className="h-3 w-3 mr-1.5" />
                {ticket.priority === "Urgent" ? "Already Urgent" : escalating ? "Escalating…" : "Escalate Ticket"}
              </Button>
            </div>
          </div>

          <Separator className="border-border/40" />

          {/* Internal Notes */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Internal Notes
              </p>
            </div>

            {/* Add note */}
            <div className="space-y-2">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add an internal note..."
                className="rounded-xl text-sm resize-none min-h-[80px] border-border/50 focus-visible:ring-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleAddNote();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={handleAddNote}
                disabled={saving || !noteText.trim()}
                className="w-full h-8 text-xs rounded-lg font-medium"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Add Note
              </Button>
            </div>

            {/* Notes list */}
            {sortedNotes.length > 0 ? (
              <div className="mt-4 space-y-2">
                {sortedNotes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3 space-y-1"
                  >
                    <p className="text-xs text-foreground leading-relaxed">{n.text}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDateTime(n.createdAtIso)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground text-center py-4">
                No notes yet. Add one above.
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function SupportPage() {
  const { user } = useAuth();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [contacts, setContacts] = useState<ContactRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);

  // ── Firestore subscriptions ──────────────────
  useEffect(() => {
    const unsubTickets = listenCollection<SupportTicket>(
      "support_tickets",
      { orderByField: "createdAt", limit: 500 },
      (rows) => {
        setTickets(rows);
        setTicketsError(null);
        setLoading(false);
      },
      (err) => {
        console.error("Tickets sync failed:", err);
        setTicketsError(formatLeadError(err, user?.email));
        setLoading(false);
      },
    );

    const qContact = query(collection(db, "contact_requests"), limit(500));

    const unsubContact = onSnapshot(
      qContact,
      (snap) => {
        const data = (snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ContactRequest[]).sort(
          (a, b) =>
            getTimestamp(b.createdAt, b.createdAtIso) - getTimestamp(a.createdAt, a.createdAtIso)
        );
        setContacts(data);
        setContactError(null);
      },
      (err) => {
        console.error("Contact requests sync failed:", err);
        setContactError(formatLeadError(err, user?.email));
      }
    );

    return () => {
      unsubTickets();
      unsubContact();
    };
  }, [user?.email]);

  // ── Mutations ───────────────────────────────
  const updateTicketStatus = async (ticketId: string, newStatus: SupportTicket["status"]) => {
    const prev = tickets.find((t) => t.id === ticketId)?.status;
    setTickets((all) => all.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t)));
    try {
      await updateDoc(doc(db, "support_tickets", ticketId), { status: newStatus });
      toast.success(`Ticket moved to "${newStatus}"`);
    } catch (err) {
      console.error(err);
      setTickets((all) => all.map((t) => (t.id === ticketId ? { ...t, status: prev as any } : t)));
      toast.error("Failed to update ticket status");
    }
  };

  const addNote = async (ticketId: string, text: string) => {
    const ticket = tickets.find((t) => t.id === ticketId);
    const prevNotes = ticket?.notes ?? [];
    const newNote: TicketNote = {
      id: crypto.randomUUID(),
      text,
      createdAtIso: new Date().toISOString(),
    };
    const updatedNotes = [...prevNotes, newNote];

    setTickets((all) =>
      all.map((t) => (t.id === ticketId ? { ...t, notes: updatedNotes } : t))
    );

    try {
      await updateDoc(doc(db, "support_tickets", ticketId), { notes: updatedNotes });
      toast.success("Note added");
    } catch (err) {
      console.error(err);
      setTickets((all) => all.map((t) => (t.id === ticketId ? { ...t, notes: prevNotes } : t)));
      toast.error("Failed to save note");
    }
  };

  const updateContactStatus = async (
    id: string,
    newStatus: NonNullable<ContactRequest["status"]>
  ) => {
    try {
      await updateDoc(doc(db, "contact_requests", id), { status: newStatus });
      toast.success(`Contact moved to "${newStatus}"`);
    } catch (err) {
      toast.error("Failed to update contact request");
    }
  };

  const assignTicket = async (ticketId: string, assignee: string) => {
    const next = assignee || null;
    const prev = tickets.find((t) => t.id === ticketId)?.assignedTo;
    setTickets((all) => all.map((t) => (t.id === ticketId ? { ...t, assignedTo: next || undefined } : t)));
    try {
      await updateDoc(doc(db, "support_tickets", ticketId), {
        assignedTo: next,
        assignedAt: next ? serverTimestamp() : null,
      });
      toast.success(next ? `Assigned to ${next}` : "Unassigned");
    } catch (err) {
      console.error("assignTicket failed", err);
      setTickets((all) => all.map((t) => (t.id === ticketId ? { ...t, assignedTo: prev } : t)));
      toast.error("Failed to assign ticket");
    }
  };

  const escalateTicket = async (ticketId: string) => {
    const t0 = tickets.find((t) => t.id === ticketId);
    if (!t0) return;
    if (t0.priority === "Urgent") {
      toast.info("Ticket is already Urgent.");
      return;
    }
    const prev = t0.priority;
    setTickets((all) => all.map((t) => (t.id === ticketId ? { ...t, priority: "Urgent" } : t)));
    try {
      await updateDoc(doc(db, "support_tickets", ticketId), {
        priority: "Urgent",
        escalatedAt: serverTimestamp(),
        escalatedBy: user?.email || "admin",
      });
      toast.success("Ticket escalated to Urgent");
    } catch (err) {
      console.error("escalateTicket failed", err);
      setTickets((all) => all.map((t) => (t.id === ticketId ? { ...t, priority: prev } : t)));
      toast.error("Failed to escalate");
    }
  };

  // ── Derived stats ───────────────────────────
  const openTickets = useMemo(
    () => tickets.filter((t) => t.status === "Open").length,
    [tickets]
  );
  // Only tickets still being worked — a resolved urgent ticket isn't urgent.
  const urgentTickets = useMemo(
    () => tickets.filter((t) => t.priority === "Urgent" && (t.status === "Open" || t.status === "In Progress")).length,
    [tickets]
  );
  const inProgressTickets = useMemo(
    () => tickets.filter((t) => t.status === "In Progress").length,
    [tickets]
  );
  const newContactsToday = useMemo(
    () => contacts.filter((c) => isToday(c.createdAt, c.createdAtIso)).length,
    [contacts]
  );

  const selectedTicket = selectedTicketId
    ? tickets.find((t) => t.id === selectedTicketId) ?? null
    : null;

  // ── Ticket table columns ────────────────────
  const ticketColumns: ColumnDef<SupportTicket>[] = useMemo(
    () => [
      {
        id: "ticketId",
        header: "ID",
        cell: ({ row }) => (
          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
            #{row.original.id.slice(-5).toUpperCase()}
          </span>
        ),
      },
      {
        accessorKey: "subject",
        header: "Subject",
        cell: ({ row }) => {
          const t = row.original;
          return (
            <button
              type="button"
              className="text-left group"
              onClick={() => setSelectedTicketId(t.id)}
            >
              <div className="font-medium text-sm text-foreground group-hover:text-primary transition-colors leading-snug">
                {t.subject}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.restaurantName}</div>
            </button>
          );
        },
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-semibold rounded-md px-2 py-0.5 border",
              PRIORITY_STYLES[row.original.priority]
            )}
          >
            {row.original.priority}
          </Badge>
        ),
      },
      {
        id: "sla",
        header: "SLA Timer",
        cell: ({ row }) => {
          const created = getTimestamp(row.original.createdAt);
          if (!created || row.original.status === 'Resolved' || row.original.status === 'Closed') return <span className="text-xs text-muted-foreground">—</span>;
          const hours = Math.floor((Date.now() - created) / 3600000);
          const isBreached = hours > 24;
          return (
            <span className={cn("text-xs font-semibold flex items-center gap-1", isBreached ? "text-rose-600" : "text-amber-600")}>
              <TimerReset className="h-3 w-3" />
              {hours}h
            </span>
          );
        }
      },
      {
        id: "assignment",
        header: "Assigned",
        cell: ({ row }) => (
          <div className="text-xs">
            <div className="font-medium">{row.original.assignedTo || "Unassigned"}</div>
            {row.original.department && <div className="text-muted-foreground text-[10px]">{row.original.department}</div>}
          </div>
        )
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-semibold rounded-md px-2 py-0.5 border",
              STATUS_STYLES[row.original.status]
            )}
          >
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "createdAt",
        header: "Created",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const t = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0 rounded-lg">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-xl shadow-xl">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Actions
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => setSelectedTicketId(t.id)}
                  className="text-xs cursor-pointer"
                >
                  View Details
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Status
                </DropdownMenuLabel>
                {(["Open", "In Progress", "Resolved", "Closed"] as SupportTicket["status"][]).map(
                  (s) => (
                    <DropdownMenuItem
                      key={s}
                      onClick={() => updateTicketStatus(t.id, s)}
                      className="text-xs cursor-pointer"
                    >
                      {s}
                    </DropdownMenuItem>
                  )
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs cursor-pointer text-rose-600 font-medium"
                >
                  <ShieldAlert className="h-3.5 w-3.5 mr-2" /> Escalate
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    []
  );

  // ── Contact table columns ───────────────────
  const contactColumns: ColumnDef<ContactRequest>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <span className="font-medium text-sm text-foreground">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.email}</span>
        ),
      },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.phone || "—"}</span>
        ),
      },
      {
        accessorKey: "topic",
        header: "Topic",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[10px] font-medium rounded-md px-2 py-0.5">
            {row.original.topic || "General"}
          </Badge>
        ),
      },
      {
        accessorKey: "message",
        header: "Message",
        cell: ({ row }) => (
          <p className="text-xs text-muted-foreground line-clamp-2 max-w-[200px]">
            {row.original.message}
          </p>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.status ?? "new";
          return (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-semibold rounded-md px-2 py-0.5 border capitalize",
                CONTACT_STATUS_STYLES[s]
              )}
            >
              {s}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const c = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0 rounded-lg">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-xl">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Contact
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <a
                    href={buildMailto(c)}
                    className="flex items-center gap-2 text-xs cursor-pointer"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Email Contact
                  </a>
                </DropdownMenuItem>
                {c.phone && (
                  <DropdownMenuItem asChild>
                    <a
                      href={`tel:${c.phone.replace(/\s+/g, "")}`}
                      className="flex items-center gap-2 text-xs cursor-pointer"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Call
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Change Status
                </DropdownMenuLabel>
                {(["new", "working", "done", "closed"] as NonNullable<ContactRequest["status"]>[]).map(
                  (s) => (
                    <DropdownMenuItem
                      key={s}
                      onClick={() => updateContactStatus(c.id, s)}
                      className="text-xs cursor-pointer capitalize"
                    >
                      {s}
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    []
  );

  const renderTicketMobileCard = useCallback((t: SupportTicket) => (
    <div className="bg-card rounded-xl border border-border/60 p-4 shadow-sm space-y-3 relative group" onClick={() => setSelectedTicketId(t.id)}>
      <div className="flex items-start justify-between gap-2">
         <div className="flex-1 min-w-0">
           <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md mb-2 inline-block border">
             #{t.id.slice(-5).toUpperCase()}
           </span>
           <h4 className="font-medium text-sm leading-snug">{t.subject}</h4>
           <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.restaurantName}</p>
         </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-border/40">
        <div className="flex items-center gap-2">
           <Badge variant="outline" className={cn("text-[10px] font-semibold rounded-md px-2 py-0.5 border", STATUS_STYLES[t.status])}>
             {t.status}
           </Badge>
           <Badge variant="outline" className={cn("text-[10px] font-semibold rounded-md px-2 py-0.5 border", PRIORITY_STYLES[t.priority])}>
             {t.priority}
           </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground">{formatDate(t.createdAt)}</span>
      </div>
    </div>
  ), [setSelectedTicketId]);

  const renderContactMobileCard = useCallback((c: ContactRequest) => (
    <div className="bg-card rounded-xl border border-border/60 p-4 shadow-sm space-y-3 relative group">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
           <div className="flex items-center gap-2 mb-1">
             <h4 className="font-bold text-sm leading-tight text-foreground truncate">{c.name}</h4>
             <Badge variant="outline" className="text-[9px] font-medium rounded-md px-1.5 py-0">
               {c.topic || "General"}
             </Badge>
           </div>
           <p className="text-xs text-muted-foreground truncate">{c.email}</p>
           {c.phone && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{c.phone}</p>}
        </div>
        <DropdownMenu>
           <DropdownMenuTrigger asChild>
             <Button variant="ghost" className="h-8 w-8 p-0 shrink-0">
               <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
             </Button>
           </DropdownMenuTrigger>
           <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-xl">
             <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">Actions</DropdownMenuLabel>
             <DropdownMenuItem asChild>
               <a href={buildMailto(c)} className="flex items-center gap-2 text-xs cursor-pointer"><Mail className="h-3.5 w-3.5" /> Email</a>
             </DropdownMenuItem>
             {c.phone && (
               <DropdownMenuItem asChild>
                 <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="flex items-center gap-2 text-xs cursor-pointer"><Phone className="h-3.5 w-3.5" /> Call</a>
               </DropdownMenuItem>
             )}
             <DropdownMenuSeparator />
             <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">Change Status</DropdownMenuLabel>
             {(["new", "working", "done", "closed"] as NonNullable<ContactRequest["status"]>[]).map(s => (
               <DropdownMenuItem key={s} onClick={() => updateContactStatus(c.id, s)} className="text-xs cursor-pointer capitalize">{s}</DropdownMenuItem>
             ))}
           </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-xs text-foreground line-clamp-3 bg-muted/30 p-2.5 rounded-lg border border-border/40">
        {c.message}
      </p>
      <div className="flex items-center justify-between pt-1">
        <Badge variant="outline" className={cn("text-[9px] font-semibold rounded-md px-2 py-0.5 border capitalize", CONTACT_STATUS_STYLES[c.status ?? "new"])}>
          {c.status ?? "new"}
        </Badge>
      </div>
    </div>
  ), [updateContactStatus]);

  // ── Loading state ──────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-48 rounded-xl" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[500px] rounded-2xl" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────
  return (
    <div className="flex flex-col gap-6 h-full">
      <AdminPageHeader
        title="Cases"
        description="Tickets and website contact requests. Live chat with Kada Assist escalations lives in the Live chat tab."
        icon={Ticket}
        actions={
          <Button asChild variant="outline" className="gap-2">
            <Link to="/admin/support?tab=chats">
              <MessageSquare className="h-4 w-4" />
              Live chat
            </Link>
          </Button>
        }
      />

      <StatCards
        items={[
          { label: "Open tickets", value: openTickets, hint: "Not yet picked up", icon: Ticket, tone: "text-rose-600" },
          { label: "In progress", value: inProgressTickets, icon: TrendingUp, tone: "text-sky-600" },
          { label: "Urgent", value: urgentTickets, hint: "Open or in progress", icon: ShieldAlert, tone: "text-amber-600" },
          { label: "New contacts today", value: newContactsToday, hint: "Website contact form", icon: Users, tone: "text-emerald-600" },
        ]}
      />

      {/* ── Tabs ── */}
      <Tabs defaultValue="tickets" className="flex-1 flex flex-col min-h-0">
        <TabsList className="rounded-xl bg-muted/60 p-1 h-10 w-fit shrink-0">
          <TabsTrigger value="tickets" className="rounded-lg text-sm font-medium px-4 h-8 gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Tickets
            {openTickets > 0 && (
              <span className="ml-1 h-4 min-w-4 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold px-1">
                {openTickets}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="contact" className="rounded-lg text-sm font-medium px-4 h-8 gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            Contact Requests
          </TabsTrigger>
        </TabsList>

        {/* ── Tickets Tab ── */}
        <TabsContent value="tickets" className="flex-1 mt-4 min-h-0 data-[state=inactive]:hidden">
          {ticketsError && (
            <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-700 dark:text-amber-400">
              {ticketsError}
            </div>
          )}

          <div className="rounded-2xl border border-border/40 shadow-sm bg-card overflow-hidden h-full">
            <ResizablePanelGroup direction="horizontal" className="h-full min-h-[600px]">
              {/* Left: Table */}
              <ResizablePanel defaultSize={selectedTicket ? 65 : 100} minSize={40}>
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40 bg-muted/20 shrink-0">
                    <div className="flex items-center gap-2">
                      <Ticket className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">All Tickets</span>
                      <span className="text-xs text-muted-foreground">({tickets.length})</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {urgentTickets > 0 && (
                        <span className="flex items-center gap-1.5 text-rose-500 font-medium">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          {urgentTickets} urgent
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                        <Clock className="h-3.5 w-3.5" />
                        {openTickets} open
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto px-5 py-4">
                    <DataTable
                      columns={ticketColumns}
                      data={tickets}
                      searchKey="subject"
                      searchPlaceholder="Search tickets..."
                      renderMobileCard={renderTicketMobileCard}
                    />
                  </div>
                </div>
              </ResizablePanel>

              {/* Resize handle + right panel only when ticket is selected */}
              {selectedTicket && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={35} minSize={25} maxSize={55}>
                    <div className="h-full border-l border-border/40 bg-background">
                      <TicketDetail
                        ticket={selectedTicket}
                        onClose={() => setSelectedTicketId(null)}
                        onStatusChange={updateTicketStatus}
                        onAddNote={addNote}
                        onAssign={assignTicket}
                        onEscalate={escalateTicket}
                        currentUserEmail={user?.email || undefined}
                      />
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </TabsContent>

        {/* ── Contact Requests Tab ── */}
        <TabsContent value="contact" className="flex-1 mt-4 data-[state=inactive]:hidden">
          {contactError && (
            <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-700 dark:text-amber-400">
              {contactError}
            </div>
          )}

          <div className="rounded-2xl border border-border/40 shadow-sm bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40 bg-muted/20">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Contact Requests</span>
                <span className="text-xs text-muted-foreground">({contacts.length})</span>
              </div>
              {newContactsToday > 0 && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {newContactsToday} new today
                </span>
              )}
            </div>
            <div className="px-5 py-4">
              <DataTable
                columns={contactColumns}
                data={contacts}
                searchKey="name"
                searchPlaceholder="Search contacts..."
                renderMobileCard={renderContactMobileCard}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
