/**
 * Smoothing primitives for the live position.
 *
 * WHY THIS EXISTS. Geolocation delivers fixes at roughly 1 Hz and the browser
 * may hand back a cached one, so the raw dot jumps several metres each tick and
 * the camera steps after it. Driving speed makes both obvious. These helpers
 * let the host draw a position that eases toward each new fix between ticks, so
 * the dot and the camera move continuously rather than stuttering.
 *
 * PURE: no DOM, no MapLibre, no timers - the requestAnimationFrame loop lives
 * in host.ts and only calls these. That is what keeps them testable under
 * `node --test`.
 */

import { haversineM } from "./steps.ts";

export interface LngLat {
  lon: number;
  lat: number;
}

/** Cubic ease-in-out on a clamped 0..1 progress. */
export function easeInOutCubic(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Straight-line interpolation between two lon/lat points (degrees). */
export function lerpPoint(a: LngLat, b: LngLat, t: number): LngLat {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return { lon: a.lon + (b.lon - a.lon) * x, lat: a.lat + (b.lat - a.lat) * x };
}

/**
 * Interpolate a compass bearing along the shorter arc, in degrees. Returns
 * `b` when there is no previous bearing to turn from, so a first fix snaps
 * rather than sweeping in from an arbitrary angle.
 */
export function lerpAngle(a: number | null, b: number | null, t: number): number | null {
  if (b === null || !Number.isFinite(b)) return a;
  if (a === null || !Number.isFinite(a)) return b;
  const delta = ((((b - a) % 360) + 540) % 360) - 180; // shortest signed turn
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return (a + delta * x + 360) % 360;
}

/**
 * Whether a GPS transition is physically plausible. A fix that implies more
 * than `maxSpeedMps` over the elapsed time is a dropout/jump, not motion, and
 * must not teleport the dot or drag the camera with it. Non-positive elapsed
 * time means a duplicate or out-of-order fix: not something to follow.
 */
export function isPlausibleTransition(
  prev: LngLat,
  next: LngLat,
  dtS: number,
  maxSpeedMps = 70,
): boolean {
  if (!(dtS > 0)) return false;
  const distM = haversineM(prev.lon, prev.lat, next.lon, next.lat);
  return distM / dtS <= maxSpeedMps;
}
