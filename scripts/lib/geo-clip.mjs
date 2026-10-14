/**
 * Clip GeoJSON geometries to an axis-aligned bounding box.
 *
 * Why this exists: the EMODnet biogenic-substrate layer is published as large
 * MultiPolygons that each aggregate scattered beds across most of the NE
 * Atlantic. A WFS bbox query returns every *feature* that intersects the box,
 * not the part of it inside the box, so an Isle of Man query comes back with
 * polygons reaching 45 N and 35 E. Shipping that would put the whole sea floor
 * under the island's basemap and misrepresent the survey as island-wide.
 *
 * Sutherland-Hodgman against a rectangle is exact for the convex clip region
 * and needs no dependency. Rings stay closed; empty polygons are dropped.
 */

function interX(a, b, x) {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}

function interY(a, b, y) {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

function clipEdge(pts, inside, intersect) {
  const out = [];
  const n = pts.length;
  if (n === 0) return out;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const prev = pts[(i - 1 + n) % n];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

/** Clip one ring to the box. Returns raw points, not yet closed or validated. */
export function clipRingToBox(ring, [minX, minY, maxX, maxY]) {
  let pts = ring;
  pts = clipEdge(pts, (p) => p[0] >= minX, (a, b) => interX(a, b, minX));
  pts = clipEdge(pts, (p) => p[0] <= maxX, (a, b) => interX(a, b, maxX));
  pts = clipEdge(pts, (p) => p[1] >= minY, (a, b) => interY(a, b, minY));
  pts = clipEdge(pts, (p) => p[1] <= maxY, (a, b) => interY(a, b, maxY));
  return pts;
}

/** Drop consecutive duplicates and close the ring, or null if degenerate. */
export function normalizeRing(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || p[1] !== last[1]) out.push(p);
  }
  if (out.length < 3) return null;
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out.length >= 4 ? out : null;
}

/** Clip a closed ring to the box; returns a closed ring or null. */
export function clipRing(ring, bbox) {
  return normalizeRing(clipRingToBox(ring, bbox));
}

export function clipGeometry(geom, bbox) {
  if (!geom) return null;
  const [minX, minY, maxX, maxY] = bbox;
  const insidePoint = (p) => p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;

  switch (geom.type) {
    case "Point":
      return insidePoint(geom.coordinates) ? geom : null;
    case "MultiPoint": {
      const kept = geom.coordinates.filter(insidePoint);
      return kept.length ? { type: "MultiPoint", coordinates: kept } : null;
    }
    case "Polygon": {
      const rings = geom.coordinates
        .map((r) => normalizeRing(clipRingToBox(r, bbox)))
        .filter(Boolean);
      return rings.length ? { type: "Polygon", coordinates: rings } : null;
    }
    case "MultiPolygon": {
      const polys = [];
      for (const poly of geom.coordinates) {
        const rings = poly
          .map((r) => normalizeRing(clipRingToBox(r, bbox)))
          .filter(Boolean);
        if (rings.length) polys.push(rings);
      }
      return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
    }
    case "GeometryCollection": {
      const geometries = geom.geometries.map((g) => clipGeometry(g, bbox)).filter(Boolean);
      return geometries.length ? { type: "GeometryCollection", geometries } : null;
    }
    default:
      return geom;
  }
}
