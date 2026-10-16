/**
 * Unit tests for the scoped offline download (src/lib/offline-scope.ts).
 *
 * Pure manifest parsing and bbox maths, so it runs under `node --test`.
 * Fixture boxes sit on the island's real extent (lon -4.84..-4.31,
 * lat 54.03..54.42) plus one box far out in the Atlantic for the cases that
 * must NOT intersect - a viewport test where every layer matches proves
 * nothing.
 *
 * NOTE: this file is plain JS (.mjs) on purpose - `--experimental-strip-types`
 * applies to the imported .ts sources, but the test file itself must not use
 * TypeScript syntax.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  bboxIntersects,
  collectTargets,
  formatBytes,
  parseManifest,
  scopeLayers,
  totalBytes,
  viewportToBBox,
} from "../../src/lib/offline-scope.ts";

const MANIFEST = {
  generated: "2026-10-16",
  layers: {
    roads: {
      file: "roads.geojson",
      bytes: 4339463,
      bbox: [-4.83, 54.04, -4.31, 54.42],
      pmtiles: "tiles/roads.pmtiles",
    },
    heritage: {
      file: "heritage.geojson",
      bytes: 127929,
      bbox: [-4.84, 54.03, -4.3, 54.41],
    },
    offshore: {
      file: "offshore.geojson",
      bytes: 1024,
      bbox: [-10, 50, -9, 51],
    },
  },
};

const parse = () => parseManifest(MANIFEST);

test("parseManifest reads ids, sizes, bboxes and the build stamp", () => {
  const m = parse();
  assert.equal(m.generated, "2026-10-16");
  assert.deepEqual(
    m.layers.map((l) => l.id),
    ["roads", "heritage", "offshore"],
  );
  const roads = m.layers[0];
  assert.equal(roads.file, "roads.geojson");
  assert.equal(roads.pmtiles, "tiles/roads.pmtiles");
  assert.equal(roads.bytes, 4339463);
  assert.deepEqual(roads.bbox, [-4.83, 54.04, -4.31, 54.42]);
  assert.equal(m.layers[1].pmtiles, undefined, "a layer without tiles has none");
});

test("parseManifest keeps a label when the manifest carries one", () => {
  const m = parseManifest({ layers: { roads: { label: "Road network", bytes: 1 } } });
  assert.equal(m.layers[0].label, "Road network");
  assert.equal(parseManifest({ layers: { roads: { bytes: 1 } } }).layers[0].label, undefined);
});

test("parseManifest degrades junk instead of throwing", () => {
  const m = parseManifest({
    generated: 20261016,
    layers: {
      good: { bytes: 10, bbox: [1, 2, 3, 4] },
      nulled: null,
      sloppy: { bytes: "a lot", bbox: [1, 2], file: "" },
    },
  });
  assert.equal(m.generated, null, "a non-string stamp is dropped");
  assert.deepEqual(
    m.layers.map((l) => l.id),
    ["good", "sloppy"],
    "non-object entries are skipped, everything else is kept",
  );
  const sloppy = m.layers[1];
  assert.equal(sloppy.bytes, 0, "an unusable size counts as nothing");
  assert.equal(sloppy.bbox, undefined, "a half-written bbox is not a bbox");
  assert.equal(sloppy.file, undefined, "empty strings are not file names");
});

test("parseManifest survives a manifest that is not an object", () => {
  for (const bad of [null, undefined, "layers", 42]) {
    assert.deepEqual(parseManifest(bad), { generated: null, layers: [] });
  }
  assert.deepEqual(parseManifest({}).layers, []);
});

test("bboxIntersects treats touching edges as on screen", () => {
  // A view over the whole island vs. a layer that only clips its north-west.
  const island = [-4.84, 54.03, -4.3, 54.42];
  assert.equal(bboxIntersects(island, [-5, 54, -4.5, 55]), true);
  assert.equal(bboxIntersects([-5, 54, -4.5, 55], island), true, "symmetric");
  assert.equal(bboxIntersects(island, [-4.84, 54.03, -4.3, 54.42]), true, "identical");
  assert.equal(bboxIntersects(island, [-4.84, 54.2, -4.3, 54.42]), true, "shared edge");
  assert.equal(bboxIntersects(island, [-10, 50, -9, 51]), false, "out in the Atlantic");
  assert.equal(bboxIntersects(island, [-4.3, 54.03, -4.0, 54.42]), true, "east of the island shares the edge");
  assert.equal(bboxIntersects(island, [-4.29, 54.03, -4.0, 54.42]), false, "just east of the island, no touch");
});

test("viewportToBBox reorders the panel's viewport into manifest order", () => {
  assert.deepEqual(
    viewportToBBox({ west: -4.8, south: 54.1, east: -4.4, north: 54.3 }),
    [-4.8, 54.1, -4.4, 54.3],
  );
});

test("scope 'all' returns every layer but not the same array", () => {
  const layers = parse().layers;
  const out = scopeLayers(layers, "all", { selected: [], viewport: null });
  assert.deepEqual(out.map((l) => l.id), ["roads", "heritage", "offshore"]);
  assert.notEqual(out, layers, "callers may sort or mutate the result");
});

test("scope 'selected' keeps only ticked ids, in manifest order", () => {
  const layers = parse().layers;
  const out = scopeLayers(layers, "selected", {
    selected: ["offshore", "no-such-layer", "roads"],
    viewport: null,
  });
  assert.deepEqual(out.map((l) => l.id), ["roads", "offshore"], "unknown ids are dropped");
  assert.deepEqual(
    scopeLayers(layers, "selected", { selected: [], viewport: null }),
    [],
    "an empty selection downloads nothing rather than everything",
  );
});

test("scope 'viewport' keeps only layers the view can see", () => {
  const layers = parse().layers;
  const view = { west: -5, south: 54, east: -4, north: 54.5 };
  const out = scopeLayers(layers, "viewport", { selected: [], viewport: view });
  assert.deepEqual(
    out.map((l) => l.id),
    ["roads", "heritage"],
    "the Atlantic layer is outside the view",
  );
  assert.deepEqual(
    scopeLayers(layers, "viewport", { selected: [], viewport: null }),
    [],
    "no viewport means nothing is assumed to be visible",
  );
});

test("scope 'viewport' skips layers with no bbox at all", () => {
  const layers = [...parse().layers, { id: "unstamped", bytes: 5 }];
  const out = scopeLayers(layers, "viewport", {
    selected: [],
    viewport: { west: -5, south: 54, east: -4, north: 54.5 },
  });
  assert.deepEqual(
    out.map((l) => l.id),
    ["roads", "heritage"],
    "a layer with no bbox cannot be proven visible",
  );
});

test("totalBytes sums real sizes and ignores nonsensical ones", () => {
  assert.equal(totalBytes(parse().layers), 4339463 + 127929 + 1024);
  assert.equal(totalBytes([]), 0);
  assert.equal(
    totalBytes([{ id: "a", bytes: 10 }, { id: "b", bytes: -1 }, { id: "c", bytes: NaN }]),
    10,
  );
});

test("formatBytes reads sizes the way a person does", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(-5), "0 B");
  assert.equal(formatBytes(NaN), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(583347), "570 KB");
  assert.equal(formatBytes(1048576), "1.0 MB");
  assert.equal(formatBytes(4339463), "4.1 MB");
});

test("collectTargets builds /data and /tiles URLs, deduplicated", () => {
  const layers = parse().layers;
  const targets = collectTargets(layers, "https://example.test");
  assert.deepEqual([...targets].sort(), [
    "https://example.test/data/heritage.geojson",
    "https://example.test/data/offshore.geojson",
    "https://example.test/data/roads.geojson",
    "https://example.test/tiles/roads.pmtiles",
  ]);

  const shared = collectTargets(
    [
      { id: "a", file: "same.geojson", bytes: 1 },
      { id: "b", file: "same.geojson", pmtiles: "same.pmtiles", bytes: 1 },
    ],
    "https://example.test/",
  );
  assert.equal(shared.length, 2, "the same file is fetched once, not twice");

  assert.deepEqual(
    collectTargets([{ id: "tiles-only", pmtiles: "tiles/x.pmtiles", bytes: 0 }], "https://example.test"),
    ["https://example.test/tiles/x.pmtiles"],
  );
  assert.deepEqual(collectTargets([], "https://example.test"), []);
});
