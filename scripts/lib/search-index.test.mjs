import { test } from "node:test";
import { strict as assert } from "node:assert";
import { searchIndex } from "../../src/lib/search-index.ts";

const index = {
  generated: "2026-10-07",
  layers: [
    { id: "roads", label: "Roads" },
    { id: "bus-stops", label: "Bus stops" },
  ],
  entries: [
    [0, "A18", -4.5, 54.1],
    [0, "A18 Snaefell", -4.6, 54.2],
    [0, "Ballaglass Glen", -4.4, 54.3],
    [1, "A18 stop", -4.5, 54.1],
    [0, "A18", -4.9, 54.4],
  ],
};

test("a prefix match outranks a mid-word match", () => {
  const hits = searchIndex(index, "a18");
  assert.equal(hits[0].label, "A18");
  assert.equal(hits[0].layerId, "roads");
});

test("duplicate (layer, label) results collapse to one", () => {
  const hits = searchIndex(index, "a18");
  const roadA18 = hits.filter((h) => h.layerId === "roads" && h.label === "A18");
  assert.equal(roadA18.length, 1);
  // The same label in a different layer is a different result.
  assert.ok(hits.some((h) => h.layerId === "bus-stops" && h.label === "A18 stop"));
});

test("queries shorter than two characters return nothing", () => {
  assert.deepEqual(searchIndex(index, "a"), []);
});

test("the limit is honoured", () => {
  assert.equal(searchIndex(index, "a18", 1).length, 1);
});
