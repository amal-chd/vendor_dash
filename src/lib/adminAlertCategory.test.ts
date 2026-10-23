import { describe, it, expect } from "vitest";
import { categorizeAdminNotification as cat } from "./adminAlertCategory";

describe("categorizeAdminNotification", () => {
  it("routes the alert types the backend actually raises", () => {
    expect(cat({ type: "support_sla_breach" })).toMatchObject({ category: "support", severity: "critical" });
    expect(cat({ type: "support_escalation" })).toMatchObject({ category: "support", severity: "warning" });
    expect(cat({ type: "stay_payment_unverified" })).toMatchObject({ category: "finance", severity: "critical" });
    expect(cat({ type: "refund_failed" })).toMatchObject({ category: "finance", severity: "critical" });
    expect(cat({ type: "cod_deposit_excess" })).toMatchObject({ category: "finance", severity: "warning" });
    expect(cat({ type: "delivery_exception" })).toMatchObject({ category: "operations", severity: "critical" });
  });

  it("honours a declared severity and an admin href", () => {
    expect(cat({ type: "anything", severity: "high", href: "/admin/stay" })).toEqual({
      category: "operations",
      severity: "critical",
      href: "/admin/stay",
    });
  });

  it("never follows a non-admin href", () => {
    expect(cat({ type: "refund_failed", href: "https://evil.example" }).href).toBe("/admin/finance");
  });
});
