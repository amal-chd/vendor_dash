import { describe, expect, it } from "vitest";
import { adminModuleHome, getAdminModule, groupsForModule, moduleForLocation, moduleLink, visibleAdminModules } from "@/lib/adminModules";
import { ADMIN_NAV, adminNavItemIsActive, workspaceForAdminPath } from "@/lib/adminNavigation";

describe("admin module navigation", () => {
  it("keeps a product selected across shared links and supports older bookmarks", () => {
    const link = moduleLink("/admin/orders?tab=live", "kada-delivery");
    expect(link).toBe("/admin/orders?tab=live&module=kada-delivery");
    expect(moduleForLocation("/admin/orders", "?tab=live&module=kada-delivery")).toBe("kada-delivery");
    expect(moduleForLocation("/admin/stay/hosts/123", "")).toBe("kada-stay");
    expect(moduleForLocation("/admin/products/puzlume", "?module=kada-stay")).toBe("puzlume");
    expect(moduleForLocation("/admin/settings", "?module=unknown")).toBe("platform");
  });

  it("finds an allowed route for a delegated admin without dashboard access", () => {
    const canOpen = (path: string) => workspaceForAdminPath(path.split("?")[0]) === "stay";
    expect(visibleAdminModules(canOpen).map((module) => module.id)).toEqual(["platform", "kada-stay"]);
    expect(adminModuleHome(getAdminModule("kada-stay"), canOpen)).toBe("/admin/stay?module=kada-stay");
    expect(adminModuleHome(getAdminModule("platform"), canOpen)).toBe("/admin/stay");
    expect(workspaceForAdminPath("/verse-app/")).toBe("dashboard");
  });

  it("provides an authorized destination for every registry and product link", () => {
    for (const group of [...ADMIN_NAV, ...groupsForModule(getAdminModule("kada-dine"))]) {
      for (const item of group.items) expect(workspaceForAdminPath(item.path.split("?")[0])).toBeTruthy();
    }
    expect(workspaceForAdminPath("/admin/products/puzlume")).toBe("dashboard");
  });

  it("matches default tabs and ignores the active module when highlighting tools", () => {
    expect(adminNavItemIsActive("/admin/stay", "/admin/stay", "?tab=overview&module=kada-stay")).toBe(true);
    expect(adminNavItemIsActive("/admin/stay", "/admin/stay", "?tab=hosts&module=kada-stay")).toBe(false);
    expect(adminNavItemIsActive("/admin/products", "/admin/products/puzlume", "")).toBe(false);
    expect(adminNavItemIsActive("/admin/growth?tab=brand&brand=kada-dine", "/admin/growth", "?tab=brand&brand=sellrapp")).toBe(false);
  });
});
