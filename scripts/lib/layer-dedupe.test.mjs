import { test } from "node:test";
import assert from "node:assert/strict";
import { geometryKey, sharedCoordinateCount } from "./layer-dedupe.mjs";

const pt = (lon, lat) => ({ type: "Point", coordinates: [lon, lat] });
const feat = (lon, lat) => ({ geometry: pt(lon, lat) });

test("geometryKey rounds so differing precision still matches", () => {
  assert.equal(geometryKey(pt(-4.123456, 54.654321)), geometryKey(pt(-4.123457, 54.654321)));
  assert.notEqual(geometryKey(pt(-4.1, 54.6)), geometryKey(pt(-4.9, 54.6)));
});

test("geometryKey handles LineString coordinates", () => {
  const line = { type: "LineString", coordinates: [[-4.1, 54.1], [-4.2, 54.2]] };
  assert.equal(geometryKey(line), "-4.10000,54.10000|-4.20000,54.20000");
});

test("geometryKey returns null for missing geometry", () => {
  assert.equal(geometryKey(null), null);
  assert.equal(geometryKey({ type: "Point" }), null);
});

test("sharedCoordinateCount finds exact-coordinate duplicates", () => {
  const a = [feat(-4.5, 54.1), feat(-4.6, 54.2)];
  const b = [feat(-4.5, 54.1), feat(-4.7, 54.3)];
  assert.equal(sharedCoordinateCount(a, b), 1);
});

test("sharedCoordinateCount is zero for disjoint layers", () => {
  const a = [feat(-4.5, 54.1), feat(-4.6, 54.2)];
  const b = [feat(-4.9, 54.9)];
  assert.equal(sharedCoordinateCount(a, b), 0);
});
