/**
 * Build-time health report, written to public/health.json.
 *
 * WHY THIS IS A SCRIPT AND NOT A ROUTE. The app is a static export: there is no
 * server to answer /api/health, and a static host serves the same bytes to
 * everyone, so a "live" health check could not report anything per-instance in
 * any case. What can be checked is exactly the thing that matters and can only
 * go wrong at build time - the two silent failures this project has already hit:
 *
 *   - the MapLibre worker missing, which hides every data layer while the
 *     basemap keeps drawing;
 *   - the ingest output missing, which gives a map with no data and nothing to
 *     say why, because the registry still lists all 39 layers.
 *
 * Both are build-time facts. Both are now caught by `next build` failing.
 *
 * WHAT IT NO LONGER CHECKS. The old route reported which live feeds were
 * enabled, because on a server the answer depends on that instance's
 * environment variables. On a static host two of the five feeds no longer
 * involve the host at all (satellite passes run in the browser), and
 * the other three depend on the Functions deployment, which is a separate
 * lifecycle. So live-feed state moved to the browser, where the client can
 * actually observe what happened, and where a "feed offline" badge is grounded
 * in a real request rather than an env var.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJSON } from "./lib/fetch.mjs";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public", "data");
const WORKER = path.join(ROOT, "public", "maplibre-gl-worker.mjs");
const OUT = path.join(ROOT, "public", "health.json");

/** @type {string[]} */
const problems = [];

// 1. The worker. Without it MapLibre cannot process GeoJSON, so every data layer
//    silently disappears while the basemap still renders.
let workerOk = false;
try {
  workerOk = fs.statSync(WORKER).size > 1000;
} catch {
  problems.push(
    "maplibre worker missing - run `npm run copy:worker`. All data layers will be invisible.",
  );
}

// 2. Ingest output.
let layers = 0;
let features = 0;
/** @type {string[]} */
let absent = [];
try {
  const m = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf8"));
  absent = m.absent ?? [];
  for (const v of Object.values(m.layers ?? {})) {
    if (!v || typeof v !== "object") continue;
    layers++;
    features += v.features ?? 0;
  }
  if (!layers) problems.push("manifest lists no layers - run `npm run ingest:all`.");
  if (absent.length) {
    problems.push(`${absent.length} layer(s) have no data: ${absent.join(", ")}`);
  }
} catch {
  problems.push("public/data/manifest.json missing - run `npm run ingest:all`.");
}

// 3. The satellite pass worker. Missing here means the satellite-passes layer
//    fetches TLEs, computes nothing and renders an empty layer with no console
//    error - the same shape of failure as the MapLibre worker above.
try {
  if (fs.statSync(path.join(ROOT, "public", "passes-worker.mjs")).size < 1000) {
    problems.push("public/passes-worker.mjs is suspiciously small - run `npm run build:passes-worker`.");
  }
} catch {
  problems.push(
    "public/passes-worker.mjs missing - run `npm run build:passes-worker`. The satellite-passes layer will be silently empty.",
  );
}

// 3b. The routing worker. Missing here means long-press navigation computes
//     nothing and the UI just shows "route not computed yet" with no error -
//     a silent gap of exactly the kind the pass worker gaps produce.
try {
  if (fs.statSync(path.join(ROOT, "public", "routing-worker.mjs")).size < 1000) {
    problems.push("public/routing-worker.mjs is suspiciously small - run `npm run build:routing-worker`.");
  }
} catch {
  problems.push(
    "public/routing-worker.mjs missing - run `npm run build:routing-worker`. Long-press routing will silently do nothing.",
  );
}

// 4. The security headers file. Cloudflare Pages reads public/_headers; if it
//    is absent the deploy simply loses the CSP and nothing says so, because a
//    missing header looks exactly like a working page until something breaks.
try {
  const h = fs.readFileSync(path.join(ROOT, "public", "_headers"), "utf8");
  if (!h.includes("Content-Security-Policy")) {
    problems.push("public/_headers has no Content-Security-Policy - run `npm run build:headers`.");
  }
} catch {
  problems.push("public/_headers missing - run `npm run build:headers`.");
}

const report = {
  ok: problems.length === 0,
  worker: workerOk,
  layers,
  features,
  absent,
  /**
   * `static` means this is a fact about the build, not about a running process.
   * A consumer that expects a dynamic check should see that immediately rather
   * than treating a fixed `ok: true` as reassurance about a live deployment.
   */
  check: "static-build",
  generated: new Date().toISOString(),
  hosting: {
    static: true,
    /** These run in the browser and need nothing from the host. */
    clientFeeds: ["satellite-passes"],
  },
  problems,
  warnings: [
    "This is a BUILD-TIME report. It says the map is structurally complete, not that any upstream is reachable.",
    "Live-feed state is observed in the browser, not here: satellite passes are fetched client-side.",
    "Satellite passes need public/passes-worker.mjs, bundled from src/lib/feeds/passes-worker.ts by scripts/build-passes-worker.mjs before next build. If that file is missing or stale, the layer is silently empty - there is no console error to see. (Its presence is checked above; staleness is checked by scripts/lib/passes-worker-build.test.mjs.)",
  ],
};

writeJSON(OUT, report, { pretty: true, trailingNewline: true });

console.log(
  `  public/health.json  ok=${report.ok} worker=${report.worker} layers=${layers} features=${features}`,
);
if (problems.length) {
  for (const p of problems) console.error(`  ! ${p}`);
  process.exit(1);
}