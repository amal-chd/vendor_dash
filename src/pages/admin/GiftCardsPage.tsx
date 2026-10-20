import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import { useEffect, useMemo, useState } from "react";
import { Gift, Search, ShieldOff, ShieldCheck, Eye, EyeOff, Copy, Plus, Users, Download, Wallet, CheckCircle2, Ban } from "lucide-react";
import {
  collection, query, limit, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, writeBatch
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CustomerBrandLockup } from "@/components/admin/customer/CustomerBrandLockup";
import { StatCards } from "@/components/admin/StatCards";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface GiftCard {
  id: string;
  code: string;
  pin: string;
  amount: number;
  theme: string;
  message?: string;
  purchaserUid: string;
  purchaserName?: string;
  status: "active" | "redeemed" | "void" | "expired";
  createdAt?: { toDate?: () => Date };
  redeemedAt?: { toDate?: () => Date };
  redeemedByUid?: string | null;
}

const THEME_LABELS: Record<string, string> = {
  kada: "The Kada",
  birthday: "Birthday",
  thankyou: "Thank you",
  anniversary: "Anniversary",
  congrats: "Congrats",
};

const groupCode = (code: string) => code.replace(/(\d{4})(?=\d)/g, "$1 ");
const fmtDate = (t?: { toDate?: () => Date }) =>
  t?.toDate ? t.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function GiftCardsPage() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  
  // Single Issue State
  const [issueAmount, setIssueAmount] = useState(500);
  const [issuing, setIssuing] = useState(false);

  // Bulk Issue State
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkQty, setBulkQty] = useState(10);
  const [bulkValue, setBulkValue] = useState(1000);
  const [bulkTheme, setBulkTheme] = useState("kada");
  const [bulkPurchaser, setBulkPurchaser] = useState("Corporate Client");
  const [bulkMessage, setBulkMessage] = useState("A gift from our team!");

  const issueCard = async () => {
    const amount = Number(issueAmount);
    if (!amount || amount < 50) {
      toast.error("Minimum ₹50");
      return;
    }
    setIssuing(true);
    try {
      const code = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join("");
      const pin = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join("");
      await addDoc(collection(db, "gift_cards"), {
        code,
        pin,
        amount,
        theme: "kada",
        status: "active",
        purchaserUid: "platform_admin",
        purchaserName: "Kada Admin",
        message: "Issued from admin console",
        createdAt: serverTimestamp(),
      });
      toast.success(`Issued ₹${amount} card`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Issue failed");
    } finally {
      setIssuing(false);
    }
  };

  const handleBulkIssue = async () => {
    if (bulkQty < 1 || bulkQty > 500) return toast.error("Quantity must be 1-500");
    if (bulkValue < 50) return toast.error("Minimum value ₹50");
    setIssuing(true);
    
    try {
      const batch = writeBatch(db);
      const generatedCards = [];

      for (let i = 0; i < bulkQty; i++) {
        const code = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join("");
        const pin = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join("");
        const docRef = doc(collection(db, "gift_cards"));
        
        const cardData = {
          code,
          pin,
          amount: bulkValue,
          theme: bulkTheme,
          status: "active",
          purchaserUid: "platform_b2b",
          purchaserName: bulkPurchaser || "Kada Corporate",
          message: bulkMessage || "",
          createdAt: serverTimestamp(),
        };

        batch.set(docRef, cardData);
        generatedCards.push(cardData);
      }

      await batch.commit();

      // Generate CSV
      const headers = ["Code", "PIN", "Value (INR)", "Theme", "Purchaser"];
      const rows = generatedCards.map(c => 
        [c.code, c.pin, c.amount, THEME_LABELS[c.theme] || c.theme, `"${c.purchaserName}"`].join(",")
      );
      const csv = [headers.join(","), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `b2b_gift_cards_${bulkPurchaser.replace(/\s+/g, '_')}_${bulkQty}.csv`;
      link.click();

      toast.success(`Successfully generated ${bulkQty} gift cards and downloaded CSV`);
      setBulkOpen(false);
    } catch (error) {
      toast.error("Failed to generate bulk cards");
      console.error(error);
    } finally {
      setIssuing(false);
    }
  };

  const exportFilteredCards = () => {
    const toExport = filtered.filter(c => c.status === "active");
    if (!toExport.length) return toast.error("No active cards in current filter to export");
    
    const headers = ["Code", "PIN", "Value (INR)", "Theme", "Purchaser", "Issued Date"];
    const rows = toExport.map(c => 
      [c.code, c.pin, c.amount, THEME_LABELS[c.theme] || c.theme, `"${c.purchaserName || ""}"`, fmtDate(c.createdAt)].join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `active_gift_cards_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  useEffect(() => {
    const q = query(collection(db, "gift_cards"), limit(500));
    return onSnapshot(
      q,
      (snap) => {
        setCards(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as GiftCard[]);
        setLoading(false);
      },
      (err) => {
        console.error("gift_cards snapshot error:", err);
        setLoading(false);
      }
    );
  }, []);

  const stats = useMemo(() => {
    const sum = (list: GiftCard[]) => list.reduce((t, c) => t + (c.amount || 0), 0);
    const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
    const active = cards.filter((c) => c.status === "active");
    const redeemed = cards.filter((c) => c.status === "redeemed");
    const dead = cards.filter((c) => c.status === "void" || c.status === "expired");
    return { total: cards.length, totalValue: inr(sum(cards)), active: active.length, outstanding: inr(sum(active)), redeemed: redeemed.length, redeemedValue: inr(sum(redeemed)), dead: dead.length };
  }, [cards]);

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      const matchesFilter = filter === "all" || c.status === filter;
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        c.code?.includes(q.replace(/\D/g, "")) ||
        (c.purchaserName || "").toLowerCase().includes(q) ||
        String(c.amount).includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [cards, filter, search]);

  const setStatus = async (card: GiftCard, status: GiftCard["status"]) => {
    try {
      await updateDoc(doc(db, "gift_cards", card.id), { status });
      toast.success(`Card ••${card.code.slice(-4)} marked ${status}`);
    } catch (e) {
      console.error(e);
      toast.error("Update failed");
    }
  };

  const statusBadge = (status: GiftCard["status"]) => {
    const map: Record<string, string> = {
      active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      redeemed: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      void: "bg-destructive/10 text-destructive border-destructive/20",
      expired: "bg-muted text-muted-foreground border-border/40",
    };
    return (
      <Badge className={cn("border rounded-lg h-6 px-2.5 text-[10px] font-bold uppercase tracking-wider", map[status])}>
        {status}
      </Badge>
    );
  };

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mt-2">
        <CustomerBrandLockup
          title="Gift cards"
          subtitle="Issue cards, run B2B bulk orders and track what is still owed."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            placeholder="Amount"
            className="w-24 h-10 rounded-xl"
            value={issueAmount}
            onChange={(e) => setIssueAmount(Number(e.target.value))}
          />
          <Button className="h-10 rounded-xl" disabled={issuing} onClick={issueCard}>
            <Plus className="w-4 h-4 mr-1" /> Issue
          </Button>
          
          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" className="h-10 rounded-xl bg-primary/10 text-primary hover:bg-primary/20">
                <Users className="w-4 h-4 mr-2" /> B2B Bulk Issue
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Corporate Bulk Issuance</DialogTitle>
                <DialogDescription>
                  Generate up to 500 gift cards at once. A CSV containing the codes and PINs will be downloaded automatically upon creation.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Quantity (Max 500)</Label>
                    <Input type="number" value={bulkQty} onChange={(e) => setBulkQty(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Value per Card (₹)</Label>
                    <Input type="number" value={bulkValue} onChange={(e) => setBulkValue(Number(e.target.value))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Purchaser / Corporate Client</Label>
                  <Input placeholder="e.g. Acme Corp" value={bulkPurchaser} onChange={(e) => setBulkPurchaser(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Theme</Label>
                  <Select value={bulkTheme} onValueChange={setBulkTheme}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(THEME_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Custom Message</Label>
                  <Input placeholder="Optional message..." value={bulkMessage} onChange={(e) => setBulkMessage(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
                <Button onClick={handleBulkIssue} disabled={issuing}>
                  {issuing ? "Generating..." : "Generate & Download CSV"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search code, purchaser…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 bg-card border-border/40 rounded-xl text-sm"
            />
          </div>
        </div>
      </div>

      <StatCards
        items={[
          { label: "Cards issued", value: stats.total, hint: `${stats.totalValue} face value`, icon: Gift, onClick: () => setFilter("all"), active: filter === "all" },
          { label: "Outstanding", value: stats.outstanding, hint: `${stats.active} unredeemed · owed to holders`, icon: Wallet, tone: "text-amber-600", onClick: () => setFilter("active"), active: filter === "active" },
          { label: "Redeemed", value: stats.redeemedValue, hint: `${stats.redeemed} cards`, icon: CheckCircle2, tone: "text-emerald-600", onClick: () => setFilter("redeemed"), active: filter === "redeemed" },
          { label: "Voided / expired", value: stats.dead, icon: Ban, tone: "text-rose-600", onClick: () => setFilter("void"), active: filter === "void" || filter === "expired" },
        ]}
      />

      <div className="flex items-center justify-between overflow-x-auto pb-1 gap-4">
        <div className="flex items-center gap-2">
          {["all", "active", "redeemed", "void", "expired"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border whitespace-nowrap transition-all",
                filter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border/40 hover:border-primary/50"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={exportFilteredCards} className="rounded-xl h-9 whitespace-nowrap">
          <Download className="w-4 h-4 mr-2" /> Export Active CSV
        </Button>
      </div>

      <div className="space-y-3">
        {loading && (
          <div className="py-20 text-center text-sm text-muted-foreground">Loading gift cards…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="py-20 text-center space-y-2 opacity-60">
            <Gift className="w-12 h-12 mx-auto text-muted-foreground" />
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">No gift cards found</p>
          </div>
        )}
        {filtered.map((c) => {
          const shown = revealed[c.id];
          return (
            <div
              key={c.id}
              className="bg-card border border-border/40 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                  <Gift className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-foreground text-base">₹{(c.amount || 0).toLocaleString("en-IN")}</span>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {THEME_LABELS[c.theme] || c.theme}
                    </span>
                    {statusBadge(c.status)}
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono font-semibold text-muted-foreground">
                    <span>{shown ? groupCode(c.code || "") : `•••• •••• •••• ${(c.code || "").slice(-4)}`}</span>
                    {shown && <span className="text-amber-600">PIN {c.pin}</span>}
                    <button
                      onClick={() => setRevealed((r) => ({ ...r, [c.id]: !shown }))}
                      className="hover:text-foreground transition-colors"
                      title={shown ? "Hide" : "Reveal for support"}
                    >
                      {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    {shown && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`Code: ${c.code} PIN: ${c.pin}`);
                          toast.success("Code + PIN copied");
                        }}
                        className="hover:text-foreground transition-colors"
                        title="Copy"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    By {c.purchaserName || c.purchaserUid?.slice(0, 8)} · Issued {fmtDate(c.createdAt)}
                    {c.status === "redeemed" && ` · Redeemed ${fmtDate(c.redeemedAt)}`}
                    {c.message ? ` · “${c.message}”` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                {c.status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl text-xs font-bold h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: `Void card ending ${c.code.slice(-4)}?`,
                          description: "It can no longer be claimed. This can't be undone.",
                          confirmLabel: "Void card",
                          destructive: true,
                        })
                      ) {
                        setStatus(c, "void");
                      }
                    }}
                  >
                    <ShieldOff className="w-3.5 h-3.5 mr-1.5" /> Void
                  </Button>
                )}
                {c.status === "void" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl text-xs font-bold h-9 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                    onClick={() => setStatus(c, "active")}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Reactivate
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
