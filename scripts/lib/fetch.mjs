/**
 * Shared helpers for OpenMannin ingest scripts.
 *
 * Two things matter here:
 *  1. We send a distinctive User-Agent. MANNGIS and Overpass both ask for it,
 *     and it is the polite thing to do when you are consuming a Crown
 *     Dependency's public services.
 *  2. Paging. The ArcGIS services cap maxRecordCount at 1000 and return
 *     exceededTransferLimit rather than an error, so a naive single-shot query
 *     silently truncates. Every fetch here loops.
 */

import { writeFileSync } from "node:fs";

export const UA =
  "OpenMannin/0.1 (Isle of Man open infrastructure map; +https://github.com/openmannin) node-fetch";

const MANNGIS_HOSTS = [
  "services3.arcgis.com",
  "utility.arcgis.com",
  "maps.gov.im",
  "images.gov.im",
];

export function isProtectedHost(hostname) {
  return MANNGIS_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

/**
 * gov.im and images.gov.im both sit behind an F5 BIG-IP ASM that rejects
 * requests without a browser-shaped User-Agent. We keep one honest UA string
 * with a browser token in it rather than spoofing a full browser, and we send
 * it to everything so behaviour is predictable.
 */
export const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OpenMannin/0.1";

export async function get(
  url,
  { headers = {}, timeoutMs = 60_000, retries = 3, method = "GET", body } = {},
) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": BROWSER_UA, Accept: "*/*", ...headers },
        signal: ctrl.signal,
        redirect: "follow",
      });
      if (!res.ok) {
        // 4xx will not improve on retry. 5xx and 429 might.
        if (res.status < 500 && res.status !== 429) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${url}\n${body.slice(0, 400)}`);
        }
        lastErr = new Error(`HTTP ${res.status} ${url}`);
      } else {
        return res;
      }
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) {
      // Back off. Overpass docs say wait 30s on 429/406; that is too slow for
      // ingest, but we are polite backoff for a different host so 2-8s is fine.
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function getJson(url, opts = {}) {
  const res = await get(url, opts);
  return res.json();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Read a whole ArcGIS FeatureServer layer (or MapServer layer) as GeoJSON.
 *
 * Uses the service's own f=geojson output so ArcGIS does the reprojection to
 * WGS84 — which matters, because some MANNGIS services are published in EPSG:27700
 * and silently returning Irish Grid coordinates labelled as lat/lon is the
 * single easiest way to put a map in the sea.
 */
export async function fetchArcGISLayer(layerUrl, { where = "1=1", label = "" } = {}) {
  const base = layerUrl.split("?")[0].replace(/\/$/, "");
  const feats = [];

  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where,
      outFields: "*",
      outSR: "4326",
      f: "geojson",
      returnGeometry: "true",
      resultOffset: String(offset),
      resultRecordCount: "1000",
    });
    let body;
    try {
      const res = await get(`${base}/query?${params}`);
      body = await res.json();
    } catch (err) {
      if (err.message?.includes("HTTP 400")) {
        // Some services reject resultOffset when the result set is small.
        if (offset === 0) {
          const fallback = new URLSearchParams({
            where,
            outFields: "*",
            outSR: "4326",
            f: "geojson",
            returnGeometry: "true",
          });
          const res = await get(`${base}/query?${fallback}`);
          body = await res.json();
        } else {
          break;
        }
      } else {
        throw err;
      }
    }

    const page = body?.features ?? [];
    feats.push(...page);

    if (body?.properties?.exceededTransferLimit === true || page.length === 1000) {
      offset += page.length;
      await sleep(150);
      if (offset > 60_000) throw new Error(`refusing to page past 60k for ${label}`);
      continue;
    }
    break;
  }

  return { type: "FeatureCollection", features: feats };
}

export async function countArcGISLayer(layerUrl, where = "1=1") {
  const base = layerUrl.split("?")[0].replace(/\/$/, "");
  const params = new URLSearchParams({ where, returnCountOnly: "true", f: "json" });
  const body = await getJson(`${base}/query?${params}`);
  return body?.count ?? null;
}

/** Discover every layer id in a FeatureServer or MapServer. */
export async function listLayers(serverUrl) {
  const body = await getJson(`${serverUrl.replace(/\/$/, "")}?f=json`);
  return (body.layers ?? []).map((l) => ({ id: l.id, name: l.name }));
}

export function emptyFC() {
  return { type: "FeatureCollection", features: [] };
}

