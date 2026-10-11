/**
 * Layer tree grouping tests.
 *
 * The tree reducer is pure and lives in src/lib/layer-tree.ts so it can be
 * unit-tested without a DOM. The invariant: every layer lands in exactly one
 * place (themed tree OR unthemed group) and none is silently dropped.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayerTree } from "../../src/lib/layer-tree.ts";

function layer(overrides = {}) {
  return {
    id: "test",
    label: "Test",
    group: "geography",
    kind: "geojson",
    file: "test.geojson",
    color: "#000",
    defaultOn: true,
    description: "x",
    confidence: "B",
    sourceId: "osmIOM",
    ...overrides,
  };
}

test("themed layers go into the two-level category tree", () => {
  const { byCategory, byGroup } = buildLayerTree([
    layer({ id: "a", category: "heritage", subcategory: "designated" }),
    layer({ id: "b", category: "heritage", subcategory: "mine-infrastructure" }),
    layer({ id: "c", category: "prow", subcategory: "rights-of-way" }),
  ]);

  assert.equal(byCategory.size, 2);
  assert.ok(byCategory.has("heritage"));
  assert.ok(byCategory.has("prow"));
  assert.equal(byCategory.get("heritage").size, 2);
  assert.equal(byCategory.get("prow").size, 1);
  assert.equal(byCategory.get("heritage").get("designated").length, 1);
  assert.equal(byCategory.get("heritage").get("mine-infrastructure").length, 1);
  assert.equal(byCategory.get("prow").get("rights-of-way").length, 1);
  assert.equal(byGroup.size, 0);
});

test("unthemed layers keep their register group", () => {
  const { byCategory, byGroup } = buildLayerTree([
    layer({ id: "a", group: "aviation" }),
    layer({ id: "b", group: "live" }),
    layer({ id: "c", group: "aviation" }),
  ]);

  assert.equal(byCategory.size, 0);
  assert.equal(byGroup.size, 2);
  assert.ok(byGroup.has("aviation"));
  assert.ok(byGroup.has("live"));
  assert.equal(byGroup.get("aviation").length, 2);
  assert.equal(byGroup.get("live").length, 1);
});

test("mixed themed and unthemed layers are separated correctly", () => {
  const { byCategory, byGroup } = buildLayerTree([
    layer({ id: "a", category: "civic", subcategory: "boundaries" }),
    layer({ id: "b", group: "surveillance" }),
    layer({ id: "c", group: "surveillance" }),
    layer({ id: "d", category: "poi", subcategory: "amenities" }),
  ]);

  assert.equal(byCategory.size, 2);
  assert.ok(byCategory.has("civic"));
  assert.ok(byCategory.has("poi"));
  assert.equal(byGroup.size, 1);
  assert.ok(byGroup.has("surveillance"));
  assert.equal(byGroup.get("surveillance").length, 2);
});

test("layers with only category or only subcategory fall back to group", () => {
  const { byCategory, byGroup } = buildLayerTree([
    layer({ id: "a", category: "heritage" }), // missing subcategory
    layer({ id: "b", subcategory: "designated" }), // missing category
  ]);

  assert.equal(byCategory.size, 0);
  assert.equal(byGroup.size, 1); // both have group "geography" by default
  assert.ok(byGroup.has("geography"));
  assert.equal(byGroup.get("geography").length, 2);
});

test("total layer count is preserved across both buckets", () => {
  const layers = [
    layer({ id: "a", category: "heritage", subcategory: "designated" }),
    layer({ id: "b", category: "prow", subcategory: "trails" }),
    layer({ id: "c", group: "aviation" }),
    layer({ id: "d", group: "live" }),
    layer({ id: "e", group: "cables" }),
  ];

  const { byCategory, byGroup } = buildLayerTree(layers);
  const catTotal = [...byCategory.values()].reduce(
    (sum, subs) => sum + [...subs.values()].reduce((s, arr) => s + arr.length, 0),
    0,
  );
  const grpTotal = [...byGroup.values()].reduce((sum, arr) => sum + arr.length, 0);

  assert.equal(catTotal + grpTotal, layers.length);
});