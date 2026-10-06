import { test } from "node:test";
import { strict as assert } from "node:assert";
import { registryProvenance } from "./registry-provenance.mjs";

test("registryProvenance resolves a registered manngis layer", () => {
  const p = registryProvenance("roads.geojson");
  assert.ok(p, "roads.geojson is a registered layer");
  assert.equal(p.sourceId, "manngis");
  assert.equal(p.licenceId, "OGL-IoM-DERIVED");
  assert.ok(p.source.includes("MANNGIS"), "source names the publisher");
  assert.ok(Array.isArray(p.caveats) && p.caveats.length > 0, "caveats copy from the registry");
  assert.ok(!Number.isNaN(Date.parse(p.generated)), "generated is a timestamp");
});

test("registryProvenance returns null for unregistered files", () => {
  assert.equal(registryProvenance("nope.geojson"), null);
  assert.equal(registryProvenance(undefined), null);
});