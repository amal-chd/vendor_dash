import React, { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { collection, onSnapshot, query, orderBy, getCountFromServer, getDocs, limit as fsLimit, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Users, Plus, RefreshCw, Send } from "lucide-react";

interface Segment {
  id: string;
  name: string;
  description: string;
  entityType: "customer" | "vendor" | "rider" | "host";
  estimatedCount: number;
  lastEvaluated?: any;
  isCustom?: boolean;
}

const BUILT_IN_SEGMENTS: Segment[] = [
  {
    id: "c-all",
    name: "All Customers",
    description: "Every registered customer",
    entityType: "customer",
    estimatedCount: 0,
  },
  {
    id: "c-active",
    name: "Active Customers",
    description: "Ordered in last 30 days",
    entityType: "customer",
    estimatedCount: 0,
  },
  {
    id: "v-all",
    name: "All Vendors",
    description: "Every registered vendor",
    entityType: "vendor",
    estimatedCount: 0,
  },
  {
    id: "v-active",
    name: "Active Vendors",
    description: "Accepting orders right now",
    entityType: "vendor",
    estimatedCount: 0,
  },
  {
    id: "r-all",
    name: "All Riders",
    description: "Every registered rider",
    entityType: "rider",
    estimatedCount: 0,
  },
  {
    id: "r-online",
    name: "Online Riders",
    description: "Currently online & available",
    entityType: "rider",
    estimatedCount: 0,
  },
  {
    id: "c-new",
    name: "New Signups",
    description: "Joined in the last 7 days",
    entityType: "customer",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "c-high-value",
    name: "VIP / Whales",
    description: "Lifetime value > ₹50,000",
    entityType: "customer",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "c-churn-risk",
    name: "Churn Risk",
    description: "No orders in the last 60 days",
    entityType: "customer",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "c-discount",
    name: "Promo Seekers",
    description: "Frequently use discount codes",
    entityType: "customer",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "c-veg",
    name: "Pure Veg Diners",
    description: "Only order from vegetarian restaurants",
    entityType: "customer",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "c-midnight",
    name: "Midnight Cravers",
    description: "Orders primarily between 11 PM - 3 AM",
    entityType: "customer",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "c-stay",
    name: "KadaStay Guests",
    description: "Customers who have booked a stay",
    entityType: "customer",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "v-top-rated",
    name: "Top Rated Vendors",
    description: "Average rating > 4.5 stars",
    entityType: "vendor",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "v-struggling",
    name: "Struggling Vendors",
    description: "Average rating < 3.5 stars",
    entityType: "vendor",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "v-high-volume",
    name: "High Volume Vendors",
    description: "> 100 orders per week",
    entityType: "vendor",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "r-ev",
    name: "EV Fleet",
    description: "Riders using Electric Vehicles",
    entityType: "rider",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "r-top",
    name: "Top Performers",
    description: "Rating > 4.8 with 100+ deliveries",
    entityType: "rider",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "r-inactive",
    name: "Inactive Riders",
    description: "No deliveries in 30 days",
    entityType: "rider",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "h-all",
    name: "All Hosts",
    description: "Every registered KadaStay host",
    entityType: "host",
    estimatedCount: 0,
  },
  {
    id: "h-super",
    name: "Super Hosts",
    description: "Rating > 4.8 and high response rate",
    entityType: "host",
    estimatedCount: 0,
    isCustom: true,
  },
  {
    id: "h-low-occ",
    name: "Low Occupancy Hosts",
    description: "< 30% occupancy this month",
    entityType: "host",
    estimatedCount: 0,
    isCustom: true,
  },
];

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>(BUILT_IN_SEGMENTS);
  const [countsNonce, setCountsNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  // Customers grouped by the locality captured at signup, so a campaign can
  // go to one area (a new kitchen in Kakkanad) instead of the whole city.
  const [areaSegments, setAreaSegments] = useState<Segment[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "customer_users"), fsLimit(1000)),
        );
        if (cancelled) return;
        const counts = new Map<string, number>();
        snap.docs.forEach((d) => {
          const v = d.data() as Record<string, any>;
          const direct = String(v.primaryArea ?? "").trim();
          const fromAddr = Array.isArray(v.addresses)
            ? String(v.addresses.find((a: any) => a?.area)?.area ?? "").trim()
            : "";
          const area = direct || fromAddr;
          if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
        });
        setAreaSegments(
          Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([area, count]) => ({
              id: `c-area-${area.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
              name: area,
              description: `Customers whose delivery area is ${area}`,
              entityType: "customer" as const,
              estimatedCount: count,
              isCustom: true,
            })),
        );
      } catch {
        /* locality grouping is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    (async () => {
      try {
        const [customers, vendors, riders, activeVendors] = await Promise.all([
          getCountFromServer(collection(db, "customer_users")),
          getCountFromServer(collection(db, "restaurants")),
          getCountFromServer(collection(db, "delivery_users")),
          getCountFromServer(
            query(collection(db, "restaurants"), where("acceptingOrders", "==", true)),
          ).catch(() => null),
        ]);
        if (cancelled) return;
        setSegments((prev) =>
          prev.map((s) => {
            if (s.id === "c-all") return { ...s, estimatedCount: customers.data().count };
            if (s.id === "v-all") return { ...s, estimatedCount: vendors.data().count };
            if (s.id === "r-all") return { ...s, estimatedCount: riders.data().count };
            if (s.id === "v-active")
              return { ...s, estimatedCount: activeVendors?.data().count ?? 0 };
            return s;
          }),
        );
      } catch (err) {
        console.error("[SegmentsPage] segment counts failed", err);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // countsNonce lets the refresh button re-run exactly this count.
  }, [countsNonce]);

  useEffect(() => {
    const q = query(
      collection(db, "notification_segments"),
      orderBy("createdAt", "desc"),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const customSegments = snapshot.docs.map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
              isCustom: true,
            }) as Segment,
        );
        setSegments([...BUILT_IN_SEGMENTS, ...areaSegments, ...customSegments]);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        toast.error("Failed to load custom segments");
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [areaSegments]);

  const renderSegments = (type: string) => {
    const filtered = segments.filter((s) => s.entityType === type);

    if (loading)
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      );

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((segment) => (
          <Card key={segment.id} className="relative overflow-hidden group">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <CardTitle className="text-lg">{segment.name}</CardTitle>
                {segment.isCustom && <Badge variant="outline">Custom</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {segment.description}
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between items-end mt-4">
                <div>
                  <p className="text-2xl font-bold">
                    {segment.estimatedCount.toLocaleString("en-IN")}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> Estimated Audience
                  </p>
                </div>
                <div className="flex gap-2">
                  {/* This used to toast "Count refreshed!" without recounting
                      anything. It now re-runs the same server-side counts the
                      page loads with. The "Use" button opened nothing and is
                      gone — campaigns are built in the Campaigns tab. */}
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    disabled={refreshing}
                    title="Recount this segment"
                    onClick={() => setCountsNonce((n) => n + 1)}
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* The create-segment card opened nothing. Custom segments are created
            in the Campaigns tab's audience builder, which writes the same
            crm_segments documents this page reads. */}
        <Card
          className="flex flex-col items-center justify-center p-6 border-dashed opacity-60"
        >
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Plus className="h-5 w-5 text-primary" />
          </div>
          <h3 className="font-medium">Create Custom Segment</h3>
          <p className="text-xs text-muted-foreground mt-1 text-center">
            Build a specific audience based on custom rules
          </p>
        </Card>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="Audience Segments"
        description="Define and manage target audiences for your campaigns."
      />

      <Tabs defaultValue="customer" className="space-y-6">
        <TabsList>
          <TabsTrigger value="customer">Customers</TabsTrigger>
          <TabsTrigger value="vendor">Vendors</TabsTrigger>
          <TabsTrigger value="rider">Riders</TabsTrigger>
          <TabsTrigger value="host">Hosts</TabsTrigger>
        </TabsList>
        <TabsContent value="customer">{renderSegments("customer")}</TabsContent>
        <TabsContent value="vendor">{renderSegments("vendor")}</TabsContent>
        <TabsContent value="rider">{renderSegments("rider")}</TabsContent>
        <TabsContent value="host">{renderSegments("host")}</TabsContent>
      </Tabs>
    </div>
  );
}
