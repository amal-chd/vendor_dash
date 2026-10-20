import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin", () => ({
  firestore: Object.assign(() => ({}), { FieldValue: {}, Timestamp: {} }),
}));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_o: unknown, h: unknown) => h,
  HttpsError: class extends Error {},
}));
vi.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: (_o: unknown, h: unknown) => h }));
vi.mock("firebase-functions", () => ({ logger: { info: () => {}, error: () => {}, warn: () => {} } }));

const { dayKey, istMidnightTomorrow } = await import("../src/mess");

// A mess day is a day in Kochi: the kitchen cooks lunch on an IST date. These
// keys previously came from UTC date components, so between 00:00 and 05:30 IST
// the UTC date was still yesterday — the calendar showed one date, the skip was
// stored against another, and settlement paid the kitchen for the wrong day.
// The bug only existed in a 5.5-hour window, which is exactly why it needs a
// test rather than a careful reader.

describe("dayKey", () => {
  it("uses the IST date during the window where UTC is still yesterday", () => {
    // 02:00 IST on 5 Oct is 20:30 UTC on 4 Oct. The meal is on the 5th.
    expect(dayKey(new Date("2026-10-04T20:30:00Z"))).toBe("2026-10-05");
  });

  it("agrees with UTC during the rest of the day", () => {
    // 15:00 IST on 5 Oct is 09:30 UTC the same day.
    expect(dayKey(new Date("2026-10-05T09:30:00Z"))).toBe("2026-10-05");
  });

  it("rolls over exactly at IST midnight, not UTC midnight", () => {
    // 18:29:59 UTC is 23:59:59 IST — still the 4th.
    expect(dayKey(new Date("2026-10-04T18:29:59Z"))).toBe("2026-10-04");
    // 18:30:00 UTC is 00:00:00 IST on the 5th.
    expect(dayKey(new Date("2026-10-04T18:30:00Z"))).toBe("2026-10-05");
  });

  it("handles a month boundary in IST", () => {
    // 21:00 UTC on 31 Oct is 02:30 IST on 1 Nov.
    expect(dayKey(new Date("2026-10-31T21:00:00Z"))).toBe("2026-11-01");
  });
});

describe("istMidnightTomorrow", () => {
  it("is the next IST midnight, expressed as a UTC instant", () => {
    // 10:00 IST on 3 Oct (04:30 UTC) -> midnight IST on 4 Oct = 18:30 UTC 3 Oct.
    expect(istMidnightTomorrow(new Date("2026-10-03T04:30:00Z")).toISOString())
      .toBe("2026-10-03T18:30:00.000Z");
  });

  it("does not skip a day when called just after IST midnight", () => {
    // 00:30 IST on 4 Oct is 19:00 UTC on 3 Oct; tomorrow is the 5th.
    expect(istMidnightTomorrow(new Date("2026-10-03T19:00:00Z")).toISOString())
      .toBe("2026-10-04T18:30:00.000Z");
  });

  it("keeps the cutoff a whole day ahead of the meal it protects", () => {
    // The kitchen must not lose a lunch it already started: a skip for today
    // is always before the cutoff and so refused.
    const now = new Date("2026-10-03T06:00:00Z"); // 11:30 IST
    expect(new Date("2026-10-03T06:30:00Z").getTime()).toBeLessThan(istMidnightTomorrow(now).getTime());
  });
});
