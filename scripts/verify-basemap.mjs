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

import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = process.env.PORT ?? "3000";
const CDP_PORT = process.env.CDP_PORT ?? "9232";
const BASE = `http://localhost:${PORT}`;

// A fresh profile each run: with a reused cache every tile arrives as an
// HTTP-cache hit, transferSize reports 0, and the "really fetched tiles from
// the network" assertion below becomes meaningless.
const PROFILE = "/tmp/opencode/chrome-tile";
fs.rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn("chromium", [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--no-sandbox",
  "--use-gl=swiftshader",
  "--enable-unsafe-swiftshader",
  "--window-size=1280,900",
  `--user-data-dir=${PROFILE}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const errors = [];

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    pending.set(msg.id, { resolve, reject });
    ws.send(JSON.stringify(msg));
  });
}
async function evaluate(expression, sessionId) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.value;
}

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
try {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await sleep(250);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    // Cross-origin tiles omit Timing-Allow-Origin, so performance entries
    // report transferSize 0 and duration 0 even for a healthy network fetch.
    // The responses themselves are the only trustworthy signal.
    if (msg.method === "Network.responseReceived" && /tiles\.openfreemap\.org/.test(msg.params.response.url)) {
      tileResponses.push(msg.params.response.status);
    }
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Page.navigate", { url: BASE }, sessionId);
  await sleep(12000);

  const result = await evaluate(probe, sessionId);
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
  })()`, sessionId);
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

  const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync("/tmp/opencode/openfreemap-basemap.png", Buffer.from(shot.data, "base64"));

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
  chrome.kill();
  try { ws?.close(); } catch {}
}
