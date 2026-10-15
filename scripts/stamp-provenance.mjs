#!/usr/bin/env node
/**
 * stamp-provenance — resolve every data file's provenance from the registers.
 *
 * WHY THIS EXISTS
 * ---------------
 * `verify-registry.mjs` requires each GeoJSON file to carry `licenceId`,
 * `sourceId` and `licenceUrl` matching the registers the app renders, because a
 * bare licence NAME cannot be checked mechanically. The ingest scripts each
 * hand-write their own properties block, and most of them were written before
 * that rule existed, so they stamp `generated`/`source`/`licence` and stop.
 * The files that are right today are right because someone ran a one-off over
 * them, not because the pipeline produces them that way: point the documented
 * pipeline at a clean checkout and `ingest:all` rewrites every provenance block
 * back to the incomplete shape, and the registry check fails 13 times.
 *
 * WHAT IT DOES
 * ------------
 * For each file in public/data it finds the registered layer that claims it and
 * fills in ONLY the register-derived keys that are missing. It never overwrites
 * a value an ingest already wrote: `airports` points `source` at OurAirports'
 * CSV rather than the register's source name and carries a `sourceVerified`
 * stamp, and a stamper that "fixed" that would be trading a real bug for a
 * different real bug. Anything it cannot resolve is reported and fails loudly.
 *
 * Safe to run repeatedly: an already-stamped file is read, found complete and
 * rewritten unchanged (bar the `generated` timestamp, which it leaves alone).
 *
 *   node --experimental-strip-types scripts/stamp-provenance.mjs
 *   node --experimental-strip-types scripts/stamp-provenance.mjs --check   (no writes)
 */

import fs from "node:fs";
import path from "node:path";
import { LAYERS } from "../src/lib/layers.ts";
import { SOURCES } from "../src/lib/sources.ts";
import { LICENCES } from "../src/lib/licences.ts";
import { writeJSON } from "./lib/fetch.mjs";

const OUT = "public/data";
const CHECK_ONLY = process.argv.includes("--check");

/** Register keys a file must carry, mapped to how to resolve them. */
const WANTED = [
  ["licenceId", (layer, src, lic) => src?.licence ?? null],
  ["sourceId", (layer, src, lic) => layer.sourceId],
  ["sourceUrl", (layer, src, lic) => src?.url ?? null],
  ["licenceUrl", (layer, src, lic) => lic?.url ?? null],
];

const files = fs
  .readdirSync(OUT)
  .filter((f) => f.endsWith(".geojson"))
  .sort();

let stamped = 0;
let complete = 0;
const problems = [];

for (const file of files) {
  const full = path.join(OUT, file);
  const layer = LAYERS.find((l) => l.file === file);
  if (!layer || layer.kind !== "geojson") {
    problems.push(`${file}: no registered geojson layer claims this file`);
    continue;
  }

  const src = SOURCES[layer.sourceId];
  const lic = src ? LICENCES[src.licence] : undefined;
  if (!src || !lic) {
    problems.push(`${file}: layer "${layer.id}" points at unregistered source "${layer.sourceId}"`);
    continue;
  }

  let fc;
  try {
    fc = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    problems.push(`${file}: not valid JSON`);
    continue;
  }
  const props = fc.properties ?? {};

  // `generated` is the file's own timestamp, not this run's: restamping it would
  // advance a layer's age without refreshing its data.
  for (const [k, v] of [["generated", new Date().toISOString()]]) {
    if (!props[k]) props[k] = v;
  }

  const added = [];
  for (const [key, resolve] of WANTED) {
    const want = resolve(layer, src, lic);
    if (want === null) continue;
    if (props[key] === undefined) {
      props[key] = want;
      added.push(key);
    } else if (props[key] !== want) {
      problems.push(`${file}: ${key} is "${props[key]}", the register says "${want}"`);
    }
  }

  // Caveats are the layer's, not the ingest's, but an ingest that wrote its own
  // is reporting something real about its own data, so only fill a gap.
  if (props.caveats === undefined) {
    props.caveats = layer.caveats ?? [];
    added.push("caveats");
  }

  fc.properties = props;
  if (added.length) {
    if (!CHECK_ONLY) {
      writeJSON(full, fc, { pretty: file.endsWith(".geojson") });
    }
    stamped += 1;
    console.log(`  ${layer.id.padEnd(22)} +${added.join(" +")}`);
  } else complete += 1;
}

console.log(
  `\nstamp-provenance: ${stamped} file(s) stamped, ${complete} already complete, ${problems.length} problem(s)`,
);
for (const p of problems) console.log(`  ! ${p}`);

if (problems.length) process.exit(1);
if (stamped === 0) console.log("  (nothing to do — every file agrees with the registers)");
