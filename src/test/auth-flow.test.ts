import { describe, it, expect, vi } from "vitest";
import { isAdminEmail, ADMIN_EMAILS, resolvePostAuthPath, setSignupIntent } from "../lib/auth-flow";

vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    doc: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
  };
});

import { getDoc, setDoc } from "firebase/firestore";

describe("auth-flow", () => {
  it("recognizes configured admin emails", () => {
    expect(isAdminEmail("thekada@gmail.com")).toBe(true);
    expect(isAdminEmail("THEKADA@GMAIL.COM")).toBe(true);
    expect(isAdminEmail("thekadaapp@gmail.com")).toBe(true);
  });

  it("rejects non-admin emails", () => {
    expect(isAdminEmail("random@user.com")).toBe(false);
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it("contains valid administrator list", () => {
    expect(ADMIN_EMAILS.length).toBeGreaterThan(0);
    expect(ADMIN_EMAILS).toContain("thekada@gmail.com");
  });

  it("routes new users to /setup (not /download-app)", async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => false,
    } as any);

    const mockUser: any = {
      uid: "user-123",
      email: "vendor@example.com",
      displayName: "My Restaurant",
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    const path = await resolvePostAuthPath(mockUser);
    expect(path).toBe("/setup");
  });

  it("routes existing uncompleted onboarding users to /setup", async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ onboardingComplete: false }),
    } as any);

    const mockUser: any = {
      uid: "user-456",
      email: "vendor2@example.com",
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    const path = await resolvePostAuthPath(mockUser);
    expect(path).toBe("/setup");
  });

  it("routes completed onboarding users to /dashboard", async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ onboardingComplete: true }),
    } as any);

    const mockUser: any = {
      uid: "user-789",
      email: "vendor3@example.com",
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    const path = await resolvePostAuthPath(mockUser);
    expect(path).toBe("/dashboard");
  });

  it("routes blocking onboarding states (started, incomplete, action_required) to /setup", async () => {
    for (const state of ["started", "incomplete", "action_required"]) {
      vi.mocked(getDoc).mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ onboarding: { state } }),
      } as any);

      const mockUser: any = {
        uid: "user-block-" + state,
        email: `vendor-${state}@example.com`,
        getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
      };

      const path = await resolvePostAuthPath(mockUser);
      expect(path).toBe("/setup");
    }
  });

  it("routes submitted and approved onboarding states to /dashboard", async () => {
    for (const state of ["submitted", "kyc_review", "verification", "approved", "active"]) {
      vi.mocked(getDoc).mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ onboarding: { state } }),
      } as any);

      const mockUser: any = {
        uid: "user-ok-" + state,
        email: `vendor-${state}@example.com`,
        getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
      };

      const path = await resolvePostAuthPath(mockUser);
      expect(path).toBe("/dashboard");
    }
  });

  it("routes mess kitchen with blocking onboarding state to /setup?type=mess", async () => {
    // 1st getDoc (restaurants) returns not found, 2nd getDoc (mess_kitchens) returns started state
    vi.mocked(getDoc)
      .mockResolvedValueOnce({ exists: () => false } as any)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ name: "Amma's Mess", onboarding: { state: "started" } }),
      } as any);

    const mockUser: any = {
      uid: "mess-user-1",
      email: "mess@example.com",
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    const path = await resolvePostAuthPath(mockUser);
    expect(path).toBe("/setup?type=mess");
  });

  it("routes active mess kitchen to /mess/dashboard", async () => {
    // 1st getDoc (restaurants) returns not found, 2nd getDoc (mess_kitchens) returns active state
    vi.mocked(getDoc)
      .mockResolvedValueOnce({ exists: () => false } as any)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ name: "Amma's Mess", onboarding: { state: "active" } }),
      } as any);

    const mockUser: any = {
      uid: "mess-user-active",
      email: "mess-active@example.com",
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    const path = await resolvePostAuthPath(mockUser);
    expect(path).toBe("/mess/dashboard");
  });

  it("creates mess kitchen profile without engine-owned fields when intent is mess", async () => {
    setSignupIntent("mess");
    vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => false } as any);

    const mockUser: any = {
      uid: "new-mess-1",
      email: "newmess@example.com",
      displayName: "Grandma's Kitchen",
      phoneNumber: "+919876543210",
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    const path = await resolvePostAuthPath(mockUser);
    expect(path).toBe("/setup?type=mess");
    
    const lastCall = vi.mocked(setDoc).mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        name: "Grandma's Kitchen",
        ownerName: "Grandma's Kitchen",
        ownerId: "new-mess-1",
        phone: "+919876543210",
        email: "newmess@example.com",
        mealsServed: ["lunch", "dinner"],
        dietType: "both",
        fulfilmentModes: ["delivery"],
      })
    );
    // Crucial: verify that engineOwnedFields (like 'onboarding', 'bank', etc.) are NEVER written
    const setDocPayload = lastCall?.[1] as any;
    expect(setDocPayload.onboarding).toBeUndefined();
    expect(setDocPayload.bank).toBeUndefined();
    expect(setDocPayload.isActive).toBeUndefined();
    expect(localStorage.getItem("kada_signup_account_type")).toBeNull();
  });

  it("routes mess kitchen with missing onboarding object to /setup?type=mess", async () => {
    // 1st getDoc (restaurants) returns not found, 2nd getDoc (mess_kitchens) returns doc without onboarding
    vi.mocked(getDoc)
      .mockResolvedValueOnce({ exists: () => false } as any)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ name: "Amma's Mess" }),
      } as any);

    const mockUser: any = {
      uid: "mess-user-no-ob",
      email: "mess@example.com",
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    const path = await resolvePostAuthPath(mockUser);
    expect(path).toBe("/setup?type=mess");
  });
});

