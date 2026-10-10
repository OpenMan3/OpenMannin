/**
 * Copy the MapLibre worker into public/ so it can be served as a real module.
 *
 * WHY THIS EXISTS. MapLibre GL JS derives its worker URL like this:
 *
 *     let t = import.meta.url;
 *     if (!/^https?:/.test(t)) return "";
 *     return new URL("./maplibre-gl-worker.mjs", t).href;
 *
 * Under a bundler, `import.meta.url` is not an http(s) URL, so MapLibre gets an
 * empty string and calls `new Worker("")`. That resolves against the document
 * to the site root, the browser is handed the HTML page instead of JavaScript,
 * and it refuses to run it:
 *
 *     Loading Worker from "http://localhost:3000/" was blocked because of a
 *     disallowed MIME type ("text/html").
 *
 * The failure is quiet and misleading: MapLibre still renders the map and the
 * raster basemap, because those do not need a worker. GeoJSON sources DO need
 * one, so every data layer fails in the background and you get a bare map with
 * nothing on it and no error explaining why.
 *
 * The fix is to serve the worker ourselves and point MapLibre at it with
 * `setWorkerUrl()`. Both files are copied verbatim; nothing is patched. The
 * worker imports only "./maplibre-gl-shared.mjs", which has no imports of its
 * own, so preserving their relative names in one directory is sufficient.
 *
 * Re-run after upgrading maplibre-gl: npm run copy:worker
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "node_modules", "maplibre-gl", "dist");
const PUBLIC = path.join(ROOT, "public");

// The production worker. The -dev variant carries assertions and source maps
// and is not what a deployed map should be running.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs", "maplibre-gl.css"];

let copied = 0;
for (const name of FILES) {
  const src = path.join(DIST, name);
  if (!fs.existsSync(src)) {
    console.error(`  ! ${name} not found in maplibre-gl/dist - is maplibre-gl installed?`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(PUBLIC, name));
  const kb = (fs.statSync(path.join(PUBLIC, name)).size / 1024).toFixed(0);
  console.log(`  public/${name}  ${kb} kB`);
  copied++;
}

console.log(`maplibre worker copied (${copied} files). MapView calls setWorkerUrl("/maplibre-gl-worker.mjs").`);