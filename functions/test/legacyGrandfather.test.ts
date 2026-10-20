import { describe, expect, it } from "vitest";
import { isUninitialisedLegacyLive } from "../src/onboarding/backfill";

describe("legacy-live partners opening the new wizard", () => {
  it("recognises an approved rider with no onboarding record", () => {
    expect(isUninitialisedLegacyLive("rider", { status: "approved" })).toBe(true);
  });

  it("repairs an approved rider an older wizard flipped to incomplete", () => {
    expect(isUninitialisedLegacyLive("rider", {
      status: "approved",
      onboarding: { state: "incomplete", steps: { personal_details: true } },
    })).toBe(true);
  });

  it("leaves genuine applicants alone", () => {
    // Created after the engine: the trigger ticks `account` and sets isActive false.
    expect(isUninitialisedLegacyLive("rider", {
      status: "pending_approval",
      onboarding: { state: "incomplete", steps: { account: true } },
    })).toBe(false);
    expect(isUninitialisedLegacyLive("vendor", {
      isActive: false,
      onboarding: { state: "started", steps: { account: true } },
    })).toBe(false);
  });

  it("never overrides a decision the engine or a person made", () => {
    for (const state of ["submitted", "action_required", "suspended", "active"]) {
      expect(isUninitialisedLegacyLive("rider", { status: "approved", onboarding: { state } })).toBe(false);
    }
    expect(isUninitialisedLegacyLive("rider", {
      status: "approved",
      onboarding: { state: "incomplete", migratedFromLegacy: true },
    })).toBe(false);
  });

  it("does not grandfather a rider who was never approved, or is blocked", () => {
    expect(isUninitialisedLegacyLive("rider", { status: "pending_approval" })).toBe(false);
    expect(isUninitialisedLegacyLive("rider", { status: "approved", isBlocked: true })).toBe(false);
  });
});
