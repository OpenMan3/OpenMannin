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
  deriveSteps,
  formatStepDistance,
  haversineM,
  normalizeDeg,
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

test("formatStepDistance prefers km once past 1 km", () => {
  assert.equal(formatStepDistance(300), "300 m");
  assert.equal(formatStepDistance(1200), "1.2 km");
  assert.equal(formatStepDistance(12300), "12 km");
});

test("a one-segment straight route is a single step", () => {
  const coords = [
    [-4.48, 54.16],
    [-4.48, 54.161],
  ];
  const steps = deriveSteps(coords);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].instruction, "Head north for 111 m");
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
  assert.match(steps[0].instruction, /^Head north for \d+ m$/);
  const first = steps[0].distanceM;
  assert.ok(first > 215 && first < 230, `first leg ${first} m`);
  assert.match(steps[1].instruction, /^Turn right, heading east for \d+ m$/);
  const east = steps[1].distanceM;
  assert.ok(east > 60 && east < 70, `second leg ${east} m`);
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
  assert.match(steps[1].instruction, /^Turn right, heading east for \d+ m$/);
});

test("tiny routes and degenerate inputs do not throw", () => {
  assert.deepEqual(deriveSteps([]), []);
  assert.deepEqual(deriveSteps([[-4.48, 54.16]]), []);
  assert.equal(deriveSteps([[-4.48, 54.16], [-4.48, 54.16]]).length, 0, "zero-length folds away");
  assert.ok(haversineM(-4.48, 54.16, -4.48, 54.16) < 1e-6, "zero distance is ~0");
});