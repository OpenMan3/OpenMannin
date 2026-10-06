import { test } from "node:test";
import { strict as assert } from "node:assert";
import { browseLabel, featureCentre, indexFeatures } from "../../src/lib/feature-index.ts";

test("browseLabel prefers the ingest labels, then name-ish fields", () => {
  assert.equal(browseLabel({ label: "  42 Castle Street  " }), "42 Castle Street");
  assert.equal(browseLabel({ species: "Fagus sylvatica", label: "" }), "Fagus sylvatica");
  assert.equal(browseLabel({ name: "Douglas Head" }), "Douglas Head");
  assert.equal(browseLabel({ regNo: "RT0001" }), "Reg. RT0001");
  assert.equal(browseLabel(null), "(unnamed)");
  assert.equal(browseLabel({}), "(unnamed)");
});

test("featureCentre of a Point is the point itself", () => {
  assert.deepEqual(featureCentre({ type: "Point", coordinates: [-4.5, 54.1] }), [-4.5, 54.1]);
  assert.equal(featureCentre({ type: "Point", coordinates: [NaN, 54.1] }), null);
});

test("featureCentre of a LineString is the average vertex", () => {
  assert.deepEqual(
    featureCentre({ type: "LineString", coordinates: [[0, 0], [2, 0], [2, 2]] }),
    [4 / 3, 2 / 3],
  );
});

test("featureCentre of a Polygon uses its ring vertices", () => {
  // Ring closes: the first vertex repeats, so the mean is the five points'
  // average, not the four corners'.
  const square = {
    type: "Polygon",
    coordinates: [[[-2, -1], [0, -1], [0, 1], [-2, 1], [-2, -1]]],
  };
  assert.deepEqual(featureCentre(square), [-6 / 5, -1 / 5]);
});

test("featureCentre of a MultiPolygon uses the largest member, not the first", () => {
  const multi = {
    type: "MultiPolygon",
    coordinates: [
      [[[0, 0], [1, 0], [1, 1], [0, 0]]], // triangle, 4 vertices, centre (0.5, 0.25)
      [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], // 5 vertices, centre (4, 4)
    ],
  };
  assert.deepEqual(featureCentre(multi), [4, 4]);
});

test("indexFeatures keeps order, labels and geometry, skipping the uncentred", () => {
  const fc = {
    features: [
      { geometry: { type: "Point", coordinates: [1, 2] }, properties: { label: "A" } },
      { geometry: { type: "Point", coordinates: [NaN, 2] }, properties: { label: "B" } },
      { geometry: { type: "Point", coordinates: [3, 4] }, properties: { species: "Oak" } },
    ],
  };
  const entries = indexFeatures(fc);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { index: 0, label: "A", lon: 1, lat: 2, properties: { label: "A" }, geometry: { type: "Point", coordinates: [1, 2] } });
  assert.equal(entries[1].label, "Oak");
  assert.equal(entries[1].index, 2);
});