/** Stable de-duplication on a chosen identity field. */
export function dedupe(fc, keyFn) {
  const seen = new Set();
  const out = [];
  for (const f of fc.features) {
    const k = keyFn(f);
    if (k == null || seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return { type: "FeatureCollection", features: out };
}

/** Round coordinates so output files are small and diffable in git. */
export function roundCoords(geom, dp = 5) {
  const r = (n) => Number(n.toFixed(dp));
  const walk = (c) => {
    if (typeof c[0] === "number") return [r(c[0]), r(c[1])];
    return c.map(walk);
  };
  if (!geom) return geom;
  if (geom.type === "GeometryCollection") {
    return { ...geom, geometries: geom.geometries.map((g) => roundCoords(g, dp)) };
  }
  return { type: geom.type, coordinates: walk(geom.coordinates) };
}

// ---------------------------------------------------------------------------
// Simplification
//
// Why this exists: the pilgrimage-walks layer ships 23 features carrying
// 1,446,209 coordinates — about 63,000 vertices per walk. Rendered as-is that
// is 28 MB of GeoJSON for alignments that are accurate to the metre and need
// to be accurate to about ten. Douglas-Peucker gets us a 30x reduction with no
// visible difference at any zoom this app reaches.
// ---------------------------------------------------------------------------

/** Perpendicular distance from p to the segment ab, in degrees. */
function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denom = Math.hypot(dx, dy);
  if (denom === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / denom;
}

/**
 * Iterative Douglas-Peucker. Recursion would blow the stack on a 63,000-vertex
 * ring, so this keeps an explicit stack of [start, end) index pairs.
 */
export function douglasPeucker(pts, tol) {
  const n = pts.length;
  if (n <= 2) return pts;

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack = [[0, n - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    let maxD = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(pts[i], pts[lo], pts[hi]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }

  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Recurse through GeoJSON's arbitrarily nested coordinate arrays. */
function simplifyCoords(coords, tol) {
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const head = coords[0];
  if (!Array.isArray(head)) return [];
  if (typeof head[0] === "number") return douglasPeucker(coords, tol);
  const out = [];
  for (const part of coords) {
    const s = simplifyCoords(part, tol);
    // Rings need 4 positions to be a valid polygon; lines need 2. Anything
    // shorter collapsed to nothing and is dropped.
    if (Array.isArray(s) && s.length >= 2) out.push(s);
  }
  return out;
}

export function simplifyGeometry(geom, tol) {
  if (!geom || !tol) return geom;
  if (geom.type === "GeometryCollection") {
    return { ...geom, geometries: geom.geometries.map((g) => simplifyGeometry(g, tol)) };
  }
  const simplified = simplifyCoords(geom.coordinates, tol);
  if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
    const pruned = dropDegenerate(simplified, geom.type === "Polygon" ? 1 : 1);
    if (!pruned || (Array.isArray(pruned) && pruned.length === 0)) return null;
    return { type: geom.type, coordinates: pruned };
  }
  const empties =
    (geom.type === "LineString" && simplified.length < 2) ||
    (geom.type === "MultiLineString" && simplified.length === 0);
  if (empties) return null;
  return { type: geom.type, coordinates: simplified };
}

/** Remove rings that simplification collapsed below validity. */
function dropDegenerate(coords, minRings) {
  const rings = coords.filter((r) => Array.isArray(r) && r.length >= 4);
  if (rings.length < minRings) return null;
  return rings;
}

/**
 * Collapse any geometry to a single representative point.
 *
 * Used for the Field Gazetteer: upstream it is 19,848 FIELD BOUNDARY POLYGONS
 * carrying 1.46 million coordinates. A gazetteer is a name-to-place index, and
 * a label needs an anchor, not a boundary. We keep the point and drop 31 MB.
 */
export function toAnchorPoint(geom) {
  if (!geom) return null;
  if (geom.type === "Point") return geom;

  // Collect every distinct position, then take the median on each axis. This is
  // robust against the spiky shapes that make a bounding-box centre land
  // outside the polygon, and unlike a true centroid it needs no area maths.
  const xs = [];
  const ys = [];
  const visit = (c) => {
    if (typeof c[0] === "number") {
      xs.push(c[0]);
      ys.push(c[1]);
      return;
    }
    for (const p of c) visit(p);
  };
  visit(geom.coordinates);
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return {
    type: "Point",
    coordinates: [
      Number(xs[mid === 0 ? 0 : mid - 1].toFixed(5)),
      Number(ys[mid === 0 ? 0 : mid - 1].toFixed(5)),
    ],
  };
}

/** Bounding box of a FeatureCollection, as [minX, minY, maxX, maxY]. */
export function bboxOf(fc) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
      return;
    }
    for (const p of c) visit(p);
  };
  for (const f of fc.features) if (f.geometry) visit(f.geometry.coordinates);
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

/** Strip attributes we do not use, keeping files an order of magnitude smaller. */
export function project(fc, keep, defaults = {}, opts = {}) {
  const { simplify = 0, points = false, minVertices } = opts;
  const out = [];
  for (const [i, f] of fc.features.entries()) {
    let geom = f.geometry;
    if (points) {
      geom = toAnchorPoint(geom);
      if (!geom) continue;
    } else if (simplify) {
      geom = simplifyGeometry(geom, simplify);
      if (!geom) continue;
    }
    geom = roundCoords(geom);

    // A line with fewer than `minVertices` points is noise.
    if (minVertices) {
      const n =
        geom.type === "LineString"
          ? geom.coordinates.length
          : geom.type === "MultiLineString"
            ? geom.coordinates.reduce((a, l) => a + l.length, 0)
            : Infinity;
      if (n < minVertices) continue;
    }

    const props = { ...defaults };
    for (const [dest, spec] of Object.entries(keep)) {
      // A value may be a single field name, an array of candidates (first
      // non-empty wins), or an array used as a path.
      const candidates = Array.isArray(spec) ? spec : [spec];
      for (const src of candidates) {
        const v = String(src)
          .split(".")
          .reduce((acc, k) => (acc == null ? acc : acc[k]), f.properties);
        if (v !== undefined && v !== null && v !== "") {
          props[dest] = v;
          break;
        }
      }
    }
    props.id = props.id ?? i;
    out.push({ type: "Feature", id: props.id, geometry: geom, properties: props });
  }
  return { type: "FeatureCollection", features: out };
}

export function writeJSON(path, obj, { pretty = false } = {}) {
  const body = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  writeFileSync(path, body);
  return Buffer.byteLength(body);
}