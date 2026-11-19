import { describe, it, expect } from "vitest";
import { loadLeaflet, haversineKm, pointInPolygon, centroidOf, areaSqKm } from "@/lib/leaflet";

describe("leaflet loader and geo utils", () => {
  it("loads leaflet module and provides L object", async () => {
    const L = await loadLeaflet();
    expect(L).toBeDefined();
    expect(typeof L.map).toBe("function");
    expect(typeof L.polygon).toBe("function");
    expect(typeof L.circleMarker).toBe("function");
  });

  it("calculates haversine distance correctly", () => {
    // Distance between Kochi (9.9312, 76.2673) and Aluva (10.1076, 76.3516) is approx 21.5 km
    const dist = haversineKm(
      { lat: 9.9312, lng: 76.2673 },
      { lat: 10.1076, lng: 76.3516 },
    );
    expect(dist).toBeGreaterThan(19);
    expect(dist).toBeLessThan(24);
  });

  it("evaluates point-in-polygon correctly", () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];
    expect(pointInPolygon({ lat: 5, lng: 5 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 15, lng: 5 }, square)).toBe(false);
  });

  it("calculates centroid of a polygon", () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];
    const c = centroidOf(square);
    expect(c.lat).toBe(5);
    expect(c.lng).toBe(5);
  });

  it("calculates approximate area in square km", () => {
    const triangle = [
      { lat: 9.93, lng: 76.26 },
      { lat: 9.94, lng: 76.26 },
      { lat: 9.94, lng: 76.27 },
    ];
    const area = areaSqKm(triangle);
    expect(area).toBeGreaterThan(0);
  });
});
