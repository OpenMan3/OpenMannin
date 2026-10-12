/**
 * The OpenSeaMap overlay is the only raster layer added at runtime, and its
 * ordering rule is the whole point: it must sit ABOVE the basemap but BELOW
 * every `om-*` data layer. Get that wrong and either the marks vanish under an
 * opaque basemap or they hide the data layers. A fake map pins the contract
 * without a WebGL context.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySeamarkOverlay,
  SEAMARK_SOURCE_ID,
  SEAMARK_LAYER_ID,
  SEAMARK_TILES,
} from "../../src/lib/map-style.ts";

function fakeMap(initialLayerIds = []) {
  const layers = initialLayerIds.map((id) => ({ id }));
  const sources = {};
  return {
    getLayer: (id) => layers.find((l) => l.id === id),
    getSource: (id) => sources[id],
    addSource: (id, source) => {
      sources[id] = source;
    },
    removeSource: (id) => {
      delete sources[id];
    },
    getStyle: () => ({ layers }),
    addLayer: (layer, beforeId) => {
      const at = beforeId ? layers.findIndex((l) => l.id === beforeId) : layers.length;
      assert.notEqual(at, -1, `beforeId ${beforeId} does not exist`);
      layers.splice(at < 0 ? layers.length : at, 0, layer);
    },
    removeLayer: (id) => {
      const at = layers.findIndex((l) => l.id === id);
      if (at >= 0) layers.splice(at, 1);
    },
    layerIds: () => layers.map((l) => l.id),
  };
}

test("the overlay tiles come from OpenSeaMap", () => {
  for (const url of SEAMARK_TILES) {
    assert.ok(url.startsWith("https://tiles.openseamap.org/"), url);
    assert.ok(url.includes("{z}/{x}/{y}"), url);
  }
});

test("adding the overlay sits it above the basemap and below the data layers", () => {
  const map = fakeMap(["background", "basemap", "om-roads-line", "om-roads-circle"]);
  applySeamarkOverlay(map, true);

  assert.ok(map.getSource(SEAMARK_SOURCE_ID), "source added");
  assert.deepEqual(map.layerIds(), [
    "background",
    "basemap",
    SEAMARK_LAYER_ID,
    "om-roads-line",
    "om-roads-circle",
  ]);
});

test("with no data layers yet the overlay still lands above the basemap", () => {
  const map = fakeMap(["background", "basemap"]);
  applySeamarkOverlay(map, true);
  assert.deepEqual(map.layerIds(), ["background", "basemap", SEAMARK_LAYER_ID]);
});

test("adding twice is idempotent", () => {
  const map = fakeMap(["background", "basemap", "om-roads-line"]);
  applySeamarkOverlay(map, true);
  applySeamarkOverlay(map, true);
  assert.equal(map.layerIds().filter((id) => id === SEAMARK_LAYER_ID).length, 1);
});

test("removing the overlay drops both the layer and its source", () => {
  const map = fakeMap(["background", "basemap", "om-roads-line"]);
  applySeamarkOverlay(map, true);
  applySeamarkOverlay(map, false);
  assert.equal(map.getLayer(SEAMARK_LAYER_ID), undefined);
  assert.equal(map.getSource(SEAMARK_SOURCE_ID), undefined);
  assert.deepEqual(map.layerIds(), ["background", "basemap", "om-roads-line"]);
});
