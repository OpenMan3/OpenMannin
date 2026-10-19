/**
 * Unit tests for the offline coverage shapes (src/lib/offline-coverage.ts).
 *
 * Pure bbox maths and set counting, so it runs under `node --test`. Fixture
 * boxes sit on the island's real extent, plus one entry with no bbox (a
 * malformed manifest line) and one whose id is not cached, to exercise the
 * skip paths.
 *
 * NOTE: this file is plain JS (.mjs) on purpose - `--experimental-strip-types`
 * applies to the imported .ts sources, but the test file itself must not use
 * TypeScript syntax.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  bboxPolygon,
  coverageFeatureCollection,
  summarizeCoverage,
} from "../../src/lib/offline-coverage.ts";

const LAYERS = [
  { id: "roads", label: "Roads", bytes: 1000, bbox: [-4.83, 54.04, -4.31, 54.42] },
  { id: "heritage", label: "Heritage", bytes: 500, bbox: [-4.84, 54.03, -4.3, 54.41] },
  { id: "lighthouses", label: "Lighthouses", bytes: 250 },
];

test("summarizeCoverage counts only the cached ids", () => {
  const summary = summarizeCoverage(LAYERS, new Set(["roads", "lighthouses"]));
  assert.equal(summary.cachedLayers, 2);
  assert.equal(summary.totalLayers, 3);
  assert.equal(summary.cachedBytes, 1250);
});

test("summarizeCoverage ignores ids that match no layer", () => {
  const summary = summarizeCoverage(LAYERS, new Set(["ghost"]));
  assert.equal(summary.cachedLayers, 0);
  assert.equal(summary.cachedBytes, 0);
});

test("summarizeCoverage treats a missing or nonsensical size as zero", () => {
  const layers = [
    { id: "a", bytes: -5 },
    { id: "b" },
    { id: "c", bytes: Number.NaN },
    { id: "d", bytes: 42 },
  ];
  const summary = summarizeCoverage(layers, new Set(["a", "b", "c", "d"]));
  assert.equal(summary.cachedLayers, 4);
  assert.equal(summary.cachedBytes, 42);
});

test("bboxPolygon closes the ring and can pad outward", () => {
  const ring = bboxPolygon([-1, 50, 1, 52]);
  assert.deepEqual(ring, [
    [-1, 50],
    [1, 50],
    [1, 52],
    [-1, 52],
    [-1, 50],
  ]);
  const padded = bboxPolygon([-1, 50, 1, 52], 0.5);
  assert.deepEqual(padded[0], [-1.5, 49.5]);
  assert.deepEqual(padded[2], [1.5, 52.5]);
});

test("coverageFeatureCollection carries only cached layers that have a bbox", () => {
  const fc = coverageFeatureCollection(LAYERS, new Set(["roads", "heritage", "lighthouses"]));
  // lighthouses has no bbox, so it is skipped.
  assert.equal(fc.type, "FeatureCollection");
  assert.equal(fc.features.length, 2);
  const ids = fc.features.map((f) => f.id);
  assert.deepEqual(ids, ["roads", "heritage"]);
  const roads = fc.features[0];
  assert.equal(roads.geometry.type, "Polygon");
  assert.equal(roads.geometry.coordinates.length, 1, "one ring");
  assert.equal(roads.geometry.coordinates[0].length, 5, "closed");
  assert.equal(roads.properties.label, "Roads");
  assert.equal(roads.properties.bytes, 1000);
});

test("coverageFeatureCollection is empty when nothing is cached", () => {
  const fc = coverageFeatureCollection(LAYERS, new Set());
  assert.deepEqual(fc.features, []);
});
