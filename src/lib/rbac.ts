/**
 * Role-based access control (spec §35).
 *
 * A permission matrix maps each admin role to the set of capabilities it holds.
 * The frontend uses this to gate UI (sidebar, destructive actions), but it is a
 * convenience only — sensitive writes are ALSO enforced server-side in Firestore
 * rules / Cloud Functions ("never rely on frontend-only permission checks").
 */

export type Permission =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "refund"
  | "suspend"
  | "export"
  | "view_financial"
  | "view_pii"
  | "manage_admins";

export type Role =
  | "super_admin"
  | "platform_admin"
  | "ops_manager"
  | "finance_manager"
  | "support_manager"
  | "support_agent"
  | "vendor_manager"
  | "delivery_manager"
  | "stay_manager"
  | "marketing_manager"
  | "analytics"
  | "developer"
  | "auditor";

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  platform_admin: "Platform Admin",
  ops_manager: "Operations Manager",
  finance_manager: "Finance Manager",
  support_manager: "Support Manager",
  support_agent: "Support Agent",
  vendor_manager: "Vendor Manager",
  delivery_manager: "Delivery Manager",
  stay_manager: "Stay Manager",
  marketing_manager: "Marketing Manager",
  analytics: "Analytics",
  developer: "Developer",
  auditor: "Auditor",
};

const ALL: Permission[] = [
  "view", "create", "edit", "delete", "approve", "refund", "suspend",
  "export", "view_financial", "view_pii", "manage_admins",
];

// Role → permissions. Kept intentionally explicit and readable.
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ALL,
  // "refund" and "manage_admins" were missing here while adminPlatformAction's
  // own table allows platform_admin to run refundOrder and grantAdmin. The
  // server is the authority, so withholding them client-side only hid buttons
  // from a role that was permitted to use them — and nothing surfaced the gap,
  // because the UI simply rendered nothing. See ACTION_PERMISSION below, which
  // the doctor now cross-checks against the server table.
  platform_admin: ["view", "create", "edit", "delete", "approve", "refund", "suspend", "export", "view_financial", "view_pii", "manage_admins"],
  // +approve: adminPlatformAction names ops_manager as one of the roles that
  // runs the onboarding review queue (transitionOnboarding, reviewOnboardingStep).
  ops_manager: ["view", "create", "edit", "approve", "suspend", "export", "view_pii"],
  finance_manager: ["view", "approve", "refund", "export", "view_financial"],
  // +suspend: the server lets support_manager run setCustomerStatus, which is
  // how an abusive customer gets banned — support is who does that.
  support_manager: ["view", "create", "edit", "approve", "refund", "suspend", "export", "view_pii"],
  support_agent: ["view", "create", "edit", "view_pii"],
  vendor_manager: ["view", "create", "edit", "suspend", "approve", "export", "view_pii"],
  // +delete (deleteZone) and +approve (the onboarding review queue): both are
  // in the server's table for this role.
  delivery_manager: ["view", "create", "edit", "delete", "approve", "suspend", "export", "view_pii"],
  stay_manager: ["view", "create", "edit", "suspend", "approve", "export", "view_pii"],
  // +delete: marketing owns home collections, including removing them.
  marketing_manager: ["view", "create", "edit", "delete", "export"],
  analytics: ["view", "export", "view_financial"],
  developer: ["view", "create", "edit", "export"],
  auditor: ["view", "export", "view_financial"],
};

export function roleCan(role: Role, perm: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(perm);
}

export const isValidRole = (r: unknown): r is Role =>
  typeof r === "string" && r in ROLE_PERMISSIONS;

export type Workspace =
  | "dashboard"
  | "orders"
  | "customers"
  | "vendors"
  | "delivery"
  | "markets"
  | "finance"
  | "stay"
  | "mess"
  | "support"
  | "quality"
  | "growth"
  | "analytics"
  | "settings";

export const WORKSPACE_LABELS: Record<Workspace, string> = {
  dashboard: "Dashboard",
  orders: "Orders & Ops",
  customers: "Customers",
  vendors: "Vendors",
  delivery: "Delivery",
  markets: "Markets & Zones",
  finance: "Finance",
  stay: "KadaStay",
  mess: "Kada Mess",
  support: "AI & Support",
  quality: "Quality & Trust",
  growth: "Growth",
  analytics: "Analytics",
  settings: "Settings",
};

