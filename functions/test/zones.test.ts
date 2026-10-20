import { describe, it, expect } from "vitest";
import {
  pointInPolygon,
  bboxOf,
  inBBox,
  centroidOf,
  areaSqKm,
  isSelfIntersecting,
  haversineKm,
  normaliseEconomics,
  type LatLng,
} from "../src/zones";

// A rough square over central Kochi. Zone geometry decides serviceability and
// delivery pricing, so every case below is a way the platform could quote the
// wrong fee or refuse a real customer.
const KOCHI: LatLng[] = [
  { lat: 9.99, lng: 76.26 },
  { lat: 9.99, lng: 76.32 },
  { lat: 10.03, lng: 76.32 },
  { lat: 10.03, lng: 76.26 },
];

describe("pointInPolygon", () => {
  it("accepts a point well inside the ring", () => {
    expect(pointInPolygon({ lat: 10.01, lng: 76.29 }, KOCHI)).toBe(true);
  });

  it("rejects a point outside on every side", () => {
    expect(pointInPolygon({ lat: 9.98, lng: 76.29 }, KOCHI)).toBe(false);
    expect(pointInPolygon({ lat: 10.04, lng: 76.29 }, KOCHI)).toBe(false);
    expect(pointInPolygon({ lat: 10.01, lng: 76.25 }, KOCHI)).toBe(false);
    expect(pointInPolygon({ lat: 10.01, lng: 76.33 }, KOCHI)).toBe(false);
  });

  it("rejects a degenerate ring rather than matching everything", () => {
    expect(pointInPolygon({ lat: 10.01, lng: 76.29 }, [])).toBe(false);
    expect(pointInPolygon({ lat: 10.01, lng: 76.29 }, KOCHI.slice(0, 2))).toBe(false);
  });

  // Adjacent zones are drawn sharing a border. A point on that border must
  // land in exactly one of them — never both (double-counted revenue) and
  // never neither (a customer told Kada does not serve their street).
  it("assigns a point on a shared border to exactly one of two zones", () => {
    const west: LatLng[] = [
      { lat: 9.99, lng: 76.26 },
      { lat: 9.99, lng: 76.29 },
      { lat: 10.03, lng: 76.29 },
      { lat: 10.03, lng: 76.26 },
    ];
    const east: LatLng[] = [
      { lat: 9.99, lng: 76.29 },
      { lat: 9.99, lng: 76.32 },
      { lat: 10.03, lng: 76.32 },
      { lat: 10.03, lng: 76.29 },
    ];
    const onBorder = { lat: 10.01, lng: 76.29 };
    const hits = [west, east].filter((z) => pointInPolygon(onBorder, z));
    expect(hits).toHaveLength(1);
  });

  it("handles a concave ring — a point in the notch is outside", () => {
    // An L-shape: the notch is the top-right quadrant.
    const L: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 5, lng: 10 },
      { lat: 5, lng: 5 },
      { lat: 10, lng: 5 },
      { lat: 10, lng: 0 },
    ];
    expect(pointInPolygon({ lat: 2, lng: 2 }, L)).toBe(true);
    expect(pointInPolygon({ lat: 8, lng: 8 }, L)).toBe(false);
  });
});

describe("bbox pre-filter", () => {
  it("bounds the ring", () => {
    expect(bboxOf(KOCHI)).toEqual({
      minLat: 9.99,
      maxLat: 10.03,
      minLng: 76.26,
      maxLng: 76.32,
    });
  });

  // The bbox is only a cheap pre-filter, so it must never exclude a point the
  // polygon test would have accepted.
  it("contains every point the polygon accepts", () => {
    const box = bboxOf(KOCHI);
    for (let lat = 9.98; lat <= 10.04; lat += 0.005) {
      for (let lng = 76.25; lng <= 76.33; lng += 0.005) {
        const p = { lat, lng };
        if (pointInPolygon(p, KOCHI)) expect(inBBox(p, box)).toBe(true);
      }
    }
  });
});

describe("centroid and area", () => {
  it("centres a square on its middle", () => {
    const c = centroidOf(KOCHI);
    expect(c.lat).toBeCloseTo(10.01, 6);
    expect(c.lng).toBeCloseTo(76.29, 6);
  });

  it("measures a square close to its true size", () => {
    // ~0.04° lat ≈ 4.42 km, ~0.06° lng at 10°N ≈ 6.58 km → ≈ 29 km².
    expect(areaSqKm(KOCHI)).toBeGreaterThan(25);
    expect(areaSqKm(KOCHI)).toBeLessThan(33);
  });

  it("reports zero for a degenerate ring", () => {
    expect(areaSqKm(KOCHI.slice(0, 2))).toBe(0);
  });
});

describe("isSelfIntersecting", () => {
  it("passes a simple square", () => {
    expect(isSelfIntersecting(KOCHI)).toBe(false);
  });

  it("catches a bow-tie", () => {
    const bowtie: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 10 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 0 },
    ];
    expect(isSelfIntersecting(bowtie)).toBe(true);
  });

  it("passes a concave but simple ring", () => {
    const L: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 5, lng: 10 },
      { lat: 5, lng: 5 },
      { lat: 10, lng: 5 },
      { lat: 10, lng: 0 },
    ];
    expect(isSelfIntersecting(L)).toBe(false);
  });
});

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm({ lat: 10, lng: 76 }, { lat: 10, lng: 76 })).toBe(0);
  });

  it("matches the known Kochi→Thrissur distance", () => {
    const d = haversineKm({ lat: 9.9312, lng: 76.2673 }, { lat: 10.5276, lng: 76.2144 });
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(75);
  });
});

describe("normaliseEconomics", () => {
  it("fills defaults for a zone that configures nothing", () => {
    const e = normaliseEconomics({});
    expect(e.deliveryBaseFee).toBe(25);
    expect(e.deliveryPerKm).toBe(7);
    expect(e.maxDeliveryRadiusKm).toBe(15);
  });

  // A negative fee would pay the customer to order; a missing value must fall
  // back rather than become NaN and poison the total.
  it("rejects negative and non-numeric values", () => {
    const e = normaliseEconomics({ deliveryBaseFee: -50, deliveryPerKm: "abc" });
    expect(e.deliveryBaseFee).toBe(25);
    expect(e.deliveryPerKm).toBe(7);
  });

  it("caps the delivery radius so no zone can claim an unbounded area", () => {
    expect(normaliseEconomics({ maxDeliveryRadiusKm: 500 }).maxDeliveryRadiusKm).toBe(30);
  });

  it("keeps a zero fee, which is a legitimate promotional setting", () => {
    expect(normaliseEconomics({ deliveryBaseFee: 0 }).deliveryBaseFee).toBe(0);
  });
});
