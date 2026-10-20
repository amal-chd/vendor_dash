import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  BarChart3,
  BookOpen,
  Bell,
  Bike,
  Building2,
  Hotel,
  CalendarClock,
  CreditCard,
  Download,
  DownloadCloud,
  FileCheck2,
  Headset,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  PackageSearch,
  PlusCircle,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Store,
  Ticket,
  User,
  Users,
  ShoppingBag,
} from "lucide-react";

/**
 * Universal admin search (⌘K) — one box that finds *everything*:
 * every admin page, quick actions, and live platform entities (restaurants,
 * customers, riders, recent orders, coupons). Entity results deep-link into
 * the target list pre-filtered via `?search=` (handled by DataTable / pages).
 *
 * Entities load once per palette session (parallel, capped reads) and are
 * filtered client-side; result groups render only while the operator is
 * actually typing, so the list stays fast with thousands of records loaded.
 */

interface EntityHit {
  id: string;
  /** Primary display line. */
  title: string;
  /** Secondary muted line (email / phone / status). */
  sub?: string;
  /** String cmdk matches against (title + sub + extra keywords). */
  haystack: string;
  /** Where selecting this result navigates. */
  target: string;
}

interface EntityIndex {
  restaurants: EntityHit[];
  customers: EntityHit[];
  riders: EntityHit[];
  orders: EntityHit[];
  promos: EntityHit[];
  properties: EntityHit[];
  hosts: EntityHit[];
  tickets: EntityHit[];
  incidents: EntityHit[];
  payments: EntityHit[];
}

