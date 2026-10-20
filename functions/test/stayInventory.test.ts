import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin", () => ({
  firestore: Object.assign(() => ({}), {
    FieldValue: { serverTimestamp: () => "ts" },
  }),
}));

const { nightsBetween, claimNights, releaseNights, shouldReleaseNights, isClosedBookingStatus } =
  await import("../src/stayInventory");

// Availability existed as a data model but nothing enforced it: bookedCount was
// only ever read, and createStayBooking never looked at it. A host could block a
// date and still receive a booking for it, and one room-night could be sold to
// any number of guests. These tests pin the enforcement.

const writes: { path: string; data: Record<string, unknown> }[] = [];
const tx = {
  set: (ref: { path: string }, data: Record<string, unknown>) => { writes.push({ path: ref.path, data }); },
} as never;
const db = {
  collection: (c: string) => ({
    doc: (d: string) => ({
      path: `${c}/${d}`,
      collection: (c2: string) => ({
        doc: (d2: string) => ({
          path: `${c}/${d}/${c2}/${d2}`,
          collection: (c3: string) => ({ doc: (d3: string) => ({ path: `${c}/${d}/${c2}/${d2}/${c3}/${d3}` }) }),
        }),
      }),
    }),
  }),
} as never;

const state = (night: string, over: Partial<{ isBlocked: boolean; bookedCount: number }> = {}) => ({
  night,
  isBlocked: false,
  bookedCount: 0,
  ...over,
});

describe("nightsBetween", () => {
  it("counts nights slept, not days touched", () => {
    // Checking in on the 1st and out on the 4th occupies 3 nights; the
    // check-out date itself is free for the next guest.
    expect(nightsBetween(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-04T00:00:00Z")))
      .toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("returns nothing for a same-day range", () => {
    expect(nightsBetween(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"))).toEqual([]);
  });

  it("crosses a month boundary", () => {
    expect(nightsBetween(new Date("2026-10-31T00:00:00Z"), new Date("2026-11-02T00:00:00Z")))
      .toEqual(["2026-10-31", "2026-11-01"]);
  });
});

describe("claimNights", () => {
  it("refuses a night the host has blocked", () => {
    expect(() => claimNights(tx, db, "h1", "r1", [state("2026-10-01", { isBlocked: true })], 1))
      .toThrowError(/closed 2026-10-01/);
  });

  it("refuses when the room is already sold out that night", () => {
    expect(() => claimNights(tx, db, "h1", "r1", [state("2026-10-02", { bookedCount: 1 })], 1))
      .toThrowError(/fully booked/);
  });

  it("allows a second booking when the room has inventory for it", () => {
    writes.length = 0;
    claimNights(tx, db, "h1", "r1", [state("2026-10-02", { bookedCount: 1 })], 3);
    expect(writes).toHaveLength(1);
    expect(writes[0].data.bookedCount).toBe(2);
  });

  it("rejects the whole stay if any single night is unavailable", () => {
    // Partially booking a stay would leave a guest with nowhere to sleep on
    // night two, so one bad night fails the lot.
    expect(() =>
      claimNights(tx, db, "h1", "r1", [state("2026-10-01"), state("2026-10-02", { bookedCount: 1 }), state("2026-10-03")], 1),
    ).toThrowError(/2026-10-02/);
  });

  it("writes one incremented counter per night", () => {
    writes.length = 0;
    claimNights(tx, db, "h1", "r1", [state("2026-10-01"), state("2026-10-02")], 1);
    expect(writes.map((w) => w.data.bookedCount)).toEqual([1, 1]);
    expect(writes[0].path).toContain("hotels/h1/rooms/r1/availability/2026-10-01");
  });
});

describe("releaseNights", () => {
  it("gives the night back", () => {
    writes.length = 0;
    releaseNights(tx, db, "h1", "r1", [state("2026-10-01", { bookedCount: 2 })]);
    expect(writes[0].data.bookedCount).toBe(1);
  });

  it("never goes negative, so a double release cannot make a room look free forever", () => {
    writes.length = 0;
    releaseNights(tx, db, "h1", "r1", [state("2026-10-01", { bookedCount: 0 })]);
    expect(writes[0].data.bookedCount).toBe(0);
  });
});

/**
 * Nights were claimed at booking time but released by exactly one path: the
 * unpaid-checkout sweeper. A guest cancelling, a host declining and ops
 * cancelling from the console all left the nights counted as sold forever, so
 * every cancellation permanently withdrew that room from sale on those dates.
 *
 * The release now happens on the status transition, which means the guard
 * against releasing TWICE is what protects other guests: releaseNights
 * decrements from a value it read, so a second release of the same booking
 * takes a night from 2 → 1 → 0 and frees a room somebody else paid for.
 */
describe("shouldReleaseNights", () => {
  const closed = ["cancelled", "canceled", "expired", "rejected", "declined", "no_show", "noshow"];

  it("releases on the transition into every closed status", () => {
    for (const after of closed) {
      expect(shouldReleaseNights({ before: "confirmed", after, alreadyReleased: false })).toBe(true);
    }
  });

  it("releases a booking cancelled before it was ever paid for", () => {
    // pending_payment still HOLDS nights — that is what stops two guests
    // paying for the same room — so abandoning it must give them back.
    expect(shouldReleaseNights({ before: "pending_payment", after: "cancelled", alreadyReleased: false })).toBe(true);
  });

  it("never releases twice, whatever re-fires the transition", () => {
    for (const after of closed) {
      expect(shouldReleaseNights({ before: "confirmed", after, alreadyReleased: true })).toBe(false);
    }
  });

  it("ignores a write that does not close the booking", () => {
    expect(shouldReleaseNights({ before: "pending_payment", after: "confirmed", alreadyReleased: false })).toBe(false);
    expect(shouldReleaseNights({ before: "confirmed", after: "checked_in", alreadyReleased: false })).toBe(false);
    expect(shouldReleaseNights({ before: "checked_in", after: "checked_out", alreadyReleased: false })).toBe(false);
  });

  it("ignores an edit to a booking that was already closed", () => {
    // e.g. ops adding a cancellation reason to a cancelled booking.
    expect(shouldReleaseNights({ before: "cancelled", after: "cancelled", alreadyReleased: false })).toBe(false);
    expect(shouldReleaseNights({ before: "cancelled", after: "no_show", alreadyReleased: false })).toBe(false);
  });

  it("reads the status the way the apps actually write it", () => {
    expect(isClosedBookingStatus("Cancelled")).toBe(true);
    expect(isClosedBookingStatus("NO_SHOW")).toBe(true);
    expect(isClosedBookingStatus("no show")).toBe(true);
    expect(isClosedBookingStatus("no-show")).toBe(true);
    expect(isClosedBookingStatus(" cancelled ")).toBe(true);
    expect(isClosedBookingStatus("confirmed")).toBe(false);
    expect(isClosedBookingStatus(undefined)).toBe(false);
    expect(isClosedBookingStatus("")).toBe(false);
  });

  it("releases exactly once across a realistic sequence of writes", () => {
    // confirmed → cancelled (release) → reason added → mirrored again
    let releasedAt: string | null = null;
    const writes = [
      { before: "confirmed", after: "cancelled" },
      { before: "cancelled", after: "cancelled" },
      { before: "cancelled", after: "cancelled" },
    ];
    let releases = 0;
    for (const w of writes) {
      if (shouldReleaseNights({ ...w, alreadyReleased: Boolean(releasedAt) })) {
        releases++;
        releasedAt = "ts";
      }
    }
    expect(releases).toBe(1);
  });
});
