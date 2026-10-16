/**
 * Unit tests for deep-link parameter round-trips and nearest-feature restore
 * (src/lib/deep-link.ts). Pure parsing/maths, so it runs under `node --test`.
 *
 * NOTE: this file is plain JS (.mjs) on purpose - `--experimental-strip-types`
 * applies to the imported .ts sources, but the test file itself must not use
 * TypeScript syntax.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatPickParam,
  formatToParam,
  nearestFeatureProperties,
  parsePickParam,
  parseToParam,
} from "../../src/lib/deep-link.ts";

test("to-param round-trips a simple destination", () => {
  const raw = formatToParam({ lon: -4.4814, lat: 54.1509, title: "Douglas Head" });
  const parsed = parseToParam(raw);
  assert.deepEqual(parsed, { lon: -4.4814, lat: 54.1509, title: "Douglas Head" });
});

test("to-param keeps commas and colons inside the title", () => {
  const raw = formatToParam({
    lon: -4.5,
    lat: 54.2,
    title: "Peel, Castle",
    detail: "later: at dusk",
  });
  const parsed = parseToParam(raw);
  assert.ok(parsed);
  assert.equal(parsed.title, "Peel, Castle");
  assert.equal(parsed.detail, "later: at dusk");
});

test("to-param rejects mangled input instead of throwing", () => {
  assert.equal(parseToParam(null), null);
  assert.equal(parseToParam(""), null);
  assert.equal(parseToParam("-4.5,54.2"), null, "missing title");
  assert.equal(parseToParam("nope,54.2,Title"), null, "bad lon");
  assert.equal(parseToParam("-4.5,999,Title"), null, "lat out of range");
  const bad = parseToParam("-4.5,54.2,%E0%A4%A");
  assert.ok(bad, "undecodable title falls back to the raw text");
  assert.equal(bad.title, "%E0%A4%A");
});

test("pick-param round-trips layer, position and label", () => {
  const raw = formatPickParam({
    layerId: "bus-stops",
    lon: -4.4777,
    lat: 54.1549,
    label: "Douglas Station",
  });
  assert.deepEqual(parsePickParam(raw), {
    layerId: "bus-stops",
    lon: -4.4777,
    lat: 54.1549,
    label: "Douglas Station",
  });
});

test("pick-param tolerates a label containing colons", () => {
  const parsed = parsePickParam("heritage:-4.48000:54.16000:Tower%3A%20Peel");
  assert.ok(parsed);
  assert.equal(parsed.layerId, "heritage");
  assert.equal(parsed.label, "Tower: Peel");
});

test("pick-param rejects missing or malformed parts", () => {
  assert.equal(parsePickParam(null), null);
  assert.equal(parsePickParam("roads"), null);
  assert.equal(parsePickParam("roads:-4.4"), null);
  assert.equal(parsePickParam("roads:abc:54.1"), null);
});

const fc = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Tower" },
      geometry: { type: "Point", coordinates: [-4.48, 54.16] },
    },
    {
      type: "Feature",
      properties: { name: "Road" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-4.49, 54.17],
          [-4.47, 54.17],
        ],
      },
    },
    {
      type: "Feature",
      properties: { name: "Lake" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-4.46, 54.15],
            [-4.45, 54.15],
            [-4.45, 54.151],
            [-4.46, 54.151],
            [-4.46, 54.15],
          ],
        ],
      },
    },
    { type: "Feature", properties: { name: "Broken" }, geometry: null },
  ],
};

test("nearest feature wins across points, lines and polygons", () => {
  assert.equal(nearestFeatureProperties(fc, -4.48, 54.1601, 150)?.name, "Tower");
  assert.equal(nearestFeatureProperties(fc, -4.48, 54.17, 150)?.name, "Road");
  assert.equal(nearestFeatureProperties(fc, -4.455, 54.1505, 150)?.name, "Lake");
});

test("nothing within range yields null, not the global nearest", () => {
  // 0.5 degrees of latitude is ~55 km away - far outside any radius.
  assert.equal(nearestFeatureProperties(fc, -4.48, 54.65, 150), null);
});

test("unusable collections return null without throwing", () => {
  assert.equal(nearestFeatureProperties(null, -4.48, 54.16), null);
  assert.equal(nearestFeatureProperties(undefined, -4.48, 54.16), null);
  assert.equal(nearestFeatureProperties({ type: "FeatureCollection" }, -4.48, 54.16), null);
  assert.equal(
    nearestFeatureProperties({ type: "FeatureCollection", features: [null] }, -4.48, 54.16),
    null,
  );
});
