import { describe, it, expect } from "vitest";
import { RULE_KIND_ROLES, canManageRuleKind, canSimulate, resolveAdminRole } from "../src/pricing/permissions";
import { RULE_KINDS } from "../src/pricing/rules";

describe("pricing permissions", () => {
  it("gives every rule kind an owner", () => {
    for (const kind of RULE_KINDS) expect(RULE_KIND_ROLES[kind].length).toBeGreaterThan(0);
  });

  it("lets Finance change GST and commission but not coupons", () => {
    expect(canManageRuleKind("finance_manager", "tax_category")).toBe(true);
    expect(canManageRuleKind("finance_manager", "commission")).toBe(true);
    expect(canManageRuleKind("finance_manager", "promotion")).toBe(false);
  });

  it("lets Marketing manage coupons only", () => {
    expect(canManageRuleKind("marketing_manager", "promotion")).toBe(true);
    expect(canManageRuleKind("marketing_manager", "tax_assignment")).toBe(false);
    expect(canManageRuleKind("marketing_manager", "surge")).toBe(false);
  });

  it("lets Operations manage delivery pricing and surge, not tax", () => {
    expect(canManageRuleKind("ops_manager", "surge")).toBe(true);
    expect(canManageRuleKind("delivery_manager", "delivery_fee")).toBe(true);
    expect(canManageRuleKind("ops_manager", "tax_category")).toBe(false);
  });

  it("keeps support agents out of pricing changes but lets auditors simulate", () => {
    for (const kind of RULE_KINDS) expect(canManageRuleKind("support_agent", kind)).toBe(false);
    expect(canSimulate("auditor")).toBe(true);
    expect(canSimulate("support_agent")).toBe(false);
  });

  it("treats a bootstrap admin without a role claim as super admin", () => {
    expect(resolveAdminRole({})).toBe("super_admin");
    expect(resolveAdminRole({ adminRole: "finance_manager" })).toBe("finance_manager");
  });
});
