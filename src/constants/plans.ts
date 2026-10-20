export type Capability =
  | "qr_ordering"
  | "gst_billing"
  | "single_outlet"
  | "pos_sync"
  | "multi_device"
  | "inventory_tracking"
  | "predictive_kds"
  | "cdp"
  | "aggregator_integration"
  | "custom_api"
  | "priority_support"
  | "vpc_isolation"
  | "marketing_automation"
  | "pnl_reports"
  | "multi_outlet"
  | "staff_management"
  | "expense_tracking"
  | "loyalty";

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: number | "Custom";
  annualPrice: number | "Custom";
  monthlyPriceUSD: number | "Custom";
  annualPriceUSD: number | "Custom";
  tagline: string;
  description: string;
  popular?: boolean;
  badge?: string;
  features: string[];
  capabilities: Capability[];
  color?: string;
  cta: string;
  highlightedFeature?: string;
  maxOutlets: number;
}

// Base prices. Annual prices reflect a ~20% discount (e.g. 499 → 399/mo).
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 499,
    annualPrice: 399,
    monthlyPriceUSD: 6.99,
    annualPriceUSD: 5.50,
    tagline: "For cafés and small restaurants getting started.",
    description: "Everything you need to run a standalone outlet — billing, QR menu, and live orders on one screen.",
    cta: "Get Started",
    maxOutlets: 1,
    features: [
      "Standalone Setup — 1 outlet maximum",
      "QR Digital Menu — contactless table ordering",
      "GST-Ready Billing & KOT printing",
      "Live Order Tracking (POS + Kitchen screen)",
      "Basic sales reports & analytics",
      "Basic Inventory — ingredient-level tracking",
      "Up to 3 concurrent devices",
      "Staff attendance tracking",
      "Email & chat support",
    ],
    capabilities: [
      "qr_ordering",
      "gst_billing",
      "pos_sync",
      "multi_device",
      "inventory_tracking",
      "staff_management",
      "pnl_reports",
    ],
    color: "slate",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPrice: 899,
    annualPrice: 699,
    monthlyPriceUSD: 12.99,
    annualPriceUSD: 9.99,
    tagline: "For growing restaurants that want to scale fast.",
    description: "Advanced kitchen tools, delivery integrations, CRM, and marketing — support for up to 5 outlets.",
    popular: true,
    badge: "Most Popular",
    cta: "Get Started",
    highlightedFeature: "Everything in Starter, plus:",
    maxOutlets: 5,
    features: [
      "Up to 5 Outlets management",
      "Kitchen Display System (KDS) with timers",
      "Low-stock alerts & smart reorder",
      "Customer database (CRM + loyalty points)",
      "Native digital promotions & win-back campaigns",
      "Aggregator webhook integration (Zomato / Swiggy)",
      "Expense tracking & P&L reports",
      "Unlimited devices",
      "Priority 24/7 support",
    ],
    capabilities: [
      "qr_ordering",
      "gst_billing",
      "pos_sync",
      "multi_device",
      "inventory_tracking",
      "predictive_kds",
      "cdp",
      "aggregator_integration",
      "priority_support",
      "marketing_automation",
      "pnl_reports",
      "staff_management",
      "expense_tracking",
      "loyalty",
    ],
    color: "primary",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyPrice: "Custom",
    annualPrice: "Custom",
    monthlyPriceUSD: "Custom",
    annualPriceUSD: "Custom",
    tagline: "For hotel chains, restaurant groups & franchises.",
    description: "Dedicated infrastructure, custom integrations, white-label branding, and a dedicated success manager.",
    cta: "Contact Sales",
    highlightedFeature: "Everything in Growth, plus:",
    maxOutlets: Infinity,
    features: [
      "Multi-outlet management (unlimited branches, >5 outlets)",
      "Centralised analytics across all locations",
      "Inter-branch stock transfers",
      "Custom API & third-party integrations",
      "White-label mobile app & branding",
      "Private cloud infrastructure (VPC)",
      "Dedicated onboarding & training",
      "99.9% uptime SLA",
    ],
    capabilities: [
      "qr_ordering",
      "gst_billing",
      "pos_sync",
      "multi_device",
      "inventory_tracking",
      "predictive_kds",
      "cdp",
      "aggregator_integration",
      "priority_support",
      "custom_api",
      "vpc_isolation",
      "marketing_automation",
      "pnl_reports",
      "multi_outlet",
      "staff_management",
      "expense_tracking",
      "loyalty",
    ],
    color: "slate",
  },
];

