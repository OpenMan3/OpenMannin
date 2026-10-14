/**
 * The tile/GeoJSON source choice is the branch most likely to regress
 * silently: a layer that should stream PMTiles but falls back to loading a
 * 4 MB GeoJSON would still draw, just slowly, so only a unit test catches it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { pmtilesSource } from "../../src/lib/layer-source.ts";

test("a layer with a pmtiles archive gets a vector source", () => {
  assert.deepEqual(pmtilesSource({ pmtiles: "tiles/roads.pmtiles" }), {
    type: "vector",
    url: "pmtiles:///tiles/roads.pmtiles",
  });
});

test("a leading slash is normalised", () => {
  assert.equal(pmtilesSource({ pmtiles: "/tiles/roads.pmtiles" }).url, "pmtiles:///tiles/roads.pmtiles");
});

test("a layer without a pmtiles archive falls back", () => {
  assert.equal(pmtilesSource({}), null);
});
