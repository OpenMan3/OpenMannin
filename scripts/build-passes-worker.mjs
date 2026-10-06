/**
 * Build the satellite pass worker into public/ as real, servable JavaScript.
 *
 * WHY THIS EXISTS. The pass layer computes ~115,000 SGP4 propagations off the main
 * thread, in a Web Worker created with `new Worker(new URL("./passes-worker.ts",
 * import.meta.url), { type: "module" })`. That is the correct way to write it, and
 * it works in dev. It does not survive a static export:
 *
 *     out/_next/static/media/passes-worker.1i0st72txyklq.ts
 *
 * The bundler copied the TypeScript SOURCE to the export as an asset, keeping the
 * .ts extension, rather than compiling it into the JavaScript a Worker can execute.
 * Cloudflare then serves it as video/mp2t - the extension is unknown to its MIME
 * table - and the browser refuses to run it. The worker's `postMessage` handler
 * never replies, so the layer renders nothing.
 *
 * The failure is invisible. There is no error in the console worth reading, the
 * layer toggles on, and "nothing is currently predicted overhead" is a completely
 * plausible reading of the result. It looks exactly like the documented caveat
 * about orbital geometry, which is what made this hard to see.
 *
 * WHY THE SAME SHAPE AS copy-maplibre-worker.mjs. MapLibre hits the identical
 * problem and is fixed identically, by serving a real .mjs from public/ and
 * pointing the constructor at it. Two workers, one rule: anything a Worker
 * executes must be hand-compiled into public/, because the bundler will not do it.
 *
 * esbuild bundles rather than merely transpiles. passes-worker.ts imports
 * src/lib/feeds/satellite-js.ts, which in turn imports satellite.js's pure-JS
 * modules by relative path. A Worker cannot resolve those at runtime - there is no
 * node_modules on a static host - so the dependency graph has to be inlined into
 * one self-contained file.
 *
 * Run after changing passes-worker.ts or satellite-js.ts:
 *
 *     npm run build:passes-worker
 */

import { build } from "esbuild";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "src/lib/feeds/passes-worker.ts");
const OUT_DIR = join(ROOT, "public");
const OUT_FILE = join(OUT_DIR, "passes-worker.mjs");

const result = await build({
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  format: "esm",
  platform: "browser",
  // Matches the browser this ships to, and the target Next 16 already compiles to.
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

const bytes = statSync(OUT_FILE).size;
const kb = (bytes / 1024).toFixed(0);

// Report what got inlined. satellite.js is the bulk of it and is the reason this
// script has to bundle at all, so a silent drop in that number would mean the
// worker lost its propagation code and would return empty features.
const inputs = Object.keys(result.metafile.inputs);
const modules = inputs.length;
const satellite = inputs.some((p) => p.includes("satellite.js"));

console.log(`public/passes-worker.mjs  ${kb} kB`);
console.log(`  bundled ${modules} modules${satellite ? " (satellite.js included)" : ""}`);

if (!satellite) {
  console.warn(
    "\nWARNING: no satellite.js modules in the bundle. The worker will have no way to\n" +
      "propagate element sets and every pass prediction will be empty. Check that\n" +
      "src/lib/feeds/satellite-js.ts still resolves.",
  );
}

if (bytes < 20_000) {
  console.warn(
    "\nWARNING: bundle is small for code that does 115,000 propagations. Verify the\n" +
      "output is complete before deploying.",
  );
}