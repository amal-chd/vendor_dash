import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { ScrollToTop } from "./components/ScrollToTop";
import { ThemeProvider } from "./components/ThemeProvider";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { FeatureGate } from "./components/FeatureGate";


import { useParams } from "react-router-dom";

// ── Admin panel ───────────────────────────────────────────────────────────
const AdminLayout = lazy(() => import("./components/AdminLayout"));
// The 14 admin workspaces. Each composes existing pages as `?tab=` panes.
const DashboardWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.DashboardWorkspace })));
const OrdersWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.OrdersWorkspace })));
const CustomersWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.CustomersWorkspace })));
const VendorsWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.VendorsWorkspace })));
const DeliveryWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.DeliveryWorkspace })));
const MarketsWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.MarketsWorkspace })));
const FinanceWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.FinanceWorkspace })));
const PricingWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.PricingWorkspace })));
const PlansWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.PlansWorkspace })));
const StayWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.StayWorkspace })));
const MessWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.MessWorkspace })));
const SupportWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.SupportWorkspace })));
const QualityWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.QualityWorkspace })));
const GrowthWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.GrowthWorkspace })));
const AnalyticsWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.AnalyticsWorkspace })));
const SettingsWorkspace = lazy(() => import("./pages/admin/workspaces").then(m => ({ default: m.SettingsWorkspace })));
const ChangelogEditorPage = lazy(() => import("./pages/admin/changelog/ChangelogEditorPage"));

const Order360 = lazy(() => import("./pages/admin/Order360"));
const Vendor360 = lazy(() => import("./pages/admin/Vendor360"));
const Customer360 = lazy(() => import("./pages/admin/Customer360"));
const Rider360 = lazy(() => import("./pages/admin/Rider360"));
const StayProperty360 = lazy(() => import("./pages/admin/stay/StayProperty360"));
const StayHost360 = lazy(() => import("./pages/admin/stay/StayHost360"));

function LegacyEntityRedirect({ to }: { to: string }) {
  const { id } = useParams();
  return <Navigate to={id ? `/admin/${to}/${id}` : `/admin/${to}`} replace />;
}

function NotificationLegacyRedirect() {
  const { section } = useParams();
  const map: Record<string, string> = {
    broadcasts: "send",
    campaigns: "campaigns",
    "ai-studio": "create",
    automations: "automations",
    templates: "templates",
    segments: "audiences",
    scheduled: "system",
    failed: "system",
    devices: "system",
    preferences: "system",
    analytics: "analytics",
    health: "system",
  };
  return (
    <Navigate
      to={`/admin/notifications?tab=${map[section || ""] || "overview"}`}
      replace
    />
  );
}

