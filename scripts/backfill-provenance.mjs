#!/usr/bin/env node
/**
 * One-time backfill: stamp registry-resolved provenance onto every data file
 * that lacks it.
 *
 * Run with:   node --experimental-strip-types --no-warnings scripts/backfill-provenance.mjs
 *
 * Files written by scripts that already stamp their own (richer, per-script
 * verified) blocks are left untouched. Anything without source, licence and
 * generated fields gets the block the UI would render for that layer, so a
 * reader of public/data/*.geojson no longer needs the app to explain the file.
 */

import { dirname } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSON } from "./lib/fetch.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

let stamped = 0;
let skipped = 0;
for (const name of readdirSync(OUT).filter((f) => f.endsWith(".geojson"))) {
  const path = join(OUT, name);
  const fc = JSON.parse(readFileSync(path, "utf8"));
  const props = fc.properties ?? {};
  const hasBlock = props.source && props.licence && props.generated;
  if (hasBlock) {
    skipped += 1;
    continue;
  }
  const provenance = registryProvenance(name);
  if (!provenance) {
    console.warn(`  SKIP ${name}: no registered layer claims it`);
    skipped += 1;
    continue;
  }
  fc.properties = provenance;
  writeJSON(path, fc);
  console.log(`  + ${name}`);
  stamped += 1;
}

console.log(`\nBackfill complete: ${stamped} stamped, ${skipped} skipped.`);