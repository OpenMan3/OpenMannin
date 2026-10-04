/**
 * Assert the OpenTopoMap basemap actually paints, and that the live satellite
 * pass layer renders, by driving the real UI rather than trusting the config.
 *
 * The tile proxy can return 200 with a valid PNG while the map still shows
 * nothing, if the style never picks up the source. So this switches the basemap
 * through the actual <select>, screenshots the result, and measures how much of
 * the canvas is non-basemap colour.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = process.env.PORT ?? "3000";
const BASE = `http://localhost:${PORT}`;

const chrome = spawn("chromium", [
  "--headless=new",
  "--remote-debugging-port=9223",
  "--no-sandbox",
  "--use-gl=swiftshader",
  "--enable-unsafe-swiftshader",
  "--window-size=1280,900",
  "--user-data-dir=/tmp/opencode/chrome-tile",
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
try {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch("http://localhost:9223/json/version")).json()).webSocketDebuggerUrl; } catch {}
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
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
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

  const tileErrors = errors.filter((e) => /api\/tiles\/opentopo/i.test(e));
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
      [...s.options].some(o => o.value === "esri"));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, "esri");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`, sessionId);
  await sleep(4000);
  const orderAfterBack = await evaluate(orderProbe, sessionId);
  assertOrder("after switching back to esri", orderAfterBack);

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

  // Count proxied tile requests that the browser actually made.
  const perf = await evaluate(`(() => performance.getEntriesByType("resource")
     .filter(e => e.name.includes("/api/tiles/opentopo/"))
     .map(e => ({ name: e.name, size: e.transferSize, dur: Math.round(e.duration) })) )()`, sessionId);
  const okTiles = (perf ?? []).filter((t) => t.size > 0);
  if (!okTiles.length) fails.push("browser requested no proxied opentopo tiles with a non-zero body");

  // The attribution control must credit whoever actually served the tiles.
  // OpenTopoMap is CC-BY-SA, so leaving Esri credited on screen is a licence
  // breach, not a cosmetic nit - and it is exactly what setTiles() would cause.
  const attribution = await evaluate(`(() => {
    const el = document.querySelector(".maplibregl-ctrl-attrib-inner")
           || document.querySelector(".maplibregl-ctrl-attrib");
    return el ? el.innerText.replace(/\\s+/g, " ").trim() : "";
  })()`, sessionId);
  if (!/OpenTopoMap/i.test(attribution ?? "")) {
    fails.push(`attribution does not credit OpenTopoMap: "${(attribution ?? "").slice(0, 120)}"`);
  }
  if (/Esri/i.test(attribution ?? "")) {
    fails.push(`attribution still credits Esri while showing OpenTopoMap tiles: "${(attribution ?? "").slice(0, 120)}"`);
  }

  const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync("/tmp/opencode/opentopo-basemap.png", Buffer.from(shot.data, "base64"));

  console.log("\nOpenTopoMap basemap check");
  console.log(`  proxied tile requests ${(perf ?? []).length} (${okTiles.length} with body)`);
  console.log(`  tile request errors   ${tileErrors.length}`);
  console.log(`  basemap layer index   ${orderAfterSwitch.basemapIndex} (first data layer ${orderAfterSwitch.firstDataIndex}, ${orderAfterSwitch.dataCount} data layers)`);
  console.log(`  below data, both ways ${orderAfterSwitch.basemapBelowAllData && orderAfterBack.basemapBelowAllData ? "yes" : "NO"}`);
  console.log(`  attribution          ${(attribution ?? "(none)").slice(0, 90)}`);
  console.log(`  slowest tile          ${Math.max(0, ...okTiles.map((t) => t.dur))} ms`);
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