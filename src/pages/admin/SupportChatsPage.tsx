import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  increment,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Send,
  ShieldAlert,
  User as UserIcon,
  Sparkles,
  Wand2,
  Languages,
  Sliders,
  Volume2,
  Image as ImageIcon,
  UserCheck,
  Tag,
  ThumbsUp,
  AlertCircle,
  Clock,
  ExternalLink,
  ChevronRight,
  Filter,
  Star,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

type ThreadStatus = "bot" | "escalated" | "open" | "resolved";

interface AiAnalysis {
  intent?: string;
  sentiment?: "positive" | "neutral" | "frustrated" | "angry";
  urgency?: "low" | "medium" | "high" | "emergency";
  language?: string;
  confidenceScore?: number;
  summary?: string;
  suggestedActions?: string[];
}

interface Thread {
  id: string;
  participantUid?: string;
  participantName?: string;
  participantPhone?: string;
  participantRole?: string;
  status?: ThreadStatus;
  orderId?: string;
  lastMessage?: string;
  lastSender?: string;
  unreadForAdmin?: number;
  lastMessageAt?: { toDate?: () => Date } | null;
  assignedAgentName?: string;
  assignedAgentUid?: string;
  department?: string;
  aiAnalysis?: AiAnalysis;
  escalatedAt?: { toDate?: () => Date; toMillis?: () => number } | null;
  firstResponseAt?: { toDate?: () => Date } | null;
  firstResponseSecs?: number;
  slaBreached?: boolean;
  csatRating?: number;
  csatComment?: string;
}

interface Macro {
  id: string;
  title?: string;
  category?: string;
  text?: string;
}

interface Message {
  id: string;
  text?: string;
  sender?: "user" | "bot" | "admin";
  senderName?: string;
  createdAt?: { toDate?: () => Date } | null;
  imageUrl?: string;
  audioUrl?: string;
  mediaUrl?: string;
  mediaType?: string;
  suggestedActions?: string[];
  isBot?: boolean;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  escalated: {
    label: "Needs human",
    className: "bg-rose-500/15 text-rose-600 border-rose-500/30",
  },
  open: {
    label: "With agent",
    className: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  },
  active: {
    label: "Active",
    className: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  },
  bot: {
    label: "AI handling",
    className: "bg-violet-500/15 text-violet-600 border-violet-500/30",
  },
  new: {
    label: "New",
    className: "bg-violet-500/15 text-violet-600 border-violet-500/30",
  },
  resolved: {
    label: "Resolved",
    className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  },
  closed: {
    label: "Closed",
    className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  },
  pending: {
    label: "Pending",
    className: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  },
  waiting: {
    label: "Waiting",
    className: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  },
};

// Old customer-app builds parked idle chats as "disconnected". The server now
// treats that exactly like resolved (the next message reopens it), so the
// inbox does too.
const normStatus = (status?: string) => {
  const s = (status || "bot").toLowerCase();
  return s === "disconnected" ? "resolved" : s;
};

const getStatusMeta = (status?: string) => {
  const normalized = normStatus(status);
  return (
    STATUS_META[normalized] ?? {
      label: status || "AI handling",
      className: "bg-violet-500/15 text-violet-600 border-violet-500/30",
    }
  );
};

// First-response SLA target (minutes) — mirrors the backend slaSweep.
const SLA_TARGET_MINS = 10;

// SLA state for an escalated thread awaiting its first human reply.
const slaInfo = (t: Thread): { mins: number; breached: boolean } | null => {
  if ((t.status ?? "") !== "escalated") return null;
  if (t.firstResponseAt) return null; // a human already replied
  const ms = t.escalatedAt?.toMillis?.() ?? t.escalatedAt?.toDate?.()?.getTime?.() ?? 0;
  if (!ms) return null;
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  return { mins, breached: t.slaBreached === true || mins >= SLA_TARGET_MINS };
};

const DEPARTMENTS = [
  "All",
  "Customer Support",
  "Vendor Support",
  "Delivery Support",
  "Stay Support",
  "Finance",
  "Technical",
  "Operations",
];

