import { lazy } from "react";
import { Navigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BadgeIndianRupee,
  BarChart3,
  Bell,
  Bike,
  BookOpen,
  Building2,
  Calendar,
  CalendarCheck,
  CalendarClock,
  ChefHat,
  CreditCard,
  Crown,
  Download,
  FileCheck2,
  Landmark,
  FileText,
  Flame,
  Gift,
  HeartHandshake,
  Hotel,
  Layers,
  ListX,
  Mail,
  Map as MapIcon,
  MapPin,
  Megaphone,
  MessageSquare,
  PackageSearch,
  RotateCcw,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Shield,
  ShoppingBag,
  Smartphone,
  Star,
  Target,
  Ticket,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
  Zap,
  FlaskConical,
  History,
  Scale,
  Rocket,
} from "lucide-react";
import { WorkspaceShell, type WorkspaceTab } from "@/components/admin/core/WorkspaceShell";

/**
 * The 14 admin workspaces.
 *
 * Each one is a thin composition: the existing page components become tabs,
 * unchanged. Nothing here re-implements a screen — the restructure is about
 * where things live, not rewriting what already works.
 *
 * Every import is lazy, so opening a workspace loads only the tab you land on.
 */

// ── Lazy page imports ──────────────────────────────────────────────────────
const PlatformDashboard = lazy(() => import("../PlatformDashboard"));

const PlatformOrdersPage = lazy(() => import("../PlatformOrdersPage"));
const LiveOperationsPage = lazy(() => import("../LiveOperationsPage"));
const IncidentsPage = lazy(() => import("../IncidentsPage"));

const ConsumersPage = lazy(() => import("../ConsumersPage"));
const CRMPage = lazy(() => import("../CRMPage"));
const LoyaltyPage = lazy(() => import("../LoyaltyPage"));
const ReferralsPage = lazy(() => import("../ReferralsPage"));
const GiftCardsPage = lazy(() => import("../GiftCardsPage"));

const RestaurantsPage = lazy(() => import("../RestaurantsPage"));
const OnboardingCommandCenter = lazy(() => import("../OnboardingCommandCenter"));
const ReservationsHubPage = lazy(() => import("../ReservationsHubPage"));

const FleetPage = lazy(() => import("../FleetPage"));

const MarketsPage = lazy(() => import("../MarketsPage"));
const ZoneManagerPage = lazy(() => import("../ZoneManagerPage"));
const ZonesPage = lazy(() => import("../ZonesPage"));
const StayDestinations = lazy(() => import("../stay/StayDestinations"));

const FinancePage = lazy(() => import("../FinancePage"));
const SettlementsPage = lazy(() => import("../SettlementsPage"));
const PayoutRunsPage = lazy(() => import("../PayoutRunsPage"));
const RefundsPage = lazy(() => import("../RefundsPage"));
const TransactionLedger = lazy(() => import("../TransactionLedger"));
const ReconciliationPage = lazy(() => import("../ReconciliationPage"));
const DonationsPage = lazy(() => import("../DonationsPage"));

const PlansPage = lazy(() => import("../PlansPage"));

const StayCommandCenter = lazy(() => import("../stay/StayCommandCenter"));
const MessKitchens = lazy(() => import("../mess/MessKitchens"));
const MessPlans = lazy(() => import("../mess/MessPlans"));
const MessSubscriptions = lazy(() => import("../mess/MessSubscriptions"));
const MessSettlements = lazy(() => import("../mess/MessSettlements"));
const StayProperties = lazy(() => import("../stay/StayProperties"));
const StayBookings = lazy(() => import("../stay/StayBookings"));
const StayHosts = lazy(() => import("../stay/StayHosts"));
const StayAmenities = lazy(() => import("../stay/StayAmenities"));
const StayPolicies = lazy(() => import("../stay/StayPolicies"));

const SupportPage = lazy(() => import("../SupportPage"));
const SupportChatsPage = lazy(() => import("../SupportChatsPage"));
const SupportKnowledgeBasePage = lazy(() => import("../SupportKnowledgeBasePage"));
const SupportAnalyticsPage = lazy(() => import("../SupportAnalyticsPage"));
const DemoRequestsPage = lazy(() => import("../DemoRequestsPage"));

