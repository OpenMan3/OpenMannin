import { test } from "node:test";
import { strict as assert } from "node:assert";
import { GEOMETRY_FILTER, PAINT_SUFFIXES } from "../../src/lib/geometry-filter.ts";

/** The geometry types a `["match", ["geometry-type"], [...], true, false]` guard admits. */
function admitted(suffix) {
  const guard = GEOMETRY_FILTER[suffix];
  assert.equal(guard[0], "match");
  assert.deepEqual(guard[1], ["geometry-type"]);
  assert.equal(guard[3], true);
  assert.equal(guard[4], false);
  return guard[2];
}

test("every paint suffix has a geometry guard", () => {
  for (const suffix of PAINT_SUFFIXES) {
    assert.ok(GEOMETRY_FILTER[suffix], `${suffix} has a guard`);
  }
});

test("the fill guard refuses line strings", () => {
  const types = admitted("fill");
  assert.ok(types.includes("Polygon"));
  assert.ok(types.includes("MultiPolygon"));
  assert.ok(!types.includes("LineString"));
  assert.ok(!types.includes("MultiLineString"));
});

test("the circle guard refuses line strings - the dots regression", () => {
  const types = admitted("circle");
  assert.deepEqual(types, ["Point", "MultiPoint"]);
});

test("the line guard draws lines and polygon outlines", () => {
  const types = admitted("line");
  assert.ok(types.includes("LineString"));
  assert.ok(types.includes("MultiLineString"));
  assert.ok(types.includes("Polygon"));
  assert.ok(types.includes("MultiPolygon"));
  assert.ok(!types.includes("Point"));
});

test("the symbol guard labels points and polygons, not bare lines", () => {
  const types = admitted("symbol");
  assert.ok(types.includes("Point"));
  assert.ok(types.includes("Polygon"));
  assert.ok(!types.includes("LineString"));
});
