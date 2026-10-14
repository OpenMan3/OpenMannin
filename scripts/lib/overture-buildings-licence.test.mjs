import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBuildingRecord,
  summariseBuildingRecords,
  OVERTURE_BUILDINGS_LICENCE_MAP,
  OVERTURE_BUILDINGS_ALLOWED_LICENCE,
} from "./overture-buildings-licence.mjs";

test("keeps ODbL-1.0 primary contributors", () => {
  for (const dataset of ["OpenStreetMap", "Microsoft ML Buildings"]) {
    const decision = classifyBuildingRecord({ sourceDataset: dataset, sourceLicense: "ODbL-1.0" });
    assert.equal(decision.action, "keep");
    assert.equal(decision.keep, true);
    assert.equal(decision.licence, OVERTURE_BUILDINGS_ALLOWED_LICENCE);
  }
});

test("every keep entry is the allowed ODbL licence", () => {
  for (const [key, action] of Object.entries(OVERTURE_BUILDINGS_LICENCE_MAP)) {
    if (action === "keep") assert.ok(key.endsWith(`::${OVERTURE_BUILDINGS_ALLOWED_LICENCE}`), key);
  }
});

test("errors on unknown contributor/licence pairs", () => {
  const decision = classifyBuildingRecord("Some ML Provider", "CC-BY-4.0");
  assert.equal(decision.action, "error");
  assert.match(decision.error, /Some ML Provider::CC-BY-4\.0/);
});

test("errors on missing dataset and missing licence", () => {
  assert.equal(classifyBuildingRecord({ sourceLicense: "ODbL-1.0" }).reason, "missing-dataset");
  assert.equal(classifyBuildingRecord({ sourceDataset: "OpenStreetMap" }).reason, "missing-licence");
});

test("summarises a mixed batch", () => {
  const result = summariseBuildingRecords([
    { sourceDataset: "OpenStreetMap", sourceLicense: "ODbL-1.0" },
    { sourceDataset: "Microsoft ML Buildings", sourceLicense: "ODbL-1.0" },
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.kept, 2);
  assert.equal(result.excluded, 0);
  assert.deepEqual([...result.contributors].sort(), ["Microsoft ML Buildings", "OpenStreetMap"]);
});

test("summariser throws on unknown pairs", () => {
  assert.throws(
    () => summariseBuildingRecords([
      { sourceDataset: "OpenStreetMap", sourceLicense: "ODbL-1.0" },
      { sourceDataset: "Mystery", sourceLicense: "MIT" },
    ]),
    /Mystery::MIT/,
  );
});