const FoodReviewsPage = lazy(() => import("../FoodReviewsPage"));
const StayReviews = lazy(() => import("../stay/StayReviews"));
const CatalogQcPage = lazy(() => import("../CatalogQcPage"));
const BankVerificationPage = lazy(() => import("../BankVerificationPage"));
const RiskCenterPage = lazy(() => import("../RiskCenterPage"));

const PromosPage = lazy(() => import("../PromosPage"));
const AdsPage = lazy(() => import("../AdsPage"));
const MerchandisingPage = lazy(() => import("../MerchandisingPage"));
const MobileNotificationsPage = lazy(() => import("../comms/MobileNotificationsPage"));
const EmailPage = lazy(() => import("../comms/EmailPage"));
const ChangelogAdminPage = lazy(() => import("../changelog/ChangelogAdminPage"));

const AnalyticsPage = lazy(() => import("../AnalyticsPage"));
const StayAnalytics = lazy(() => import("../stay/StayAnalytics"));
const ExportsPage = lazy(() => import("../ExportsPage"));

const PlatformSettingsPage = lazy(() => import("../PlatformSettingsPage"));
const BusinessRulesPage = lazy(() => import("../BusinessRulesPage"));
const PricingRulesPage = lazy(() => import("../pricing/PricingRulesPage"));
const PricingSimulatorPage = lazy(() => import("../pricing/PricingSimulatorPage"));
const PricingAuditPage = lazy(() => import("../pricing/PricingAuditPage"));
const PricingReconciliationPage = lazy(() => import("../pricing/PricingReconciliationPage"));
const CancellationReasonsPage = lazy(() => import("../CancellationReasonsPage"));
const AppReleasesPage = lazy(() => import("../AppReleasesPage"));
const IntegrationsPage = lazy(() => import("../IntegrationsPage"));
const RazorpayWebhooksPage = lazy(() => import("../RazorpayWebhooksPage"));
const AdminTeamPage = lazy(() => import("../AdminTeamPage"));
const AuditLogPage = lazy(() => import("../AuditLogPage"));
const SecurityPage = lazy(() => import("../SecurityPage"));
const AdminRolesPage = lazy(() => import("../AdminRolesPage"));

// Lazy() types the component as accepting its own props; workspaces render
// every tab with none, so this narrows them to a common no-prop shape.
type Tab = WorkspaceTab["component"];
const t = (c: unknown) => c as Tab;

// ── Workspaces ─────────────────────────────────────────────────────────────

export function DashboardWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "overview", label: "Overview", icon: Activity, component: t(PlatformDashboard) },
  ];
  return (
    <WorkspaceShell
      title="Dashboard"
      description="Platform health, live operations and anything that needs attention today."
      icon={Activity}
      tabs={tabs}
    />
  );
}

export function OrdersWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "orders", label: "Orders", icon: ShoppingBag, component: t(PlatformOrdersPage) },
    { key: "live", label: "Live dispatch", icon: Activity, component: t(LiveOperationsPage) },
    { key: "incidents", label: "Incidents", icon: AlertTriangle, component: t(IncidentsPage) },
  ];
  return (
    <WorkspaceShell
      title="Orders & Operations"
      description="Every order, the live dispatch board, and the exceptions that need a human."
      icon={ShoppingBag}
      tabs={tabs}
    />
  );
}

export function CustomersWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "directory", label: "Directory", icon: Smartphone, component: t(ConsumersPage) },
    { key: "segments", label: "Segments & CRM", icon: Target, component: t(CRMPage) },
    { key: "loyalty", label: "Loyalty & Gold", icon: Crown, component: t(LoyaltyPage) },
    { key: "referrals", label: "Referrals", icon: Users, component: t(ReferralsPage) },
    { key: "credits", label: "Gift cards", icon: Gift, component: t(GiftCardsPage) },
  ];
  return (
    <WorkspaceShell
      title="Customers"
      description="Who orders from Kada, how they're segmented, and what they've earned."
      icon={Smartphone}
      tabs={tabs}
    />
  );
}

export function VendorsWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "directory", label: "Directory", icon: Building2, component: t(RestaurantsPage) },
    { key: "onboarding", label: "Onboarding", icon: Users, component: t(OnboardingCommandCenter) },
    { key: "reservations", label: "Reservations", icon: Calendar, component: t(ReservationsHubPage) },
    { key: "plans", label: "Plans & billing", icon: CreditCard, component: t(PlansPage) },
  ];
  return (
    <WorkspaceShell
      title="Vendors"
      description="Restaurant partners, onboarding pipeline, table bookings, and POS subscription plans."
      icon={Building2}
      tabs={tabs}
    />
  );
}

