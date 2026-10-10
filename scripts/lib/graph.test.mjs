/**
 * Unit tests for the routing graph (src/lib/navigation/graph.ts).
 *
 * The graph is PURE (no DOM, no fetch), so it runs under `node --test` against
 * tiny synthetic road networks. This is where route correctness lives:
 * a wrong A*, broken junction merging or a snapping bug would all surface
 * here, cheaply, before the browser ever fetches the 8 MB roads layer.
 *
 * Coordinate units: 1 deg lon ≈ 65.2 km and 1 deg lat ≈ 111.3 km around the
 * island, so fixtures use ~0.001-0.002 deg steps = tens to hundreds of metres.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildGraph,
  distanceToSegmentM,
  haversineM,
  nearestSnap,
  routeBetween,
} from "../../src/lib/navigation/graph.ts";
import { PROFILES } from "../../src/lib/navigation/profiles.ts";

const DRIVING = PROFILES.driving;
const WALKING = PROFILES.walking;

/** Shorthand for a LineString feature whose highway class we set. */
const road = (highway, pts) => ({
  geometry: { type: "LineString", coordinates: pts },
  properties: { highway },
});

/** A→B→C vertical line a car cannot use but a walker can. */
const FOOTWAY_FIXTURE = [
  // R1: a short residential road A→B.
  road("residential", [
    [-4.48, 54.16],
    [-4.48, 54.161],
  ]),
  // R2: a parallel residential road C→D, NOT connected to R1.
  road("residential", [
    [-4.478, 54.16],
    [-4.478, 54.161],
  ]),
  // The only connection: a footway B→C. B and C reuse the endpoint vertices,
  // so they merge into R1/R2's nodes (the graph merges by 5 m cell).
  road("footway", [
    [-4.48, 54.161],
    [-4.478, 54.16],
  ]),
];

test("buildGraph merges shared vertices into a single node per junction", () => {
  const g = buildGraph({ features: FOOTWAY_FIXTURE });
  assert.equal(g.nodeCount, 4, "expected the four distinct vertices A, B, C, D");
  assert.equal(g.edgeA.length, 3, "R1, R2 and the footway are three edges");
  // B is the footway junction: it should neighbour A (via R1) and C (via the
  // footway); C neighbours B and D. Everything is undirected.
  const totalAdjacency = g.adjTo.reduce((n, xs) => n + xs.length, 0);
  assert.equal(totalAdjacency, 6, "undirected 3-edge graph has 6 adjacency slots");
  assert.ok(
    g.adjTo.every((xs) => new Set(xs).size === xs.length),
    "an edge duplicated a neighbour (self-loop or double-insert)",
  );
});

test("haversine distance is sensible (two degrees of lon at this latitude)", () => {
  const d = haversineM(-4.48, 54.16, -4.478, 54.16);
  assert.ok(d > 120 && d < 140, `got ${d} m`);
});

test("distanceToSegmentM projects orthogonally and clamps to the segment", () => {
  // Horizontal road E→F at lat 54.16. Query directly below its middle.
  const seg = distanceToSegmentM(-4.479, 54.159, -4.48, 54.16, -4.478, 54.16);
  assert.equal(seg.u, 0.5, "mid-query should land at the segment's midpoint");
  assert.ok(Math.abs(seg.distanceM - 111.32) < 2, `perpendicular distance ${seg.distanceM}`);
  // Beyond the endpoint of a short segment: clamp to u = 1.
  const out = distanceToSegmentM(0, 0, -4.48, 54.16, -4.478, 54.16);
  assert.equal(out.u, 1, "off-the-end queries clamp rather than extend the road");
});

test("nearestSnap returns the projection and the along-edge distances", () => {
  const g = buildGraph({ features: FOOTWAY_FIXTURE });
  // Just east of R1, which runs north along lon -4.48 for 0.001 deg (~111 m).
  const hit = nearestSnap(g, -4.4799, 54.1605, 300);
  assert.ok(hit, "should snap to R1 from just off it");
  assert.ok(hit.distanceM < 30, `snap distance ${hit.distanceM}`);
  assert.ok(
    Math.abs(hit.distA + hit.distB - 111.3) < 1,
    `distA+distB should be R1's length (111.3 m), got ${hit.distA + hit.distB}`,
  );
});

