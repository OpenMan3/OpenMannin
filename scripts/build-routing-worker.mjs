/**
 * Bundle the routing worker into public/ as real, servable JavaScript.
 *
 * Same shape and reasoning as scripts/build-passes-worker.mjs. A module worker
 * written as `new Worker(new URL("./routing-worker.ts", import.meta.url))` works
 * in dev but does not survive `output: "export"`: the bundler copies the
 * TypeScript SOURCE into the export as an asset, and the browser refuses to run
 * it. The worker then never replies and routing silently returns nothing.
 *
 * So the worker and its (dependency-free) graph module are inlined into one
 * self-contained public/routing-worker.mjs, and the client constructs it by URL.
 *
 * Re-run after changing routing-worker.ts, graph.ts or profiles.ts:
 *
 *     npm run build:routing-worker
 */

import { build } from "esbuild";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "src/lib/navigation/routing-worker.ts");
const OUT_FILE = join(ROOT, "public", "routing-worker.mjs");

const result = await build({
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

const bytes = statSync(OUT_FILE).size;
const kb = (bytes / 1024).toFixed(0);
const inputs = Object.keys(result.metafile.inputs);

console.log(`public/routing-worker.mjs  ${kb} kB`);
console.log(`  bundled ${inputs.length} modules`);

if (bytes < 8_000) {
  console.warn(
    "\nWARNING: bundle is small for a routing engine. Verify the graph and A*\n" +
      "code was inlined before deploying.",
  );
}