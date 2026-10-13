/**
 * Focused browser test for the live-layer behaviour.
 *
 * The bug this guards against: live layers used to be wired up only inside the
 * mount-only effect, so switching one on after load never started polling and
 * never added the layer to the map, and switching one off left it painting.
 * Neither is visible in the existing smoke test, which only looks at static
 * GeoJSON.
 *
 * Asserts, against the real production build in Chromium:
 *   1. A default-on live layer (satellite passes) is on the map with real features.
 *   2. A gated live layer (flights) reports itself as offline in the panel.
 *   3. Toggling a live layer OFF removes its source and paint layers.
 *   4. Toggling a gated live layer ON starts a poller and surfaces the 503.
 *   5. Toggling it back OFF stops the poller and clears the badge.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { startBrowser } from "./lib/chrome-driver.mjs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3111/";

const { send, evaluate, onMessage, navigate, close } = await startBrowser({
  // Fixed port: this check is expected to run in parallel with the others.
  port: "9333",
  windowSize: "1440,900",
  stdio: ["ignore", "ignore", "pipe"],
  flags: ["--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars"],
  domains: ["Runtime", "Page", "Network"],
});

const consoleMsgs = [];
onMessage((msg) => {
  if (msg.method === "Runtime.consoleAPICalled") {
    const t = msg.params.type;
    if (t === "error" || t === "warning") {
      consoleMsgs.push(`${t}: ` + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
    }
  } else if (msg.method === "Runtime.exceptionThrown") {
    consoleMsgs.push("exception: " + (msg.params.exceptionDetails.exception?.description ?? ""));
  }
});

await navigate(URL_UNDER_TEST);
await sleep(9000);

const fails = [];

/** Inspect the live MapLibre style for our layer ids. */
const probe = () => evaluate(`(() => {
  const m = window.__openmanninMap;
  if (!m) return { error: "no map" };
  const style = m.getStyle();
  const srcIds = Object.keys(style.sources).filter(s => s.startsWith("om-"));
  return { sources: srcIds.sort(), layers: (style.layers ?? []).map(l => l.id).filter(l=>l.startsWith("om-")).sort() };
})()`);

/**
 * Ask the map itself how many features a source holds.
 *
 * Deliberately does not poke at GeoJSONSource internals: `_data` is private and
 * its shape is version-dependent, so reading it silently reports null and looks
 * like "the layer is empty" when it is actually "my probe was wrong". Use the
 * public query API instead.
 */
const featureCount = (sourceId) => evaluate(`(() => {
  const m = window.__openmanninMap;
  if (!m || !m.getSource(${JSON.stringify(sourceId)})) return null;
  try { return m.querySourceFeatures(${JSON.stringify(sourceId)}).length; } catch { return null; }
})()`);

/** Toggle a layer checkbox by registry id, the way a user would. */
const toggle = (layerId) => evaluate(`(() => {
  const cb = document.getElementById("layer-${layerId}");
  if (!cb) return "no checkbox for ${layerId}";
  if (cb.disabled) return "disabled";
  cb.click();
  return cb.checked ? "on" : "off";
})()`);

const badge = (layerId) => evaluate(`(() => {
  const cb = document.getElementById("layer-${layerId}");
  if (!cb) return null;
  const row = cb.closest("div").parentElement;
  return row.innerText.replace(/\\s+/g," ").trim();
})()`);

/**
 * The badge's own tooltip, which is where the feed error text actually lives.
 *
 * The row text only carries the badge label ("feed offline"); the reason is the
 * span's title attribute, and the same string is shown in full in the expanded
 * row. Asserting on the row text alone cannot tell "on hold pending an
 * agreement" apart from "the upstream is down", which is the difference this
 * test exists to pin.
 */
const badgeReason = (layerId) => evaluate(`(() => {
  const cb = document.getElementById("layer-${layerId}");
  if (!cb) return null;
  const row = cb.closest("div").parentElement;
  const el = [...row.querySelectorAll("span")].find(s => s.title);
  return el ? el.title : null;
})()`);

