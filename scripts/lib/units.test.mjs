/**
 * Unit tests for the imperial formatters (src/lib/units.ts).
 *
 * The island reads distance in feet/yards/miles and speed in mph, so these
 * boundaries are user-facing: a regression here changes what every instruction
 * says. Pure math, so it runs under `node --test`.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatDistance,
  formatMiles,
  formatDuration,
  formatSpeedMph,
  kmhToMph,
  mphToKmh,
} from "../../src/lib/units.ts";

test("formatDistance uses feet for the last few dozen metres", () => {
  assert.equal(formatDistance(0), "10 ft");
  assert.equal(formatDistance(20), "70 ft");
  assert.equal(formatDistance(30), "100 ft");
  assert.equal(formatDistance(45), "150 ft");
});

test("formatDistance uses yards up to a quarter mile", () => {
  assert.equal(formatDistance(46), "50 yd");
  assert.equal(formatDistance(111), "120 yd");
  assert.equal(formatDistance(300), "330 yd");
  assert.equal(formatDistance(400), "440 yd");
});

test("formatDistance switches to miles at a quarter mile", () => {
  assert.equal(formatDistance(500), "0.3 mi");
  assert.equal(formatDistance(1200), "0.7 mi");
  assert.equal(formatDistance(12300), "7.6 mi");
  assert.equal(formatDistance(20093), "12 mi", "past 10 miles drop the decimal");
});

test("formatDistance never returns a negative or NaN string", () => {
  assert.equal(formatDistance(-5), "10 ft");
  assert.equal(formatDistance(Number.NaN), "10 ft");
});

test("formatMiles is the plain road-distance summariser", () => {
  assert.equal(formatMiles(0), "0.0 mi");
  assert.equal(formatMiles(1609.344), "1.0 mi");
  assert.equal(formatMiles(16093.44), "10 mi");
});

test("formatSpeedMph converts km/h to whole miles per hour", () => {
  assert.equal(formatSpeedMph(48.28032), "30 mph");
  assert.equal(formatSpeedMph(32.18688), "20 mph");
  assert.equal(formatSpeedMph(Number.NaN), "-");
});

test("speed conversions round-trip", () => {
  assert.ok(Math.abs(kmhToMph(100) - 62.1371) < 1e-3);
  assert.ok(Math.abs(mphToKmh(30) - 48.28032) < 1e-4);
});

test("formatDuration formats seconds as human-readable", () => {
  assert.equal(formatDuration(0), "<1 min");
  assert.equal(formatDuration(30), "<1 min");
  assert.equal(formatDuration(45), "1 min");
  assert.equal(formatDuration(90), "2 min");
  assert.equal(formatDuration(3540), "59 min");
  assert.equal(formatDuration(3600), "1 h");
  assert.equal(formatDuration(3660), "1 h 1 min");
  assert.equal(formatDuration(5400), "1 h 30 min");
  assert.equal(formatDuration(7200), "2 h");
  assert.equal(formatDuration(7260), "2 h 1 min");
});
