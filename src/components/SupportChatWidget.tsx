import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { ArrowUp, ClipboardList, Landmark, MessageCircle, Sparkles, Store, UtensilsCrossed, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/lib/firebase";

interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  senderName: string;
  actions: string[];
  /** Server time, or the local send time while a message is still pending. */
  at: number;
}

/** Vendor-dashboard Kada Assist, on the same support_threads model as the vendor app. */
export function SupportChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, setTick] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || !open) return;
    const thread = doc(db, "support_threads", user.uid);
    const q = query(collection(thread, "messages"), orderBy("createdAt", "desc"), limit(40));
    return onSnapshot(q, (snap) => {
      setMessages(
        snap.docs
          .map((d) => ({
            id: d.id,
            text: String(d.data().text ?? ""),
            sender: String(d.data().sender ?? "bot"),
            senderName: String(d.data().senderName ?? ""),
            actions: Array.isArray(d.data().suggestedActions) ? d.data().suggestedActions.map(String).slice(0, 3) : [],
            at:
              d.data({ serverTimestamps: "estimate" }).createdAt?.toMillis?.() ??
              Number(d.data().timestamp ?? Date.now()),
          }))
          .reverse(),
      );
    }, (err) => console.error("[SupportChatWidget] q listener failed", err));
  }, [user, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  // The assistant answers every message unless a person has joined; show that
  // it's on the way, for a while — never a spinner that runs forever.
  const last = messages[messages.length - 1];
  const replyDueMs = last && last.sender === "user" ? last.at + 45_000 - Date.now() : 0;
  const awaitingReply = replyDueMs > 0;
  useEffect(() => {
    if (replyDueMs <= 0) return;
    const t = setTimeout(() => setTick((n) => n + 1), replyDueMs);
    return () => clearTimeout(t);
  }, [replyDueMs > 0, last?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;

  async function send(preset?: string) {
    const trimmed = (preset ?? text).trim();
    if (!user || !trimmed || sending) return;
    setSending(true);
    if (preset === undefined) setText("");
    try {
      const thread = doc(db, "support_threads", user.uid);
      const existing = await getDoc(thread);
      if (!existing.exists()) {
        await setDoc(thread, {
          participantUid: user.uid,
          participantRole: "vendor",
          participantName: user.displayName || user.email?.split("@")[0] || "Restaurant",
          participantPhone: user.phoneNumber || "",
          status: "bot",
          lastMessage: "",
          lastSender: "user",
          lastMessageAt: serverTimestamp(),
          unreadForAdmin: 0,
          unreadForUser: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      // Preview, unread and reopening a resolved chat are done by the server
      // when it sees the message; doing them here raced the assistant's reply.
      await addDoc(collection(thread, "messages"), {
        text: trimmed,
        sender: "user",
        senderName: user.displayName || "You",
        timestamp: Date.now(),
        createdAt: serverTimestamp(),
      });
      setFailed(false);
    } catch (err) {
      // Give the message back instead of silently dropping it.
      console.error("[Kada Assist] send failed", err);
      if (preset === undefined) setText(trimmed);
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  const hour = new Date().getHours();
  const greeting = `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}${
    user.displayName ? `, ${user.displayName.split(" ")[0]}` : ""
  }!`;
  const starters = [
    { icon: ClipboardList, color: "#2563EB", text: "I need help with an order" },
    { icon: Landmark, color: "#059669", text: "When will my next payout arrive?" },
    { icon: UtensilsCrossed, color: "#EA580C", text: "How do I update my menu?" },
    { icon: Store, color: "#7C3AED", text: "My store is not showing to customers" },
  ];
  const lastBot = [...messages].reverse().find((m) => m.sender !== "user");

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 z-50 flex h-[560px] max-h-[calc(100vh-8rem)] w-[min(100vw-2rem,390px)] flex-col overflow-hidden rounded-[28px] border border-white/80 bg-gradient-to-b from-[#F4F8FF] via-[#E3EDFF] to-[#C7DAFF] shadow-2xl dark:border-white/10 dark:from-[#0B1220] dark:via-[#0E1A36] dark:to-[#13285A]">
          <div className="flex items-center justify-between px-3 pt-3">
            <span className="w-10" />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/90 bg-white/70 px-4 py-2 text-sm font-bold text-primary backdrop-blur dark:border-white/10 dark:bg-white/10">
              <MessageCircle className="h-4 w-4" /> Kada Assist
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/90 bg-white/70 backdrop-blur dark:border-white/10 dark:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="pt-4">
                <p className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary" /> {greeting}
                </p>
                <p className="mt-1 text-center text-2xl font-black tracking-tight">How can I help?</p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {starters.map(({ icon: Icon, color, text: t }) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => void send(t)}
                      className="flex h-28 flex-col justify-between rounded-3xl border border-white/90 bg-white/65 p-4 text-left backdrop-blur transition hover:bg-white/90 dark:border-white/10 dark:bg-white/10"
                    >
                      <Icon className="h-6 w-6" style={{ color }} />
                      <span className="text-sm font-bold leading-snug" style={{ color }}>{t}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
                  I can check your orders, payouts and store settings — a person from our team can join any chat.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] whitespace-pre-wrap rounded-[20px] px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.sender === "user"
                        ? "ml-auto rounded-br-md bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] text-white"
                        : "rounded-bl-md border border-white/90 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-white/10"
                    }`}
                  >
                    {m.sender === "admin" && <p className="mb-0.5 text-[11px] font-bold text-amber-600">{m.senderName || "Kada Support"}</p>}
                    {m.text}
                  </div>
                ))}
                {awaitingReply && (
                  <div className="inline-flex gap-1 rounded-[20px] rounded-bl-md border border-white/90 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/10">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                  </div>
                )}
                {!awaitingReply && lastBot && lastBot === messages[messages.length - 1] && lastBot.actions.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {lastBot.actions.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => void send(a)}
                        className="rounded-full border border-white/90 bg-white/70 px-3 py-1.5 text-xs font-semibold text-primary backdrop-blur hover:bg-white dark:border-white/10 dark:bg-white/10"
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="flex items-center gap-2 px-3 pb-3 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ask anything…"
              className="h-12 flex-1 rounded-full border border-white/90 bg-white/75 px-5 text-sm outline-none backdrop-blur focus:border-primary dark:border-white/10 dark:bg-white/10"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              aria-label="Send"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] text-white shadow-lg disabled:opacity-50"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </form>
          {failed && <p className="px-4 pb-3 text-xs font-medium text-red-600">Message didn't send — check your connection and try again.</p>}
        </div>
      )}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] text-white shadow-xl transition hover:scale-105 active:scale-95"
          aria-label="Open Kada Assist"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}
    </>
  );
}
