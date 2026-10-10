/**
 * A small, dependency-free routable graph built from the roads layer.
 *
 * WHY THIS EXISTS. The app is a static site; there is no server to run a
 * routing engine, and the task is only "get from here to there on the Isle of
 * Man". The island's road network is a single ~8 MB GeoJSON already served to
 * the browser for the roads layer, so the routing engine reuses it: build a
 * graph once, in a Web Worker, from OSM way geometry and run A* per query.
 *
 * GRAPH SHAPE. Every road vertex becomes a node; consecutive vertex pairs
 * become edges. Vertices closer than a fixed snapping cell (~5 m) map to the
 * same node, so roads that meet at a crossing share a node for free - no
 * separate junction-finding step. There is one node per cell rather than one
 * per vertex, which is both fewer nodes and fewer broken junctions.
 *
 * This module is PURE: no DOM, no MapLibre, no fetch. That is what lets the
 * same code run in the routing Web Worker and in `node --test`. Profiles
 * (who may use which road, and how fast) live in ./profiles and are applied
 * only when a route is requested, so one graph serves both driving and
 * walking.
 */

import { edgeTimeS, maxSpeedKmh, type Profile } from "./profiles.ts";

export interface LatLng {
  lon: number;
  lat: number;
}

export interface Graph {
  nodeCount: number;
  /** Node positions (degrees). */
  lon: number[];
  lat: number[];
  /** Adjacency: neighbour node ids and edge ids, parallel to each other. */
  adjTo: number[][];
  adjEdge: number[][];
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeLenM: Float64Array;
  edgeHighway: (string | null)[];
  /** Spatial index: 100 m cell key -> edge ids whose bbox touches the cell. */
  index: Map<string, number[]>;
}

/** Projected where the "indices" below use local equirectangular metres. */
interface Local {
  mx: number;
  my: number;
}

/** The snapped-onto-the-network position a route starts or ends at. */
export interface SnapResult extends LatLng {
  edge: number;
  /** Road distance from the projection to each edge endpoint, metres. */
  distA: number;
  distB: number;
  /** Straight-line distance from the query point to the projection, metres. */
  distanceM: number;
}

export interface RouteResult {
  distanceM: number;
  durationS: number;
  /** [lon, lat] pairs: user position → road → destination pin. */
  coordinates: [number, number][];
}

interface Feature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}

const RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_008.8;
/** Metres per degree of latitude. */
const M_PER_DEG_LAT = 111_320;
/** Snap cells smaller than this are wasted precision; driven by fixture sizes. */
const NODE_CELL_M = 5;
const INDEX_CELL_M = 100;

export function haversineM(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = (lat2 - lat1) * RAD;
  const dl = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Local equirectangular projection of a lon/lat, in metres about the point. */
export function toMeters(lon: number, lat: number): Local {
  return {
    mx: lon * M_PER_DEG_LAT * Math.cos(lat * RAD),
    my: lat * M_PER_DEG_LAT,
  };
}

/**
 * Project a point onto segment ab. Returns the unit parameter `u` in [0, 1],
 * the projected coordinates, and the great-circle distance to it.
 */
export function distanceToSegmentM(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { u: number; lon: number; lat: number; distanceM: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let u = 0;
  if (len2 > 0) {
    u = Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / len2));
  }
  const lon = ax + u * vx;
  const lat = ay + u * vy;
  return { u, lon, lat, distanceM: haversineM(px, py, lon, lat) };
}