const NotFound = lazy(() => import("./pages/NotFound"));
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const SignupPage = lazy(() => import("./pages/auth/SignupPage"));
const SetupWizardPage = lazy(() => import("./pages/auth/SetupWizardPage"));
const AdminPortalChooser = lazy(() => import("./pages/auth/AdminPortalChooser"));
const DashboardLayout = lazy(() => import("./components/DashboardLayout"));
const DashboardOverview = lazy(() => import("./pages/dashboard/DashboardOverview"));
const MenuPage = lazy(() => import("./pages/dashboard/MenuPage"));
const OrdersPage = lazy(() => import("./pages/dashboard/OrdersPage"));
const TablesPage = lazy(() => import("./pages/dashboard/TablesPage"));
const ReservationsPage = lazy(() => import("./pages/dashboard/ReservationsPage"));
const KitchenPage = lazy(() => import("./pages/dashboard/KitchenPage"));
const POSPage = lazy(() => import("./pages/dashboard/POSPage"));
const InventoryPage = lazy(() => import("./pages/dashboard/InventoryPage"));
const StaffPage = lazy(() => import("./pages/dashboard/StaffPage"));
const CustomersPage = lazy(() => import("./pages/dashboard/CustomersPage"));
const MarketingPage = lazy(() => import("./pages/dashboard/MarketingPage"));
const IntegrationsPage = lazy(() => import("./pages/dashboard/IntegrationsPage"));
const ReportsPage = lazy(() => import("./pages/dashboard/ReportsPage"));
const ExpensesPage = lazy(() => import("./pages/dashboard/ExpensesPage"));
const SettingsPage = lazy(() => import("./pages/dashboard/SettingsPage"));
const OutletsPage = lazy(() => import("./pages/dashboard/OutletsPage"));
const PlansPricingPage = lazy(() => import("./pages/dashboard/PlansPricingPage"));
const MessDashboardPage = lazy(() => import("./pages/mess/MessDashboardPage"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-primary opacity-40" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ScrollToTop />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/setup" element={<SetupWizardPage />} />
              <Route path="/pricing" element={<PlansPricingPage />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/portal-select" element={<AdminPortalChooser />} />
                <Route path="/dashboard" element={<DashboardLayout />}>
                  <Route index element={<DashboardOverview />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="menu" element={<MenuPage />} />
                  <Route path="tables" element={<TablesPage />} />
                  <Route path="reservations" element={<ReservationsPage />} />
                  <Route path="kitchen" element={<FeatureGate capability="predictive_kds"><KitchenPage /></FeatureGate>} />
                  <Route path="pos" element={<POSPage />} />
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="staff" element={<StaffPage />} />
                  <Route path="customers" element={<FeatureGate capability="cdp"><CustomersPage /></FeatureGate>} />
                  <Route path="marketing" element={<FeatureGate capability="marketing_automation"><MarketingPage /></FeatureGate>} />
                  <Route path="integrations" element={<FeatureGate capability="aggregator_integration"><IntegrationsPage /></FeatureGate>} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="expenses" element={<FeatureGate capability="expense_tracking"><ExpensesPage /></FeatureGate>} />
                  <Route path="pricing" element={<PlansPricingPage />} />
                  <Route path="plans" element={<Navigate to="/dashboard/pricing" replace />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="outlets" element={<OutletsPage />} />
                </Route>

                {/* ── Kada Mess Kitchen Workspace ───────────────────────── */}
                <Route path="/mess/dashboard" element={<MessDashboardPage />} />
                <Route path="/mess" element={<Navigate to="/mess/dashboard" replace />} />

                {/* ── Admin console ────────────────────────────────────── */}
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<DashboardWorkspace />} />
                  <Route path="orders" element={<OrdersWorkspace />} />
                  <Route path="orders/:id" element={<Order360 />} />
                  <Route path="customers" element={<CustomersWorkspace />} />
                  <Route path="customers/:id" element={<Customer360 />} />
                  <Route path="vendors" element={<VendorsWorkspace />} />
                  <Route path="vendors/:id" element={<Vendor360 />} />
                  <Route path="delivery" element={<DeliveryWorkspace />} />
                  <Route path="delivery/:id" element={<Rider360 />} />
                  <Route path="markets" element={<MarketsWorkspace />} />
                  <Route path="finance" element={<FinanceWorkspace />} />
                  <Route path="pricing" element={<PricingWorkspace />} />
                  <Route path="plans" element={<PlansWorkspace />} />
                  <Route path="stay" element={<StayWorkspace />} />
                  <Route path="stay/properties/:id" element={<StayProperty360 />} />
                  <Route path="stay/hosts/:id" element={<StayHost360 />} />
                  <Route path="mess" element={<MessWorkspace />} />
                  <Route path="support" element={<SupportWorkspace />} />
                  <Route path="quality" element={<QualityWorkspace />} />
                  <Route path="growth" element={<GrowthWorkspace />} />
                  <Route path="growth/changelog/:id" element={<ChangelogEditorPage />} />
                  <Route path="analytics" element={<AnalyticsWorkspace />} />
                  <Route path="settings" element={<SettingsWorkspace />} />

                  {/* Legacy redirects */}
                  <Route path="consumers" element={<Navigate to="/admin/customers" replace />} />
                  <Route path="consumers/:id" element={<LegacyEntityRedirect to="customers" />} />
                  <Route path="restaurants" element={<Navigate to="/admin/vendors" replace />} />
                  <Route path="restaurants/:id" element={<LegacyEntityRedirect to="vendors" />} />
                  <Route path="fleet" element={<Navigate to="/admin/delivery" replace />} />
                  <Route path="fleet/:id" element={<LegacyEntityRedirect to="delivery" />} />
                  <Route path="live-ops" element={<Navigate to="/admin/orders?tab=live" replace />} />
                  <Route path="deliveries" element={<Navigate to="/admin/orders?tab=live" replace />} />
                  <Route path="incidents" element={<Navigate to="/admin/orders?tab=incidents" replace />} />
                  <Route path="notifications/:section" element={<NotificationLegacyRedirect />} />
                  <Route path="comms/:section" element={<NotificationLegacyRedirect />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
