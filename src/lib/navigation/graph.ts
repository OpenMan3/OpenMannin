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
 * (who may use which road, in which direction, and how fast) live in
 * ./profiles and are applied only when a route is requested, so one graph
 * serves driving, walking and cycling alike.
 */

import { edgeTimeS, maxSpeedKmh, type Profile, type RoadTags } from "./profiles.ts";

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
  /** Access/direction/speed tags per edge, or null when the way had none. */
  edgeRoad: (RoadTags | null)[];
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
  /**
   * Street name of each segment, parallel to `coordinates`: entry k names the
   * segment from coordinates[k] to coordinates[k+1]. `null` where the road is
   * unnamed. Empty when no names are known.
   */
  segmentNames: (string | null)[];
  /**
   * OSM junction=* of each segment, parallel to `coordinates`. Lets the step
   * builder recognise roundabouts ("leave the roundabout onto X"). `null`
   * where the segment had no junction tag.
   */
  segmentJunctions: (string | null)[];
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

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Parse an OSM `oneway` (and the implicit roundabout rule) into -1 | 0 | 1. */
function parseOneway(props: Record<string, unknown> | null | undefined): -1 | 0 | 1 {
  const ow = asString(props?.oneway)?.toLowerCase() ?? null;
  if (ow === "-1" || ow === "reverse") return -1;
  if (ow === "yes" || ow === "true" || ow === "1") return 1;
  if (ow === "no" || ow === "false" || ow === "0") return 0;
  const junction = asString(props?.junction)?.toLowerCase();
  if (junction === "roundabout" || junction === "circular") return 1;
  return 0;
}

/**
 * The routing-relevant tags of a way, or null when none are present, so the
 * graph does not carry empty objects for the many untagged segments.
 */
