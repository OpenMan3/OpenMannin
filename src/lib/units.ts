/**
 * User-facing units for the Isle of Man.
 *
 * The island drives on the left and measures road distance in miles, yards and
 * feet and speed in miles per hour - it is the only place in the British Isles
 * where this is legislated as its own thing, but the conventions match the UK.
 * Everything internal (the routing graph, step geometry, profile speeds) stays
 * SI: metres and seconds. This module is the single boundary where SI becomes
 * the imperial units a person actually reads.
 *
 * PURE: no DOM, no dependencies - testable under `node --test`.
 */

const METRES_PER_FOOT = 0.3048;
const METRES_PER_YARD = 0.9144;
const METRES_PER_MILE = 1609.344;
const KMH_PER_MPH = 1.609344;

/** Below this (50 yards-ish) a distance reads better in feet. */
const FEET_CEILING_M = 45.72;
/** Below this (a quarter mile) a distance reads better in yards. */
const YARDS_CEILING_M = METRES_PER_MILE / 4;

/**
 * A road distance in the units a driver or walker on the island expects:
 * feet for the last few dozen metres, yards up to a quarter mile, then miles.
 * Rounded to the nearest 10 of the small units - spurious precision (a turn
 * "in 327 feet") helps no one.
 */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) m = 0;
  if (m < FEET_CEILING_M) {
    const feet = Math.max(10, Math.round(m / METRES_PER_FOOT / 10) * 10);
    return `${feet} ft`;
  }
  if (m < YARDS_CEILING_M) {
    const yards = Math.max(10, Math.round(m / METRES_PER_YARD / 10) * 10);
    return `${yards} yd`;
  }
  const miles = m / METRES_PER_MILE;
  return `${miles >= 10 ? miles.toFixed(0) : miles.toFixed(1)} mi`;
}

/** A distance in miles, for a single number (route totals, "3.4 mi"). */
export function formatMiles(m: number): string {
  if (!Number.isFinite(m) || m < 0) m = 0;
  const miles = m / METRES_PER_MILE;
  return `${miles >= 10 ? miles.toFixed(0) : miles.toFixed(1)} mi`;
}

/** A speed given in km/h as miles per hour; the island's only speed unit. */
export function formatSpeedMph(kmh: number): string {
  if (!Number.isFinite(kmh)) return "-";
  return `${Math.round(kmh / KMH_PER_MPH)} mph`;
}

/** Kilometres per hour as a bare miles-per-hour number. */
export function kmhToMph(kmh: number): number {
  return kmh / KMH_PER_MPH;
}

/** Miles per hour as kilometres per hour. */
export function mphToKmh(mph: number): number {
  return mph * KMH_PER_MPH;
}

/** A duration in seconds as a human-readable string (e.g., "5 min", "1 h 20 min"). */
export function formatDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  if (s < 45) return "<1 min";
  if (s < 3600) {
    const min = Math.round(s / 60);
    return `${min} min`;
  }
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  return min > 0 ? `${h} h ${min} min` : `${h} h`;
}
