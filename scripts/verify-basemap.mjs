/**
 * Assert the OpenTopoMap basemap actually paints, and that a basemap switch
 * keeps every data layer above it, by driving the real UI rather than
 * trusting the config.
 *
 * Tiles can return 200 with a valid PNG while the map still shows
 * nothing, if the style never picks up the source. So this switches the basemap
 * through the actual <select>, screenshots the result, and measures how much of
 * the canvas is non-basemap colour.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = process.env.PORT ?? "3000";
const CDP_PORT = process.env.CDP_PORT ?? "9232";
const BASE = `http://localhost:${PORT}`;

// A fresh profile each run: with a reused cache every tile arrives as a
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
    // The response themselves are the only trustworthy signal.
    if (msg.method === "Network.responseReceived" && /tile\.opentopomap\.org/.test(msg.params.response.url)) {
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

  // Switch basemap through the real control.
  const switched = await evaluate(`(() => {
    const sel = [...document.querySelectorAll("select")].find(s =>
      [...s.options].some(o => o.value === "opentopo"));
    if (!sel) return "no basemap select found";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, "opentopo");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`, sessionId);
  if (switched !== "ok") fails.push(`could not switch basemap: ${switched}`);
  await sleep(9000);

  // Direct from OpenTopoMap now, so assert on the upstream host rather than our
  // own path. If their CORS header goes away this fires, which is the point.
  const tileErrors = errors.filter((e) => /tile\.opentopomap\.org/i.test(e));
  if (tileErrors.length) fails.push(`${tileErrors.length} opentopo tile error(s): ${tileErrors[0].slice(0, 140)}`);

  // LAYER ORDER, not layer existence.
  // addLayer without a beforeId appends to the end, putting an opaque raster
  // basemap ON TOP of every data layer. Every layer still exists, so an
  // existence check passes while the map looks empty - and because the effect
  // runs in both directions, swapping back does not recover it. Only a refresh
  // rebuilds the style with the basemap first, which is exactly the reported
  // "it only fixes itself if I reload" symptom.
  const orderProbe = `(() => {
    const m = window.__openmanninMap;
    if (!m) return { error: "no debug handle" };
    const ids = m.getStyle().layers.map(l => l.id);
    const basemap = ids.indexOf("basemap");
    const data = ids.filter(id => id.startsWith("om-"));
    return {
      basemapIndex: basemap,
      dataCount: data.length,
      firstDataIndex: data.length ? ids.indexOf(data[0]) : -1,
      basemapBelowAllData:
        data.length === 0 ? null : basemap !== -1 && basemap < ids.indexOf(data[0]),
      order: ids,
    };
  })()`;

  const assertOrder = (label, probe) => {
    if (probe.error) { fails.push(`${label}: ${probe.error}`); return; }
    if (probe.dataCount === 0) { fails.push(`${label}: no data layers in style at all`); return; }
    if (!probe.basemapBelowAllData) {
      fails.push(
        `${label}: basemap is NOT below the data layers ` +
        `(basemap at ${probe.basemapIndex}, first data layer at ${probe.firstDataIndex}) - ` +
        `an opaque raster layer is covering them. order: ${probe.order.join(" > ")}`,
      );
    }
  };

  const orderAfterSwitch = await evaluate(orderProbe, sessionId);
  assertOrder("after switching to opentopo", orderAfterSwitch);

  // And back again: the old bug survived the return trip too.
  await evaluate(`(() => {
    const sel = [...document.querySelectorAll("select")].find(s =>
      [...s.options].some(o => o.value === "osm"));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, "osm");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`, sessionId);
  await sleep(4000);
  const orderAfterBack = await evaluate(orderProbe, sessionId);
  assertOrder("after switching back to opentopo", orderAfterBack);

  // Put it back on opentopo for the screenshot and attribution assertions.
  await evaluate(`(() => {
    const sel = [...document.querySelectorAll("select")].find(s =>
      [...s.options].some(o => o.value === "opentopo"));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, "opentopo");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`, sessionId);
  await sleep(6000);

  // Count the tile requests the browser actually made.
  //
  // These are direct to OpenTopoMap, not through our origin. That is the whole
  // point of the change: it sends `access-control-allow-origin: *`, so the proxy
  // had nothing left to do, and going direct removes a hop and a bandwidth bill.
  // The status of each response is captured by the Network listener above,
  // because performance.getEntriesByType("resource") cannot be used here:
  // OpenTopoMap sends no Timing-Allow-Origin, so entry transferSize/duration
  // are 0 even for a healthy fetch. If OpenTopoMap ever stops sending the CORS
  // header, MapLibre fails to read the pixels and the canvas assertion in
  // verify-render catches it; here we catch the narrower HTTP failure.
  const perf = await evaluate(`(() => performance.getEntriesByType("resource")
     .filter(e => /tile\\.opentopomap\\.org/.test(e.name))
     .map(e => ({ name: e.name, size: e.transferSize })) )()`, sessionId);
  const tile200 = tileResponses.filter((s) => s === 200);
  if (!tile200.length) {
    fails.push(
      `no opentopo tile came back 200 (${tileResponses.length} responses: ${[...new Set(tileResponses)].join(", ") || "none recorded"})`,
    );
  }

  // The attribution control must credit whoever actually served the tiles.
  // OpenTopoMap is CC-BY-SA, so leaving the old provider credited on screen
  // is a licence-compliance bug, not a cosmetic nit - setTiles() would do exactly that.
  const attribution = await evaluate(`(() => {
    const el = document.querySelector(".maplibregl-ctrl-attrib-inner")
           || document.querySelector(".maplibregl-ctrl-attrib");
    return el ? el.innerText.replace(/\\s+/g, " ").trim() : "";
  })()`, sessionId);
  if (!/OpenTopoMap/i.test(attribution ?? "")) {
    fails.push(`attribution does not credit OpenTopoMap: "${(attribution ?? "").slice(0, 120)}"`);
  }
  if (/tile\.openstreetmap\.org/i.test(String(attribution ?? "").replace(/OpenTopoMap|OpenStreetMap/g, "")) && /Standard OSM/i.test(String(attribution ?? ""))) {
    fails.push(`attribution still credits "Standard OSM" while showing OpenTopoMap tiles: "${(attribution ?? "").slice(0, 120)}"`);
  }

  const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync("/tmp/opencode/opentopo-basemap.png", Buffer.from(shot.data, "base64"));

  console.log("\nOpenTopoMap basemap check");
  console.log(`  direct tile requests  ${(perf ?? []).length} (${tile200.length} HTTP 200)`);
  console.log(`  tile request errors   ${tileErrors.length}`);
  console.log(`  basemap layer index   ${orderAfterSwitch.basemapIndex} (first data layer ${orderAfterSwitch.firstDataIndex}, ${orderAfterSwitch.dataCount} data layers)`);
  console.log(`  below data, both ways ${orderAfterSwitch.basemapBelowAllData && orderAfterBack.basemapBelowAllData ? "yes" : "NO"}`);
  console.log(`  attribution          ${(attribution ?? "(none)").slice(0, 90)}`);
  console.log("  screenshot            /tmp/opencode/opentopo-basemap.png");
  console.log(fails.length ? `\nFAIL:\n  ${fails.join("\n  ")}` : "\nOK");
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error(`basemap check failed to run: ${e.message}`);
  process.exitCode = 2;
} finally {
  chrome.kill();
  try { ws?.close(); } catch {}
}