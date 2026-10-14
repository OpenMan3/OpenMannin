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
import { CATEGORY_ORDER, SUBCATEGORY_LABELS } from "../src/lib/taxonomy.ts";
import { registryProvenance } from "./lib/registry-provenance.mjs";
import { sharedCoordinateCount } from "./lib/layer-dedupe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "public", "data");

const problems = [];
const fail = (layer, msg) => problems.push(`${layer.id.padEnd(18)} ${msg}`);
/** file -> features, for the cross-layer duplicate check below. */
const loaded = new Map();

// ---- layer-level rules ------------------------------------------------------

const ids = new Set();
let provenanceOk = 0;
let provenanceChecked = 0;
for (const l of LAYERS) {
  if (ids.has(l.id)) fail(l, `duplicate layer id`);
  ids.add(l.id);

  // Rule 1, from the registry's own header comment. As of 2026-10-07 every
  // layer is shown by default; grade D is allowed on, but it must carry its
  // dispute flag in the caveats so the panel can surface it.
  if (l.confidence === "D") {
    const caveats = (l.caveats ?? []).join(" ");
    if (!/grade[- ]D/i.test(caveats) && !/INDICATIVE|DISPUTED|NOT VERIFIED/i.test(caveats)) {
      fail(l, `grade D but no dispute caveat where the reader can see it`);
    }
  }

  if (!SOURCES[l.sourceId]) fail(l, `unknown sourceId "${l.sourceId}"`);
  else {
    const lic = LICENCES[SOURCES[l.sourceId].licence];
    if (!lic) fail(l, `source "${l.sourceId}" references unknown licence "${SOURCES[l.sourceId].licence}"`);
    // Open-licence guarantee. The whole project rests on reuse being
    // unambiguous, so no rendered layer may sit on a licence that does not
    // clearly grant it. A layer that needs written permission does not belong
    // on an open map.
    else if (lic.requiresPermission)
      fail(l, `licence "${lic.id}" requires permission — every layer must be unambiguously open`);
  }

  // Every layer must state the zoom at which it first appears, so the renderer
  // can gate it instead of painting an island-wide blanket of detail at z3.
  if (l.minZoom === undefined) {
    fail(l, `no minZoom — every layer must state the zoom it appears at`);
  } else if (!Number.isInteger(l.minZoom) || l.minZoom < 0 || l.minZoom > 20) {
    fail(l, `minZoom ${l.minZoom} is not an integer 0-20`);
  }

  // Taxonomy: category and subcategory travel together, and both must be known
  // so the layer tree never renders a drawer with no label.
  if (l.subcategory && !l.category) fail(l, `subcategory set without a category`);
  if (l.category) {
    if (!CATEGORY_ORDER.includes(l.category)) fail(l, `unknown category "${l.category}"`);
    if (!l.subcategory) fail(l, `category "${l.category}" without a subcategory`);
    else if (!SUBCATEGORY_LABELS[l.subcategory])
      fail(l, `unknown subcategory "${l.subcategory}"`);
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
          loaded.set(l.file, g.features ?? []);
          if (n === 0) fail(l, `${l.file} contains 0 features`);
          if (l.featureCount === undefined) {
            fail(l, `no featureCount pin — add one and keep it in step with ${l.file}`);
          } else if (l.featureCount !== n) {
            fail(l, `featureCount says ${l.featureCount}, ${l.file} has ${n}`);
          }

          // Provenance block: every data file must state where it came from so
          // it does not depend on this app to explain itself. When a file
          // declares ids, they must match the registers the UI renders.
          const props = g.properties ?? {};
          const need = ["source", "licence", "generated"].filter((k) => !props[k] || !String(props[k]).trim());
          if (need.length) {
            fail(l, `${l.file} provenance block missing ${need.join(", ")}`);
          } else {
            provenanceChecked += 1;
            let ok = true;
            if (Number.isNaN(Date.parse(props.generated))) {
              fail(l, `${l.file} generated is not a date: ${props.generated}`);
              ok = false;
            } else if (Date.parse(props.generated) > Date.now() + 86400000) {
              fail(l, `${l.file} generated is in the future: ${props.generated}`);
              ok = false;
            }
            if (props.caveats !== undefined && !Array.isArray(props.caveats)) {
              fail(l, `${l.file} caveats must be an array`);
              ok = false;
            }
            const expected = registryProvenance(l.file);
            if (expected) {
              if (props.sourceId !== undefined && props.sourceId !== expected.sourceId) {
                fail(l, `${l.file} provenance sourceId "${props.sourceId}" != registry "${expected.sourceId}"`);
                ok = false;
              }
              // licenceId is REQUIRED, not optional: it is the machine-readable
              // link between the shipped file and the open-licence register. A
              // bare licence NAME cannot be checked against the register, so
              // allowing it was exactly the ambiguity this project forbids.
              if (props.licenceId === undefined) {
                fail(l, `${l.file} provenance has no licenceId — re-run the layer's ingest`);
                ok = false;
              } else if (props.licenceId !== expected.licenceId) {
                fail(l, `${l.file} provenance licenceId "${props.licenceId}" != registry "${expected.licenceId}"`);
                ok = false;
              }
            }
            if (ok) provenanceOk += 1;
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

// ---- cross-layer duplicate rules --------------------------------------------
//
// Some OSM tags match more than one layer's ingest query, which quietly ships
// the same geometry in two files. These pairs are the ownership boundaries: the
// feature belongs to ONE owner, and the other layer must not repeat it. A
// non-zero count means an ingest query has widened again (or the dedupe pass was
// skipped), so it is a hard failure rather than a warning.
const EXCLUSIVE_PAIRS = [
  { owner: "footpaths", ownerFile: "footpaths.geojson", other: "roads", otherFile: "roads.geojson" },
  { owner: "essential-utilities", ownerFile: "essential_utilities.geojson", other: "emergency", otherFile: "emergency.geojson" },
  { owner: "coastal-outdoor", ownerFile: "coastal_outdoor.geojson", other: "tourism", otherFile: "tourism.geojson" },
  { owner: "tholtans-ruins", ownerFile: "tholtans_ruins.geojson", other: "archaeology", otherFile: "archaeology.geojson" },
];
const OVERLAP_LIMITS = {
  "airports.geojson|satellite-stations.geojson": 1,
  "bridges.geojson|footpaths.geojson": 261,
  "bridges.geojson|railways.geojson": 37,
  "bridges.geojson|roads.geojson": 249,
  "bridges.geojson|tourism.geojson": 5,
  "cable-landings.geojson|ports.geojson": 1,
  "coastal_outdoor.geojson|footpaths.geojson": 2,
  "coastal_outdoor.geojson|roads.geojson": 26,
  "food_drink.geojson|tourism.geojson": 5,
  "house-numbers.geojson|postcodes.geojson": 3,
  "house-numbers.geojson|wifi.geojson": 1,
  "postcodes.geojson|wifi.geojson": 7,
  "protected-areas.geojson|tholtans_ruins.geojson": 1,
  "reservoirs.geojson|tholtans_ruins.geojson": 1,
  "roads.geojson|tourism.geojson": 7,
  "tholtans_ruins.geojson|tourism.geojson": 1,
  "tholtans_ruins.geojson|worship.geojson": 1,
};

let duplicatePairs = 0;
for (const pair of EXCLUSIVE_PAIRS) {
  const a = loaded.get(pair.ownerFile);
  const b = loaded.get(pair.otherFile);
  if (!a || !b) continue;
  const n = sharedCoordinateCount(a, b);
  if (n > 0) {
    duplicatePairs += 1;
    problems.push(
      `duplicate  ${pair.other} repeats ${n} feature(s) owned by ${pair.owner} — layers must be disjoint`,
    );
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
console.log(`  provenance  ${provenanceOk}/${provenanceChecked} blocks checked agree with the registers`);
console.log(`  grades      ${Object.entries(byGrade).sort().map(([k, v]) => `${k}:${v}`).join("  ")}`);
console.log(`  default-on  ${LAYERS.filter((l) => l.defaultOn).length}`);
console.log(
  `  taxonomy    ${LAYERS.filter((l) => l.category).length} themed across ${
    CATEGORY_ORDER.filter((c) => LAYERS.some((l) => l.category === c)).length
  } categories, ${LAYERS.filter((l) => !l.category).length} unthemed`,
);
console.log(
  `  disjoint    ${EXCLUSIVE_PAIRS.length - duplicatePairs}/${EXCLUSIVE_PAIRS.length} exclusive ownership pairs share no geometry`,
);

if (problems.length) {
  console.error(`\nFAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`\nOK`);