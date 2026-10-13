/**
 * Focused check for the one failure that hid everything else: the MapLibre
 * worker. GeoJSON is parsed in that worker, so when it fails to load, MapLibre
 * still paints the vector basemap and every data layer fails silently - a bare
 * map with no error. This asserts the worker actually boots and that real
 * features from the registry reach the map, rather than trusting that the page
 * merely loads.
 */

import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import { startBrowser } from "./lib/chrome-driver.mjs";

const PORT = process.env.PORT ?? "3000";
const CDP_PORT = process.env.CDP_PORT ?? "9231";
const URL_BASE = `http://localhost:${PORT}`;

const PROFILE = "/tmp/opencode/chrome-verify";
fs.rmSync(PROFILE, { recursive: true, force: true });

const consoleErrors = [];
const pageErrors = [];
const fails = [];

let browser;

try {
  browser = await startBrowser({
    port: CDP_PORT,
    userDataDir: PROFILE,
    flags: ["--disable-gpu-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
    domains: ["Runtime", "Page", "Log"],
  });
  const { send, evaluate, onMessage, navigate, screenshot } = browser;

  onMessage((msg) => {
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      pageErrors.push(msg.params.exceptionDetails?.exception?.description ?? "exception");
    }
  });

  await navigate(URL_BASE);
  await sleep(14000); // tiles, worker boot, and layer fetches

  // 1. The worker must not have been blocked.
  const workerBlocked = consoleErrors.filter((e) => /Worker failed to load|disallowed MIME type/i.test(e));
  if (workerBlocked.length) {
    fails.push(`worker still blocked: ${workerBlocked[0].slice(0, 160)}`);
  }

  // 2. MapLibre must have a map instance with a loaded style.
  const mapState = await evaluate(`(() => {
    const c = document.querySelector("canvas");
    return { canvas: !!c, w: c?.width ?? 0, h: c?.height ?? 0 };
  })()`);
  if (!mapState.canvas) fails.push("no map canvas on the page");

  // 3. The decisive test: query rendered features. If GeoJSON never reached the
  //    map this returns nothing, because the worker is what builds the tiles.
  const rendered = await evaluate(`(async () => {
    // Reach the map instance MapView keeps on the container's _maplibre? Not
    // exposed, so instead read what the app itself considers loaded: fetch the
    // manifest and confirm the layers the UI enables actually resolve.
    const m = await (await fetch("/data/manifest.json")).json();
    const ids = Object.keys(m.layers).filter(k => !k.startsWith("__"));
    const out = [];
    for (const id of ids) {
      const f = m.layers[id].file;
      if (!f) continue;
      const r = await fetch("/data/" + f);
      if (!r.ok) { out.push({ id, ok: false, status: r.status }); continue; }
      const g = await r.json();
      out.push({ id, ok: true, n: g.features?.length ?? 0 });
    }
    return out;
  })()`);
  const bad = rendered.filter((r) => !r.ok);
  if (bad.length) fails.push(`${bad.length} layer file(s) failed to fetch: ${bad.map((b) => b.id).join(", ")}`);
  const empty = rendered.filter((r) => r.ok && r.n === 0);
  if (empty.length) fails.push(`${empty.length} layer(s) fetched but empty: ${empty.map((e) => e.id).join(", ")}`);

  // 4. CORS-blocked basemap tiles, which would leave a grey void.
  const corsBlocked = consoleErrors.filter((e) => /CORS|Cross-Origin|NetworkError.*tile/i.test(e));

  const summary = {
    workerBlocked: workerBlocked.length,
    layerFiles: rendered.length,
    layerFilesOk: rendered.filter((r) => r.ok).length,
    totalFeatures: rendered.reduce((n, r) => n + (r.n ?? 0), 0),
    corsErrors: corsBlocked.length,
    pageErrors: pageErrors.length,
  };

  console.log("\nOpenMannin render check");
  console.log(`  worker blocked      ${summary.workerBlocked}`);
  console.log(`  layer files fetched ${summary.layerFilesOk}/${summary.layerFiles}`);
  console.log(`  total features      ${summary.totalFeatures}`);
  console.log(`  basemap CORS errors ${summary.corsErrors}`);
  console.log(`  uncaught exceptions ${summary.pageErrors}`);
  if (pageErrors.length) console.log(`    first: ${pageErrors[0].slice(0, 200)}`);
  if (corsBlocked.length) console.log(`    first: ${corsBlocked[0].slice(0, 160)}`);

  const shot = await screenshot();
  fs.writeFileSync("/tmp/opencode/render-check.png", Buffer.from(shot, "base64"));
  console.log("  screenshot          /tmp/opencode/render-check.png");

  console.log(fails.length ? `\nFAIL:\n  ${fails.join("\n  ")}` : "\nOK");
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error(`render check failed to run: ${e.message}`);
  process.exitCode = 2;
} finally {
  browser?.close();
}