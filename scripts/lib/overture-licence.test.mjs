import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyOvertureRecord,
  summariseOvertureRecords,
  OVERTURE_LICENCE_MAP,
  OVERTURE_ALLOWED_LICENCE,
} from "./overture-licence.mjs";

test("keeps CDLA-Permissive-2.0 primary contributors", () => {
  const keepers = ["meta", "Microsoft", "PinMeTo", "DAC"].map((dataset) =>
    classifyOvertureRecord({ sourceDataset: dataset, sourceLicense: "CDLA-Permissive-2.0" }),
  );
  for (const decision of keepers) {
    assert.equal(decision.action, "keep");
    assert.equal(decision.keep, true);
    assert.equal(decision.error, null);
  }
});

test("excludes separately licensed contributors", () => {
  const allThePlaces = classifyOvertureRecord("AllThePlaces", "CC0-1.0");
  const foursquare = classifyOvertureRecord("Foursquare", "Apache-2.0");
  assert.equal(allThePlaces.action, "exclude");
  assert.equal(foursquare.action, "exclude");
});

test("rejects unknown contributor and licence pairs", () => {
  const decision = classifyOvertureRecord({
    sourceDataset: "Acme",
    sourceLicense: "NOASSERTION",
  });
  assert.equal(decision.action, "error");
  assert.match(decision.message, /Acme::NOASSERTION/);
});

test("rejects missing contributor and missing licence", () => {
  assert.equal(classifyOvertureRecord({ sourceDataset: "", sourceLicense: "CDLA-Permissive-2.0" }).reason, "missing-dataset");
  assert.equal(classifyOvertureRecord({ sourceDataset: "Meta", sourceLicense: "" }).reason, "missing-licence");
});

test("summarises a mixed batch", () => {
  const result = summariseOvertureRecords([
    { sourceDataset: "Microsoft", sourceLicense: "CDLA-Permissive-2.0" },
    { sourceDataset: "AllThePlaces", sourceLicense: "CC0-1.0" },
    { sourceDataset: "Foursquare", sourceLicense: "Apache-2.0" },
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.kept, 1);
  assert.equal(result.excluded, 2);
  assert.equal(result.excludedCounts.get("AllThePlaces::CC0-1.0"), 1);
  assert.equal(result.excludedCounts.get("Foursquare::Apache-2.0"), 1);
});

test("summariser throws on unknown pairs", () => {
  assert.throws(() => summariseOvertureRecords([
    { sourceDataset: "Meta", sourceLicense: "CDLA-Permissive-2.0" },
    { sourceDataset: "Unknown", sourceLicense: "MIT" },
  ]), /Unknown::MIT/);
});

test("shared constants are unchanged", () => {
  assert.equal(OVERTURE_ALLOWED_LICENCE, "CDLA-Permissive-2.0");
  assert.equal(OVERTURE_LICENCE_MAP["Foursquare::Apache-2.0"], "exclude");
});
