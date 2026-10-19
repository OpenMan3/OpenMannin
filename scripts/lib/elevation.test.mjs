import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  decodeTerrarium,
  tilesPerAxis,
  lonLatToTileFloat,
  sampleLine,
  profileStats,
} from "../../src/lib/elevation.ts";

test("decodeTerrarium reads metres across the RGB channels", () => {
  // Sea level is the encoding's midpoint.
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  // The blue channel is the fractional metre.
  assert.equal(decodeTerrarium(128, 100, 0), 100);
  assert.equal(decodeTerrarium(128, 0, 128), 0.5);
  // A negative (below-sea-level) value.
  assert.ok(decodeTerrarium(127, 255, 255) < 0);
});

test("tilesPerAxis doubles per zoom", () => {
  assert.equal(tilesPerAxis(0), 1);
  assert.equal(tilesPerAxis(1), 2);
  assert.equal(tilesPerAxis(12), 4096);
});

test("lonLatToTileFloat places the origin at the centre of a z=1 world", () => {
  const { x, y } = lonLatToTileFloat(0, 0, 1);
  assert.equal(x, 1);
  assert.ok(Math.abs(y - 1) < 1e-9);
});

test("sampleLine spaces samples evenly by distance and keeps the endpoints", () => {
  const coords = [
    [0, 0],
    [0, 0.01],
  ];
  const pts = sampleLine(coords, 2);
  assert.equal(pts.length, 2);
  assert.equal(pts[0].lon, 0);
  assert.equal(pts[0].lat, 0);
  assert.equal(pts[0].distM, 0);
  assert.equal(pts[1].lat, 0.01);
  // ~0.01 degrees of latitude is ~1112 m.
  assert.ok(pts[1].distM > 1100 && pts[1].distM < 1120);
});

test("sampleLine honours the sample cap", () => {
  const coords = Array.from({ length: 50 }, (_, i) => [i * 0.001, 0]);
  assert.equal(sampleLine(coords, 10).length, 10);
  // Never below two points, and never more than the input vertices.
  assert.equal(sampleLine(coords, 1).length, 2);
  assert.equal(sampleLine(coords, 999).length, 50);
});

test("sampleLine handles a zero-length line without dividing by zero", () => {
  const pts = sampleLine(
    [
      [5, 5],
      [5, 5],
    ],
    8,
  );
  assert.ok(pts.length >= 2);
  assert.ok(pts.every((p) => p.distM === 0 && p.lon === 5 && p.lat === 5));
});

test("profileStats reports range and accumulated climb/descent", () => {
  const stats = profileStats([
    { distM: 0, eleM: 10 },
    { distM: 100, eleM: 30 },
    { distM: 200, eleM: 5 },
  ]);
  assert.equal(stats.minM, 5);
  assert.equal(stats.maxM, 30);
  assert.equal(stats.ascentM, 20);
  assert.equal(stats.descentM, 25);
});

test("profileStats on an empty profile is all zeroes", () => {
  assert.deepEqual(profileStats([]), {
    minM: 0,
    maxM: 0,
    ascentM: 0,
    descentM: 0,
  });
});
