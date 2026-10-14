import { stableFeatureKey, countSharedKeys, pairwiseSharedCounts } from "./data-quality.mjs";
import { test } from "node:test";
import { strict as assert } from "node:assert";

test("stableFeatureKey prefers identity property values", () => {
  assert.equal(
    stableFeatureKey({ id: 42, name: "x" }, { type: "Point", coordinates: [1, 2] }),
    "id:42",
  );
  assert.equal(
    stableFeatureKey({ osm: "way/1" }, { type: "Point", coordinates: [1, 2] }),
    "osm:way/1",
  );
});

test("stableFeatureKey falls back to rounded geometry", () => {
  assert.equal(
    stableFeatureKey({}, { type: "Point", coordinates: [1.234567, 2.345678] }),
    "geom:1.234567,2.345678",
  );
});

test("countSharedKeys counts exact identity matches", () => {
  const a = [{ properties: { osm: "way/1" }, geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } }];
  const b = [
    { properties: { osm: "way/1" }, geometry: { type: "LineString", coordinates: [[0, 0], [5, 5]] } },
    { properties: { osm: "way/2" }, geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } },
  ];
  assert.equal(countSharedKeys(a, b), 1);
});

test("pairwiseSharedCounts sorts by count", () => {
  const input = {
    "a.geojson": [{ properties: { id: 1 }, geometry: { type: "Point", coordinates: [1, 2] } }],
    "b.geojson": [{ properties: { id: 2 }, geometry: { type: "Point", coordinates: [1, 2] } }],
    "c.geojson": [{ properties: { id: 1 }, geometry: { type: "Point", coordinates: [3, 4] } }],
  };
  const rows = pairwiseSharedCounts(input);
  assert.deepEqual(rows, [
    { a: "a.geojson", b: "c.geojson", shared: 1 },
  ]);
});
