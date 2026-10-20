import { describe, expect, it } from "vitest";
import { decideAutoProgress, dueNudge, pathToActive, type AutoProgressInput } from "../src/onboarding/autoProgress";
import { canTransition, type OnboardingState } from "../src/onboarding/stateMachine";

const base = (over: Partial<AutoProgressInput> = {}): AutoProgressInput => ({
  state: "incomplete",
  missing: [],
  checkedDocuments: [
    { id: "pan", label: "PAN card" },
    { id: "fssai", label: "FSSAI licence" },
  ],
  documentChecks: { pan: { status: "auto_verified" }, fssai: { status: "auto_verified" } },
  bankState: "verified",
  zoneId: "kochi-central",
  riskFlags: [],
  blockingReasons: [],
  ...over,
});

describe("automatic go-live decision", () => {
  it("activates when every automatic check passed", () => {
    expect(decideAutoProgress(base())).toEqual({ kind: "activate" });
  });

  it("does nothing while mandatory steps are still missing", () => {
    expect(decideAutoProgress(base({ missing: ["menu"] }))).toEqual({ kind: "none" });
  });

  it("never touches a partner a person already moved on (approved, active, suspended)", () => {
    for (const state of ["approved", "commercial_setup", "ready_for_activation", "active", "suspended"] as OnboardingState[]) {
      expect(decideAutoProgress(base({ state })).kind).toBe("none");
    }
  });

  it("waits while a document or the bank is still being checked", () => {
    const d = decideAutoProgress(base({ documentChecks: { pan: { status: "checking" }, fssai: { status: "auto_verified" } }, bankState: "pending_verification" }));
    expect(d.kind).toBe("wait");
    expect(d.kind === "wait" && d.reasons.join(" ")).toMatch(/PAN card.*bank/);
  });

  it("queues for a person when a document was flagged, unchecked, or outside the zone", () => {
    expect(decideAutoProgress(base({ documentChecks: { pan: { status: "needs_review" }, fssai: { status: "auto_verified" } } })).kind).toBe("review");
    expect(decideAutoProgress(base({ documentChecks: { pan: { status: "auto_verified" } } })).kind).toBe("review");
    expect(decideAutoProgress(base({ zoneId: null })).kind).toBe("review");
    expect(decideAutoProgress(base({ riskFlags: ["duplicate bank account"] })).kind).toBe("review");
    expect(decideAutoProgress(base({ bankState: "action_required" })).kind).toBe("review");
  });

  it("keeps waiting reasons alongside review reasons so ops sees everything", () => {
    const d = decideAutoProgress(base({ zoneId: null, bankState: "pending_verification" }));
    expect(d.kind).toBe("review");
    expect(d.kind === "review" && d.reasons.length).toBe(2);
  });
});

describe("path to active", () => {
  it("only takes legal state-machine steps from every automatable state", () => {
    for (const from of ["started", "incomplete", "action_required", "submitted", "kyc_review", "verification"] as OnboardingState[]) {
      let at = from;
      const path = pathToActive(from);
      expect(path.at(-1), `from ${from}`).toBe("active");
      for (const to of path) {
        expect(canTransition(at, to), `${at} → ${to}`).toBe(true);
        at = to;
      }
    }
  });
});

describe("onboarding reminders", () => {
  it("sends the 1, 3 and 7 day reminders once each, never before they're due", () => {
    expect(dueNudge(0, {})).toBeNull();
    expect(dueNudge(1, {})).toBe(1);
    expect(dueNudge(2, { d1: true })).toBeNull();
    expect(dueNudge(4, { d1: true })).toBe(3);
    expect(dueNudge(9, {})).toBe(7);
    expect(dueNudge(30, { d1: true, d3: true, d7: true })).toBeNull();
  });
});
