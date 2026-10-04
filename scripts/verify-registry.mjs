/**
 * Registry integrity check.
 *
 * The layer registry is the single source of truth for what the map claims to
 * show, and it is hand-written. That makes it drift: a layer can be declared
 * default-on while its ingest script has never been run, or advertise a feature
 * count that no longer matches the file on disk. Neither failure is visible
 * until a user loads the page and sees a greyed-out row or an empty basemap.
 *
 * This runs those checks in CI-able form. Exit code 1 on any violation.
 *
 * Run with:  node --experimental-strip-types scripts/verify-registry.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAYERS, GAPS } from "../src/lib/layers.ts";
import { SOURCES } from "../src/lib/sources.ts";
import { LICENCES } from "../src/lib/licences.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "public", "data");

const problems = [];
const fail = (layer, msg) => problems.push(`${layer.id.padEnd(18)} ${msg}`);

// ---- layer-level rules ------------------------------------------------------

const ids = new Set();
for (const l of LAYERS) {
  if (ids.has(l.id)) fail(l, `duplicate layer id`);
  ids.add(l.id);

  // Rule 1, from the registry's own header comment.
  if (l.defaultOn && l.confidence === "D") fail(l, `grade D but defaultOn`);

  if (!SOURCES[l.sourceId]) fail(l, `unknown sourceId "${l.sourceId}"`);
  else {
    const lic = LICENCES[SOURCES[l.sourceId].licence];
    if (!lic) fail(l, `source "${l.sourceId}" references unknown licence "${SOURCES[l.sourceId].licence}"`);
  }

  if (l.kind === "geojson") {
    if (!l.file) fail(l, `geojson layer has no file`);
    else {
      const p = path.join(DATA, l.file);
      if (!fs.existsSync(p)) {
        fail(l, `data file missing: ${l.file}`);
        // A layer with no data cannot be usefully default-on: it would render
        // nothing and show the user a broken checkbox on first load.
        if (l.defaultOn) fail(l, `defaultOn but ${l.file} does not exist — flip to defaultOn: false`);
      } else {
        let g;
        try {
          g = JSON.parse(fs.readFileSync(p, "utf8"));
        } catch (e) {
          fail(l, `${l.file} is not valid JSON: ${e.message}`);
        }
        if (g) {
          if (g.type !== "FeatureCollection") fail(l, `${l.file} is ${g.type}, not FeatureCollection`);
          const n = g.features?.length ?? 0;
          if (n === 0) fail(l, `${l.file} contains 0 features`);
          if (l.featureCount !== undefined && l.featureCount !== n) {
            fail(l, `featureCount says ${l.featureCount}, ${l.file} has ${n}`);
          }
        }
      }
    }
  } else if (l.kind === "live" && !l.file) {
    // live layers are fed by an API route, so no static file is expected.
  }
}

// ---- gap-level rules --------------------------------------------------------

const gapIds = new Set();
for (const g of GAPS) {
  if (gapIds.has(g.id)) problems.push(`gap ${g.id}: duplicate gap id`);
  gapIds.add(g.id);
  for (const field of ["wanted", "whyUnavailable", "whatWeWouldNeed"]) {
    if (!g[field] || !String(g[field]).trim()) problems.push(`gap ${g.id}: empty ${field}`);
  }
}

// ---- provenance totals ------------------------------------------------------

const geo = LAYERS.filter((l) => l.kind === "geojson");
const present = geo.filter((l) => l.file && fs.existsSync(path.join(DATA, l.file)));
const byGrade = LAYERS.reduce((acc, l) => ((acc[l.confidence] = (acc[l.confidence] ?? 0) + 1), acc), {});

console.log(`OpenMannin registry check`);
console.log(`  layers      ${LAYERS.length} (${geo.length} static, ${LAYERS.length - geo.length} live)`);
console.log(`  gaps        ${GAPS.length}`);
console.log(`  sources     ${Object.keys(SOURCES).length}`);
console.log(`  licences    ${Object.keys(LICENCES).length}`);
console.log(`  data files  ${present.length}/${geo.length} present`);
console.log(`  grades      ${Object.entries(byGrade).sort().map(([k, v]) => `${k}:${v}`).join("  ")}`);
console.log(`  default-on  ${LAYERS.filter((l) => l.defaultOn).length}`);

if (problems.length) {
  console.error(`\nFAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`\nOK`);