// ── Feature comparison matrix ─────────────────────────────────────────────────

export interface CompareRow {
  category: string;
  feature: string;
  starter: string | boolean;
  growth: string | boolean;
  enterprise: string | boolean;
}

export const COMPARE_ROWS: CompareRow[] = [
  // Core POS
  { category: "Point of Sale", feature: "GST-ready billing & KOT", starter: true, growth: true, enterprise: true },
  { category: "Point of Sale", feature: "QR digital menu", starter: true, growth: true, enterprise: true },
  { category: "Point of Sale", feature: "Table management", starter: true, growth: true, enterprise: true },
  { category: "Point of Sale", feature: "Offline mode", starter: true, growth: true, enterprise: true },
  { category: "Point of Sale", feature: "Concurrent devices", starter: "3 devices", growth: "Unlimited", enterprise: "Unlimited" },
  // Kitchen
  { category: "Kitchen", feature: "Kitchen Order Ticket (KOT)", starter: true, growth: true, enterprise: true },
  { category: "Kitchen", feature: "Kitchen Display System (KDS)", starter: false, growth: true, enterprise: true },
  { category: "Kitchen", feature: "Prep timers & alerts", starter: false, growth: true, enterprise: true },
  // Inventory
  { category: "Inventory", feature: "Ingredient-level tracking", starter: true, growth: true, enterprise: true },
  { category: "Inventory", feature: "Low-stock alerts", starter: false, growth: true, enterprise: true },
  { category: "Inventory", feature: "Inter-branch transfers", starter: false, growth: false, enterprise: true },
  // Marketing & CRM
  { category: "Marketing & CRM", feature: "Customer database (CRM)", starter: false, growth: true, enterprise: true },
  { category: "Marketing & CRM", feature: "Loyalty points", starter: false, growth: true, enterprise: true },
  { category: "Marketing & CRM", feature: "Native digital promotions", starter: false, growth: true, enterprise: true },
  { category: "Marketing & CRM", feature: "Aggregator webhook (Zomato/Swiggy)", starter: false, growth: true, enterprise: true },
  // Analytics
  { category: "Analytics", feature: "Basic sales reports", starter: true, growth: true, enterprise: true },
  { category: "Analytics", feature: "Expense tracking & P&L", starter: false, growth: true, enterprise: true },
  { category: "Analytics", feature: "Multi-location analytics", starter: false, growth: false, enterprise: true },
  { category: "Analytics", feature: "Custom report builder", starter: false, growth: false, enterprise: true },
  // Scale
  { category: "Scale", feature: "Multi-outlet management", starter: false, growth: false, enterprise: true },
  { category: "Scale", feature: "Custom API & webhooks", starter: false, growth: false, enterprise: true },
  { category: "Scale", feature: "Private cloud (VPC)", starter: false, growth: false, enterprise: true },
  { category: "Scale", feature: "White-label branding", starter: false, growth: false, enterprise: true },
  // Support
  { category: "Support", feature: "Email & chat support", starter: true, growth: true, enterprise: true },
  { category: "Support", feature: "Priority 24/7 support", starter: false, growth: true, enterprise: true },
  { category: "Support", feature: "Dedicated success manager", starter: false, growth: false, enterprise: true },
  { category: "Support", feature: "Onboarding & training", starter: false, growth: false, enterprise: true },
];
