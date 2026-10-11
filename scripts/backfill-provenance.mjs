#!/usr/bin/env node
/**
 * Backfill: stamp registry-resolved provenance onto data files that lack it,
 * and top up the id fields on files that have a hand-written block.
 *
 * Run with:   node --experimental-strip-types --no-warnings scripts/backfill-provenance.mjs
 *
 * Two cases:
 *
 *  1. A file with NO provenance block gets the full block the UI would render
 *     for that layer, so a reader of public/data/*.geojson no longer needs the
 *     app to explain the file.
 *
 *  2. A file that already has a (richer, per-script verified) block but predates
 *     the `licenceId` / `sourceId` / `licenceUrl` fields gets those fields
 *     ADDED, preserving its existing prose. The machine-checkable licence id is
 *     what lets verify-registry enforce that nothing ambiguous ships; the
 *     human-written source/caveats text is more valuable than what the register
 *     would print, so it is never overwritten.
 *
 * Idempotent: a second run changes nothing.
 */

import { dirname } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSON } from "./lib/fetch.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

/** id fields the registry can supply that must survive on every file. */
const ID_FIELDS = ["licenceId", "sourceId", "licenceUrl"];

let stamped = 0;
let enriched = 0;
let skipped = 0;
for (const name of readdirSync(OUT).filter((f) => f.endsWith(".geojson"))) {
  const path = join(OUT, name);
  const fc = JSON.parse(readFileSync(path, "utf8"));
  const props = fc.properties ?? {};

  const provenance = registryProvenance(name);
  if (!provenance) {
    console.warn(`  SKIP ${name}: no registered layer claims it`);
    skipped += 1;
    continue;
  }

  const hasBlock = props.source && props.licence && props.generated;
  if (!hasBlock) {
    fc.properties = provenance;
    writeJSON(path, fc);
    console.log(`  + ${name}`);
    stamped += 1;
    continue;
  }

  let changed = false;
  for (const key of ID_FIELDS) {
    if (props[key] === undefined && provenance[key] !== undefined) {
      props[key] = provenance[key];
      changed = true;
    }
  }
  if (changed) {
    fc.properties = props;
    writeJSON(path, fc);
    console.log(`  ~ ${name} (added licence identifiers)`);
    enriched += 1;
  } else {
    skipped += 1;
  }
}

console.log(`\nBackfill complete: ${stamped} stamped, ${enriched} enriched, ${skipped} skipped.`);