export function buildGraph(fc: {
  features?: Feature[];
}): Graph {
  const lon: number[] = [];
  const lat: number[] = [];
  const nodeCells = new Map<string, number>();
  const cellOf = (m: Local, sizeM: number) =>
    `${Math.round(m.mx / sizeM)},${Math.round(m.my / sizeM)}`;

  let nextNode = 0;
  const nodeFor = (pt: [number, number]): number => {
    const m = toMeters(pt[0], pt[1]);
    const key = cellOf(m, NODE_CELL_M);
    let id = nodeCells.get(key);
    if (id === undefined) {
      id = nextNode++;
      nodeCells.set(key, id);
      lon.push(pt[0]);
      lat.push(pt[1]);
    }
    return id;
  };

  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const edgeLenM: number[] = [];
  const edgeHighway: (string | null)[] = [];

  for (const feature of fc.features ?? []) {
    const geom = feature.geometry;
    if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) continue;
    const pts = geom.coordinates as number[][];
    if (pts.length < 2) continue;
    const highway =
      typeof feature.properties?.highway === "string" ? feature.properties.highway : null;

    let prev = nodeFor([pts[0][0], pts[0][1]]);
    for (let i = 1; i < pts.length; i++) {
      const [plon, plat] = [pts[i][0], pts[i][1]];
      if (!Number.isFinite(plon) || !Number.isFinite(plat)) continue;
      const cur = nodeFor([plon, plat]);
      const len = haversineM(lon[prev], lat[prev], plon, plat);
      if (cur !== prev && len > 0.001) {
        edgeA.push(prev);
        edgeB.push(cur);
        edgeLenM.push(len);
        edgeHighway.push(highway);
      }
      prev = cur;
    }
  }

  // Adjacency (undirected: roads.geojson carries no oneway, so every edge is
  // traversable both ways for both profiles).
  const adjTo: number[][] = Array.from({ length: nextNode }, () => []);
  const adjEdge: number[][] = Array.from({ length: nextNode }, () => []);
  for (let e = 0; e < edgeA.length; e++) {
    adjTo[edgeA[e]].push(edgeB[e]);
    adjEdge[edgeA[e]].push(e);
    adjTo[edgeB[e]].push(edgeA[e]);
    adjEdge[edgeB[e]].push(e);
  }

  // Spatial index for nearest-edge snapping. Each edge is one segment, so its
  // bbox is just its endpoints.
  const index = new Map<string, number[]>();
  for (let e = 0; e < edgeA.length; e++) {
    const a = toMeters(lon[edgeA[e]], lat[edgeA[e]]);
    const b = toMeters(lon[edgeB[e]], lat[edgeB[e]]);
    const x0 = Math.floor(Math.min(a.mx, b.mx) / INDEX_CELL_M);
    const x1 = Math.floor(Math.max(a.mx, b.mx) / INDEX_CELL_M);
    const y0 = Math.floor(Math.min(a.my, b.my) / INDEX_CELL_M);
    const y1 = Math.floor(Math.max(a.my, b.my) / INDEX_CELL_M);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        let list = index.get(key);
        if (!list) {
          list = [];
          index.set(key, list);
        }
        list.push(e);
      }
    }
  }

  return {
    nodeCount: nextNode,
    lon,
    lat,
    adjTo,
    adjEdge,
    edgeA: Int32Array.from(edgeA),
    edgeB: Int32Array.from(edgeB),
    edgeLenM: Float64Array.from(edgeLenM),
    edgeHighway,
    index,
  };
}

/** Endpoint coordinates of an edge. */
function edgePoints(graph: Graph, e: number): [number, number][] {
  return [
    [graph.lon[graph.edgeA[e]], graph.lat[graph.edgeA[e]]],
    [graph.lon[graph.edgeB[e]], graph.lat[graph.edgeB[e]]],
  ];
}

/**
 * Closest point on the network to a query point. Chessboard (3x3) neighbour
 * cells are probed because the two endpoints of an edge can fall in different
 * index cells and the nearest edge should still be found for either.
 *
 * Returns null when nothing is within `maxSnapM` - the caller then reports
 * "off the network" rather than pretending the sea has roads.
 */
