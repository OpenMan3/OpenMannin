/**
 * Tests for the offline coverage overlay's map glue (src/lib/map-coverage.ts).
 *
 * The module's only runtime surface is a handful of MapLibre methods, and its
 * imports are type-only (erased under `--experimental-strip-types`), so a tiny
 * fake map exercises the add/update/teardown lifecycle without a browser. What
 * matters here is idempotency: a style swap calls this again, and a duplicate
 * addSource/addLayer would throw in MapLibre.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  COVERAGE_FILL_LAYER_ID,
  COVERAGE_LINE_LAYER_ID,
  COVERAGE_SOURCE_ID,
  syncCoverage,
} from "../../src/lib/map-coverage.ts";

/** A minimal stand-in for a MapLibre map that records source/layer mutations. */
function fakeMap() {
  const sources = new Map();
  const layers = new Map();
  const calls = { addSource: 0, addLayer: 0, removeSource: 0, removeLayer: 0, setData: 0 };
  return {
    calls,
    getSource: (id) => sources.get(id),
    addSource: (id, src) => {
      calls.addSource++;
      sources.set(id, {
        type: "geojson",
        data: src.data,
        setData(d) {
          calls.setData++;
          this.data = d;
        },
      });
    },
    removeSource: (id) => {
      calls.removeSource++;
      sources.delete(id);
    },
    getLayer: (id) => layers.get(id),
    addLayer: (l) => {
      calls.addLayer++;
      layers.set(l.id, l);
    },
    removeLayer: (id) => {
      calls.removeLayer++;
      layers.delete(id);
    },
    hasSource: (id) => sources.has(id),
    hasLayer: (id) => layers.has(id),
  };
}

const SAMPLE = { type: "FeatureCollection", features: [] };

test("syncCoverage adds the source and both layers on first show", () => {
  const map = fakeMap();
  syncCoverage(map, SAMPLE);
  assert.equal(map.calls.addSource, 1);
  assert.equal(map.calls.addLayer, 2);
  assert.ok(map.hasSource(COVERAGE_SOURCE_ID));
  assert.ok(map.hasLayer(COVERAGE_FILL_LAYER_ID));
  assert.ok(map.hasLayer(COVERAGE_LINE_LAYER_ID));
});

test("syncCoverage updates data instead of re-adding on a second show", () => {
  const map = fakeMap();
  syncCoverage(map, SAMPLE);
  syncCoverage(map, SAMPLE);
  assert.equal(map.calls.addSource, 1, "source added exactly once");
  assert.equal(map.calls.addLayer, 2, "layers added exactly once");
  assert.equal(map.calls.setData, 1, "second show just pushes new data");
});

test("syncCoverage(null) tears the overlay down", () => {
  const map = fakeMap();
  syncCoverage(map, SAMPLE);
  syncCoverage(map, null);
  assert.equal(map.hasSource(COVERAGE_SOURCE_ID), false);
  assert.equal(map.hasLayer(COVERAGE_FILL_LAYER_ID), false);
  assert.equal(map.hasLayer(COVERAGE_LINE_LAYER_ID), false);
});

test("syncCoverage(null) on an empty map is a harmless no-op", () => {
  const map = fakeMap();
  assert.doesNotThrow(() => syncCoverage(map, null));
  assert.equal(map.calls.removeSource, 0);
  assert.equal(map.calls.removeLayer, 0);
});
