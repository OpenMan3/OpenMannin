/**
 * Unit tests for turn-by-turn steps (src/lib/navigation/steps.ts).
 *
 * Pure geometry math, so it runs under `node --test`. The island's meridian
 * runs ~north-south (lat 54.16), so a route that only changes longitude is an
 * east/west line and a route changing both is a diagonal - handy for fixtures.
 *
 * NOTE: this file is plain JS (.mjs) on purpose - `--experimental-strip-types`
 * applies to the imported .ts sources, but the test file itself must not use
 * TypeScript syntax.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  bearingDeg,
  bearingDelta,
  cardinal,
  classifyManeuver,
  deriveSteps,
  formatStepDistance,
  haversineM,
  normalizeDeg,
  pointAtDistance,
} from "../../src/lib/navigation/steps.ts";

test("normalizeDeg wraps into [0, 360)", () => {
  assert.equal(normalizeDeg(0), 0);
  assert.equal(normalizeDeg(360), 0);
  assert.equal(normalizeDeg(-10), 350);
  assert.equal(normalizeDeg(730), 10);
});

test("bearingDelta gives the signed shortest angle", () => {
  assert.equal(bearingDelta(0, 90), 90);
  assert.equal(bearingDelta(90, 0), -90);
  assert.equal(bearingDelta(350, 10), 20);
  assert.equal(bearingDelta(10, 350), -20);
  assert.equal(bearingDelta(270, 90), 180);
});

test("bearingDeg measures a north-then-east L shape correctly", () => {
  // Due north: 0.001 deg of latitude ~ 111 m.
  assert.ok(Math.abs(bearingDeg(-4.48, 54.16, -4.48, 54.161) - 0) < 0.5, "north");
  assert.ok(Math.abs(bearingDeg(-4.48, 54.16, -4.48, 54.159) - 180) < 0.5, "south");
  // Due east: ~0.001 deg of longitude ~ 65 m at this latitude.
  assert.ok(Math.abs(bearingDeg(-4.48, 54.16, -4.479, 54.16) - 90) < 0.5, "east");
});

test("cardinal names the 16-point compass", () => {
  assert.equal(cardinal(0), "north");
  assert.equal(cardinal(90), "east");
  assert.equal(cardinal(180), "south");
  assert.equal(cardinal(270), "west");
  assert.equal(cardinal(315), "north-west");
  assert.equal(cardinal(10), "north");
  assert.equal(cardinal(350), "north");
});

test("formatStepDistance reports the island's road units", () => {
  assert.equal(formatStepDistance(30), "100 ft");
  assert.equal(formatStepDistance(300), "330 yd");
  assert.equal(formatStepDistance(1200), "0.7 mi");
  assert.equal(formatStepDistance(12300), "7.6 mi");
});

test("a one-segment straight route is a single step", () => {
  const coords = [
    [-4.48, 54.16],
    [-4.48, 54.161],
  ];
  const steps = deriveSteps(coords);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].instruction, "Head north for 120 yd");
  assert.ok(steps[0].distanceM > 105 && steps[0].distanceM < 120);
  assert.equal(steps[0].bearing, 0);
});

test("an L-shaped route yields a second step with a turn", () => {
  // North for ~222 m, then east for ~65 m: one 90-degree turn.
  const coords = [
    [-4.48, 54.16],
    [-4.48, 54.162],
    [-4.479, 54.162],
  ];
  const steps = deriveSteps(coords);
  assert.equal(steps.length, 2, "two legs across a right-angle turn");
  assert.match(steps[0].instruction, /^Head north for \d+ yd$/);
  const first = steps[0].distanceM;
  assert.ok(first > 215 && first < 230, `first leg ${first} m`);
  assert.match(steps[1].instruction, /^Turn right, heading east for \d+ yd$/);
  const east = steps[1].distanceM;
  assert.ok(east > 60 && east < 70, `second leg ${east} m`);
});

test("street names are carried onto the legs that use them", () => {
  const coords = [
    [-4.48, 54.16],
    [-4.48, 54.162],
    [-4.479, 54.162],
  ];
  // Segment 0 (north) is "Main Street"; segment 1 (east) is unnamed.
  const steps = deriveSteps(coords, ["Main Street", null]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].streetName, "Main Street");
  assert.equal(steps[0].instruction, "Head north on Main Street for 240 yd");
  assert.match(steps[1].instruction, /^Turn right, heading east for \d+ yd$/);
  assert.equal(steps[1].streetName, null);
});

test("a leg keeps the name of its longest named segment", () => {
  // Two collinear segments, the first much shorter than the second. The leg
  // should not be named after the fleeting first segment.
  const coords = [
    [-4.48, 54.16],
    [-4.48, 54.1605],
    [-4.48, 54.162],
  ];
  const steps = deriveSteps(coords, ["Side Alley", "Cathedral Road"]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].streetName, "Cathedral Road");
  assert.match(steps[0].instruction, /^Head north on Cathedral Road for .+$/);
});

test("a gentle curve stays one step, a sharp turn splits", () => {
  // 8 segments crawling east with a <30deg wobble at the end: should merge.
  const gentle = [];
  for (let i = 0; i < 8; i++) {
    gentle.push([-4.48 + i * 0.0005, 54.161 + (i % 2 === 0 ? 0.00001 : 0)]);
  }
  assert.equal(deriveSteps(gentle).length, 1, "a wobble under the threshold is one leg");

  // Same line but with hard 90-degree turns: north, east, then north again.
  const sharp = [
    [-4.48, 54.16],
    [-4.48, 54.162],
    [-4.478, 54.162],
    [-4.478, 54.164],
  ];
  const steps = deriveSteps(sharp);
  assert.ok(steps.length >= 2, "hard turns split the route");
  assert.match(steps[1].instruction, /^Turn right, heading east for \d+ yd$/);
});

test("pointAtDistance walks and interpolates along the polyline", () => {
  const coords = [
    [-4.48, 54.16],
    [-4.48, 54.162],
    [-4.479, 54.162],
  ];
  assert.deepEqual(pointAtDistance(coords, 0), [-4.48, 54.16]);
  const leg1 = haversineM(-4.48, 54.16, -4.48, 54.162);
  const mid = pointAtDistance(coords, leg1 / 2);
  assert.ok(Math.abs(mid[0] + 4.48) < 1e-9 && mid[1] > 54.16 && mid[1] < 54.162);
  const corner = pointAtDistance(coords, leg1);
  assert.ok(Math.abs(corner[0] + 4.48) < 1e-9 && Math.abs(corner[1] - 54.162) < 1e-6);
  assert.deepEqual(pointAtDistance(coords, 1e9), [-4.479, 54.162]);
  assert.equal(pointAtDistance([], 10), null);
});

test("tiny routes and degenerate inputs do not throw", () => {
  assert.deepEqual(deriveSteps([]), []);
  assert.deepEqual(deriveSteps([[-4.48, 54.16]]), []);
  assert.equal(deriveSteps([[-4.48, 54.16], [-4.48, 54.16]]).length, 0, "zero-length folds away");
  assert.ok(haversineM(-4.48, 54.16, -4.48, 54.16) < 1e-6, "zero distance is ~0");
});

test("classifyManeuver maps bearing change to a kind and side", () => {
  assert.equal(classifyManeuver(0, 0).kind, "continue");
  assert.equal(classifyManeuver(0, 10).kind, "continue", "under 20 deg is not a turn");
  assert.equal(classifyManeuver(0, 40).kind, "slight-right");
  assert.equal(classifyManeuver(0, 90).kind, "right");
  assert.equal(classifyManeuver(0, 150).kind, "sharp-right");
  assert.equal(classifyManeuver(0, 180).kind, "uturn");
  assert.equal(classifyManeuver(0, -40).kind, "slight-left");
  assert.equal(classifyManeuver(0, -90).kind, "left");
  assert.equal(classifyManeuver(0, -150).kind, "sharp-left");
  // Across north, the shorter arc decides the side.
  assert.equal(classifyManeuver(355, 5).kind, "continue");
  assert.equal(classifyManeuver(350, 80).side, "right");
  assert.equal(classifyManeuver(10, 300).side, "left");
  // Side is only meaningful for turns.
  assert.equal(classifyManeuver(0, 180).side, null);
  assert.equal(classifyManeuver(0, 0).side, null);
});

test("derived steps carry a maneuver kind and side", () => {
  const right = deriveSteps([
    [-4.48, 54.16],
    [-4.48, 54.162],
    [-4.479, 54.162],
  ]);
  assert.equal(right[0].maneuver, "depart");
  assert.equal(right[1].maneuver, "right");
  assert.equal(right[1].side, "right");

  const left = deriveSteps([
    [-4.48, 54.16],
    [-4.48, 54.162],
    [-4.481, 54.162],
  ]);
  assert.equal(left[1].maneuver, "left");
  assert.equal(left[1].side, "left");
});

test("roundabout legs are phrased and classified as such", () => {
  // North, then east onto a roundabout segment, then north off it.
  const coords = [
    [-4.48, 54.16],
    [-4.48, 54.162],
    [-4.479, 54.162],
    [-4.479, 54.164],
  ];
  const steps = deriveSteps(coords, [null, null, null], [null, "roundabout", null]);
  assert.equal(steps.length, 3);
  assert.equal(steps[1].maneuver, "roundabout-enter");
  assert.match(steps[1].instruction, /^At the roundabout/);
  assert.equal(steps[2].maneuver, "roundabout-exit");
  assert.match(steps[2].instruction, /^Leave the roundabout/);
});

test("folding a route past MAX_LEGS preserves total distance", () => {
  // A 20-segment zigzag: every segment turns 90 degrees, so each becomes its
  // own leg (20 legs > MAX_LEGS = 16), and the last four legs fold into the
  // final step. Regression: slice(MAX_LEGS - 1) re-included leg 15 and
  // double-counted its distance into the folded step.
  const coords = [[-4.48, 54.16]];
  for (let i = 0; i < 20; i++) {
    const [lon, lat] = coords[coords.length - 1];
    coords.push(i % 2 === 0 ? [lon + 0.001, lat] : [lon, lat + 0.001]);
  }

  let expected = 0;
  for (let i = 1; i < coords.length; i++) {
    expected += haversineM(...coords[i - 1], ...coords[i]);
  }

  const steps = deriveSteps(coords);
  assert.equal(steps.length, 16, "leg count is capped at MAX_LEGS");
  const total = steps.reduce((m, s) => m + s.distanceM, 0);
  assert.ok(
    Math.abs(total - expected) / expected < 0.02,
    `folded legs total ${total} m vs path ${expected} m`,
  );
});