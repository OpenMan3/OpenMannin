/**
 * Shareable deep-link parameters.
 *
 * The address bar already carries `?layers=&z=&lon=&lat=` so a viewport can be
 * copied around (see page.tsx). Two more parameters make a *finding* shareable
 * rather than just a view:
 *
 *   - `to`   — a destination pin, so opening the link drops the pin and starts
 *              computing routes exactly as if the recipient had long-pressed.
 *   - `pick` — a selected feature (layer + clicked position + resolved label),
 *              so the popup reopens on the thing being pointed at.
 *
 * Everything here is pure and SSR-safe: parsing never throws (a mangled link
 * degrades to "no parameter" rather than a blank page), and the label is
 * carried alongside the coordinates so a popup can still name the feature when
 * the layer file cannot be loaded (offline, first paint) - the full properties
 * are recovered client-side by nearest-feature lookup when possible.
 *
 * Nearest-feature matching projects every geometry onto a local metre grid
 * around the query point and measures point-to-segment distance; it is a
 * restore heuristic, not a spatial index, and runs once per link open over a
 * single (already cached) layer file.
 */

import type { FeatureCollection } from "./layer-data.ts";

export interface ToParam {
  lon: number;
  lat: number;
  title: string;
  detail?: string;
}

export interface PickParam {
  layerId: string;
  lon: number;
  lat: number;
  /** Best-effort human label at share time; only used when the layer cannot be reloaded. */
  label?: string;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Encode a destination for `?to=`. Commas inside text become %2C so the split below is safe. */
export function formatToParam(d: ToParam): string {
  const base = `${d.lon.toFixed(5)},${d.lat.toFixed(5)},${encodeURIComponent(d.title)}`;
  return d.detail ? `${base},${encodeURIComponent(d.detail)}` : base;
}

/** Parse `?to=lon,lat,title[,detail]`. Returns null for anything malformed. */
export function parseToParam(raw: string | null | undefined): ToParam | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length < 3) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!finite(lon) || !finite(lat)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const title = safeDecode(parts[2]);
  if (!title) return null;
  const detail = parts.length > 3 ? safeDecode(parts.slice(3).join(",")) : undefined;
  return detail ? { lon, lat, title, detail } : { lon, lat, title };
}

/** Encode a pick for `?pick=layerId:lon:lat[:label]`. */
export function formatPickParam(p: PickParam): string {
  const base = `${encodeURIComponent(p.layerId)}:${p.lon.toFixed(5)}:${p.lat.toFixed(5)}`;
  return p.label ? `${base}:${encodeURIComponent(p.label)}` : base;
}

/** Parse `?pick=layerId:lon:lat[:label]`. Returns null for anything malformed. */
export function parsePickParam(raw: string | null | undefined): PickParam | null {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length < 3) return null;
  const layerId = safeDecode(parts[0]);
  const lon = Number(parts[1]);
  const lat = Number(parts[2]);
  if (!layerId || !finite(lon) || !finite(lat)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const label = parts.length > 3 ? safeDecode(parts.slice(3).join(":")) : undefined;
  return label ? { layerId, lon, lat, label } : { layerId, lon, lat };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The properties of the feature nearest to (lon, lat), or null when nothing is
 * within `maxMeters` or the collection is unusable.
 *
 * Matching uses point-to-segment distance, not just vertex distance: a shared
 * link carries the exact click position, which on a road, footpath or cable
 * lands mid-segment - a vertex-only comparison would miss the very feature the
 * link points at. Coordinates are projected to a local metre grid around the
 * query point (valid to well past the default radius), so segments are plain
 * planar geometry.
 */
export function nearestFeatureProperties(
  fc: FeatureCollection | null | undefined,
  lon: number,
  lat: number,
  maxMeters = 150,
): Record<string, unknown> | null {
  const features = Array.isArray(fc?.features) ? fc.features : null;
  if (!features) return null;
  const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const mPerLat = 110574;
  let best: Record<string, unknown> | null = null;
  let bestD = Infinity;
  for (const f of features) {
    const geom = f?.geometry as { type?: string; coordinates?: unknown } | null | undefined;
    if (!geom || !Array.isArray(geom.coordinates)) continue;
    let dBest = Infinity;
    for (const seq of coordinateSequences(geom.type, geom.coordinates)) {
      let prev: [number, number] | null = null;
      for (const [px, py] of seq) {
        const x = (px - lon) * mPerLon;
        const y = (py - lat) * mPerLat;
        let d = Math.hypot(x, y);
        if (prev) {
          const dSeg = segmentDistanceFromOrigin(
            (prev[0] - lon) * mPerLon,
            (prev[1] - lat) * mPerLat,
            x,
            y,
          );
          if (dSeg < d) d = dSeg;
        }
        prev = [px, py];
        if (d < dBest) dBest = d;
      }
    }
    if (dBest < bestD) {
      bestD = dBest;
      const props = f.properties as Record<string, unknown> | null;
      best = props ?? {};
    }
  }
  return bestD <= maxMeters ? best : null;
}

/** Distance from the origin to the segment A-B (planar, local metres). */
function segmentDistanceFromOrigin(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

const isPair = (n: unknown): n is [number, number] =>
  Array.isArray(n) && n.length >= 2 && finite(n[0]) && finite(n[1]) && !Array.isArray(n[0]);

/**
 * Split a geometry's coordinates into continuous position sequences (one per
 * point-stream: ring, line, or lone point). Edges only ever run inside a
 * sequence - stitching two lines together would invent a segment that does not
 * exist and could pass through the query point.
 */
function* coordinateSequences(type: string | undefined, coords: unknown): Generator<[number, number][]> {
  if (type === "Point") {
    if (isPair(coords)) yield [coords];
    return;
  }
  if (!Array.isArray(coords)) return;
  if (type === "MultiPoint") {
    for (const c of coords) if (isPair(c)) yield [c];
    return;
  }
  if (type === "LineString") {
    const seq = coords.filter(isPair);
    if (seq.length > 0) yield seq;
    return;
  }
  if (type === "MultiLineString" || type === "Polygon") {
    for (const ring of coords) {
      if (!Array.isArray(ring)) continue;
      const seq = ring.filter(isPair);
      if (seq.length > 0) yield seq;
    }
    return;
  }
  if (type === "MultiPolygon") {
    for (const poly of coords) {
      if (!Array.isArray(poly)) continue;
      for (const ring of poly) {
        if (!Array.isArray(ring)) continue;
        const seq = ring.filter(isPair);
        if (seq.length > 0) yield seq;
      }
    }
    return;
  }
  // Unknown geometry type: be conservative - lone vertices only, no invented
  // edges. Anything pair-shaped becomes its own singleton sequence.
  for (const c of coords) {
    if (isPair(c)) yield [c];
    else yield* coordinateSequences(undefined, c);
  }
}
