import { test } from "node:test";
import assert from "node:assert/strict";
import { clipGeometry, clipRingToBox, normalizeRing } from "./geo-clip.mjs";

const BBOX = [-4.9, 54.0, -4.2, 54.45];

function collectCoords(geom, out = []) {
  if (!geom) return out;
  if (geom.type === "Point") out.push(geom.coordinates);
  else if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) for (const p of ring) out.push(p);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) for (const ring of poly) for (const p of ring) out.push(p);
  }
  return out;
}

function withinBox(geom) {
  for (const [x, y] of collectCoords(geom)) {
    if (x < BBOX[0] - 1e-9 || x > BBOX[2] + 1e-9) return false;
    if (y < BBOX[1] - 1e-9 || y > BBOX[3] + 1e-9) return false;
  }
  return true;
}

test("a point outside the box is dropped; inside is kept", () => {
  assert.equal(clipGeometry({ type: "Point", coordinates: [0, 0] }, BBOX), null);
  const inside = { type: "Point", coordinates: [-4.5, 54.2] };
  assert.deepEqual(clipGeometry(inside, BBOX), inside);
});

test("a polygon fully inside is unchanged in shape", () => {
  const poly = {
    type: "Polygon",
    coordinates: [[[-4.5, 54.1], [-4.4, 54.1], [-4.4, 54.2], [-4.5, 54.2], [-4.5, 54.1]]],
  };
  assert.deepEqual(clipGeometry(poly, BBOX), poly);
});

test("a polygon overlapping the box edge is clamped to the box", () => {
  const poly = {
    type: "Polygon",
    coordinates: [[[-5.5, 53.5], [-4.4, 53.5], [-4.4, 54.6], [-5.5, 54.6], [-5.5, 53.5]]],
  };
  const clipped = clipGeometry(poly, BBOX);
  assert.ok(clipped);
  assert.equal(withinBox(clipped), true);
  assert.equal(clipped.coordinates[0].length >= 4, true);
});

test("a far-away polygon is dropped", () => {
  const poly = {
    type: "Polygon",
    coordinates: [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
  };
  assert.equal(clipGeometry(poly, BBOX), null);
});

test("a multipolygon keeps only the members that survive", () => {
  const mp = {
    type: "MultiPolygon",
    coordinates: [
      [[[-4.5, 54.1], [-4.4, 54.1], [-4.4, 54.2], [-4.5, 54.2], [-4.5, 54.1]]],
      [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
    ],
  };
  const out = clipGeometry(mp, BBOX);
  assert.equal(out.coordinates.length, 1);
});

test("rings are closed and normalised", () => {
  const ring = clipRingToBox([[-4.5, 54.1], [-4.4, 54.1], [-4.4, 54.2], [-4.5, 54.2]], BBOX);
  const closed = normalizeRing(ring);
  assert.ok(closed.length >= 4);
  assert.deepEqual(closed[0], closed[closed.length - 1]);
});