const FILTERS: { key: string; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "escalated", label: "Needs human" },
  { key: "open", label: "With agent" },
  { key: "bot", label: "AI handling" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

const fmtTime = (t: Thread["lastMessageAt"]) => {
  const d = t?.toDate?.();
  if (!d) return "";
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
};

export default function SupportChatsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active");
  const [deptFilter, setDeptFilter] = useState("All");
  const [activeId, setActiveId] = useState<string | null>(searchParams.get("thread"));
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [macrosOpen, setMacrosOpen] = useState(false);
  const scrollBottom = useRef<HTMLDivElement>(null);

  // AI Assistant States
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiAction, setAiAction] = useState<{ action?: string; details?: string } | null>(null);

  // Tracks which threads we've already alerted on so a live escalation only
  // pops once (and re-alerts if it is resolved then escalated again).
  const seenEscalatedRef = useRef<Set<string>>(new Set());
  const escalationInitRef = useRef(false);

  // Short attention beep via Web Audio (no asset needed).
  const beep = () => {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.36);
    } catch {
      /* audio not available — ignore */
    }
  };

  // Best-effort desktop notification permission for human-handoff alerts.
  useEffect(() => {
    try {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, []);

  // ── The real customer behind the thread ───────────────────────────────────
  // This panel used to print "₹450 / Kada Gold / 24 orders" for every single
  // chat. An agent acting on invented numbers is worse than an agent with
  // none, so everything here now comes from the customer's own records.
  const active = useMemo(
    () => threads.find((t) => t.id === activeId) ?? null,
    [threads, activeId],
  );

  const [customerCtx, setCustomerCtx] = useState<{
    loading: boolean;
    name?: string;
    phone?: string;
    email?: string;
    area?: string;
    wallet?: number;
    isGold?: boolean;
    orderCount?: number;
    lastOrders?: { id: string; orderNumber?: string; status?: string; total?: number }[];
  }>({ loading: false });

  // ── Live agent macros (canned replies) ────────────────────────────────────
  useEffect(() => {
    return listenCollection<Macro>(
      "support_macros",
      { orderByField: "title", orderDir: "asc" },
      (rows) => setMacros(rows),
    );
  }, []);

  // ── Customer context for the open thread ──────────────────────────────────
  useEffect(() => {
    const uid = active?.participantUid;
    const role = (active?.participantRole || "customer").toLowerCase();
    if (!uid || role !== "customer") {
      setCustomerCtx({ loading: false });
      return;
    }
    let cancelled = false;
    setCustomerCtx({ loading: true });
    (async () => {
      try {
        const [profileSnap, ordersSnap] = await Promise.all([
          getDoc(doc(db, "customer_users", uid)),
          getDocs(
            query(
              collection(db, "orders"),
              where("customerUid", "==", uid),
              orderBy("timestamp", "desc"),
              fsLimit(20),
            ),
          ).catch(() =>
            getDocs(query(collection(db, "orders"), where("customerUid", "==", uid), fsLimit(20))),
          ),
        ]);
        if (cancelled) return;
        const p = (profileSnap.data() ?? {}) as Record<string, any>;
        const addresses = Array.isArray(p.addresses) ? p.addresses : [];
        const home =
          addresses.find(
            (a: any) => String(a?.label ?? "").toLowerCase() === "home" && a?.area,
          ) ?? addresses.find((a: any) => a?.area);
        const goldUntil = p.goldUntil?.toDate?.() ?? null;
        setCustomerCtx({
          loading: false,
          name: p.name || active?.participantName,
          phone: p.phone || active?.participantPhone,
          email: p.email,
          area: home?.area ? String(home.area) : undefined,
          wallet: Number(p.walletBalance ?? 0),
          isGold: Boolean(goldUntil && goldUntil.getTime() > Date.now()),
          orderCount: ordersSnap.size,
          lastOrders: ordersSnap.docs.slice(0, 3).map((d) => ({
            id: d.id,
            orderNumber: d.data().orderNumber,
            status: d.data().status,
            total: Number(d.data().total ?? 0),
          })),
        });
      } catch {
        if (!cancelled) setCustomerCtx({ loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.participantUid, active?.participantRole, active?.participantName, active?.participantPhone]);

  // ── Live thread list ──────────────────────────────────────────────────────
  useEffect(() => {
    return listenCollection<Thread>(
      "support_threads",
      { orderByField: "lastMessageAt", limit: 250 },
      (rows) => {
        setThreads(rows);
        setLoading(false);

        // Detect newly escalated ("chat with a human") threads → pop an alert.
        const escalated = rows.filter((t) => t.status === "escalated");
        if (!escalationInitRef.current) {
          escalated.forEach((t) => seenEscalatedRef.current.add(t.id));
          escalationInitRef.current = true;
        } else {
          for (const t of escalated) {
            if (seenEscalatedRef.current.has(t.id)) continue;
            seenEscalatedRef.current.add(t.id);
            beep();
            const who = t.participantName || "A customer";
            toast.error(`${who} wants to chat with a human`, {
              description: t.lastMessage
                ? String(t.lastMessage).slice(0, 90)
                : "A Kada Assist chat was escalated to a human agent.",
              duration: 15000,
              action: { label: "Open chat", onClick: () => openThread(t) },
            });
            try {
              if ("Notification" in window && Notification.permission === "granted") {
                new Notification("Kada Assist — human requested", {
                  body: `${who} needs a human agent`,
                });
              }
            } catch {
              /* ignore */
            }
          }
          // Forget resolved threads so a later re-escalation alerts again.
          const current = new Set(escalated.map((t) => t.id));
          for (const id of Array.from(seenEscalatedRef.current)) {
            if (!current.has(id)) seenEscalatedRef.current.delete(id);
          }
        }
      },
      (err) => {
        console.error("support_threads snapshot error:", err);
        setLoading(false);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live messages for the open thread ─────────────────────────────────────
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setAiSuggestions([]);
      setAiSummary(null);
      setAiAction(null);
      return;
    }
    return listenCollection<Message>(
      `support_threads/${activeId}/messages`,
      { orderByField: "createdAt", orderDir: "asc", limit: 500 },
      setMessages,
    );
  }, [activeId]);

  // The open chat is being read: messages that land while it's on screen
  // shouldn't leave an unread badge behind.
  const activeUnread = active?.unreadForAdmin ?? 0;
  useEffect(() => {
    if (!activeId || activeUnread === 0) return;
    updateDoc(doc(db, "support_threads", activeId), { unreadForAdmin: 0 }).catch((e) =>
      console.error("reset unread failed", e),
    );
  }, [activeId, activeUnread]);

  const lastActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scrollBottom.current) return;
    const isNewThread = activeId !== lastActiveIdRef.current;
    lastActiveIdRef.current = activeId;

    const parent = scrollBottom.current.closest("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    if (parent) {
      const isNearBottom = parent.scrollHeight - parent.scrollTop - parent.clientHeight < 160;
      if (isNewThread || isNearBottom) {
        scrollBottom.current.scrollIntoView({ behavior: isNewThread ? "auto" : "smooth" });
      }
    } else {
      scrollBottom.current.scrollIntoView({ behavior: isNewThread ? "auto" : "smooth" });
    }
  }, [messages, activeId]);

  const openThread = (t: Thread) => {
    setActiveId(t.id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("thread", t.id);
      if (!next.get("tab")) next.set("tab", "chats");
      return next;
    }, { replace: true });
    // Its unread count is cleared by the effect that watches the open chat.
  };

  const escalatedCount = useMemo(
    () => threads.filter((t) => t.status === "escalated").length,
    [threads]
  );

  const filtered = useMemo(() => {
    const rank = (s?: string) =>
      s === "escalated" ? 0 : s === "open" ? 1 : s === "bot" ? 2 : 3;
    let list =
      filter === "all"
        ? threads
        : filter === "active"
          ? threads.filter((t) => normStatus(t.status) !== "resolved")
          : threads.filter((t) => normStatus(t.status) === filter);

    if (deptFilter !== "All") {
      list = list.filter((t) => {
        if (t.department) return t.department === deptFilter;
        // fallback inference based on role if department not explicitly set
        if (deptFilter === "Customer Support") return (t.participantRole ?? "customer") === "customer";
        if (deptFilter === "Vendor Support") return t.participantRole === "vendor";
        if (deptFilter === "Delivery Support") return t.participantRole === "rider";
        if (deptFilter === "Stay Support") return t.participantRole === "host";
        return true;
      });
    }

    return [...list].sort((a, b) => rank(normStatus(a.status)) - rank(normStatus(b.status)));
  }, [threads, filter, deptFilter]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    setSending(true);
    try {
      const now = serverTimestamp();
      await addDoc(collection(db, "support_threads", activeId, "messages"), {
        text,
        sender: "admin",
        senderName: user?.displayName || user?.email?.split("@")[0] || "Support Agent",
        createdAt: now,
      });
      await updateDoc(doc(db, "support_threads", activeId), {
        status: "open",
        lastMessage: text,
        lastSender: "admin",
        lastMessageAt: now,
        updatedAt: now,
        unreadForAdmin: 0,
        unreadForUser: increment(1),
      });
      setDraft("");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't send — check permissions");
    } finally {
      setSending(false);
    }
  };

  // Through the server, not a direct status write: resolveSupportThread posts
  // the closing message, asks the user for a rating (a direct write never
  // did, so CSAT stayed empty) and resets the rating for the next cycle.
  const resolve = async () => {
    if (!activeId) return;
    try {
      await httpsCallable(functions, "resolveSupportThread")({ threadId: activeId });
      toast.success("Marked resolved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't resolve this chat");
    }
  };

  const assignToMe = async () => {
    if (!activeId || !user) return;
    try {
      const name = user.displayName || user.email?.split("@")[0] || "Agent";
      await updateDoc(doc(db, "support_threads", activeId), {
        assignedAgentUid: user.uid,
        assignedAgentName: name,
        status: "open",
        updatedAt: serverTimestamp(),
      });
      toast.success(`Assigned to ${name}`);
    } catch {
      toast.error("Assignment failed");
    }
  };

  const convertToTicket = async () => {
    if (!activeId || !active) return;
    try {
      const call = httpsCallable(functions, "convertThreadToTicket");
      const res = await call({
        threadId: activeId,
        priority: active.aiAnalysis?.urgency === "emergency" || active.aiAnalysis?.urgency === "high" ? "Urgent" : "Medium",
        category: active.aiAnalysis?.intent || "General Support",
        subject: active.lastMessage || `Support inquiry from ${active.participantName}`,
      });
      const data = res.data as any;
      toast.success(`Created Ticket #${data.ticketId.slice(-5).toUpperCase()}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to convert to ticket");
    }
  };

  // AI Assistant Callables
  const callAiAssistant = async (action: string, extraArgs: any = {}) => {
    if (!activeId) return;
    setAiLoading(true);
    try {
      const fn = httpsCallable(functions, "getAgentAiAssistant");
      const res = await fn({
        action,
        threadId: activeId,
        draftText: draft,
        ...extraArgs,
      });
      const data = res.data as any;

      if (action === "suggest_reply" && Array.isArray(data)) {
        setAiSuggestions(data);
        toast.success("Generated 3 AI reply suggestions");
      } else if (action === "summarize" && data.result) {
        setAiSummary(data.result);
        toast.success("Generated AI Summary");
      } else if (action === "next_best_action" && data.action) {
        setAiAction(data);
        toast.success("Computed Next Best Action");
      } else if (data.result) {
        setDraft(data.result);
        toast.success(`AI ${action.replace("_", " ")} applied`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "AI Assistant call failed");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Live chat</h2>
          <p className="text-xs text-muted-foreground mt-1 font-bold uppercase tracking-widest flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-violet-500" /> AI answers first ·{" "}
            {escalatedCount > 0 ? (
              <span className="text-rose-600 font-extrabold">{escalatedCount} need a human</span>
            ) : (
              "all queues operating smoothly"
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-colors ${
                filter === f.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
              {f.key === "escalated" && escalatedCount > 0 ? ` (${escalatedCount})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Department Filter Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 shrink-0 pr-1">
          <Filter className="h-3.5 w-3.5" /> Dept:
        </span>
        {DEPARTMENTS.map((dept) => (
          <button
            key={dept}
            onClick={() => setDeptFilter(dept)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-all shrink-0 ${
              deptFilter === dept
                ? "bg-muted text-foreground border border-border font-semibold shadow-sm"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {dept}
          </button>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr_minmax(0,340px)] gap-6">
        {/* ── 1. Thread List ── */}
        <Card className="rounded-3xl border-border/40 overflow-hidden flex flex-col h-[calc(100dvh-17rem)]">
          <div className="p-3 bg-muted/30 border-b border-border/40 font-semibold text-xs uppercase tracking-wide text-muted-foreground flex items-center justify-between">
            <span>Conversations</span>
            <Badge variant="secondary" className="text-[10px] font-black">
              {filtered.length}
            </Badge>
          </div>
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center p-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary opacity-50" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-16 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
                No conversations in queue
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {filtered.map((t) => {
                  const meta = getStatusMeta(t.status);
                  const isActive = t.id === activeId;
                  const ai = t.aiAnalysis;
                  const sla = slaInfo(t);
                  return (
                    <button
                      key={t.id}
                      onClick={() => openThread(t)}
                      className={`w-full text-left p-4 transition-all ${
                        isActive ? "bg-primary/5 border-l-4 border-l-primary" : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-black text-sm truncate flex-1 text-foreground">
                          {t.participantName || "Guest"}
                        </span>
                        {/* Each order has its own chat, so say which one. */}
                        {t.orderId && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] font-bold px-1.5 py-0 text-muted-foreground shrink-0"
                          >
                            #{t.orderId.slice(-6).toUpperCase()}
                          </Badge>
                        )}
                        {(t.unreadForAdmin ?? 0) > 0 && (
                          <span className="h-5 min-w-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center animate-pulse">
                            {t.unreadForAdmin}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground font-bold shrink-0">
                          {fmtTime(t.lastMessageAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0 ${meta.className}`}
                        >
                          {meta.label}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0 text-muted-foreground"
                        >
                          {t.participantRole || "customer"}
                        </Badge>
                        {ai?.intent && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] font-bold px-1.5 py-0 truncate max-w-[120px]"
                          >
                            {ai.intent}
                          </Badge>
                        )}
                        {sla && (
                          <Badge
                            variant="outline"
                            className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0 inline-flex items-center gap-1 ${
                              sla.breached
                                ? "border-rose-500 text-rose-600 bg-rose-500/10 animate-pulse"
                                : "border-amber-500 text-amber-600 bg-amber-500/10"
                            }`}
                            title="Time since escalation without a human reply"
                          >
                            <Clock className="h-2.5 w-2.5" />
                            {sla.breached ? `SLA ${sla.mins}m` : `${sla.mins}m`}
                          </Badge>
                        )}
                        {typeof t.csatRating === "number" && (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-black px-1.5 py-0 inline-flex items-center gap-1 border-emerald-500 text-emerald-600 bg-emerald-500/10"
                            title="Customer satisfaction rating"
                          >
                            <Star className="h-2.5 w-2.5 fill-current" />
                            {t.csatRating}/5
                          </Badge>
                        )}
                      </div>

                      <p className="text-[11px] text-muted-foreground font-medium truncate mt-1.5 flex items-center gap-1">
                        {t.lastSender === "bot" && "🤖 "}
                        {t.lastSender === "admin" && "🧑‍💼 "}
                        {t.lastMessage || "New conversation"}
                      </p>

                      {t.assignedAgentName && (
                        <div className="mt-1 text-[10px] text-muted-foreground flex items-center gap-1 font-bold">
                          <UserCheck className="h-3 w-3 text-emerald-500" />
                          Assigned: {t.assignedAgentName}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </Card>

        {/* ── 2. Active Thread Chat Area ── */}
        <Card className="rounded-3xl border-border/40 overflow-hidden flex flex-col h-[calc(100dvh-17rem)]">
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <MessageSquare className="h-10 w-10 opacity-40" />
              <p className="text-sm font-bold uppercase tracking-widest">
                Select a conversation to begin handling
              </p>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border/40 bg-muted/20">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <UserIcon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-black text-sm truncate">{active.participantName || "Guest"}</p>
                      <Badge
                        variant="outline"
                        className={`text-[9px] font-semibold uppercase tracking-wide ${
                          getStatusMeta(active.status).className
                        }`}
                      >
                        {getStatusMeta(active.status).label}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest">
                      {active.participantRole || "customer"}
                      {active.orderId ? ` · Order #${active.orderId}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!active.assignedAgentName ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={assignToMe}
                      className="gap-1.5 text-xs font-bold rounded-xl"
                    >
                      <UserCheck className="h-3.5 w-3.5 text-emerald-500" /> Assign to Me
                    </Button>
                  ) : (
                    <Badge variant="secondary" className="text-xs font-bold gap-1 rounded-xl px-2.5 py-1">
                      <UserCheck className="h-3 w-3 text-emerald-500" /> {active.assignedAgentName}
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={convertToTicket}
                    className="gap-1.5 text-xs font-bold rounded-xl"
                  >
                    Create Ticket
                  </Button>
                  {normStatus(active.status) !== "resolved" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resolve}
                      className="gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Resolve
                    </Button>
                  )}
                </div>
              </div>

              {active.status === "escalated" && (
                <div className="flex items-center justify-between gap-2 px-4 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-600 text-xs font-bold">
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 animate-bounce" /> The AI escalated this — human intervention required immediately.
                  </span>
                  <span className="text-[10px] uppercase tracking-wider font-semibold">
                    {active.aiAnalysis?.intent || "Priority Escalation"}
                  </span>
                </div>
              )}

              {/* Messages Area */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {messages.map((m) => {
                    const mine = m.sender === "admin";
                    const bot = m.sender === "bot" || m.isBot;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                            mine
                              ? "bg-primary text-primary-foreground rounded-br-none"
                              : bot
                                ? "bg-violet-500/10 border border-violet-500/20 text-foreground rounded-bl-none"
                                : "bg-muted text-foreground rounded-bl-none"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3 mb-1">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide ${mine ? "text-primary-foreground/80" : bot ? "text-violet-500" : "text-muted-foreground"}`}>
                              {bot ? "🤖 Kada Assist AI" : mine ? (m.senderName || "You") : (active.participantName || "User")}
                            </span>
                            <span className="text-[9px] opacity-60 font-medium">
                              {m.createdAt?.toDate?.()?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>

                          {m.text && <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>}

                          {/* Render Image Media */}
                          {(m.imageUrl || (m.mediaUrl && m.mediaType === "image")) && (
                            <div className="mt-2 rounded-xl overflow-hidden border border-border/40 max-w-sm">
                              <a href={m.imageUrl || m.mediaUrl} target="_blank" rel="noreferrer">
                                <img src={m.imageUrl || m.mediaUrl} alt="Attachment" className="w-full h-auto max-h-64 object-cover hover:scale-105 transition-transform" />
                              </a>
                            </div>
                          )}

                          {/* Render Voice/Audio Media */}
                          {(m.audioUrl || (m.mediaUrl && m.mediaType === "voice")) && (
                            <div className="mt-2 p-2 rounded-xl bg-background/40 border border-border/40 flex items-center gap-2">
                              <Volume2 className="h-4 w-4 shrink-0 text-primary" />
                              <audio controls src={m.audioUrl || m.mediaUrl} className="w-60 h-8" />
                            </div>
                          )}

                          {/* Render Quick Action Chips if any */}
                          {Array.isArray(m.suggestedActions) && m.suggestedActions.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-border/30">
                              {m.suggestedActions.map((action, idx) => (
                                <Badge key={idx} variant="outline" className="text-[10px] font-bold bg-background/60">
                                  {action}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={scrollBottom} />
                </div>
              </ScrollArea>

              {/* Composer */}
              <div className="p-3 border-t border-border/40 bg-card relative">
                {/* Macro picker panel */}
                {macrosOpen && (
                  <div className="absolute bottom-full left-3 right-3 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-border/60 bg-popover shadow-xl z-20 p-2">
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Canned replies
                      </span>
                      {macros.length === 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px]"
                          onClick={async () => {
                            try {
                              await httpsCallable(functions, "seedSupportMacros")({});
                              toast.success("Seeded default macros");
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Seed failed");
                            }
                          }}
                        >
                          Seed defaults
                        </Button>
                      )}
                    </div>
                    {macros.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-muted-foreground">
                        No macros yet. Seed the defaults, or add them in the DB.
                      </p>
                    ) : (
                      macros.map((mac) => (
                        <button
                          key={mac.id}
                          onClick={() => {
                            setDraft((d) => (d.trim() ? `${d.trim()} ${mac.text ?? ""}` : mac.text ?? ""));
                            setMacrosOpen(false);
                          }}
                          className="w-full text-left rounded-xl px-3 py-2 hover:bg-muted/60 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">{mac.title || "Macro"}</span>
                            {mac.category && (
                              <Badge variant="outline" className="text-[9px] font-bold">{mac.category}</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{mac.text}</p>
                        </button>
                      ))
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setMacrosOpen((o) => !o)}
                    className="rounded-xl shrink-0 gap-1.5 font-bold"
                    title="Insert a canned reply"
                  >
                    <Zap className="h-4 w-4" /> Macros
                  </Button>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Type your professional reply to the user…"
                    className="flex-1 rounded-xl border border-border/60 bg-background px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    aria-label="Reply message"
                  />
                  <Button
                    onClick={send}
                    disabled={sending || !draft.trim()}
                    className="rounded-xl gap-1.5 shrink-0 px-5 font-bold"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send Reply
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        {/* ── 3. AI Assistant & Insights Sidebar ── */}
        <Card className="rounded-3xl border-border/40 overflow-hidden flex flex-col h-[calc(100dvh-17rem)] bg-muted/10">
          <div className="p-3 bg-muted/30 border-b border-border/40 font-semibold text-xs uppercase tracking-wide text-violet-500 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" /> Agent AI Assistant
            </span>
            <Badge variant="outline" className="text-[9px] font-black border-violet-500/40 text-violet-600 bg-violet-500/10">
              Gemini 2.5 Flash
            </Badge>
          </div>

          <ScrollArea className="flex-1 p-4 space-y-5">
            {!active ? (
              <div className="text-center py-16 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Select a thread for live AI insights
              </div>
            ) : (
              <div className="space-y-5">
                {/* 1. Live AI Analysis Card */}
                <div className="p-3.5 rounded-2xl bg-card border border-border/60 shadow-sm space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-foreground">
                    <span>Detected Intent</span>
                    <Badge variant="secondary" className="font-extrabold text-[10px]">
                      {active.aiAnalysis?.intent || "General Inquiry"}
                    </Badge>
                  </div>
                  <Separator className="border-border/40" />
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-muted-foreground font-semibold block">Sentiment</span>
                      <span className="font-black capitalize text-foreground flex items-center gap-1 mt-0.5">
                        {active.aiAnalysis?.sentiment === "angry" && "😡"}
                        {active.aiAnalysis?.sentiment === "frustrated" && "😤"}
                        {active.aiAnalysis?.sentiment === "positive" && "😊"}
                        {active.aiAnalysis?.sentiment === "neutral" && "😐"}
                        {active.aiAnalysis?.sentiment || "Neutral"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground font-semibold block">Urgency</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] font-semibold uppercase mt-0.5 ${
                          active.aiAnalysis?.urgency === "emergency" || active.aiAnalysis?.urgency === "high"
                            ? "border-rose-500 text-rose-600 bg-rose-500/10"
                            : "border-border text-foreground"
                        }`}
                      >
                        {active.aiAnalysis?.urgency || "Low"}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground font-semibold block">Language</span>
                      <span className="font-bold uppercase text-foreground mt-0.5 block">
                        {active.aiAnalysis?.language || "en"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground font-semibold block">AI Confidence</span>
                      <span className="font-bold text-emerald-600 mt-0.5 block">
                        {active.aiAnalysis?.confidenceScore
                          ? `${Math.round(active.aiAnalysis.confidenceScore * 100)}%`
                          : "95%"}
                      </span>
                    </div>
                  </div>

                  {active.aiAnalysis?.summary && (
                    <div className="pt-2 border-t border-border/40 text-xs text-muted-foreground">
                      <span className="font-bold text-foreground block mb-1">AI Executive Summary:</span>
                      {active.aiAnalysis.summary}
                    </div>
                  )}
                </div>

                {/* 2. Quick Action Tools */}
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Smart Agent Coaching
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => callAiAssistant("suggest_reply")}
                      disabled={aiLoading}
                      className="h-9 text-xs font-bold gap-1.5 rounded-xl border-violet-500/30 hover:bg-violet-500/10 hover:text-violet-600 justify-start"
                    >
                      <Wand2 className="h-3.5 w-3.5 text-violet-500" /> Suggest Replies
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => callAiAssistant("next_best_action")}
                      disabled={aiLoading}
                      className="h-9 text-xs font-bold gap-1.5 rounded-xl border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-600 justify-start"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-emerald-500" /> Next Best Action
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => callAiAssistant("summarize")}
                      disabled={aiLoading}
                      className="h-9 text-xs font-bold gap-1.5 rounded-xl justify-start"
                    >
                      <Tag className="h-3.5 w-3.5 text-sky-500" /> Summarize
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => callAiAssistant("improve_grammar")}
                      disabled={aiLoading || !draft.trim()}
                      className="h-9 text-xs font-bold gap-1.5 rounded-xl justify-start"
                    >
                      <Sliders className="h-3.5 w-3.5 text-amber-500" /> Fix Grammar
                    </Button>
                  </div>

                  {/* Tone Adjustment */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => callAiAssistant("adjust_tone", { targetTone: "Professional & Empathetic" })}
                      disabled={aiLoading || !draft.trim()}
                      className="flex-1 text-[11px] font-bold h-8 rounded-xl"
                    >
                      Empathize Tone
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => callAiAssistant("translate", { targetLanguage: "Malayalam" })}
                      disabled={aiLoading || !draft.trim()}
                      className="flex-1 text-[11px] font-bold h-8 rounded-xl gap-1"
                    >
                      <Languages className="h-3 w-3" /> Malayalam
                    </Button>
                  </div>
                </div>

                {/* 3. Render AI Results (Summary / Action / Suggestions) */}
                {aiLoading && (
                  <div className="p-4 rounded-2xl bg-card border border-border/60 flex items-center justify-center gap-2 text-xs font-bold text-muted-foreground animate-pulse">
                    <Loader2 className="h-4 w-4 animate-spin text-violet-500" /> Gemini AI is reasoning…
                  </div>
                )}

                {aiSummary && (
                  <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-xs space-y-1">
                    <div className="font-bold text-sky-600 flex items-center justify-between">
                      <span>Conversation Summary</span>
                      <button onClick={() => setAiSummary(null)} className="text-[10px] hover:underline">Dismiss</button>
                    </div>
                    <p className="text-foreground leading-relaxed whitespace-pre-wrap">{aiSummary}</p>
                  </div>
                )}

                {aiAction && (
                  <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-1.5">
                    <div className="font-bold text-emerald-600 flex items-center justify-between">
                      <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Next Best Action</span>
                      <button onClick={() => setAiAction(null)} className="text-[10px] hover:underline">Dismiss</button>
                    </div>
                    <div className="font-extrabold text-foreground">{aiAction.action}</div>
                    <p className="text-muted-foreground leading-relaxed">{aiAction.details}</p>
                  </div>
                )}

                {aiSuggestions.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-violet-500">
                      <span>Suggested AI Replies</span>
                      <button onClick={() => setAiSuggestions([])} className="hover:underline">Clear</button>
                    </div>
                    {aiSuggestions.map((sug, idx) => (
                      <button
                        key={idx}
                        onClick={() => setDraft(sug)}
                        className="w-full text-left p-3 rounded-2xl bg-card border border-violet-500/20 hover:border-violet-500/50 text-xs text-foreground font-medium transition-all shadow-sm flex items-start gap-2"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
                        <span className="flex-1 leading-snug">{sug}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* 4. Customer Context — read from the customer's own record */}
                <div className="p-3.5 rounded-2xl bg-card border border-border/60 shadow-sm space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold border-b border-border/40 pb-2">
                    <span className="flex items-center gap-1.5"><UserIcon className="h-3.5 w-3.5 text-primary" /> Customer</span>
                    {customerCtx.isGold && (
                      <Badge variant="outline" className="text-[9px] font-bold border-amber-500/30 text-amber-600 bg-amber-500/10">Kada Gold</Badge>
                    )}
                  </div>
                  {customerCtx.loading ? (
                    <p className="text-[11px] text-muted-foreground">Loading…</p>
                  ) : (
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-muted-foreground font-semibold">Name</span>
                        <span className="font-bold truncate">{customerCtx.name || active.participantName || "—"}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-muted-foreground font-semibold">Phone</span>
                        {customerCtx.phone ? (
                          <a href={`tel:${customerCtx.phone}`} className="font-bold text-primary hover:underline">
                            {customerCtx.phone}
                          </a>
                        ) : (
                          <span className="font-bold text-muted-foreground">Not on file</span>
                        )}
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-muted-foreground font-semibold">Area</span>
                        <span className="font-bold truncate">{customerCtx.area || "—"}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-semibold">Wallet</span>
                        <span className="font-bold text-emerald-600">
                          ₹{(customerCtx.wallet ?? 0).toFixed(0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-semibold">Orders</span>
                        <span className="font-bold">
                          {customerCtx.orderCount ?? 0}
                          {(customerCtx.orderCount ?? 0) >= 20 ? "+" : ""}
                        </span>
                      </div>
                      {active.participantUid && (
                        <a
                          href={`/admin/consumers?uid=${active.participantUid}`}
                          className="block pt-1 text-[11px] font-bold text-primary hover:underline"
                        >
                          Open full profile →
                        </a>
                      )}
                    </div>
                  )}

                  {(customerCtx.lastOrders?.length ?? 0) > 0 && (
                    <div className="pt-2 border-t border-border/40 space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Recent orders
                      </div>
                      {customerCtx.lastOrders!.map((o) => (
                        <a
                          key={o.id}
                          href={`/admin/orders?order=${o.id}`}
                          className={`flex items-center justify-between text-[11px] rounded-lg px-2 py-1 hover:bg-muted/60 ${
                            o.id === active.orderId ? "bg-primary/10" : ""
                          }`}
                        >
                          <span className="font-mono font-bold truncate">
                            #{o.orderNumber || o.id.slice(-6).toUpperCase()}
                          </span>
                          <span className="text-muted-foreground font-semibold capitalize">
                            {(o.status || "").replace(/_/g, " ")}
                          </span>
                          <span className="font-bold">₹{(o.total ?? 0).toFixed(0)}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  {active.orderId && (
                    <div className="pt-2 border-t border-border/40">
                      <div className="flex items-center justify-between text-xs font-bold mb-1">
                        <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-primary" /> This chat is about</span>
                      </div>
                      <a
                        href={`/admin/orders?order=${active.orderId}`}
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-primary hover:underline"
                      >
                        #{active.orderId}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
