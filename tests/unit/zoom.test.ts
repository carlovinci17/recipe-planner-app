import { describe, expect, it } from "vitest";
import { clampZoom, NO_ZOOM, zoomAbout } from "@/lib/recipes/zoom";

const size = { width: 400, height: 300 };

describe("clampZoom", () => {
  it("keeps the zoom between 1× and 4×", () => {
    expect(clampZoom({ scale: 0.5, x: 0, y: 0 }, size).scale).toBe(1);
    expect(clampZoom({ scale: 9, x: 0, y: 0 }, size).scale).toBe(4);
  });

  it("allows no dragging at 1×, so the image always snaps back to centre", () => {
    expect(clampZoom({ scale: 1, x: 120, y: -80 }, size)).toEqual(NO_ZOOM);
  });

  it("stops the image being dragged past its own edge", () => {
    // At 2× a 400×300 image is 800×600, so it can move at most 200 / 150 each way.
    expect(clampZoom({ scale: 2, x: 999, y: -999 }, size)).toEqual({ scale: 2, x: 200, y: -150 });
  });
});

describe("zoomAbout", () => {
  it("keeps the tapped point under the finger when zooming in", () => {
    const tap = { x: 100, y: 50 };
    const z = zoomAbout(NO_ZOOM, tap, tap, 2);
    // The image point that was at (100, 50) is drawn at x + scale * point.
    expect(z.x + z.scale * tap.x).toBeCloseTo(tap.x);
    expect(z.y + z.scale * tap.y).toBeCloseTo(tap.y);
  });

  it("follows the fingers as they move during a pinch", () => {
    const start = { scale: 2, x: 20, y: -10 };
    const from = { x: 0, y: 0 };
    const to = { x: 30, y: 15 };
    const z = zoomAbout(start, from, to, 3);
    // The image point that was under the fingers at the start …
    const imagePoint = { x: (from.x - start.x) / start.scale, y: (from.y - start.y) / start.scale };
    // … is under them now.
    expect(z.x + z.scale * imagePoint.x).toBeCloseTo(to.x);
    expect(z.y + z.scale * imagePoint.y).toBeCloseTo(to.y);
  });
});
