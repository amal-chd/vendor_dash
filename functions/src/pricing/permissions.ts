/**
 * Who may change which part of pricing. Enforced server-side in the pricing
 * admin callable; the admin panel mirrors it only to hide controls.
 *
 * Roles are the existing `adminRole` custom claims (src/lib/rbac.ts):
 * Finance owns tax, commission, fees, settlements and rounding; Operations and
 * Delivery own delivery pricing, surge and rider pay; Marketing owns
 * promotions and coupons; Stay owns nightly rates and stay fees.
 */
import type { RuleKind } from "./rules";

const SUPER = ["super_admin", "platform_admin"];
const FINANCE = [...SUPER, "finance_manager"];
const OPERATIONS = [...SUPER, "ops_manager", "delivery_manager"];
const MARKETING = [...SUPER, "marketing_manager"];
const STAY = [...SUPER, "stay_manager"];

export const RULE_KIND_ROLES: Readonly<Record<RuleKind, readonly string[]>> = {
  tax_category: FINANCE,
  tax_assignment: FINANCE,
  commission: FINANCE,
  stay_commission: FINANCE,
  platform_fee: FINANCE,
  settlement: FINANCE,
  refund_policy: FINANCE,
  rounding: FINANCE,
  pipeline: FINANCE,
  small_order_fee: [...FINANCE, "ops_manager"],
  packaging: [...FINANCE, "ops_manager", "vendor_manager"],
  delivery_fee: OPERATIONS,
  surge: OPERATIONS,
  rider_earning: [...OPERATIONS, "finance_manager"],
  promotion: MARKETING,
  stay_rate: STAY,
  stay_fee: [...STAY, "finance_manager"],
};

/** Roles that may run the pricing simulator and read financial waterfalls. */
export const SIMULATOR_ROLES: readonly string[] = [
  ...SUPER, "finance_manager", "ops_manager", "delivery_manager", "marketing_manager", "stay_manager", "analytics", "auditor",
];

/** Bootstrap owners without an explicit claim resolve to super_admin, as elsewhere. */
export function resolveAdminRole(claims: Record<string, unknown> | undefined): string {
  const r = claims?.adminRole;
  return typeof r === "string" && r ? r : "super_admin";
}

export function canManageRuleKind(role: string, kind: RuleKind): boolean {
  return (RULE_KIND_ROLES[kind] ?? SUPER).includes(role);
}

export function canSimulate(role: string): boolean {
  return SIMULATOR_ROLES.includes(role);
}
