import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Eye, EyeOff, Star } from "lucide-react";
import { toast } from "sonner";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtTs, kitchenName, messAction, type MessKitchen, type MessReview } from "./messAdmin";

/**
 * Every subscriber review, for moderation and for spotting kitchens in
 * trouble early. Hiding a review removes it from the kitchen's public page and
 * from its rating (onMessReviewWritten recomputes), and the reason is shown to
 * the kitchen — moderation is never silent.
 */
export default function MessReviews() {
  const reviews = useLiveCollection<MessReview>("mess_reviews", { orderByField: "createdAt", limit: 2000 });
  const kitchens = useLiveCollection<MessKitchen>("mess_kitchens", { orderByField: "createdAt" });
  const [tab, setTab] = useState("all");

  const nameOf = useMemo(() => {
    const m = new Map(kitchens.rows.map((k) => [k.id, kitchenName(k)]));
    return (id?: string) => (id ? m.get(id) ?? id : "—");
  }, [kitchens.rows]);

  const rows = reviews.rows.filter((r) =>
    tab === "low" ? (r.rating ?? 0) <= 2 && !r.hidden : tab === "hidden" ? r.hidden : tab === "unanswered" ? !r.reply && !r.hidden : true,
  );
  const visible = reviews.rows.filter((r) => !r.hidden);
  const avg = visible.length ? visible.reduce((t, r) => t + (r.rating ?? 0), 0) / visible.length : 0;
  const low = visible.filter((r) => (r.rating ?? 0) <= 2).length;
  const answered = visible.filter((r) => r.reply).length;

  const toggle = async (r: MessReview) => {
    const reason = r.hidden ? "" : window.prompt("Why hide this review? The kitchen sees this reason.") ?? "";
    if (!r.hidden && !reason.trim()) return;
    try {
      await messAction("hideReview", { reviewId: r.id, hidden: !r.hidden, reason: reason.trim() });
      toast.success(r.hidden ? "Review visible again" : "Review hidden");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the review");
    }
  };

  const columns: ColumnDef<MessReview>[] = [
    {
      id: "who",
      header: "Review",
      accessorFn: (r) => `${r.customerName ?? ""} ${r.text ?? ""} ${nameOf(r.kitchenId)}`,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="min-w-0 max-w-[520px] space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{r.customerName || "Subscriber"}</span>
              <span className="text-amber-500 tracking-tight">{"★".repeat(r.rating ?? 0)}<span className="text-muted-foreground/40">{"★".repeat(5 - (r.rating ?? 0))}</span></span>
              {r.hidden && <Badge variant="outline">hidden</Badge>}
            </div>
            {r.tags?.length ? <div className="flex flex-wrap gap-1">{r.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div> : null}
            {r.text && <p className="text-sm whitespace-pre-wrap">{r.text}</p>}
            {r.reply && <p className="text-xs text-muted-foreground">Kitchen: {r.reply}</p>}
            {r.hidden && r.hiddenReason && <p className="text-xs text-rose-600">Hidden: {r.hiddenReason}</p>}
          </div>
        );
      },
    },
    { id: "kitchen", header: "Kitchen", accessorFn: (r) => nameOf(r.kitchenId) },
    { id: "when", header: "When", cell: ({ row }) => <span className="text-xs whitespace-nowrap">{fmtTs(row.original.createdAt)}</span> },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button size="sm" variant="ghost" onClick={() => toggle(row.original)}>
          {row.original.hidden ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
          {row.original.hidden ? "Show" : "Hide"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Mess reviews"
        description="What subscribers say about each kitchen. Low ratings are the earliest warning that a kitchen is slipping."
        icon={Star}
        stats={[
          { label: "Average rating", value: visible.length ? avg.toFixed(2) : "—", hint: `${visible.length} visible reviews` },
          { label: "1–2 stars", value: low, tone: low ? "text-rose-600" : undefined, onClick: () => setTab("low"), active: tab === "low" },
          { label: "Kitchen replied", value: visible.length ? `${Math.round((answered / visible.length) * 100)}%` : "—", onClick: () => setTab("unanswered") },
          { label: "Hidden", value: reviews.rows.length - visible.length, onClick: () => setTab("hidden"), active: tab === "hidden" },
        ]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All ({reviews.rows.length})</TabsTrigger>
          <TabsTrigger value="low">Low ratings</TabsTrigger>
          <TabsTrigger value="unanswered">Unanswered</TabsTrigger>
          <TabsTrigger value="hidden">Hidden</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable columns={columns} data={rows} searchKey="who" searchPlaceholder="Search reviews, names, kitchens…" exportFilename="mess-reviews" />
    </div>
  );
}
