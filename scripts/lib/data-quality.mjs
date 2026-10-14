/**
 * Data-quality helpers for layer overlap reporting.
 *
 * Cross-layer duplication is not always a bug (a bridge way and its underlying
 * road share geometry), so these helpers are diagnostic-first: they name the
 * overlaps, then the registry/ingest passes decide which are intentional.
 */

const ID_KEYS = ["osm", "osmId", "osmID", "osm_id", "gid", "@id", "id"];

/** Last-write-wins order of candidate identity keys. */
export function candidateIdKeys(properties) {
  if (!properties || typeof properties !== "object") return [];
  return ID_KEYS.filter((k) => properties[k] !== undefined && properties[k] !== null)
    .map((k) => [k, properties[k]]);
}

/** Stable key for a feature (identity preferred, rounded geometry fallback). */
export function stableFeatureKey(properties, geometry) {
  for (const [k, v] of candidateIdKeys(properties)) {
    if (String(v).trim() !== "") return `${k}:${String(v).trim()}`;
  }
  if (!geometry || typeof geometry !== "object" || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  const round = (n) => Number(n).toFixed(6);
  const walk = (coords) =>
    typeof coords[0] === "number"
      ? `${round(coords[0])},${round(coords[1])}`
      : coords.map(walk).join("|");
  return `geom:${walk(geometry.coordinates)}`;
}

/** Count keys present in both feature arrays. */
export function countSharedKeys(featuresA, featuresB) {
  if (!Array.isArray(featuresA) || !Array.isArray(featuresB)) return 0;
  const a = new Set();
  for (const f of featuresA) {
    const k = stableFeatureKey(f?.properties, f?.geometry);
    if (k !== null) a.add(k);
  }
  let n = 0;
  for (const f of featuresB) {
    const k = stableFeatureKey(f?.properties, f?.geometry);
    if (k !== null && a.has(k)) n++;
  }
  return n;
}

/** Reports each unordered pairs' shared-key count in descending order. */
export function pairwiseSharedCounts(filesToFeatures) {
  const names = Object.keys(filesToFeatures || {});
  const rows = [];
  for (let i = 0; i < names.length; i++) {
    const a = names[i];
    const featuresA = filesToFeatures[a];
    if (!Array.isArray(featuresA)) continue;
    for (let j = i + 1; j < names.length; j++) {
      const b = names[j];
      const featuresB = filesToFeatures[b];
      if (!Array.isArray(featuresB)) continue;
      const shared = countSharedKeys(featuresA, featuresB);
      if (shared > 0) {
        rows.push({ a, b, shared });
      }
    }
  }
  return rows.sort((x, y) => y.shared - x.shared);
}
