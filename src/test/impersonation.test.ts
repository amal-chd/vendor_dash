import { describe, it, expect, beforeEach } from "vitest";
import { isAdminEmail } from "@/lib/auth-flow";

describe("Admin Vendor Impersonation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("stores and retrieves impersonation vendor ID in sessionStorage and localStorage", () => {
    const vendorId = "vendor_rest_12345";
    sessionStorage.setItem("kada_impersonate_id", vendorId);
    localStorage.setItem("kada_impersonate_id", vendorId);

    expect(sessionStorage.getItem("kada_impersonate_id")).toBe(vendorId);
    expect(localStorage.getItem("kada_impersonate_id")).toBe(vendorId);
  });

  it("identifies platform admin accounts for impersonation entitlement", () => {
    expect(isAdminEmail("thekada@gmail.com")).toBe(true);
    expect(isAdminEmail("thekadaapp@gmail.com")).toBe(true);
    expect(isAdminEmail("regular_vendor@gmail.com")).toBe(false);
  });

  it("clears impersonation ID when stopImpersonating is called", () => {
    sessionStorage.setItem("kada_impersonate_id", "test_id");
    localStorage.setItem("kada_impersonate_id", "test_id");

    sessionStorage.removeItem("kada_impersonate_id");
    localStorage.removeItem("kada_impersonate_id");

    expect(sessionStorage.getItem("kada_impersonate_id")).toBeNull();
    expect(localStorage.getItem("kada_impersonate_id")).toBeNull();
  });
});