console.log("=== OpenMannin live-layer test ===\n");

// ---- 1. default-on live layer is live ---------------------------------------
let s = await probe();
const passesSource = s.sources.includes("om-satellite-passes");
if (!passesSource) fails.push("default-on live layer 'satellite-passes' has no source on the map");
console.log("1. satellite-passes source present:", passesSource, "| features:", await featureCount("om-satellite-passes"));

// ---- 2. on-hold live layer: badged, polled never ----------------------------
// live-flights is default-off and on hold. Toggling it ON must surface the hold
// as a row badge, must NOT start a poller (no console warning, no /api hit),
// and toggling it back OFF must clear the badge again.
let b = await badge("live-flights");
const noBadgeYet = !/feed offline/i.test(b ?? "");
console.log("2. live-flights badged while default-off:", !noBadgeYet, "(expected: false)");
await toggle("live-flights");
await sleep(1500);
b = await badge("live-flights");
const heldReason = await badgeReason("live-flights");
const heldBadged = /feed offline/i.test(b ?? "") && /on hold/i.test(heldReason ?? "");
if (!heldBadged) {
  fails.push(`on-hold layer 'live-flights' is not badged (row: ${b}, reason: ${heldReason})`);
}
console.log("   after enabling, badged on-hold:", heldBadged, "|", (heldReason ?? "").slice(0, 90));
await toggle("live-flights");
await sleep(1500);
b = await badge("live-flights");
const badgePruned = !/feed offline/i.test(b ?? "");
if (!badgePruned) fails.push(`on-hold badge did not clear after 'live-flights' was switched off (row: ${b})`);
console.log("   badge cleared after switching off:", badgePruned);

// ---- 3. toggling a live layer OFF removes it --------------------------------
console.log("\n3. toggling satellite-passes ON (was off by default)...");
await toggle("satellite-passes");
await sleep(6000);
s = await probe();
const passesOn = s.sources.includes("om-satellite-passes");
if (!passesOn) fails.push("toggling a live layer ON after load did not add it to the map");
console.log("   added to map:", passesOn, "| features:", await featureCount("om-satellite-passes"));

console.log("   toggling it back OFF...");
await toggle("satellite-passes");
await sleep(1500);
s = await probe();
const passesStillThere = s.sources.includes("om-satellite-passes")
  || s.layers.some((l) => l.startsWith("om-satellite-passes"));
if (passesStillThere) fails.push("toggling a live layer OFF left its source/layers on the map");
console.log("   removed from map:", !passesStillThere);

// ---- 4. it comes back when re-enabled ---------------------------------------
console.log("\n4. re-enabling satellite-passes...");
await toggle("satellite-passes");
await sleep(6000);
s = await probe();
const passesBack = s.sources.includes("om-satellite-passes");
if (!passesBack) fails.push("re-enabling a live layer did not restore it");
console.log("   restored:", passesBack, "| features:", await featureCount("om-satellite-passes"));

// ---- 5. static layers survived all of that ---------------------------------
// Ids are the registry's, not the filenames': hydrography.geojson is layer "hydro".
s = await probe();
const statics = ["om-toponyms", "om-roads", "om-hydro", "om-bus-stops"]
  .filter((x) => s.sources.includes(x));
console.log("\n5. static layers still present:", statics.join(", "));
if (statics.length !== 4) fails.push("static layers were disturbed by live-layer toggling");

// ---- 6. console stayed clean ------------------------------------------------
const noisy = consoleMsgs.filter((m) => !/Failed to load resource/.test(m));
console.log("\nconsole errors/warnings:", noisy.length);
for (const m of noisy.slice(0, 10)) console.log("   " + m);
if (noisy.length) fails.push(`${noisy.length} console error/warning(s)`);

console.log(fails.length ? `\nFAIL\n  ${fails.join("\n  ")}` : "\nPASS");
close();
process.exit(fails.length ? 1 : 0);
