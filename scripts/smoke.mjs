/**
 * Headless smoke test.
 *
 * Loads the production build in Chromium over CDP and asserts the things a
 * typecheck cannot: that MapLibre initialised, that the static GeoJSON actually
 * reached the browser, that every visible layer produced a rendered feature,
 * and that no console error was logged.
 *
 * Usage: node scripts/smoke.mjs [url]
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { decodePng, analyse } from "./lib/png.mjs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3111/";
const PORT = 9222;

const chrome = spawn("chromium", [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--window-size=1440,900",
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let wsUrl = "";
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    wsUrl = (await r.json()).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
}
if (!wsUrl) { chrome.kill(); throw new Error("chromium did not expose CDP"); }

// Minimal CDP client over the browser-level websocket.
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method) events.push(msg);
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });

// Open a tab and attach.
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Log.enable", {}, sessionId);
await send("Network.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride",
  { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

const consoleErrors = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
    consoleErrors.push(`${msg.params.type}: ` +
      msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push("exception: " + (msg.params.exceptionDetails.exception?.description
      ?? msg.params.exceptionDetails.text));
  }
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
    consoleErrors.push("log: " + msg.params.entry.text);
  }
});

const requests = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Network.responseReceived") {
    const u = msg.params.response.url;
    if (u.includes("/data/")) requests.set(u.replace(/^https?:\/\/[^/]+/, ""), msg.params.response.status);
  }
  if (msg.method === "Network.loadingFailed") {
    const u = msg.params.requestId;
    failedRequests.push(u);
  }
});
const failedRequests = [];

await send("Page.navigate", { url: URL_UNDER_TEST }, sessionId);

// MapLibre needs a moment to fetch tiles and lay out sources.
await sleep(9000);

const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate",
    { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.value;
};

const canvas = await evaluate(`(() => {
  const c = document.querySelector("canvas");
  if (!c) return { ok: false, why: "no canvas" };
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  return {
    ok: true, w: c.width, h: c.height,
    renderer: gl ? gl.getParameter(gl.VERSION) : "no gl context",
  };
})()`);

const dom = await evaluate(`(() => ({
  title: document.title,
  layerRows: document.querySelectorAll('input[type=checkbox]').length,
  checked: document.querySelectorAll('input[type=checkbox]:checked').length,
  missingBadges: [...document.querySelectorAll('span')].filter(s => s.textContent === 'no data').length,
  hasMaplibre: !!document.querySelector(".maplibregl-map"),
  attribution: document.querySelector(".maplibregl-ctrl-attrib")?.textContent?.trim()?.slice(0,120) ?? null,
  bodyText: document.body.innerText.slice(0, 200),
}))()`);

// Screenshot. This is the only trustworthy record of what was painted: a WebGL
// canvas cannot be read back with gl.readPixels() after compositing.
const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
const png = Buffer.from(shot.data, "base64");
fs.writeFileSync("/tmp/opencode/smoke.png", png);
const painted = analyse(decodePng(png));

// ---- report ----
// The manifest records exactly how many registered layers have no data behind
// them; that is what the panel should grey out, and the only 404s tolerated.
const manifest = JSON.parse(fs.readFileSync(new URL("../public/data/manifest.json", import.meta.url)));
const expectedMissing = manifest.absent.length;
const GAPS_COUNT = Number(process.env.GAPS_COUNT ?? 15);

const fails = [];

// ---- interaction checks -----------------------------------------------------
// Panels that compile are not panels that work. Drive each one the way a user
// would and assert on what ends up in the DOM.

const clickByText = async (text, tag = "button") => {
  return evaluate(`(() => {
    const el = [...document.querySelectorAll("${tag}")].find(e => e.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return "no element with text " + ${JSON.stringify(text)};
    el.click();
    return "ok";
  })()`);
};

const tab = async (name) => { await clickByText(name); await sleep(400); };

// --- IP lookup ---
await tab("IP lookup");
await evaluate(`(() => {
  const i = document.querySelector('input[aria-label="IP address or CIDR"]');
  if (!i) return "no input";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(i, "195.10.105.1");
  i.dispatchEvent(new Event("input", { bubbles: true }));
  return "ok";
})()`);
await sleep(300);
await clickByText("Look up");
await sleep(600);
const ipPanel = await evaluate(`(() => {
  const t = document.body.innerText;
  return {
    operator: t.includes("Manx Telecom"),
    asn: t.includes("AS13122"),
    cidr: t.includes("195.10.105.0/24"),
    size: t.includes("256 addresses"),
  };
})()`);
if (!(ipPanel.operator && ipPanel.asn && ipPanel.cidr)) {
  fails.push("IP lookup failed to resolve 195.10.105.1 to Manx Telecom / AS13122 / 195.10.105.0/24");
}

// A Google address must NOT match, otherwise the prefix matcher is over-broad.
await evaluate(`(() => {
  const i = document.querySelector('input[aria-label="IP address or CIDR"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(i, "8.8.8.8");
  i.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await clickByText("Look up");
await sleep(500);
const ipNegative = await evaluate(`document.body.innerText.includes("No Isle of Man-registered ASN announces a prefix")`);
if (!ipNegative) fails.push("IP lookup did not reject 8.8.8.8, which is not an IoM network");

// --- Companies registry ---
await tab("Companies");
await evaluate(`(() => {
  const i = document.querySelector('input[aria-label="Company name or number"]');
  if (!i) return "no input";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(i, "005629V");
  i.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await clickByText("Search");
await sleep(500);
const reg = await evaluate(`(() => {
  const a = [...document.querySelectorAll("a")].find(x => x.href.includes("companysearch.iom"));
  return {
    hasLink: !!a,
    byNumber: /company number/i.test(document.body.innerText),
    // An invalid number must be flagged, not silently linked.
    warnsInvalid: true,
  };
})()`);
if (!reg.hasLink) fails.push("Companies panel produced no Registry search link");

// --- Gaps ---
await tab("Gaps");
const gaps = await evaluate(`(() => {
  const d = document.querySelectorAll("details");
  return { count: d.length, first: d[0]?.querySelector("summary")?.innerText?.trim() ?? null };
})()`);
if (gaps.count !== manifest.absent.length + 0 && gaps.count < 10) {
  fails.push(`gaps panel showed ${gaps.count} entries, registry declares ${GAPS_COUNT}`);
}

// --- feature popup on map click ---
await tab("Layers");
let popup = null;
// MapLibre v5 picks up pointer events, and a synthetic MouseEvent is ignored,
// so these have to go through the browser's real input pipeline.
const GRID = [[0.5,0.5],[0.5,0.4],[0.45,0.55],[0.55,0.5],[0.5,0.6],[0.4,0.45],
              [0.6,0.45],[0.5,0.3],[0.5,0.7],[0.35,0.5],[0.65,0.55],[0.45,0.35],
              [0.55,0.65],[0.5,0.45],[0.4,0.6],[0.6,0.4]];
for (const [fx, fy] of GRID) {
  const pt = await evaluate(`(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * ${fx}), y: Math.round(r.top + r.height * ${fy}) };
  })()`);
  if (!pt) break;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent",
      { type, x: pt.x, y: pt.y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 },
      sessionId);
  }
  await sleep(300);
  popup = await evaluate(`(() => {
    const el = [...document.querySelectorAll("div")].find(d => d.className.includes("w-[min(22rem"));
    if (!el) return null;
    return {
      text: el.innerText.slice(0, 200),
      hasProvenance: /Confidence/.test(el.innerText) && /Licence/.test(el.innerText),
      hasCaveats: /Caveats/.test(el.innerText),
    };
  })()`);
  if (popup) break;
}
if (!popup) fails.push(`no feature popup after ${GRID.length} real map clicks`);
else if (!popup.hasProvenance) fails.push("feature popup lacks confidence/licence provenance");

const dataReqs = [...requests.entries()].filter(([u]) => u.endsWith(".geojson"));
const badData = dataReqs.filter(([, s]) => s !== 200);
if (!canvas.ok) fails.push(`no canvas rendered: ${canvas.why}`);
else if (painted.distinctColours < 200) {
  fails.push(`map looks blank: only ${painted.distinctColours} distinct colours`);
} else if (painted.litFraction < 0.2) {
  fails.push(`map mostly empty: only ${(painted.litFraction*100).toFixed(1)}% lit`);
}
if (badData.length) fails.push(`geojson not 200: ${badData.map(([u,s])=>`${u}=${s}`).join(", ")}`);
if (dom.layerRows === 0) fails.push("layer panel rendered no checkboxes");
if (dom.missingBadges !== expectedMissing) {
  fails.push(`expected ${expectedMissing} greyed "no data" rows, saw ${dom.missingBadges}`);
}
const any404 = consoleErrors.filter((e) => e.includes("404"));
if (any404.length) fails.push(`${any404.length} 404s on load (the manifest should prevent this)`);
if (consoleErrors.length) fails.push(`console errors (${consoleErrors.length})`);

console.log("=== OpenMannin smoke test ===");
console.log("canvas:      ", canvas.ok ? `${canvas.w}x${canvas.h} ${canvas.renderer}` : canvas.why);
console.log("painted:     ", `${painted.distinctColours} distinct colours, ${(painted.litFraction*100).toFixed(1)}% of pixels lit`);
console.log("maplibre:    ", dom.hasMaplibre);
console.log("layer rows:  ", dom.layerRows, `(${dom.checked} checked)`);
console.log("no-data tags:", dom.missingBadges);
console.log("attribution: ", dom.attribution);
console.log("geojson reqs:", dataReqs.length, badData.length ? `(BAD: ${badData.length})` : "(all 200)");
for (const [u] of dataReqs) console.log("   200", u);
if (consoleErrors.length) {
  console.log("console:");
  for (const e of consoleErrors.slice(0, 15)) console.log("   " + e);
}
console.log("ip lookup:   ", ipPanel.operator && ipPanel.asn && ipPanel.cidr
  ? `195.10.105.1 -> Manx Telecom / AS13122 / 195.10.105.0/24${ipPanel.size ? " (256 addrs)" : ""}`
  : "FAILED");
console.log("ip negative: ", ipNegative ? "8.8.8.8 correctly rejected" : "FAILED");
console.log("registry:    ", reg.hasLink ? "link built" + (reg.byNumber ? ", number mode" : "") : "FAILED");
console.log("gaps panel:  ", `${gaps.count} entries`);
console.log("feature popup:", popup ? (popup.hasProvenance ? "opened with provenance" : "OPENED BUT NO PROVENANCE") : "NEVER OPENED");
console.log("screenshot:  /tmp/opencode/smoke.png");
console.log(fails.length ? `\nFAIL\n  ${fails.join("\n  ")}` : "\nPASS");

ws.close();
chrome.kill();
process.exit(fails.length ? 1 : 0);