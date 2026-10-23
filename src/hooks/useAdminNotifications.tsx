import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { collection, onSnapshot, query, where, limit, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { OPS_QUEUE_STATES } from "@/lib/onboarding";
import { useAuth } from "./useAuth";
import { usePermissions } from "./usePermissions";
import { roleCan } from "@/lib/rbac";
import { toast } from "sonner";
import { categorizeAdminNotification } from "@/lib/adminAlertCategory";
import type {
  AdminAlert,
  NotificationSummary,
  WorkspaceAlertCounts,
  AdminItemCounts,
} from "@/types/adminNotifications";

const SOUND_STORAGE_KEY = "kada_admin_sound_enabled";
const READ_STORAGE_KEY = "kada_admin_read_alert_ids";

function playSynthesizedChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    // Harmonic pleasant two-tone chime: D5 -> A5
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Autoplay restrictions before user interaction
  }
}

export interface AdminNotificationsContextValue {
  alerts: AdminAlert[];
  summary: NotificationSummary;
  counts: AdminItemCounts;
  soundEnabled: boolean;
  toggleSound: () => void;
  readIds: Set<string>;
  markAsRead: (id: string) => void;
  markAllAsRead: (alertsToMark: AdminAlert[]) => void;
}

const defaultSummary: NotificationSummary = {
  total: 0,
  unread: 0,
  critical: 0,
  warning: 0,
  info: 0,
  workspaces: {
    orders: 0,
    vendors: 0,
    delivery: 0,
    finance: 0,
    stay: 0,
    support: 0,
    quality: 0,
  },
};

const defaultCounts: AdminItemCounts = {
  escalatedChats: 0,
  pendingSettlements: 0,
  settlementAmount: 0,
  pendingRefunds: 0,
  openIncidents: 0,
  delayedDeliveries: 0,
  paymentFailures: 0,
  vendorOnboarding: 0,
  riderOnboarding: 0,
  hostOnboarding: 0,
  bankActionCount: 0,
};

const AdminNotificationsContext = createContext<AdminNotificationsContextValue>({
  alerts: [],
  summary: defaultSummary,
  counts: defaultCounts,
  soundEnabled: true,
  toggleSound: () => {},
  readIds: new Set(),
  markAsRead: () => {},
  markAllAsRead: () => {},
});