export function DeliveryWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "fleet", label: "Fleet & KYC", icon: Bike, component: t(FleetPage) },
  ];
  return (
    <WorkspaceShell
      title="Delivery"
      description="Delivery partners, their approval status, and rider KYC."
      icon={Bike}
      tabs={tabs}
    />
  );
}

export function MarketsWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "zones", label: "Service zones", icon: MapIcon, component: t(ZoneManagerPage) },
    { key: "cities", label: "Cities", icon: MapPin, component: t(MarketsPage) },
    { key: "surge", label: "Surge & demand", icon: Flame, component: t(ZonesPage) },
  ];
  return (
    <WorkspaceShell
      title="Markets & Zones"
      description="Where Kada operates. Zones decide serviceability, delivery pricing and who belongs to which area."
      icon={MapIcon}
      tabs={tabs}
      defaultTab="zones"
    />
  );
}

export function FinanceWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "overview", label: "Overview", icon: BadgeIndianRupee, component: t(FinancePage) },
    { key: "settlements", label: "Settlements", icon: Wallet, component: t(SettlementsPage) },
    { key: "payouts", label: "Payout runs", icon: Send, component: t(PayoutRunsPage) },
    { key: "refunds", label: "Refunds", icon: RotateCcw, component: t(RefundsPage) },
    { key: "ledger", label: "Ledger", icon: CreditCard, component: t(TransactionLedger) },
    { key: "reconciliation", label: "Reconciliation", icon: FileCheck2, component: t(ReconciliationPage) },
    { key: "donations", label: "Kada Cares", icon: HeartHandshake, component: t(DonationsPage) },
  ];
  return (
    <WorkspaceShell
      title="Finance"
      description="Money in, money out, and the reconciliation that proves the two agree."
      icon={BadgeIndianRupee}
      tabs={tabs}
    />
  );
}

export function PlansWorkspace() {
  // Plans & Billing is now housed under Vendors
  return <Navigate to="/admin/vendors?tab=plans" replace />;
}

export function StayWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "overview", label: "Command centre", icon: Hotel, component: t(StayCommandCenter) },
    { key: "properties", label: "Properties", icon: Building2, component: t(StayProperties) },
    { key: "bookings", label: "Bookings", icon: Calendar, component: t(StayBookings) },
    { key: "hosts", label: "Hosts", icon: Users, component: t(StayHosts) },
    { key: "amenities", label: "Amenities", icon: Settings, component: t(StayAmenities) },
    { key: "policies", label: "Policies", icon: ScrollText, component: t(StayPolicies) },
    { key: "destinations", label: "Destinations", icon: MapPin, component: t(StayDestinations) },
    { key: "reviews", label: "Reviews", icon: Star, component: t(StayReviews) },
    { key: "analytics", label: "Analytics", icon: BarChart3, component: t(StayAnalytics) },
  ];
  return (
    <WorkspaceShell
      title="KadaStay"
      description="Properties, hosts, bookings, reviews, and analytics across the stay marketplace."
      icon={Hotel}
      tabs={tabs}
    />
  );
}

export function MessWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "kitchens", label: "Kitchens", icon: ChefHat, component: t(MessKitchens) },
    { key: "onboarding", label: "Onboarding", icon: Users, component: t(OnboardingCommandCenter) },
    { key: "plans", label: "Meal plans", icon: Layers, component: t(MessPlans) },
    { key: "subscriptions", label: "Subscriptions", icon: CalendarCheck, component: t(MessSubscriptions) },
    { key: "settlements", label: "Settlements", icon: Wallet, component: t(MessSettlements) },
  ];
  return (
    <WorkspaceShell
      title="Kada Mess"
      description="Home kitchens on monthly meal plans — who is cooking, onboarding pipeline, meal plans, subscriptions, and settlements."
      icon={ChefHat}
      tabs={tabs}
    />
  );
}

