/**
 * Open-licence compliance at the artifact level.
 *
 * The registry check (scripts/verify-registry.mjs) proves no declared layer
 * points at a licence that requires permission. This test proves the same of
 * the BYTES THAT SHIP: every public/data/*.geojson must carry a `licenceId`
 * that names one of the open licences in the register. A file that quietly
 * reverts to a name-only or missing licence fails here, which is the whole
 * point — "nothing ambiguous" has to be enforced against the artifacts, not
 * just the hand-written registry.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAYERS } from "../../src/lib/layers.ts";
import { LICENCES } from "../../src/lib/licences.ts";
import { SOURCES } from "../../src/lib/sources.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = path.join(ROOT, "public", "data");

/** Licence ids that are unambiguously open for this project's use. */
const OPEN = new Set(
  Object.values(LICENCES)
    .filter((l) => !l.requiresPermission)
    .map((l) => l.id),
);

test("no registered layer points at a licence that requires permission", () => {
  for (const layer of LAYERS) {
    const source = SOURCES[layer.sourceId];
    assert.ok(source, `${layer.id}: source "${layer.sourceId}" is not in the register`);
    const licence = LICENCES[source.licence];
    assert.ok(licence, `${layer.id}: licence "${source.licence}" is not in the register`);
    assert.equal(
      licence.requiresPermission,
      false,
      `${layer.id} uses "${licence.id}", which requires permission`,
    );
  }
});

test("every shipped data file declares an open licenceId", () => {
  const files = fs.readdirSync(DATA).filter((f) => f.endsWith(".geojson"));
  assert.ok(files.length > 0, "no data files found — run the ingests");

  for (const name of files) {
    const fc = JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
    const licenceId = fc.properties?.licenceId;
    assert.ok(
      typeof licenceId === "string" && licenceId.length > 0,
      `${name}: no properties.licenceId — run scripts/backfill-provenance.mjs`,
    );
    assert.ok(
      OPEN.has(licenceId),
      `${name}: licenceId "${licenceId}" is not an open licence (${[...OPEN].join(", ")})`,
    );
  }
});
