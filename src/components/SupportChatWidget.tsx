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
import { MessageCircle, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/lib/firebase";

interface ChatMessage {
  id: string;
  text: string;
  sender: string;
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

  async function send() {
    const trimmed = text.trim();
    if (!user || !trimmed || sending) return;
    setSending(true);
    setText("");
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
      setText(trimmed);
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 z-50 flex h-[440px] w-[min(100vw-2rem,380px)] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
          <div className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
            <div>
              <p className="text-sm font-black">Kada Assist</p>
              <p className="text-[11px] font-semibold opacity-80">Orders, payouts, and the dashboard</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">Ask about an order, a payout, or the dashboard.</p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm font-medium ${
                  m.sender === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {m.text}
              </div>
            ))}
            {awaitingReply && (
              <p className="text-xs font-semibold text-muted-foreground animate-pulse">Kada Assist is replying…</p>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message Kada Assist"
              className="flex-1 rounded-xl border bg-background px-3 py-2 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              Send
            </button>
          </form>
          {failed && (
            <p className="px-3 pb-2 text-xs font-semibold text-destructive">Message didn't send — check your connection and try again.</p>
          )}
        </div>
      )}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl"
          aria-label="Open Kada Assist"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}
    </>
  );
}