const ALL_WORKSPACES: Workspace[] = [
  "dashboard",
  "orders",
  "customers",
  "vendors",
  "delivery",
  "markets",
  "finance",
  "stay",
  "mess",
  "support",
  "quality",
  "growth",
  "analytics",
  "settings",
];

export const WORKSPACE_ACCESS: Record<Role, Workspace[]> = {
  super_admin: ALL_WORKSPACES,
  platform_admin: ALL_WORKSPACES,
  ops_manager: [
    "dashboard",
    "orders",
    "customers",
    "vendors",
    "delivery",
    "markets",
    "stay",
    "mess",
    "support",
    "quality",
    "analytics",
  ],
  finance_manager: [
    "dashboard",
    "vendors",
    "finance",
    "mess",
    "analytics",
    "settings",
  ],
  support_manager: [
    "dashboard",
    "orders",
    "customers",
    "vendors",
    "support",
    "quality",
    "analytics",
  ],
  support_agent: [
    "dashboard",
    "orders",
    "customers",
    "support",
  ],
  vendor_manager: [
    "dashboard",
    "vendors",
    "mess",
    "quality",
    "growth",
    "analytics",
  ],
  delivery_manager: [
    "dashboard",
    "orders",
    "delivery",
    "markets",
    "quality",
    "analytics",
  ],
  stay_manager: [
    "dashboard",
    "stay",
    "markets",
    "quality",
    "analytics",
  ],
  marketing_manager: [
    "dashboard",
    "customers",
    "growth",
    "analytics",
  ],
  analytics: [
    "dashboard",
    "analytics",
  ],
  developer: [
    "dashboard",
    "settings",
  ],
  auditor: [
    "dashboard",
    "finance",
    "quality",
    "analytics",
    "settings",
  ],
};

export function canAccessWorkspace(role: Role, workspace: Workspace): boolean {
  if (role === "super_admin" || role === "platform_admin") return true;
  return (WORKSPACE_ACCESS[role] ?? []).includes(workspace);
}

/**
 * Which capability each server action needs.
 *
 * The console gates its buttons on permissions; `adminPlatformAction` gates the
 * same operations on roles (its own ACTION_ROLES table). Two tables, written
 * separately, that have to agree — and they did not: platform_admin could
 * refund and grant admins server-side, but the UI's permission matrix withheld
 * both, so the buttons were never rendered for that role. Nothing reported it,
 * because a hidden button looks exactly like a feature that doesn't exist.
 *
 * This mapping makes the relationship explicit, and `scripts/doctor.mjs` fails
 * the build when the two tables disagree: a role the server allows but the UI
 * hides is a capability silently lost, and a role the UI offers but the server
 * refuses is a button that errors on click.
 *
 * Note this only pins the code. ROLE_PERMISSIONS can also be overridden at
 * runtime from config/admin_rbac (see usePermissions), which the static check
 * cannot see.
 */
export const ACTION_PERMISSION: Record<string, Permission> = {
  adjustWallet: "refund",
  refundOrder: "refund",
  approveRefund: "approve",
  rejectRefund: "approve",
  retryRefund: "refund",
  refundSubscription: "refund",
  // Re-running a stored gateway event can apply money (idempotently).
  replayWebhookEvent: "view_financial",
  sealOrderFinance: "view_financial",
  setCustomerStatus: "suspend",
  // Vendor account actions merged from the vendor_dash folder (2026-10-13 sync).
  setVendorStatus: "suspend",
  resetVendorPassword: "edit",
  setCommission: "view_financial",
  setBillingModel: "view_financial",
  upsertMarket: "create",
  deleteMarket: "delete",
  upsertZone: "create",
  deleteZone: "delete",
  moderateReview: "approve",
  upsertHomeCollection: "create",
  deleteHomeCollection: "delete",
  upsertIncident: "create",
  upsertCancellationReason: "create",
  generateHostSettlements: "view_financial",
  settleHostPayout: "view_financial",
  grantAdmin: "manage_admins",
  revokeAdmin: "manage_admins",
  seedDefaultOps: "create",
  transitionOnboarding: "approve",
  reviewOnboardingStep: "approve",
  setBankVerification: "view_financial",
  overrideOnboardingZone: "edit",
  setOnboardingRequirements: "edit",
};
