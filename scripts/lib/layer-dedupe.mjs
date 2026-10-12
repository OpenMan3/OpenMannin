/**
 * Cross-layer duplicate detection.
 *
 * The layer registry is meant to partition the island's features, not repeat
 * them: a footway belongs to the footpaths layer OR the roads layer, a
 * defibrillator to essential-utilities OR emergency, and so on. When two ingest
 * queries both match the same OpenStreetMap tag, the same geometry ships in two
 * files — silent 3 MB of duplication that reads as two independent datasets.
 *
 * This module gives that a name so verify-registry can assert it stays at zero.
 */

/**
 * A stable key for a geometry's coordinates at `dp` decimal places.
 * Rounding matters: two ingest passes may write the same point to different
 * precision, and a raw string compare would miss the duplicate.
 */
export function geometryKey(geometry, dp = 5) {
  if (!geometry || geometry.coordinates === undefined) return null;
  const r = (n) => n.toFixed(dp);
  const walk = (c) =>
    typeof c[0] === "number" ? `${r(c[0])},${r(c[1])}` : c.map(walk).join("|");
  return walk(geometry.coordinates);
}

/** Number of coordinate keys present in both feature arrays. */
export function sharedCoordinateCount(featuresA, featuresB, dp = 5) {
  const a = new Set();
  for (const f of featuresA) {
    const k = geometryKey(f.geometry, dp);
    if (k !== null) a.add(k);
  }
  let n = 0;
  for (const f of featuresB) {
    const k = geometryKey(f.geometry, dp);
    if (k !== null && a.has(k)) n++;
  }
  return n;
}
