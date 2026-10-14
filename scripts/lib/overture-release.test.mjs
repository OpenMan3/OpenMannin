import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LAYERS } from "../../src/lib/layers.ts";
import { classifyOvertureRecord } from "./overture-licence.mjs";
import { OVERTURE_RELEASE } from "./overture-release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = path.join(ROOT, "public", "data", "overture-places.geojson");

test("the pinned Overture release is well-formed", () => {
  assert.match(OVERTURE_RELEASE, /^\d{4}-\d{2}-\d{2}\.\d+$/);
});

test("shipped Overture data comes from the pinned release", () => {
  const fc = JSON.parse(fs.readFileSync(FILE, "utf8"));

  assert.equal(fc.properties?.release, OVERTURE_RELEASE);
  assert.equal(fc.properties?.licenceId, "CDLA-PERMISSIVE-2.0");

  for (const feature of fc.features) {
    const { sourceDataset, originLicence } = feature.properties;
    assert.equal(originLicence, "CDLA-Permissive-2.0");
    assert.ok(sourceDataset && String(sourceDataset).trim(), "missing sourceDataset");

    const decision = classifyOvertureRecord(sourceDataset, originLicence);
    assert.equal(decision.action, "keep");
  }
});

test("the registry feature count still matches the shipped file", () => {
  const fc = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const layer = LAYERS.find((l) => l.id === "overture-places");

  assert.ok(layer);
  assert.equal(layer.featureCount, fc.features.length);
});
