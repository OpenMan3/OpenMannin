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
  routeAlternatives,
} from "../../src/lib/navigation/graph.ts";
import { PROFILES } from "../../src/lib/navigation/profiles.ts";

const DRIVING = PROFILES.driving;
const WALKING = PROFILES.walking;
const CYCLING = PROFILES.cycling;

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

test("nearestSnap reaches the full maxSnapM radius, not one index cell", () => {
  const g = buildGraph({
    features: [road("residential", [
      [-4.48, 54.16],
      [-4.478, 54.16],
    ])],
  });
  // ~250 m due north of the road. A fixed 3x3 probe of 100 m cells only reached
  // ~100-200 m, so the 300 m driving tolerance was silently unreachable.
  const lat = 54.16 + 250 / 111320;
  const hit = nearestSnap(g, -4.479, lat, 300);
  assert.ok(hit, "a 250 m query must snap under the 300 m driving tolerance");
  assert.ok(Math.abs(hit.distanceM - 250) < 5, `snap distance ${hit.distanceM}`);
  assert.equal(nearestSnap(g, -4.479, lat, 150), null, "but not under the 150 m walking tolerance");
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

/** Helper: a road feature with tags and a simple A→B geometry. */
const taggedRoad = (highway, tags, pts) => ({
  geometry: { type: "LineString", coordinates: pts },
  properties: { highway, ...tags },
});

test("driving refuses one-way in the wrong direction", () => {
  // One-way A→B (residential). Start at A, dest at B = forward (OK).
  // Start at B, dest at A = reverse (should fail).
  const g = buildGraph({
    features: [
      taggedRoad("residential", { oneway: "yes" }, [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
    ],
  });
  const a = { lon: -4.48, lat: 54.16 };
  const b = { lon: -4.478, lat: 54.16 };
  const forward = routeBetween(g, a, b, DRIVING);
  const reverse = routeBetween(g, b, a, DRIVING);
  assert.ok(forward, "forward along one-way should work");
  assert.equal(reverse, null, "reverse along one-way must be refused");
});

test("walking ignores one-way restriction", () => {
  const g = buildGraph({
    features: [
      taggedRoad("residential", { oneway: "yes" }, [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
    ],
  });
  const a = { lon: -4.48, lat: 54.16 };
  const b = { lon: -4.478, lat: 54.16 };
  const forward = routeBetween(g, a, b, WALKING);
  const reverse = routeBetween(g, b, a, WALKING);
  assert.ok(forward, "walking forward works");
  assert.ok(reverse, "walking reverse also works (ignores one-way)");
});

test("cycling uses cycleway, refuses footway without bicycle=yes", () => {
  const g = buildGraph({
    features: [
      taggedRoad("cycleway", {}, [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
      taggedRoad("footway", {}, [
        [-4.48, 54.161],
        [-4.478, 54.161],
      ]),
    ],
  });
  const a = { lon: -4.48, lat: 54.16 };
  const b = { lon: -4.478, lat: 54.16 };
  const a2 = { lon: -4.48, lat: 54.161 };
  const b2 = { lon: -4.478, lat: 54.161 };
  const cycleCycle = routeBetween(g, a, b, CYCLING);
  const cycleFoot = routeBetween(g, a2, b2, CYCLING);
  assert.ok(cycleCycle, "cycleway allowed for cycling");
  assert.equal(cycleFoot, null, "bare footway refused for cycling");
});

test("cycling allows footway when bicycle=yes", () => {
  const g = buildGraph({
    features: [
      taggedRoad("footway", { bicycle: "yes" }, [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
    ],
  });
  const a = { lon: -4.48, lat: 54.16 };
  const b = { lon: -4.478, lat: 54.16 };
  const r = routeBetween(g, a, b, CYCLING);
  assert.ok(r, "footway with bicycle=yes allowed");
});

test("cycling respects bicycle=dismount speed", () => {
  const g = buildGraph({
    features: [
      taggedRoad("footway", { bicycle: "dismount" }, [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
    ],
  });
  const a = { lon: -4.48, lat: 54.16 };
  const b = { lon: -4.478, lat: 54.16 };
  const r = routeBetween(g, a, b, CYCLING);
  assert.ok(r, "dismount allowed");
  // ~130 m at 5 km/h = ~94s
  assert.ok(r.durationS > 80 && r.durationS < 120, `dismount duration ${r.durationS}s`);
});

test("driving refuses access=no and access=private", () => {
  const g = buildGraph({
    features: [
      taggedRoad("residential", { access: "no" }, [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
      taggedRoad("residential", { access: "private" }, [
        [-4.48, 54.161],
        [-4.478, 54.161],
      ]),
    ],
  });
  const a = { lon: -4.48, lat: 54.16 };
  const b = { lon: -4.478, lat: 54.16 };
  const a2 = { lon: -4.48, lat: 54.161 };
  const b2 = { lon: -4.478, lat: 54.161 };
  assert.equal(routeBetween(g, a, b, DRIVING), null, "access=no refused");
  assert.equal(routeBetween(g, a2, b2, DRIVING), null, "access=private refused");
  // Walking should still work on access=private (IoM commons)
  assert.ok(routeBetween(g, a2, b2, WALKING), "walking on access=private allowed");
});

test("routeBetween returns segmentNames parallel to coordinates", () => {
  const g = buildGraph({
    features: [
      taggedRoad("residential", { name: "Main Street" }, [
        [-4.48, 54.16],
        [-4.48, 54.161],
      ]),
      taggedRoad("residential", {}, [
        [-4.48, 54.161],
        [-4.478, 54.161],
      ]),
    ],
  });
  const a = { lon: -4.48, lat: 54.16 };
  const b = { lon: -4.478, lat: 54.161 };
  const r = routeBetween(g, a, b, DRIVING);
  assert.ok(r, "route found");
  assert.ok(r.segmentNames, "segmentNames present");
  // coords: start, snapA, node(A), node(B), snapB, dest = 6 points
  // segments: 5, but the last (snapB->dest) has no name -> null
  // We expect names for: start->snapA (Main St), snapA->node (Main St), node->node (unnamed), node->snapB (unnamed), snapB->dest (null)
  // The exact count depends on snapping, but segmentNames.length === coords.length - 1
  assert.equal(r.segmentNames.length, r.coordinates.length - 1, "segmentNames parallel to segments");
  assert.ok(r.segmentNames.includes("Main Street"), "named road appears in segmentNames");
});

test("routeBetween returns segmentMaxspeed parallel to coordinates", () => {
  const g = buildGraph({
    features: [
      taggedRoad("residential", { name: "Main Street", maxspeed: "30 mph" }, [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
    ],
  });
  const a = { lon: -4.48, lat: 54.16 };
  const b = { lon: -4.478, lat: 54.16 };
  const r = routeBetween(g, a, b, DRIVING);
  assert.ok(r, "route found");
  assert.equal(
    r.segmentMaxspeed.length,
    r.coordinates.length - 1,
    "segmentMaxspeed parallel to segments",
  );
  const limits = r.segmentMaxspeed.filter((v) => v !== null);
  assert.ok(limits.length > 0, "tagged limit appears on road segments");
  assert.ok(Math.abs(limits[0] - 48.28032) < 0.01, "30 mph parsed to km/h");
});

test("routeBetween leaves segmentMaxspeed null where no maxspeed is tagged", () => {
  const g = buildGraph({
    features: [
      taggedRoad("residential", { name: "Main Street" }, [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
    ],
  });
  const r = routeBetween(g, { lon: -4.48, lat: 54.16 }, { lon: -4.478, lat: 54.16 }, DRIVING);
  assert.ok(r, "route found");
  assert.ok(
    r.segmentMaxspeed.every((v) => v === null),
    "untagged road yields no invented limit",
  );
});

test("routeBetween same-edge reverse is refused for driving on one-way", () => {
  const g = buildGraph({
    features: [
      taggedRoad("residential", { oneway: "yes" }, [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
    ],
  });
  // Both points on the same one-way segment, but destination "behind" start
  const a = { lon: -4.478, lat: 54.16 }; // at B
  const b = { lon: -4.48, lat: 54.16 };  // at A
  assert.equal(routeBetween(g, a, b, DRIVING), null, "same-edge reverse refused");
  assert.ok(routeBetween(g, a, b, WALKING), "walking same-edge reverse allowed");
});

test("routeAlternatives leads with the fastest and adds a genuinely different route", () => {
  // Two junctions joined by a direct road and by a longer eastern detour, each
  // reached by a short stub (so the start/goal snap to a stub, not the middle).
  const g = buildGraph({
    features: [
      road("residential", [
        [-4.4805, 54.16],
        [-4.48, 54.16],
      ]), // start stub
      road("residential", [
        [-4.48, 54.161],
        [-4.4805, 54.161],
      ]), // end stub
      road("residential", [
        [-4.48, 54.16],
        [-4.48, 54.161],
      ]), // direct middle
      road("residential", [
        [-4.48, 54.16],
        [-4.4785, 54.16],
      ]), // S -> W1
      road("residential", [
        [-4.4785, 54.16],
        [-4.4785, 54.161],
      ]), // W1 -> W2
      road("residential", [
        [-4.4785, 54.161],
        [-4.48, 54.161],
      ]), // W2 -> G
    ],
  });
  const start = { lon: -4.4805, lat: 54.16 };
  const goal = { lon: -4.4805, lat: 54.161 };

  const primary = routeBetween(g, start, goal, DRIVING);
  assert.ok(primary, "the direct route exists");

  const routes = routeAlternatives(g, start, goal, DRIVING);
  assert.ok(routes.length >= 2, `expected an alternative, got ${routes.length}`);
  assert.equal(routes[0].distanceM, primary.distanceM, "option 0 is the fastest");
  assert.ok(
    routes[1].distanceM > routes[0].distanceM,
    "the alternative is longer than the fastest",
  );
  // The alternative must actually take different roads, not merely repeat.
  assert.notDeepEqual(routes[1].coordinates, routes[0].coordinates);
});

test("routeAlternatives returns just the one route when no detour exists", () => {
  const g = buildGraph({
    features: [
      road("residential", [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
    ],
  });
  const routes = routeAlternatives(
    g,
    { lon: -4.4795, lat: 54.16 },
    { lon: -4.4785, lat: 54.16 },
    DRIVING,
  );
  assert.equal(routes.length, 1, "a single carriageway yields a single option");
  assert.ok(routes[0].distanceM > 0);
});

test("routeAlternatives returns nothing when an endpoint is off the network", () => {
  const g = buildGraph({
    features: [
      road("residential", [
        [-4.48, 54.16],
        [-4.478, 54.16],
      ]),
    ],
  });
  // Far out to sea: beyond any profile's snap tolerance.
  assert.deepEqual(
    routeAlternatives(g, { lon: -4.6, lat: 54.3 }, { lon: -4.478, lat: 54.16 }, DRIVING),
    [],
  );
});