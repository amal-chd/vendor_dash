import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { httpsCallable } from "firebase/functions";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { functions } from "@/lib/firebase";

type Product = "taskpilot" | "sellix";
type Metric = { collection: string; label: string };
const METRICS: Record<Product, Metric[]> = {
  taskpilot: [
    { collection: "organizations", label: "Companies" },
    { collection: "plans", label: "Plans" },
    { collection: "support_tickets", label: "Support tickets" },
  ],
  sellix: [
    { collection: "stores", label: "Stores" },
    { collection: "categories", label: "Categories" },
    { collection: "reviews", label: "Reviews" },
  ],
};
const bridgeCount = httpsCallable<{
  product: Product;
  op: "count";
  collection: string;
}, { count: number }>(functions, "verseProductBridge", { timeout: 15_000 });
const countFormat = new Intl.NumberFormat();

function connectionMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "functions/permission-denied" || code === "functions/unauthenticated") return "Kada could not authorize this connection.";
  if (code === "functions/failed-precondition") return "This product connection requires server configuration.";
  if (code === "functions/not-found") return "The product connection is unavailable in this environment.";
  return "Kada could not load the product totals.";
}

export default function ProductDataPanel({ product }: { product: Product }) {
  const [requested, setRequested] = useState(false);
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["admin-product-totals", user?.uid, product],
    queryFn: async () => Promise.allSettled(METRICS[product].map(async ({ collection, label }) => {
      const { data } = await bridgeCount({ product, op: "count", collection });
      if (!Number.isSafeInteger(data?.count) || data.count < 0) throw new Error("Invalid product total.");
      return { label, count: data.count };
    })),
    enabled: Boolean(user && requested),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const refresh = () => {
    if (!requested) setRequested(true);
    else void query.refetch();
  };

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-labelledby="product-data-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="product-data-heading" className="font-semibold">Product totals</h2>
          <p className="mt-1 text-sm text-muted-foreground">Read-only counts from the product. Open its console to manage records.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={!user || query.isFetching}>
          {query.isFetching ? "Loading totals…" : requested ? "Refresh totals" : "Load product totals"}
        </Button>
      </div>
      {requested && <div aria-live="polite">
        {query.isFetching && <p className="text-sm text-muted-foreground">Requesting live product counts…</p>}
        {query.isSuccess && !query.isFetching && (
          <dl className="grid gap-2 sm:grid-cols-3">
            {query.data.map((result, index) => (
              <div key={METRICS[product][index].collection} className="rounded-lg border p-3">
                <dt className="text-sm text-muted-foreground">{METRICS[product][index].label}</dt>
                {result.status === "fulfilled"
                  ? <dd className="mt-1 text-2xl font-semibold tabular-nums">{countFormat.format(result.value.count)}</dd>
                  : <dd className="mt-1 text-sm">{connectionMessage(result.reason)}</dd>}
              </div>
            ))}
          </dl>
        )}
      </div>}
    </section>
  );
}