test("nearestSnap returns null beyond the snap radius (off the network)", () => {
  const g = buildGraph({ features: FOOTWAY_FIXTURE });
  assert.equal(nearestSnap(g, -4.47, 54.17, 150), null, "walking radius");
  assert.equal(nearestSnap(g, -4.47, 54.17, 300), null, "driving radius");
});

test("driving refuses a route that needs a footway; walking takes it", () => {
  const g = buildGraph({ features: FOOTWAY_FIXTURE });
  // Start on R1, destination on R2. The only connecting way is the footway.
  const start = { lon: -4.48, lat: 54.1605 };
  const dest = { lon: -4.478, lat: 54.1605 };

  assert.equal(
    routeBetween(g, start, dest, DRIVING),
    null,
    "a car must not be routed down a footway to reach the other street",
  );

  const walk = routeBetween(g, start, dest, WALKING);
  assert.ok(walk, "a walker is allowed down the footway");
  // start→B (55.7 m) + B→C footway (~171 m) + C→dest (55.7 m).
  assert.ok(walk.distanceM > 260 && walk.distanceM < 305, `walking distance ${walk.distanceM}`);
  assert.ok(walk.durationS > 150, `walking ~283 m at 4.8 km/h is ~3.5 min, got ${walk.durationS}s`);
  assert.ok(walk.coordinates.length >= 4, "start, snap, junction route and destination");
});

test("routeBetween takes the short side of a junction, not the long way round", () => {
  // A direct road E→F and a three-edge detour E→G→H→F sharing E and F.
  const g = buildGraph({
    features: [
      road("residential", [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
      road("residential", [
        [-4.48, 54.16],
        [-4.48, 54.161],
        [-4.478, 54.161],
        [-4.478, 54.16],
      ]),
    ],
  });

  // Start on the direct road near E; destination halfway up the detour leg E→G.
  const start = { lon: -4.4795, lat: 54.16 };
  const dest = { lon: -4.48, lat: 54.1605 };

  const route = routeBetween(g, start, dest, DRIVING);
  assert.ok(route, "start and destination are on the network");
  // Short way: start→E (32.6 m) then E→dest (55.7 m). The long way round is
  // ~330 m more, so this asserts A* chose the cheap route through the junction.
  assert.ok(route.distanceM > 70 && route.distanceM < 110, `route ${route.distanceM} m`);
});

test("same-road start and destination use the driveable portion only", () => {
  const g = buildGraph({
    features: [road("residential", [
      [-4.48, 54.16],
      [-4.478, 54.16],
    ])],
  });
  const start = { lon: -4.4795, lat: 54.16 };
  const dest = { lon: -4.4783, lat: 54.16 };
  const route = routeBetween(g, start, dest, DRIVING);
  assert.ok(route, "same road, on the network");
  assert.ok(route.distanceM > 65 && route.distanceM < 95, `same-edge distance ${route.distanceM} m`);
  assert.equal(
    route.coordinates[0][0],
    start.lon,
    "route starts at the exact dropped coordinate, not the snap point",
  );
  assert.equal(
    route.coordinates[route.coordinates.length - 1][0],
    dest.lon,
    "route ends at the exact pin coordinate",
  );
});

test("routeBetween returns null when either end is off the network", () => {
  const g = buildGraph({ features: FOOTWAY_FIXTURE });
  const onRoad = { lon: -4.48, lat: 54.1605 };
  const inTheSea = { lon: -4.47, lat: 54.17 };
  assert.equal(routeBetween(g, inTheSea, onRoad, DRIVING), null, "start off network");
  assert.equal(routeBetween(g, onRoad, inTheSea, WALKING), null, "destination off network");
});