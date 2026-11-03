/**
 * Pinch-zoom maths for the fullscreen gallery. Pure, so it can be tested.
 *
 * The image is drawn with `transform: translate(x, y) scale(scale)` around its
 * centre, so every point here is measured from the image's centre, in pixels.
 */
export type ZoomState = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** How far a double-tap zooms in. */
export const TAP_ZOOM = 2.5;

export const NO_ZOOM: ZoomState = { scale: 1, x: 0, y: 0 };

/** `+ 0` turns -0 into 0, which reads better and compares equal in tests. */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)) + 0;

/**
 * Keep the zoom between MIN_ZOOM and MAX_ZOOM, and stop the image being dragged
 * so far that empty space shows beside it. `size` is the image's on-screen size
 * at 1× zoom.
 */
export function clampZoom(state: ZoomState, size: { width: number; height: number }): ZoomState {
  const scale = clamp(state.scale, MIN_ZOOM, MAX_ZOOM);
  const maxX = ((scale - 1) * size.width) / 2;
  const maxY = ((scale - 1) * size.height) / 2;
  return { scale, x: clamp(state.x, -maxX, maxX), y: clamp(state.y, -maxY, maxY) };
}

/**
 * Zoom to `scale` so the part of the image that was under `from` (when the
 * gesture started, at `start`) is now under `to`. For a pinch, `from` and `to`
 * are the midpoint between the fingers then and now, so the picture zooms and
 * follows the fingers; for a double-tap they are the same point.
 */
export function zoomAbout(start: ZoomState, from: Point, to: Point, scale: number): ZoomState {
  const k = scale / start.scale;
  return { scale, x: to.x - k * (from.x - start.x), y: to.y - k * (from.y - start.y) };
}
