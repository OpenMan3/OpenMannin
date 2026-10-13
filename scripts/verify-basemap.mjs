/**
 * Assert the OpenFreeMap Liberty basemap actually paints, and that the data
 * layers sit above it, by loading the real app rather than trusting the config.
 *
 * This is a vector basemap: the style JSON, vector tiles, sprites and glyphs
 * all come from tiles.openfreemap.org. There is no single opaque raster
 * "basemap" layer to place under the data (that hazard was specific to the old
 * OpenTopoMap raster basemap), so the checks here are: the style loads, our
 * data layers are present, the tiles come back over CORS, and the attribution
 * credits the right provider.
 */

import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import { startBrowser } from "./lib/chrome-driver.mjs";

const PORT = process.env.PORT ?? "3000";
const CDP_PORT = process.env.CDP_PORT ?? "9232";
const BASE = `http://localhost:${PORT}`;

// A fresh profile each run: with a reused cache every tile arrives as an
// HTTP-cache hit, transferSize reports 0, and the "really fetched tiles from
// the network" assertion below becomes meaningless.
const PROFILE = "/tmp/opencode/chrome-tile";
fs.rmSync(PROFILE, { recursive: true, force: true });

const errors = [];

/** Layer order + source survey for the loaded style. */
const probe = `(() => {
  const m = window.__openmanninMap;
  if (!m) return { error: "no debug handle" };
  const layers = m.getStyle().layers ?? [];
  const ids = layers.map(l => l.id);
  const data = ids.filter(id => id.startsWith("om-"));
  const sources = Object.values(m.getStyle().sources ?? {});
  return {
    layerCount: ids.length,
    dataCount: data.length,
    vectorSources: sources.filter(s => s.type === "vector" || s.type === "geojson").length,
    // The old raster failure mode: an opaque raster layer stacked ON TOP of
    // the data. Nothing here should have a raster layer above the data.
    rasterAboveData: (() => {
      const dataIdx = data.length ? ids.indexOf(data[0]) : -1;
      if (dataIdx < 0) return false;
      return layers.some((l, i) => l.type === "raster" && i > dataIdx);
    })(),
  };
})()`;

const fails = [];
const tileResponses = [];
let browser;
try {
  browser = await startBrowser({
    port: CDP_PORT,
    userDataDir: PROFILE,
    flags: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
    domains: ["Runtime", "Page", "Network"],
  });
  const { send, evaluate, onMessage, navigate, screenshot } = browser;

  onMessage((msg) => {
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    // Cross-origin tiles omit Timing-Allow-Origin, so performance entries
    // report transferSize 0 and duration 0 even for a healthy network fetch.
    // The responses themselves are the only trustworthy signal.
    if (msg.method === "Network.responseReceived" && /tiles\.openfreemap\.org/.test(msg.params.response.url)) {
      tileResponses.push(msg.params.response.status);
    }
  });

  await navigate(BASE);
  await sleep(12000);

  const result = await evaluate(probe);
  if (result.error) fails.push(result.error);
  else {
    if (result.dataCount === 0) fails.push("no data layers in style at all");
    if (result.rasterAboveData) fails.push("a raster layer is stacked above the data layers");
    if (result.vectorSources === 0) fails.push("no vector/geojson source present");
  }

  // Credit whoever actually served the tiles. OpenFreeMap requires attribution.
  const attribution = await evaluate(`(() => {
    const el = document.querySelector(".maplibregl-ctrl-attrib-inner")
           || document.querySelector(".maplibregl-ctrl-attrib");
    return el ? el.innerText.replace(/\\s+/g, " ").trim() : "";
  })()`);
  if (!/OpenFreeMap|OpenMapTiles|OpenStreetMap/i.test(attribution ?? "")) {
    fails.push(`attribution does not credit OpenFreeMap/OSM: "${(attribution ?? "").slice(0, 120)}"`);
  }

  const tileErrors = errors.filter((e) => /tiles\.openfreemap\.org/i.test(e));
  if (tileErrors.length) fails.push(`${tileErrors.length} openfreemap tile/host error(s): ${tileErrors[0].slice(0, 140)}`);

  const tile200 = tileResponses.filter((s) => s === 200);
  if (!tile200.length) {
    fails.push(
      `no openfreemap tile came back 200 (${tileResponses.length} responses: ${[...new Set(tileResponses)].join(", ") || "none recorded"})`,
    );
  }

  const shot = await screenshot();
  fs.writeFileSync("/tmp/opencode/openfreemap-basemap.png", Buffer.from(shot, "base64"));

  console.log("\nOpenFreeMap Liberty basemap check");
  console.log(`  openfreemap responses ${tileResponses.length} (${tile200.length} HTTP 200)`);
  console.log(`  style layers          ${result.dataCount ?? "?"} data layers of ${result.layerCount ?? "?"}`);
  console.log(`  attribution           ${(attribution || "(none)").slice(0, 90)}`);
  console.log("  screenshot            /tmp/opencode/openfreemap-basemap.png");
  console.log(fails.length ? `\nFAIL:\n  ${fails.join("\n  ")}` : "\nOK");
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error(`basemap check failed to run: ${e.message}`);
  process.exitCode = 2;
} finally {
  browser?.close();
}