function useAdminNotificationsInternal(): AdminNotificationsContextValue {
  const { user } = useAuth();
  const { role } = usePermissions();
  const seeFinance = !!role && roleCan(role, "view_financial");

  // Raw domain states
  const [escalatedChats, setEscalatedChats] = useState(0);
  const [settlementInfo, setSettlementInfo] = useState({ count: 0, amount: 0 });
  const [pendingRefunds, setPendingRefunds] = useState<AdminAlert[]>([]);
  const [openIncidents, setOpenIncidents] = useState<AdminAlert[]>([]);
  // Server-raised alerts (admin_notifications): Assist escalations + SLA
  // breaches, unverified stay payments, failed refunds, COD excess, …
  const [serverAlerts, setServerAlerts] = useState<AdminAlert[]>([]);
  const [delayedDeliveries, setDelayedDeliveries] = useState(0);
  const [paymentFailures, setPaymentFailures] = useState(0);
  const [onboardingCounts, setOnboardingCounts] = useState({ vendors: 0, riders: 0, hosts: 0 });
  const [bankActionCount, setBankActionCount] = useState(0);

  // Read alert IDs
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(READ_STORAGE_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Sound preference
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(SOUND_STORAGE_KEY);
      return stored !== null ? JSON.parse(stored) : true;
    } catch {
      return true;
    }
  });

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage blocked
      }
      return next;
    });
  }, []);

  const markAsRead = useCallback((id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // storage blocked
      }
      return next;
    });
  }, []);

  const markAllAsRead = useCallback((alertsToMark: AdminAlert[]) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      alertsToMark.forEach((a) => next.add(a.id));
      try {
        localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // storage blocked
      }
      return next;
    });
  }, []);

  // Track previous critical alerts count to chime on NEW critical issues
  const prevCriticalCount = useRef(0);
  const isInitialMount = useRef(true);

  // Listeners
  useEffect(() => {
    if (!user) return;

    const unsubs: Array<() => void> = [];
    const logErr = (tag: string) => (err: unknown) => {
      console.warn(`[useAdminNotifications] ${tag} listener non-fatal:`, err);
    };

    // 0. Alerts the backend posts to admin_notifications. The bell used to
    // derive everything from live collections and never read these, so an
    // SLA breach or an unverified stay payment raised server-side reached no
    // one. Last 7 days, unread only; categorised by type.
    unsubs.push(
      onSnapshot(
        query(collection(db, "admin_notifications"), orderBy("createdAt", "desc"), limit(80)),
        (s) => {
          const weekAgo = Date.now() - 7 * 86_400_000;
          const rows: AdminAlert[] = [];
          s.docs.forEach((d) => {
            const data = d.data() as Record<string, unknown>;
            if (data.read === true || data.resolved === true) return;
            const ts = (data.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            if (ts && ts < weekAgo) return;
            const { category, severity, href } = categorizeAdminNotification(data);
            rows.push({
              id: `server-${d.id}`,
              type: "system",
              title: String(data.title ?? data.type ?? "Alert"),
              message: String(data.message ?? data.body ?? ""),
              severity,
              category,
              href,
              timestamp: ts || Date.now(),
              metadata: { serverType: data.type, docId: d.id },
            });
          });
          setServerAlerts(rows);
        },
        logErr("admin_notifications"),
      ),
    );

    // 1. Escalated Support Chats
    unsubs.push(
      onSnapshot(
        query(collection(db, "support_threads"), where("status", "==", "escalated"), limit(100)),
        (s) => setEscalatedChats(s.size),
        logErr("support_threads")
      )
    );

    // 2. Pending Vendor Settlements — finance roles only. Support staff
    // cannot read this collection, and a denied listener would spam the console.
    if (!seeFinance) setSettlementInfo({ count: 0, amount: 0 });
    if (seeFinance) unsubs.push(
      onSnapshot(
        query(collection(db, "vendor_settlements"), where("status", "==", "pending"), limit(500)),
        (s) => {
          let amount = 0;
          s.forEach((d) => (amount += Number(d.data().netPayout ?? 0) || 0));
          setSettlementInfo({ count: s.size, amount });
        },
        logErr("vendor_settlements")
      )
    );

    // 3. Pending Refund Approvals
    unsubs.push(
      onSnapshot(
        query(collection(db, "platform_refunds"), where("status", "==", "pending_approval"), limit(100)),
        (s) => {
          const items: AdminAlert[] = s.docs.map((d) => {
            const data = d.data();
            const amt = Number(data.amount) || 0;
            const orderNum = String(data.orderNumber || data.orderId || d.id);
            return {
              id: `refund-${d.id}`,
              type: "pending_refund",
              title: `Refund Approval Required: ₹${Math.round(amt).toLocaleString("en-IN")}`,
              message: `Order #${orderNum} refund request by ${data.requestedBy || "staff"} requires sign-off.`,
              severity: "warning",
              category: "finance",
              href: "/admin/finance?tab=refunds",
              timestamp: data.createdAt?.toMillis?.() || Date.now(),
              amount: amt,
            };
          });
          setPendingRefunds(items);
        },
        logErr("platform_refunds")
      )
    );

    // 4. Open Operational Incidents
    unsubs.push(
      onSnapshot(
        query(collection(db, "ops_incidents"), limit(50)),
        (s) => {
          const items: AdminAlert[] = [];
          s.forEach((d) => {
            const data = d.data();
            const status = String(data.status || "detected").toLowerCase();
            if (status !== "resolved") {
              const sev = String(data.severity || "major").toLowerCase();
              items.push({
                id: `incident-${d.id}`,
                type: "incident",
                title: String(data.title || "Operational Incident"),
                message: `Status: ${status} · Impact: ${data.impact || "Service affected"}`,
                severity: sev === "critical" ? "critical" : "warning",
                category: "operations",
                href: "/admin/orders?tab=incidents",
                timestamp: data.createdAt?.toMillis?.() || Date.now(),
              });
            }
          });
          setOpenIncidents(items);
        },
        logErr("ops_incidents")
      )
    );

    // 5. Deliveries Awaiting Rider > 10m
    unsubs.push(
      onSnapshot(
        query(collection(db, "deliveries"), limit(500)),
        (s) => {
          const now = Date.now();
          let count = 0;
          s.forEach((d) => {
            const x = d.data();
            const stage = String(x.status ?? x.stage ?? "").toLowerCase();
            const active = ["offered", "pending", "assigned", "at_restaurant", "searching"].includes(stage);
            const noRider = !x.riderName || String(x.riderName).trim() === "";
            const tsRaw = (x.createdAt ?? x.timestamp) as { toDate?: () => Date } | undefined;
            const ts = tsRaw?.toDate?.();
            const ageMin = ts ? (now - ts.getTime()) / 60000 : 0;
            if (active && noRider && ageMin > 10) count++;
          });
          setDelayedDeliveries(count);
        },
        logErr("deliveries")
      )
    );

    // 6. Payment Failures Today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    unsubs.push(
      onSnapshot(
        query(collection(db, "orders"), where("paymentStatus", "==", "failed"), limit(200)),
        (s) => {
          let count = 0;
          s.forEach((d) => {
            const ts = (d.data().timestamp as { toDate?: () => Date } | undefined)?.toDate?.();
            if (!ts || ts >= startOfToday) count++;
          });
          setPaymentFailures(count);
        },
        logErr("orders_payment_failures")
      )
    );

    // 7. Partner Onboarding Queues
    unsubs.push(
      onSnapshot(
        query(collection(db, "restaurants"), where("onboarding.state", "in", OPS_QUEUE_STATES), limit(100)),
        (s) => setOnboardingCounts((prev) => ({ ...prev, vendors: s.size })),
        logErr("restaurants_onboarding")
      )
    );

    // Bank details the verifier bounced back. Set, never accumulated — the
    // listener re-fires on every change and would otherwise count forever.
    unsubs.push(
      onSnapshot(
        query(collection(db, "restaurants"), where("bank.verificationState", "==", "action_required"), limit(100)),
        (s) => setBankActionCount(s.size),
        logErr("restaurants_bank_action")
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, "delivery_users"), where("onboarding.state", "in", OPS_QUEUE_STATES), limit(100)),
        (s) => setOnboardingCounts((prev) => ({ ...prev, riders: s.size })),
        logErr("riders_onboarding")
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, "hotels"), where("onboarding.state", "in", OPS_QUEUE_STATES), limit(100)),
        (s) => setOnboardingCounts((prev) => ({ ...prev, hosts: s.size })),
        logErr("hotels_onboarding")
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [user, seeFinance]);

  // Aggregate into unified alert cards
  const alerts = useMemo<AdminAlert[]>(() => {
    const list: AdminAlert[] = [];

    // Critical incidents from Firestore
    openIncidents.forEach((inc) => list.push(inc));
    serverAlerts.forEach((a) => list.push(a));

    // Delayed deliveries
    if (delayedDeliveries > 0) {
      list.push({
        id: "alert-delayed-deliveries",
        type: "delayed_delivery",
        title: `${delayedDeliveries} Order${delayedDeliveries > 1 ? "s" : ""} Without a Rider > 10m`,
        message: "Active delivery orders awaiting assignment need urgent dispatcher action.",
        severity: "critical",
        category: "operations",
        href: "/admin/orders?tab=live",
        timestamp: Date.now(),
        count: delayedDeliveries,
      });
    }

    // Payment failures today
    if (paymentFailures > 0) {
      list.push({
        id: "alert-payment-failures",
        type: "payment_failure",
        title: `${paymentFailures} Payment Failure${paymentFailures > 1 ? "s" : ""} Today`,
        message: "Customer checkout transactions failed at the payment gateway.",
        severity: "critical",
        category: "operations",
        href: "/admin/orders",
        timestamp: Date.now(),
        count: paymentFailures,
      });
    }

    // Escalated support chats
    if (escalatedChats > 0) {
      list.push({
        id: "alert-support-escalated",
        type: "support_escalated",
        title: `${escalatedChats} Support Chat${escalatedChats > 1 ? "s" : ""} Escalated`,
        message: "Customers or partners waiting for human assistance from Kada Assist.",
        severity: "warning",
        category: "support",
        href: "/admin/support?tab=chats",
        timestamp: Date.now(),
        count: escalatedChats,
      });
    }

    // Pending settlements
    if (settlementInfo.count > 0) {
      list.push({
        id: "alert-vendor-settlements",
        type: "pending_settlement",
        title: `${settlementInfo.count} Vendor Settlement${settlementInfo.count > 1 ? "s" : ""} Pending`,
        message: `₹${Math.round(settlementInfo.amount).toLocaleString("en-IN")} total payable ready for payout disbursement.`,
        severity: "warning",
        category: "finance",
        href: "/admin/finance?tab=settlements",
        timestamp: Date.now(),
        count: settlementInfo.count,
        amount: settlementInfo.amount,
      });
    }

    // Pending refunds
    pendingRefunds.forEach((r) => list.push(r));

    // Vendor Onboarding
    if (onboardingCounts.vendors > 0) {
      list.push({
        id: "alert-vendor-onboarding",
        type: "partner_onboarding",
        title: `${onboardingCounts.vendors} Restaurant Application${onboardingCounts.vendors > 1 ? "s" : ""}`,
        message: "New restaurants submitted verification documents awaiting review.",
        severity: "info",
        category: "partners",
        href: "/admin/vendors?tab=onboarding",
        timestamp: Date.now(),
        count: onboardingCounts.vendors,
      });
    }

    // Rider Onboarding
    if (onboardingCounts.riders > 0) {
      list.push({
        id: "alert-rider-onboarding",
        type: "partner_onboarding",
        title: `${onboardingCounts.riders} Rider Verification${onboardingCounts.riders > 1 ? "s" : ""}`,
        message: "Delivery partners submitted driving license and RC awaiting KYC check.",
        severity: "info",
        category: "partners",
        href: "/admin/delivery",
        timestamp: Date.now(),
        count: onboardingCounts.riders,
      });
    }

    // KadaStay Host Onboarding
    if (onboardingCounts.hosts > 0) {
      list.push({
        id: "alert-host-onboarding",
        type: "partner_onboarding",
        title: `${onboardingCounts.hosts} KadaStay Host${onboardingCounts.hosts > 1 ? "s" : ""} Pending`,
        message: "Property hosts submitted listings awaiting inspection and sign-off.",
        severity: "info",
        category: "partners",
        href: "/admin/stay?tab=hosts",
        timestamp: Date.now(),
        count: onboardingCounts.hosts,
      });
    }

    // Bank verification action required
    if (bankActionCount > 0) {
      list.push({
        id: "alert-bank-action",
        type: "bank_verification",
        title: `${bankActionCount} Bank Detail Mismatch${bankActionCount > 1 ? "es" : ""}`,
        message: "Penny drop validation returned a name mismatch or rejected verification.",
        severity: "warning",
        category: "quality",
        href: "/admin/quality?tab=bank",
        timestamp: Date.now(),
        count: bankActionCount,
      });
    }

    // Sort: critical first, then warning, then info; then newest
    const priority = { critical: 0, warning: 1, info: 2 };
    return list.sort((a, b) => {
      const pDiff = priority[a.severity] - priority[b.severity];
      if (pDiff !== 0) return pDiff;
      return b.timestamp - a.timestamp;
    });
  }, [
    openIncidents,
    serverAlerts,
    delayedDeliveries,
    paymentFailures,
    escalatedChats,
    settlementInfo,
    pendingRefunds,
    onboardingCounts,
    bankActionCount,
  ]);

  // Audio / Toast trigger for new critical items
  useEffect(() => {
    const currentCritical = alerts.filter((a) => a.severity === "critical").length;
    if (!isInitialMount.current && currentCritical > prevCriticalCount.current) {
      if (soundEnabled) {
        playSynthesizedChime();
      }
      const newestCritical = alerts.find((a) => a.severity === "critical");
      if (newestCritical) {
        toast.error(newestCritical.title, {
          description: newestCritical.message,
        });
      }
    }
    prevCriticalCount.current = currentCritical;
    isInitialMount.current = false;
  }, [alerts, soundEnabled]);

  // Computed summary
  const summary = useMemo<NotificationSummary>(() => {
    const unread = alerts.filter((a) => !readIds.has(a.id)).length;
    const critical = alerts.filter((a) => a.severity === "critical").length;
    const warning = alerts.filter((a) => a.severity === "warning").length;
    const info = alerts.filter((a) => a.severity === "info").length;

    const workspaces: WorkspaceAlertCounts = {
      orders: openIncidents.length + delayedDeliveries + (paymentFailures > 0 ? 1 : 0),
      vendors: onboardingCounts.vendors,
      delivery: onboardingCounts.riders,
      finance: (settlementInfo.count > 0 ? 1 : 0) + pendingRefunds.length,
      stay: onboardingCounts.hosts,
      support: escalatedChats + serverAlerts.filter((a) => a.category === "support").length,
      quality: bankActionCount + serverAlerts.filter((a) => a.category === "quality").length,
    };

    return {
      total: alerts.length,
      unread,
      critical,
      warning,
      info,
      workspaces,
    };
  }, [
    alerts,
    readIds,
    openIncidents.length,
    delayedDeliveries,
    paymentFailures,
    onboardingCounts,
    settlementInfo.count,
    pendingRefunds.length,
    escalatedChats,
    bankActionCount,
    serverAlerts,
  ]);

  const counts: AdminItemCounts = useMemo(
    () => ({
      escalatedChats,
      pendingSettlements: settlementInfo.count,
      settlementAmount: settlementInfo.amount,
      pendingRefunds: pendingRefunds.length,
      openIncidents: openIncidents.length,
      delayedDeliveries,
      paymentFailures,
      vendorOnboarding: onboardingCounts.vendors,
      riderOnboarding: onboardingCounts.riders,
      hostOnboarding: onboardingCounts.hosts,
      bankActionCount,
    }),
    [
      escalatedChats,
      settlementInfo,
      pendingRefunds.length,
      openIncidents.length,
      delayedDeliveries,
      paymentFailures,
      onboardingCounts,
      bankActionCount,
    ]
  );

  return {
    alerts,
    summary,
    counts,
    soundEnabled,
    toggleSound,
    readIds,
    markAsRead,
    markAllAsRead,
  };
}

export function AdminNotificationsProvider({ children }: { children: ReactNode }) {
  const value = useAdminNotificationsInternal();
  return (
    <AdminNotificationsContext.Provider value={value}>
      {children}
    </AdminNotificationsContext.Provider>
  );
}

export function useAdminNotifications() {
  return useContext(AdminNotificationsContext);
}
