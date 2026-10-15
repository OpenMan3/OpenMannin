import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  assignLayer,
  classify,
  dedupeByPoint,
  safetyWarning,
  SHAFT_SAFETY,
  ADIT_SAFETY,
} from "./heritage-classify.mjs";

test("industrial tags belong to the mine layer", () => {
  assert.equal(assignLayer({ man_made: "mineshaft" }), "mine");
  assert.equal(assignLayer({ man_made: "adit" }), "mine");
  assert.equal(assignLayer({ man_made: "water_wheel" }), "mine");
  assert.equal(assignLayer({ man_made: "spoil_heap" }), "mine");
  assert.equal(assignLayer({ historic: "mine" }), "mine");
  assert.equal(assignLayer({ historic: "quarry" }), "mine");
  assert.equal(assignLayer({ historic: "lime_kiln" }), "mine");
  assert.equal(assignLayer({ historic: "mine_shaft" }), "mine");
});

test("monument tags belong to the archaeology layer", () => {
  assert.equal(assignLayer({ historic: "castle" }), "archaeology");
  assert.equal(assignLayer({ historic: "monument" }), "archaeology");
  assert.equal(assignLayer({ historic: "archaeological_site" }), "archaeology");
  assert.equal(assignLayer({ historic: "keill" }), "archaeology");
  assert.equal(assignLayer({ archaeological_site: "keill" }), "archaeology");
  assert.equal(assignLayer({ archaeological_site: "keeil" }), "archaeology");
});

test("ruins and derelict features belong to the ruins layer", () => {
  assert.equal(assignLayer({ historic: "ruins" }), "ruins");
  assert.equal(assignLayer({ building: "ruins" }), "ruins");
  assert.equal(assignLayer({ ruins: "yes" }), "ruins");
  assert.equal(assignLayer({ "abandoned:building": "yes" }), "ruins");
  assert.equal(assignLayer({ historic: "building" }), "ruins");
  assert.equal(assignLayer({ disused: "yes" }), "ruins");
});

test("a tag that fits two layers is owned by exactly one, by priority", () => {
  // A derelict mine is industrial before it is a ruin.
  assert.equal(assignLayer({ man_made: "mineshaft", disused: "yes" }), "mine");
  assert.equal(assignLayer({ historic: "quarry", ruins: "yes" }), "mine");
  // A ruined monument is archaeology before it is a ruin.
  assert.equal(
    assignLayer({ historic: "archaeological_site", building: "ruins" }),
    "archaeology",
  );
  assert.equal(assignLayer({ historic: "castle", ruins: "yes" }), "archaeology");
});

test("unrelated tags are owned by nobody", () => {
  assert.equal(assignLayer({ highway: "primary" }), null);
  assert.equal(assignLayer({}), null);
});

test("classify names the specific feature type", () => {
  assert.equal(classify("mine", { man_made: "mineshaft" }), "Mine shaft");
  assert.equal(classify("mine", { man_made: "adit" }), "Mine adit");
  assert.equal(classify("mine", { man_made: "spoil_heap" }), "Spoil heap");
  assert.equal(classify("mine", { historic: "lime_kiln" }), "Lime kiln");
  assert.equal(classify("mine", { historic: "quarry" }), "Quarry");
  assert.equal(classify("archaeology", { historic: "castle" }), "Castle");
  assert.equal(classify("archaeology", { historic: "keill" }), "Keeill");
  assert.equal(classify("archaeology", { archaeological_site: "tumulus" }), "Tumulus");
  assert.equal(classify("ruins", { historic: "ruins" }), "Ruins");
  assert.equal(classify("ruins", { "abandoned:building": "house" }), "Abandoned building");
  assert.equal(classify("ruins", { historic: "building" }), "Historic building");
  assert.equal(classify("ruins", { disused: "yes" }), "Disused feature");
});

test("only shafts and adits carry a safety warning", () => {
  assert.equal(safetyWarning({ man_made: "mineshaft" }), SHAFT_SAFETY);
  assert.equal(safetyWarning({ man_made: "adit" }), ADIT_SAFETY);
  assert.equal(safetyWarning({ historic: "quarry" }), undefined);
});

test("dedupeByPoint drops same-coordinate same-type copies and keeps a name", () => {
  const point = (lon, lat, type, name) => ({
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { type, name },
  });
  const result = dedupeByPoint([
    point(-4.5, 54.1, "Ruins", null),
    point(-4.5, 54.1, "Ruins", "Ballaglass"),
    point(-4.6, 54.2, "Ruins", null),
    point(-4.6, 54.2, "Mine shaft", null),
  ]);
  assert.equal(result.dropped, 1);
  assert.equal(result.features.length, 3);
  const kept = result.features.find((f) => f.properties.name === "Ballaglass");
  assert.ok(kept, "the named copy survives");
});