const EMPTY_INDEX: EntityIndex = {
  restaurants: [],
  customers: [],
  riders: [],
  orders: [],
  promos: [],
  properties: [],
  hosts: [],
  tickets: [],
  incidents: [],
  payments: [],
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

async function loadIndex(): Promise<EntityIndex> {
  const [
    restSnap, custSnap, riderSnap, orderSnap, promoSnap,
    propSnap, hostSnap, ticketSnap, incSnap, txnSnap, contactSnap
  ] = await Promise.all([
    getDocs(query(collection(db, "restaurants"), limit(500))),
    getDocs(query(collection(db, "customer_users"), limit(500))),
    getDocs(query(collection(db, "delivery_users"), limit(500))),
    getDocs(query(collection(db, "orders"), orderBy("timestamp", "desc"), limit(200))),
    getDocs(query(collection(db, "promos"), limit(200))),
    getDocs(query(collection(db, "stay_properties"), limit(200))),
    getDocs(query(collection(db, "stay_hosts"), limit(200))),
    getDocs(query(collection(db, "support_threads"), orderBy("lastUpdatedAt", "desc"), limit(200))),
    getDocs(query(collection(db, "incidents"), orderBy("createdAt", "desc"), limit(100))),
    getDocs(query(collection(db, "transactions"), orderBy("created_at", "desc"), limit(200))).catch(() => null),
    // Vendor login emails moved off the public restaurants doc. Optional, so
    // a role that can't read it still gets the rest of the index.
    getDocs(query(collection(db, "partner_contact"), where("role", "==", "vendor"), limit(2000))).catch(() => null),
  ]);

  const vendorEmails = new Map<string, string>();
  contactSnap?.docs.forEach((d) => {
    const c = d.data();
    const email = str(c.email) || str(c.outletEmail) || str(c.ownerEmail);
    if (email) vendorEmails.set(str(c.partnerId), email);
  });

  const restaurants: EntityHit[] = restSnap.docs
    .filter((d) => !d.data().isDeleted)
    .map((d) => {
      const name = str(d.data().name) || "Unknown restaurant";
      const email = vendorEmails.get(d.id) || str(d.data().email);
      return {
        id: d.id,
        title: name,
        sub: email || undefined,
        haystack: `${name} ${email}`,
        target: `/admin/vendors/${d.id}`,
      };
    });

  const customers: EntityHit[] = custSnap.docs.map((d) => {
    const name = str(d.data().name) || "Guest";
    const email = str(d.data().email);
    const phone = str(d.data().phone);
    return {
      id: d.id,
      title: name,
      sub: email || phone || undefined,
      haystack: `${name} ${email} ${phone}`,
      target: `/admin/customers/${d.id}`,
    };
  });

  const riders: EntityHit[] = riderSnap.docs.map((d) => {
    const name = str(d.data().name) || "Rider";
    const phone = str(d.data().phone);
    const vehicle = str(d.data().vehicleNumber);
    return {
      id: d.id,
      title: name,
      sub: [phone, vehicle].filter(Boolean).join(" · ") || undefined,
      haystack: `${name} ${phone} ${vehicle}`,
      target: `/admin/delivery/${d.id}`,
    };
  });

  const orders: EntityHit[] = orderSnap.docs.map((d) => {
    const num = str(d.data().orderNumber) || d.id;
    const customer = str(d.data().customerName);
    const restaurant = str(d.data().restaurantName);
    const status = str(d.data().status);
    return {
      id: d.id,
      title: `#${num}`,
      sub: [customer, restaurant, status].filter(Boolean).join(" · ") || undefined,
      haystack: `${num} ${customer} ${restaurant} ${status}`,
      target: `/admin/orders/${d.id}`,
    };
  });

  const promos: EntityHit[] = promoSnap.docs.map((d) => {
    const code = str(d.data().code) || d.id;
    const desc = str(d.data().description);
    return {
      id: d.id,
      title: code,
      sub: desc || undefined,
      haystack: `${code} ${desc}`,
      target: `/admin/growth?tab=promos&search=${encodeURIComponent(code)}`,
    };
  });

  const properties: EntityHit[] = propSnap.docs.map((d) => {
    const name = str(d.data().name) || "Property";
    const city = str(d.data().city);
    return {
      id: d.id,
      title: name,
      sub: city || undefined,
      haystack: `${name} ${city}`,
      target: `/admin/stay/properties/${d.id}`,
    };
  });

  const hosts: EntityHit[] = hostSnap.docs.map((d) => {
    const name = str(d.data().name) || "Host";
    const email = str(d.data().email);
    return {
      id: d.id,
      title: name,
      sub: email || undefined,
      haystack: `${name} ${email}`,
      target: `/admin/stay/hosts/${d.id}`,
    };
  });

  const tickets: EntityHit[] = ticketSnap.docs.map((d) => {
    const num = str(d.data().ticketId) || d.id;
    const subject = str(d.data().subject);
    const status = str(d.data().status);
    return {
      id: d.id,
      title: `#${num}`,
      sub: [subject, status].filter(Boolean).join(" · ") || undefined,
      haystack: `${num} ${subject} ${status}`,
      target: `/admin/support?tab=queue&search=${encodeURIComponent(num)}`,
    };
  });

  const incidents: EntityHit[] = incSnap.docs.map((d) => {
    const num = str(d.data().incidentId) || d.id;
    const title = str(d.data().title);
    return {
      id: d.id,
      title: `#${num}`,
      sub: title || undefined,
      haystack: `${num} ${title}`,
      target: `/admin/orders?tab=incidents&search=${encodeURIComponent(num)}`,
    };
  });

  // Payments are searched by gateway id, order id and contact — the three
  // things a customer or a bank statement actually gives you to go on.
  const payments: EntityHit[] = (txnSnap?.docs ?? []).map((d) => {
    const data = d.data();
    const txn = str(data.transaction_id) || d.id;
    const amount = Number(data.gross_amount) || 0;
    const contact = str(data.contact) || str(data.email);
    const context = str(data.payment_context);
    const kadaOrder = str(data.kada_order_id);
    return {
      id: d.id,
      title: `₹${amount.toLocaleString("en-IN")}`,
      sub: [context, contact, txn].filter(Boolean).join(" · ") || undefined,
      haystack: `${txn} ${kadaOrder} ${contact} ${context} ${amount}`,
      target: kadaOrder
        ? `/admin/orders/${kadaOrder}`
        : `/admin/finance?tab=ledger&search=${encodeURIComponent(txn)}`,
    };
  });

  return {
    restaurants,
    customers,
    riders,
    orders,
    promos,
    properties,
    hosts,
    tickets,
    incidents,
    payments,
  };
}

/** Top-N entity hits containing the query (case-insensitive). */
function match(hits: EntityHit[], q: string, cap = 6): EntityHit[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const out: EntityHit[] = [];
  for (const h of hits) {
    if (h.haystack.toLowerCase().includes(needle)) {
      out.push(h);
      if (out.length >= cap) break;
    }
  }
  return out;
}

const PAGES: { label: string; path: string; icon: typeof LayoutDashboard }[] = [
  { label: "Platform Dashboard", path: "/admin", icon: LayoutDashboard },
  { label: "Platform Orders Hub", path: "/admin/orders", icon: ShoppingBag },
  { label: "Business Analytics", path: "/admin/analytics", icon: BarChart3 },
  { label: "Customer Users", path: "/admin/customers", icon: Smartphone },
  { label: "Coupons & Offers", path: "/admin/growth", icon: Ticket },
  { label: "Ads & Sponsorships", path: "/admin/growth?tab=ads", icon: Megaphone },
  { label: "Live Dispatch", path: "/admin/orders?tab=live", icon: PackageSearch },
  { label: "Push Broadcasts", path: "/admin/growth?tab=notifications", icon: Bell },
  { label: "Partner Restaurants", path: "/admin/vendors", icon: Building2 },
  { label: "Partner Onboarding", path: "/admin/vendors?tab=onboarding", icon: Users },
  { label: "Bank Verification", path: "/admin/quality?tab=bank", icon: FileCheck2 },
  { label: "POS Plans & Billing", path: "/admin/vendors?tab=plans", icon: CreditCard },
  { label: "Rider Fleet & KYC", path: "/admin/delivery", icon: Bike },
  { label: "KadaStay Properties", path: "/admin/stay?tab=properties", icon: Hotel },
  { label: "Platform Settings", path: "/admin/settings", icon: SlidersHorizontal },
  { label: "Support & Tickets", path: "/admin/support", icon: Headset },
  { label: "Live Support Chat", path: "/admin/support?tab=chats", icon: MessageSquare },
  { label: "Support Knowledge Base", path: "/admin/support?tab=knowledge", icon: BookOpen },
  { label: "Support AI Analytics", path: "/admin/support?tab=analytics", icon: BarChart3 },
  { label: "Demo Requests", path: "/admin/support?tab=leads", icon: CalendarClock },
  { label: "Security & Audit", path: "/admin/settings?tab=security", icon: ShieldCheck },
  { label: "Data Exports", path: "/admin/analytics?tab=exports", icon: Download },
  { label: "Settlements & Payouts", path: "/admin/finance?tab=settlements", icon: CreditCard },
  { label: "Refunds Ledger", path: "/admin/finance?tab=refunds", icon: CreditCard },
  { label: "Markets & Cities", path: "/admin/markets?tab=cities", icon: Store },
  { label: "Service Zones", path: "/admin/markets", icon: Store },
  { label: "Surge & Demand Zones", path: "/admin/markets?tab=surge", icon: PackageSearch },
  { label: "Food Reviews", path: "/admin/quality", icon: FileCheck2 },
  { label: "Home Merchandising", path: "/admin/growth?tab=merchandising", icon: Megaphone },
  { label: "Changelog & release notes", path: "/admin/growth?tab=changelog", icon: Megaphone },
  { label: "New changelog update", path: "/admin/growth/changelog/new", icon: Megaphone },
  { label: "App modules (feature flags)", path: "/admin/settings?tab=platform", icon: SlidersHorizontal },
  { label: "App Releases", path: "/admin/settings?tab=releases", icon: Smartphone },
  { label: "Loyalty & Gold", path: "/admin/customers?tab=loyalty", icon: Ticket },
  { label: "Table Reservations", path: "/admin/vendors?tab=reservations", icon: CalendarClock },
  { label: "Incidents", path: "/admin/orders?tab=incidents", icon: ShieldCheck },
  { label: "Catalog Quality", path: "/admin/quality?tab=catalog", icon: Store },
  { label: "Admin Team", path: "/admin/settings?tab=team", icon: Users },
  { label: "Cancellation Reasons", path: "/admin/settings?tab=cancellation", icon: FileCheck2 },
];

interface AdminCommandMenuProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export function AdminCommandMenu({ open, setOpen }: AdminCommandMenuProps) {
  const navigate = useNavigate();
  const [index, setIndex] = useState<EntityIndex>(EMPTY_INDEX);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open || loaded || loading) return;
    setLoading(true);
    loadIndex()
      .then((idx) => {
        setIndex(idx);
        setLoaded(true);
      })
      .catch((error) =>
        console.error("Command palette index load failed", error)
      )
      .finally(() => setLoading(false));
  }, [open, loaded, loading]);

  // Reset the query each time the palette opens fresh.
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  const results = useMemo(
    () => ({
      restaurants: match(index.restaurants, search),
      customers: match(index.customers, search),
      riders: match(index.riders, search),
      orders: match(index.orders, search),
      promos: match(index.promos, search),
      properties: match(index.properties, search),
      hosts: match(index.hosts, search),
      tickets: match(index.tickets, search),
      incidents: match(index.incidents, search),
      payments: match(index.payments, search),
    }),
    [index, search]
  );

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  const entityGroups: {
    heading: string;
    icon: any;
    hits: EntityHit[];
  }[] = [
    { heading: "Restaurants", icon: Store, hits: results.restaurants },
    { heading: "Customers", icon: User, hits: results.customers },
    { heading: "Riders", icon: Bike, hits: results.riders },
    { heading: "Recent Orders", icon: PackageSearch, hits: results.orders },
    { heading: "Coupons", icon: Ticket, hits: results.promos },
    { heading: "Properties", icon: Hotel, hits: results.properties },
    { heading: "Hosts", icon: Users, hits: results.hosts },
    { heading: "Support Tickets", icon: Headset, hits: results.tickets },
    { heading: "Incidents", icon: ShieldCheck, hits: results.incidents },
    { heading: "Payments", icon: CreditCard, hits: results.payments },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search pages, restaurants, customers, riders, orders, coupons…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? "Indexing platform…" : "No results found."}
        </CommandEmpty>

        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem
              key={p.path}
              value={`page ${p.label}`}
              onSelect={() => runCommand(() => navigate(p.path))}
            >
              <p.icon className="mr-2 h-4 w-4" />
              <span>{p.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Actions">
          <CommandItem
            value="action add new tenant restaurant"
            onSelect={() =>
              runCommand(() => navigate("/admin/vendors?tab=directory&action=new"))
            }
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            <span>Add New Tenant</span>
          </CommandItem>
          <CommandItem
            value="action create support ticket"
            onSelect={() => runCommand(() => navigate("/admin/support?tab=queue"))}
          >
            <Headset className="mr-2 h-4 w-4" />
            <span>Create Support Ticket</span>
          </CommandItem>
          <CommandItem
            value="action log major incident"
            onSelect={() => runCommand(() => navigate("/admin/orders?tab=incidents&action=new"))}
          >
            <ShieldCheck className="mr-2 h-4 w-4 text-destructive" />
            <span className="text-destructive font-medium">Log Major Incident</span>
          </CommandItem>
          <CommandItem
            value="action launch ad campaign sponsorship"
            onSelect={() => runCommand(() => navigate("/admin/growth?tab=ads"))}
          >
            <Megaphone className="mr-2 h-4 w-4" />
            <span>Launch Ad Campaign</span>
          </CommandItem>
          <CommandItem
            value="action broadcast push notification"
            onSelect={() =>
              runCommand(() => navigate("/admin/growth?tab=notifications&section=send"))
            }
          >
            <Bell className="mr-2 h-4 w-4" />
            <span>Broadcast Notification</span>
          </CommandItem>
          <CommandItem
            value="action export data csv"
            onSelect={() => runCommand(() => navigate("/admin/analytics?tab=exports"))}
          >
            <DownloadCloud className="mr-2 h-4 w-4" />
            <span>Export Data</span>
          </CommandItem>
        </CommandGroup>

        {entityGroups.map(
          (group) =>
            group.hits.length > 0 && (
              <div key={group.heading}>
                <CommandSeparator />
                <CommandGroup heading={group.heading}>
                  {group.hits.map((hit) => (
                    <CommandItem
                      key={`${group.heading}-${hit.id}`}
                      value={`${group.heading} ${hit.haystack}`}
                      onSelect={() => runCommand(() => navigate(hit.target))}
                    >
                      <group.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{hit.title}</span>
                      {hit.sub && (
                        <span className="ml-2 text-xs text-muted-foreground truncate">
                          {hit.sub}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            )
        )}
      </CommandList>
    </CommandDialog>
  );
}
