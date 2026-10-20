import { useEffect, useMemo, useState } from "react";
import { collectionGroup, limit, onSnapshot, query, updateDoc, doc, serverTimestamp, collection, addDoc } from "firebase/firestore";
import { Star, MessageSquareReply, X } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterChips } from "@/components/admin/FilterChips";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/firebase";
import { adminActionToast } from "@/lib/admin-ops";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { toast } from "sonner";

interface ReviewRow {
  id: string;
  restaurantId: string;
  restaurantName?: string;
  rating?: number;
  text?: string;
  comment?: string;
  customerName?: string;
  moderationStatus?: string;
  hidden?: boolean;
  adminReply?: string;
}

export default function FoodReviewsPage() {
  const restaurants = useLiveCollection<{ id: string; name?: string }>("restaurants", { limit: 800 });
  const names = useMemo(
    () => Object.fromEntries(restaurants.rows.map((r) => [r.id, r.name || r.id])),
    [restaurants.rows],
  );
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const [replyOpen, setReplyOpen] = useState(false);
  const [replyReview, setReplyReview] = useState<ReviewRow | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    return onSnapshot(
      query(collectionGroup(db, "reviews"), limit(400)),
      (snap) => {
        setRows(
          snap.docs
            .filter((d) => d.ref.path.startsWith("restaurants/"))
            .map((d) => ({
              id: d.id,
              restaurantId: d.ref.parent.parent?.id ?? "",
              ...(d.data() as object),
            })) as ReviewRow[],
        );
        setLoading(false);
      },
      (err) => {
        console.error("FoodReviewsPage snapshot error:", err);
        setLoading(false);
        toast.error("Couldn't load reviews — check your connection.");
      },
    );
  }, []);

  const decorated = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        restaurantName: names[r.restaurantId] || r.restaurantName || r.restaurantId,
      })),
    [rows, names],
  );

  const visible = useMemo(() => {
    return decorated.filter((r) => {
      const st = r.hidden ? "hidden" : (r.moderationStatus || "published").toLowerCase();
      if (filter === "all") return true;
      if (filter === "hidden") return r.hidden || st === "hidden";
      if (filter === "flagged") return st === "flagged";
      if (filter === "low") return Number(r.rating) > 0 && Number(r.rating) <= 2;
      return st === "published" || (!r.hidden && st !== "flagged" && st !== "hidden");
    });
  }, [decorated, filter]);

  const handleReplySubmit = async () => {
    if (!replyReview || !replyText.trim()) return;
    setReplying(true);
    try {
      const ref = doc(db, "restaurants", replyReview.restaurantId, "reviews", replyReview.id);
      await updateDoc(ref, {
        adminReply: replyText.trim(),
        adminReplyAt: serverTimestamp(),
      });
      toast.success("Reply posted successfully");
      setReplyOpen(false);
      setReplyText("");
    } catch (e) {
      toast.error("Failed to post reply");
    } finally {
      setReplying(false);
    }
  };

  const columns: ColumnDef<ReviewRow>[] = useMemo(
    () => [
      { accessorKey: "restaurantName", header: "Restaurant" },
      { accessorKey: "customerName", header: "Guest" },
      {
        accessorKey: "rating",
        header: "★",
        cell: ({ row }) => (
          <span className={Number(row.original.rating) <= 2 ? "text-rose-600 font-bold" : ""}>
            {row.original.rating ?? "—"}
          </span>
        ),
      },
      {
        id: "text",
        header: "Review",
        cell: ({ row }) => (
          <div className="max-w-md flex flex-col gap-1 py-1">
            <span className="text-sm line-clamp-2">{row.original.text || row.original.comment || "—"}</span>
            {row.original.adminReply && (
              <div className="bg-muted p-2 rounded-md text-xs border-l-2 border-primary">
                <span className="font-semibold text-primary">Reply: </span>
                <span className="text-muted-foreground">{row.original.adminReply}</span>
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "moderationStatus",
        header: "Moderation",
        cell: ({ row }) => {
          const st = row.original.hidden ? "hidden" : row.original.moderationStatus || "published";
          return <Badge variant={st === "hidden" || st === "flagged" ? "destructive" : "outline"}>{st}</Badge>;
        },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex gap-1 justify-end">
             <Button
               size="sm"
               variant="outline"
               className="h-8"
               onClick={() => {
                 setReplyReview(row.original);
                 setReplyText(row.original.adminReply || "");
                 setReplyOpen(true);
               }}
             >
               <MessageSquareReply className="h-4 w-4 mr-1.5" /> Reply
             </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                const ref = doc(db, "restaurants", row.original.restaurantId, "reviews", row.original.id);
                updateDoc(ref, { moderationStatus: "hidden", hidden: true });
                toast.success("Review hidden");
              }}
            >
              Hide
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                 const ref = doc(db, "restaurants", row.original.restaurantId, "reviews", row.original.id);
                 updateDoc(ref, { moderationStatus: "published", hidden: false });
                 toast.success("Review published");
              }}
            >
              Publish
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-amber-600 hover:text-amber-700"
              onClick={() => {
                 const ref = doc(db, "restaurants", row.original.restaurantId, "reviews", row.original.id);
                 updateDoc(ref, { moderationStatus: "flagged" });
                 toast.success("Review flagged");
              }}
            >
              Flag
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Food reviews"
        description="Moderate restaurant reviews. Hidden reviews drop off guest-facing lists; flagged ones stay visible until you hide them."
        icon={Star}
        stats={[
          { label: "Reviews", value: rows.length, hint: "Latest 400", loading, onClick: () => setFilter("all"), active: filter === "all" },
          { label: "Flagged", value: rows.filter((r) => r.moderationStatus === "flagged").length, hint: "Still visible — decide", tone: "text-amber-600", onClick: () => setFilter("flagged"), active: filter === "flagged" },
          { label: "Low rating", value: rows.filter((r) => Number(r.rating) > 0 && Number(r.rating) <= 2).length, hint: "2★ or below", tone: "text-rose-600", onClick: () => setFilter("low"), active: filter === "low" },
          { label: "Hidden", value: rows.filter((r) => r.hidden || r.moderationStatus === "hidden").length, hint: "Removed from the app", onClick: () => setFilter("hidden"), active: filter === "hidden" },
        ]}
      />
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: "All" },
          { id: "published", label: "Published" },
          { id: "flagged", label: "Flagged" },
          { id: "hidden", label: "Hidden" },
          { id: "low", label: "Low rating" },
        ]}
      />
      <DataTable columns={columns} data={visible} searchPlaceholder="Search restaurant, guest, text…" exportFilename="food-reviews" />
      
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reply to Review</DialogTitle>
            <DialogDescription>
              This reply will be visible to the customer and shown publicly if the review is published.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
             {replyReview && (
               <div className="mb-4 text-sm bg-muted/30 p-3 rounded-lg border border-border">
                 <div className="flex items-center gap-2 mb-1">
                   <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                   <span className="font-bold">{replyReview.rating}</span>
                   <span className="text-muted-foreground">• {replyReview.customerName}</span>
                 </div>
                 <p className="italic text-muted-foreground">"{replyReview.text || replyReview.comment}"</p>
               </div>
             )}
             <Textarea 
               placeholder="Write your response as the restaurant manager..." 
               value={replyText} 
               onChange={(e) => setReplyText(e.target.value)}
               className="min-h-[120px]"
             />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyOpen(false)}>Cancel</Button>
            <Button onClick={handleReplySubmit} disabled={replying || !replyText.trim()}>
              {replying ? "Saving..." : "Post Reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
