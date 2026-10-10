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
import { registryProvenance } from "./lib/registry-provenance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "public", "data");

const problems = [];
const fail = (layer, msg) => problems.push(`${layer.id.padEnd(18)} ${msg}`);

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
              if (props.licenceId !== undefined && props.licenceId !== expected.licenceId) {
                fail(l, `${l.file} provenance licenceId "${props.licenceId}" != registry "${expected.licenceId}"`);
                ok = false;
              } else if (props.licenceId === undefined) {
                const hay = String(props.licence).toLowerCase();
                const needId = String(expected.licenceId).toLowerCase();
                const needName = String(expected.licence ?? "").toLowerCase();
                if (!hay.includes(needId) && !(needName && hay.includes(needName))) {
                  fail(l, `${l.file} provenance licence "${props.licence}" not traceable to registry "${expected.licence}"`);
                  ok = false;
                }
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

if (problems.length) {
  console.error(`\nFAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`\nOK`);