/**
 * Feature browsing helpers.
 *
 * The map picks features by click, but a layer with hundreds of anonymous
 * members is hostile to that: finding a specific registered building or tree
 * means guessing where it is. These helpers give every feature a label and a
 * point to fly to, so the UI can list, search and cycle through a layer in
 * order instead of hunting by eye. Pure module, shared with the browser
 * (FeatureBrowser) and unit-tested from scripts/lib.
 */

export interface BrowseEntry {
  /** The feature's position in the source collection, for stable ordering. */
  index: number;
  label: string;
  lon: number;
  lat: number;
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown } | null | undefined;
}

interface Position {
  coordinates?: unknown;
  type: string;
}

/** First JSON value that is present, non-empty and comparable, in order. */
const LABEL_KEYS = [
  "label",
  "name",
  "title",
  "address",
  "location",
  "site",
  "species",
  "Name",
  "NAME",
];

/** A human label for a feature, or a fallback that stays honest. */
export function browseLabel(props: Record<string, unknown> | null | undefined): string {
  if (!props) return "(unnamed)";
  for (const key of LABEL_KEYS) {
    const v = props[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const regNo = props.regNo;
  if (typeof regNo === "string" && regNo.trim()) return `Reg. ${regNo}`;
  return "(unnamed)";
}

/**
 * A point the map can fly to, for any geometry the ingests produce.
 *
 * Points are exact. Lines and polygons take the average of their vertices;
 * for a Multi-part geometry the part with the most vertices is used, so a big
 * multi-boundary polygon is not shrunk to a sliver of its own extent. A
 * polygon's outer ring is almost always the largest, which also keeps the
 * average inside-ish the footprint rather than pulled out to a hole.
 */
export function featureCentre(geometry: Position | null | undefined): [number, number] | null {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  switch (geometry.type) {
    case "Point": {
      const [lon, lat] = geometry.coordinates as unknown[];
      return finitePair(lon, lat);
    }
    case "MultiPoint":
      return firstFinite(geometry.coordinates as unknown[]);
    case "LineString":
      return averageOf(geometry.coordinates as unknown[]);
    case "Polygon":
      return averageOf(verticesOf(geometry.coordinates as unknown[][]));
    case "MultiLineString":
      return largestLine(geometry.coordinates as unknown[][]);
    case "MultiPolygon":
      return largestPolygon(geometry.coordinates as unknown[][][]);
    default:
      return null;
  }
}

function finitePair(lon: unknown, lat: unknown): [number, number] | null {
  if (typeof lon === "number" && typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat)) {
    return [lon, lat];
  }
  return null;
}

function firstFinite(points: unknown[]): [number, number] | null {
  for (const p of points) {
    if (!Array.isArray(p)) continue;
    const [lon, lat] = p as unknown[];
    const hit = finitePair(lon, lat);
    if (hit) return hit;
  }
  return null;
}

/** The ring vertices of a Polygon, outer and holes kept in order. */
function verticesOf(rings: unknown[][]): unknown[] {
  return rings.flat(1);
}

/** Longest line of a MultiLineString, reduced to its centre. */
function largestLine(parts: unknown[][]): [number, number] | null {
  let best: unknown[] | null = null;
  let bestLen = -1;
  for (const part of parts) {
    if (Array.isArray(part) && part.length > bestLen) {
      bestLen = part.length;
      best = part;
    }
  }
  return best ? averageOf(best) : null;
}

/** Largest polygon of a MultiPolygon (by vertex count), reduced to its centre. */
function largestPolygon(polygons: unknown[][][]): [number, number] | null {
  let best: unknown[][] | null = null;
  let bestLen = -1;
  for (const poly of polygons) {
    if (!Array.isArray(poly)) continue;
    const len = verticesOf(poly as unknown[][]).length;
    if (len > bestLen) {
      bestLen = len;
      best = poly as unknown[][];
    }
  }
  return best ? averageOf(verticesOf(best)) : null;
}

function averageOf(points: unknown[]): [number, number] | null {
  let lonSum = 0;
  let latSum = 0;
  let count = 0;
  for (const p of points) {
    if (!Array.isArray(p)) continue;
    const [lon, lat] = p as unknown[];
    const hit = finitePair(lon, lat);
    if (!hit) continue;
    lonSum += hit[0];
    latSum += hit[1];
    count += 1;
  }
  if (count === 0) return null;
  return [lonSum / count, latSum / count];
}

/** All features that have somewhere to fly to, in source order. */
export function indexFeatures(
  fc: { features: Array<{ geometry?: Position | null; properties?: Record<string, unknown> | null }> },
): BrowseEntry[] {
  const out: BrowseEntry[] = [];
  fc.features.forEach((f, index) => {
    const centre = featureCentre(f.geometry);
    if (!centre) return;
    out.push({
      index,
      label: browseLabel(f.properties),
      lon: centre[0],
      lat: centre[1],
      properties: f.properties ?? null,
      geometry: f.geometry ?? null,
    });
  });
  return out;
}