export function nearestSnap(
  graph: Graph,
  lon: number,
  lat: number,
  maxSnapM: number,
): SnapResult | null {
  const q = toMeters(lon, lat);
  const cx = Math.floor(q.mx / INDEX_CELL_M);
  const cy = Math.floor(q.my / INDEX_CELL_M);

  let bestDistance = Infinity;
  let best: { edge: number; lon: number; lat: number; distA: number; distB: number } | null = null;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = graph.index.get(`${cx + dx},${cy + dy}`);
      if (!list) continue;
      for (const e of list) {
        const [a, b] = edgePoints(graph, e);
        const seg = distanceToSegmentM(lon, lat, a[0], a[1], b[0], b[1]);
        if (seg.distanceM >= bestDistance) continue;
        bestDistance = seg.distanceM;
        best = {
          edge: e,
          lon: seg.lon,
          lat: seg.lat,
          distA: seg.u * graph.edgeLenM[e],
          distB: (1 - seg.u) * graph.edgeLenM[e],
        };
      }
    }
  }

  if (!best || bestDistance > maxSnapM) return null;
  return { ...best, distanceM: bestDistance };
}

/** Binary min-heap over (f, node), with lazy stale-entry skipping. */
class MinHeap {
  private f: number[] = [];
  private node: number[] = [];

  get size(): number {
    return this.f.length;
  }