export function SupportWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "queue", label: "Cases", icon: MessageSquare, component: t(SupportPage) },
    { key: "chats", label: "Live chat", icon: MessageSquare, component: t(SupportChatsPage) },
    { key: "knowledge", label: "Knowledge base", icon: BookOpen, component: t(SupportKnowledgeBasePage) },
    { key: "analytics", label: "Assist analytics", icon: BarChart3, component: t(SupportAnalyticsPage) },
    { key: "leads", label: "Demo requests", icon: CalendarClock, component: t(DemoRequestsPage) },
  ];
  return (
    <WorkspaceShell
      title="AI & Support"
      description="Kada Assist across all four apps, escalations to humans, and how the AI is performing."
      icon={MessageSquare}
      tabs={tabs}
    />
  );
}

export function QualityWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "reviews", label: "Food reviews", icon: Star, component: t(FoodReviewsPage) },
    { key: "catalog", label: "Catalog QC", icon: UtensilsCrossed, component: t(CatalogQcPage) },
    { key: "bank", label: "Bank Verification", icon: Landmark, component: t(BankVerificationPage) },
    { key: "risk", label: "Risk centre", icon: ShieldCheck, component: t(RiskCenterPage) },
  ];
  return (
    <WorkspaceShell
      title="Quality & Trust"
      description="Is this actor and this content safe to show — reviews, menu quality, KYC and fraud."
      icon={ShieldCheck}
      tabs={tabs}
    />
  );
}

export function GrowthWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "promos", label: "Coupons & offers", icon: Ticket, component: t(PromosPage) },
    { key: "ads", label: "Ads", icon: Megaphone, component: t(AdsPage) },
    { key: "merchandising", label: "Merchandising", icon: Layers, component: t(MerchandisingPage) },
    { key: "notifications", label: "Push", icon: Bell, component: t(MobileNotificationsPage) },
    { key: "email", label: "Email", icon: Mail, component: t(EmailPage) },
    { key: "changelog", label: "Changelog", icon: Rocket, component: t(ChangelogAdminPage) },
  ];
  return (
    <WorkspaceShell
      title="Growth"
      description="Everything that reaches customers and partners: offers, ads, merchandising, campaigns and release notes."
      icon={Megaphone}
      tabs={tabs}
    />
  );
}

export function PricingWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "rules", label: "Rules", icon: Scale, component: t(PricingRulesPage) },
    { key: "simulator", label: "Simulator", icon: FlaskConical, component: t(PricingSimulatorPage) },
    { key: "audit", label: "Audit log", icon: History, component: t(PricingAuditPage) },
    { key: "checks", label: "Price checks", icon: FileCheck2, component: t(PricingReconciliationPage) },
  ];
  return (
    <WorkspaceShell
      title="Pricing"
      description="One backend engine prices every order and stay. Rules here are versioned, audited, testable, and reach every app at once."
      icon={Scale}
      tabs={tabs}
    />
  );
}

export function AnalyticsWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "business", label: "Business", icon: BarChart3, component: t(AnalyticsPage) },
    { key: "exports", label: "Exports", icon: Download, component: t(ExportsPage) },
  ];
  return (
    <WorkspaceShell
      title="Analytics"
      description="Cross-system reporting. Use the area selector in the header to scope any view to a city or zone."
      icon={BarChart3}
      tabs={tabs}
    />
  );
}

export function SettingsWorkspace() {
  const tabs: WorkspaceTab[] = [
    { key: "platform", label: "Platform", icon: Settings, component: t(PlatformSettingsPage) },
    { key: "rules", label: "Business rules", icon: FileText, component: t(BusinessRulesPage) },
    { key: "cancellation", label: "Cancellation reasons", icon: ListX, component: t(CancellationReasonsPage) },
    { key: "releases", label: "App releases", icon: Smartphone, component: t(AppReleasesPage) },
    { key: "integrations", label: "Integrations", icon: Zap, component: t(IntegrationsPage) },
    { key: "webhooks", label: "Webhooks", icon: Activity, component: t(RazorpayWebhooksPage) },
    { key: "team", label: "Admin team", icon: UserCog, component: t(AdminTeamPage) },
    { key: "roles", label: "Roles & Permissions", icon: Shield, component: t(AdminRolesPage) },
    { key: "audit", label: "Activity log", icon: ScrollText, component: t(AuditLogPage) },
    { key: "security", label: "Security", icon: ShieldCheck, component: t(SecurityPage) },
  ];
  return (
    <WorkspaceShell
      title="Settings"
      description="Global configuration, integrations, permissions and the audit trail."
      icon={Settings}
      tabs={tabs}
    />
  );
}