function parseRoadTags(props: Record<string, unknown> | null | undefined): RoadTags | null {
  const name = asString(props?.name);
  const oneway = parseOneway(props);
  const access = asString(props?.access);
  const motorVehicle = asString(props?.motorVehicle);
  const motorcar = asString(props?.motorcar);
  const vehicle = asString(props?.vehicle);
  const foot = asString(props?.foot);
  const bicycle = asString(props?.bicycle);
  const service = asString(props?.service);
  const maxspeed = asString(props?.maxspeed);
  const junction = asString(props?.junction)?.toLowerCase() ?? null;
  if (
    !name &&
    oneway === 0 &&
    !access &&
    !motorVehicle &&
    !motorcar &&
    !vehicle &&
    !foot &&
    !bicycle &&
    !service &&
    !maxspeed &&
    !junction
  ) {
    return null;
  }
  return { name, oneway, access, motorVehicle, motorcar, vehicle, foot, bicycle, service, maxspeed, junction };
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
  const edgeRoad: (RoadTags | null)[] = [];

  for (const feature of fc.features ?? []) {
    const geom = feature.geometry;
    if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) continue;
    const pts = geom.coordinates as number[][];
    if (pts.length < 2) continue;
    const highway =
      typeof feature.properties?.highway === "string" ? feature.properties.highway : null;
    const road = parseRoadTags(feature.properties);

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
        edgeRoad.push(road);
      }
      prev = cur;
    }
  }

  // Adjacency is undirected - both endpoints list each other - because walking
  // may use a one-way street either way and a one-way is still physically
  // traversable. Direction and access are enforced per-profile at search time
  // (edgeTimeS consults edgeRoad and the traversal direction), which keeps this
  // graph shared by every profile.
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
    edgeRoad,
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
): { path: number[]; edges: number[]; timeS: number } | null {

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
  // Seeding walks from the projection to an endpoint. `forward` says whether
  // that move follows the way's own A→B direction; a one-way refuses the other.
  const seed = (node: number, distToNodeM: number, viaEdge: number, forward: boolean) => {
    const time = edgeTimeS(
      profile,
      distToNodeM,
      graph.edgeHighway[viaEdge],
      graph.edgeRoad[viaEdge],
      forward,
    );
    if (time === null) return;
    if (time >= g[node]) return;
    g[node] = time;
    parent[node] = -1;
    parentEdge[node] = viaEdge;
    heap.push(time + hOf(node), node);
  };
  seed(graph.edgeA[start.edge], start.distA, start.edge, false);
  seed(graph.edgeB[start.edge], start.distB, start.edge, true);

  const goalA = graph.edgeA[goal.edge];
  const goalB = graph.edgeB[goal.edge];
  const goalPartialTime = (n: number): number | null =>
    edgeTimeS(
      profile,
      n === goalA ? goal.distA : goal.distB,
      graph.edgeHighway[goal.edge],
      graph.edgeRoad[goal.edge],
      n === goalA,
    );

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
      const partial = goalPartialTime(node);
      if (partial !== null) {
        const total = g[node] + partial;
        if (!best || total < best.timeS) best = { node, timeS: total };
        // Can't be beaten: every entry still in the heap has f >= f of this pop,
        // and f is a lower bound on a full route through it.
        if (best && best.timeS <= f) break;
      }
    }

    const neighbors = graph.adjTo[node];
    const neighborEdges = graph.adjEdge[node];
    for (let k = 0; k < neighbors.length; k++) {
      const to = neighbors[k];
      const edge = neighborEdges[k];
      // Traversing edge from `node` to `to` is forward when `node` is the A end.
      const forward = graph.edgeA[edge] === node;
      const step = edgeTimeS(
        profile,
        graph.edgeLenM[edge],
        graph.edgeHighway[edge],
        graph.edgeRoad[edge],
        forward,
      );
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

  // Reconstruct the node chain ending at the goal endpoint. `edges[i]` is the
  // edge used to reach path[i]; path[0]'s edge is the seed edge (start.edge).
  const path: number[] = [];
  const edges: number[] = [];
  let cursor = best.node;
  for (;;) {
    path.push(cursor);
    edges.push(parentEdge[cursor]);
    const p = parent[cursor];
    if (p < 0) break;
    cursor = p;
  }
  path.reverse();
  edges.reverse();
  return { path, edges, timeS: best.timeS };
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

  const roadName = (e: number): string | null => graph.edgeRoad[e]?.name ?? null;
  const roadJunction = (e: number): string | null => graph.edgeRoad[e]?.junction ?? null;
  const startName = roadName(startSnap.edge);
  const goalName = roadName(goalSnap.edge);
  const startJunction = roadJunction(startSnap.edge);
  const goalJunction = roadJunction(goalSnap.edge);

  // Coordinates and the parallel segment-name list are built together and
  // de-duplicated together, so names[k] always names the segment from
  // coordinates[k] to coordinates[k+1].
  const coords: [number, number][] = [[start.lon, start.lat]];
  const names: (string | null)[] = [];
  const junctions: (string | null)[] = [];
  const push = (pt: [number, number], name: string | null, junction: string | null): void => {
    const prev = coords[coords.length - 1];
    if (Math.abs(prev[0] - pt[0]) <= 1e-9 && Math.abs(prev[1] - pt[1]) <= 1e-9) return;
    coords.push(pt);
    names.push(name);
    junctions.push(junction);
  };

  let timeS = 0;

  // Fast path: both projections land on the same road segment. It is only
  // usable when the profile may travel that way along the segment (a one-way
  // with the destination "behind" the start falls through to a full search).
  let sameEdge = startSnap.edge === goalSnap.edge;
  if (sameEdge) {
    const forward = startSnap.distA <= goalSnap.distA;
    const t = edgeTimeS(
      profile,
      Math.abs(startSnap.distA - goalSnap.distA),
      graph.edgeHighway[startSnap.edge],
      graph.edgeRoad[startSnap.edge],
      forward,
    );
    if (t === null) sameEdge = false;
    else timeS = t;
  }

  if (sameEdge) {
    push([startSnap.lon, startSnap.lat], startName, startJunction);
    push([goalSnap.lon, goalSnap.lat], startName, startJunction);
    push([dest.lon, dest.lat], goalName, goalJunction);
  } else {
    const res = search(graph, startSnap, goalSnap, profile);
    if (!res) return null;
    timeS = res.timeS;
    push([startSnap.lon, startSnap.lat], startName, startJunction);
    for (let i = 0; i < res.path.length; i++) {
      const n = res.path[i];
      push([graph.lon[n], graph.lat[n]], roadName(res.edges[i]), roadJunction(res.edges[i]));
    }
    push([goalSnap.lon, goalSnap.lat], goalName, goalJunction);
    push([dest.lon, dest.lat], goalName, goalJunction);
  }

  let distanceM = 0;
  for (let i = 1; i < coords.length; i++) {
    distanceM += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }

  // Straight-line connectors off the road, at road speed. The join onto the
  // nearest edge is not a directional move, so it is checked as "forward".
  const connector =
    (edgeTimeS(
      profile,
      startSnap.distanceM,
      graph.edgeHighway[startSnap.edge],
      graph.edgeRoad[startSnap.edge],
      true,
    ) ?? 0) +
    (edgeTimeS(
      profile,
      goalSnap.distanceM,
      graph.edgeHighway[goalSnap.edge],
      graph.edgeRoad[goalSnap.edge],
      true,
    ) ?? 0);

  return {
    distanceM,
    durationS: Math.round(timeS + connector),
    coordinates: coords,
    segmentNames: names,
    segmentJunctions: junctions,
  };
}