  push(f: number, node: number): void {
    this.f.push(f);
    this.node.push(node);
    let i = this.f.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.f[parent] <= this.f[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Pops the minimum entry; entries are validated against the caller's g[]. */
  pop(): { f: number; node: number } | null {
    const n = this.f.length;
    if (n === 0) return null;
    const top = { f: this.f[0], node: this.node[0] };
    const lastF = this.f.pop() as number;
    const lastNode = this.node.pop() as number;
    if (this.f.length > 0) {
      this.f[0] = lastF;
      this.node[0] = lastNode;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.f.length && this.f[l] < this.f[smallest]) smallest = l;
        if (r < this.f.length && this.f[r] < this.f[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(i: number, j: number): void {
    [this.f[i], this.f[j]] = [this.f[j], this.f[i]];
    [this.node[i], this.node[j]] = [this.node[j], this.node[i]];
  }
}

/** A* from a snapped start point to a snapped end point, in network seconds. */
function search(
  graph: Graph,
  start: SnapResult,
  goal: SnapResult,
  profile: Profile,
): { path: number[]; timeS: number } | null {

  const nodeCount = graph.nodeCount;
  const g = new Float64Array(nodeCount);
  g.fill(Infinity);
  const parent = new Int32Array(nodeCount);
  parent.fill(-1);
  const parentEdge = new Int32Array(nodeCount);
  parentEdge.fill(-2);

  // Invert to a "seconds per metre" bound for an admissible heuristic.
  const invMaxSpeed = 3.6 / maxSpeedKmh(profile);
  const hOf = (n: number) => haversineM(graph.lon[n], graph.lat[n], goal.lon, goal.lat) * invMaxSpeed;

  const heap = new MinHeap();
  const seed = (node: number, distToNodeM: number, viaEdge: number) => {
    const time = edgeTimeS(profile, distToNodeM, graph.edgeHighway[viaEdge]);
    if (time === null) return;
    if (time >= g[node]) return;
    g[node] = time;
    parent[node] = -1;
    parentEdge[node] = viaEdge;
    heap.push(time + hOf(node), node);
  };
  seed(graph.edgeA[start.edge], start.distA, start.edge);
  seed(graph.edgeB[start.edge], start.distB, start.edge);

  const goalA = graph.edgeA[goal.edge];
  const goalB = graph.edgeB[goal.edge];
  const goalPartialTime = (n: number) =>
    edgeTimeS(profile, n === goalA ? goal.distA : goal.distB, graph.edgeHighway[goal.edge]) ?? 0;

  let best: { node: number; timeS: number } | null = null;

  for (;;) {
    const entry = heap.pop();
    if (!entry) break;
    const { node, f } = entry;
    // Lazy-skip a stale entry (its g has since improved).
    if (g[node] + hOf(node) !== f) continue;

    // Node pops in non-decreasing g order (consistent heuristic), so the first
    // time a goal endpoint pops, g[node] is optimal. Its total is that plus the
    // remaining partial along the goal edge.
    if (node === goalA || node === goalB) {
      const total = g[node] + goalPartialTime(node);
      if (!best || total < best.timeS) best = { node, timeS: total };
      // Can't be beaten: every entry still in the heap has f >= f of this pop,
      // and f is a lower bound on a full route through it.
      if (best && best.timeS <= f) break;
    }

    const neighbors = graph.adjTo[node];
    const neighborEdges = graph.adjEdge[node];
    for (let k = 0; k < neighbors.length; k++) {
      const to = neighbors[k];
      const edge = neighborEdges[k];
      const step = edgeTimeS(profile, graph.edgeLenM[edge], graph.edgeHighway[edge]);
      if (step === null) continue;
      const alt = g[node] + step;
      if (alt >= g[to]) continue;
      g[to] = alt;
      parent[to] = node;
      parentEdge[to] = edge;
      heap.push(alt + hOf(to), to);
    }
  }

  if (!best) return null;

  // Reconstruct the node chain ending at the goal endpoint.
  const path: number[] = [];
  let cursor = best.node;
  for (;;) {
    path.push(cursor);
    const p = parent[cursor];
    if (p < 0) break;
    cursor = p;
  }
  path.reverse();
  return { path, timeS: best.timeS };
}

/**
 * The full route from a start point to a destination pin over the network,
 * with the two straight connectors included so the drawn line visibly joins
 * the blue dot to the pin.
 *
 * Returns null when either point is off the network for this profile, or when
 * the two are not connected (an island in the sea is not a road).
 */
export function routeBetween(
  graph: Graph,
  start: LatLng,
  dest: LatLng,
  profile: Profile,
): RouteResult | null {
  const startSnap = nearestSnap(graph, start.lon, start.lat, profile.maxSnapM);
  const goalSnap = nearestSnap(graph, dest.lon, dest.lat, profile.maxSnapM);
  if (!startSnap || !goalSnap) return null;

  let nodeCoords: [number, number][];
  let timeS: number;

  if (startSnap.edge === goalSnap.edge) {
    // Both projections on the same road: the network leg is along that segment
    // between the projections. The off-road connectors are added below.
    nodeCoords = [];
    timeS =
      edgeTimeS(
        profile,
        Math.abs(startSnap.distA - goalSnap.distA),
        graph.edgeHighway[startSnap.edge],
      ) ?? 0;
  } else {
    const res = search(graph, startSnap, goalSnap, profile);
    if (!res) return null;
    nodeCoords = res.path.map((n): [number, number] => [graph.lon[n], graph.lat[n]]);
    timeS = res.timeS;
  }

  const coordinates: [number, number][] = [
    [start.lon, start.lat],
    [startSnap.lon, startSnap.lat],
    ...nodeCoords,
    [goalSnap.lon, goalSnap.lat],
    [dest.lon, dest.lat],
  ];

  // Drop adjacent duplicates introduced by snapping (e.g. startSnap === node[0]).
  const clean: [number, number][] = [];
  for (const pt of coordinates) {
    const prev = clean[clean.length - 1];
    if (!prev || Math.abs(prev[0] - pt[0]) > 1e-9 || Math.abs(prev[1] - pt[1]) > 1e-9) {
      clean.push(pt);
    }
  }

  let distanceM = 0;
  for (let i = 1; i < clean.length; i++) {
    distanceM += haversineM(clean[i - 1][0], clean[i - 1][1], clean[i][0], clean[i][1]);
  }

  // Straight-line connectors off the road, at road speed.
  const connector =
    (edgeTimeS(profile, startSnap.distanceM, graph.edgeHighway[startSnap.edge]) ?? 0) +
    (edgeTimeS(profile, goalSnap.distanceM, graph.edgeHighway[goalSnap.edge]) ?? 0);

  return { distanceM, durationS: Math.round(timeS + connector), coordinates: clean };
}