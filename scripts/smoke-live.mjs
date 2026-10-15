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
 *   1. The one live layer (satellite passes) is OFF by default - no source.
 *   2. Switching it ON after load adds its source and paint layers.
 *   3. Switching it OFF again removes its source and paint layers.
 *   4. Switching it back ON restores them.
 *   5. Whatever was on at load is still on, and the console stayed clean.
 *
 * MANUAL ONLY, and not wired into CI, because it needs a running server, an
 * outbound fetch to CelesTrak, and patience: the poller's first delay is
 * LIVE_POLL_BASE_MS (30 s, `src/lib/feeds/backoff.ts`), because on a static host
 * the browser talks to CelesTrak directly and the interval IS the rate limit.
 * SGP4 over 20 element sets then takes a few seconds more, so each enable costs
 * about a minute. The parsing, the checksum/element-set guards and the client
 * allowlist are all covered headlessly by scripts/lib/feeds-client.test.mjs.
 *
 * Two easy ways to break this without noticing: the sidebar starts collapsed,
 * and its checkboxes are `inert` until the panel is expanded, and the default
 * enabled set is only the two lightweight context layers, so "the layer is on
 * at load" and "the statics are all there" are both false.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { startBrowser } from "./lib/chrome-driver.mjs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3111/";

/** How long to wait for a live layer's first poll to land. See the header. */
const FEED_WAIT_MS = 150_000;

const { evaluate, onMessage, navigate, close } = await startBrowser({
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
 *
 * Wait for the source's tiles first: `addSource` resolves as soon as the source
 * exists, but `querySourceFeatures` reads the tile pyramid, and querying before
 * it has loaded answers 0 for a perfectly healthy layer. Note also that one
 * feature can appear once per tile it covers, so the count is a floor.
 */
const featureCount = async (sourceId, timeoutMs = 30_000) => {
  const started = Date.now();
  for (;;) {
    const loaded = await evaluate(`(() => {
      const m = window.__openmanninMap;
      if (!m || !m.getSource(${JSON.stringify(sourceId)})) return null;
      return m.isSourceLoaded ? m.isSourceLoaded(${JSON.stringify(sourceId)}) : true;
    })()`);
    if (loaded === null) return null;
    const n = await evaluate(`(() => {
      const m = window.__openmanninMap;
      if (!m || !m.getSource(${JSON.stringify(sourceId)})) return null;
      try { return m.querySourceFeatures(${JSON.stringify(sourceId)}).length; } catch { return null; }
    })()`);
    if (n === null) return null;
    if (n > 0 || loaded || Date.now() - started > timeoutMs) return n;
    await sleep(2000);
  }
};

/** Toggle a layer checkbox by registry id, the way a user would. */
const toggle = (layerId) => evaluate(`(() => {
  const cb = document.getElementById("layer-${layerId}");
  if (!cb) return "no checkbox for ${layerId}";
  if (cb.disabled) return "disabled";
  cb.click();
  return cb.checked ? "on" : "off";
})()`);

/**
 * Expand the sidebar, or every layer checkbox in it stays `inert` and a click
 * on one does nothing at all. The desktop drawer starts collapsed.
 */
const openSidebar = async () => {
  const clicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")]
      .find((b) => b.getAttribute("aria-label") === "Expand panel");
    if (!btn) return "no expand button";
    btn.click();
    return "clicked";
  })()`);
  if (clicked !== "clicked") fails.push(`could not expand the layer sidebar (${clicked})`);
  await sleep(600);
  const inert = await evaluate(`(() => {
    const cb = document.getElementById("layer-satellite-passes");
    if (!cb) return "no checkbox";
    return cb.closest("[inert]") ? "inert" : "live";
  })()`);
  return inert;
};

/** Wait for a source to appear, because the first poll is 30 s out by design. */
const waitForSource = async (sourceId, timeoutMs = FEED_WAIT_MS) => {
  const started = Date.now();
  for (;;) {
    const s = await probe();
    if (s.error) return { ok: false, waited: Date.now() - started, err: s.error };
    if (s.sources.includes(sourceId)) return { ok: true, waited: Date.now() - started };
    if (Date.now() - started > timeoutMs) {
      return { ok: false, waited: Date.now() - started, sources: s.sources };
    }
    await sleep(2000);
  }
};

console.log("=== OpenMannin live-layer test ===\n");

// ---- 1. the live layer is off by default ------------------------------------
let s = await probe();
const passesAtLoad = s.sources.includes("om-satellite-passes");
if (passesAtLoad) fails.push("live layer 'satellite-passes' has a source on the map at load, but it is default-off");
/** Whatever is on at load must still be on at the end. */
const initialSources = s.sources ?? [];
console.log("1. satellite-passes source absent at load:", !passesAtLoad);
console.log("   on at load:", initialSources.join(", ") || "(none)");

// ---- 2. switching a live layer ON adds it -----------------------------------
const inertState = await openSidebar();
console.log("\n2. sidebar:", inertState);

console.log("   toggling satellite-passes ON (first poll is 30 s out by design, this waits)...");
const t1 = await toggle("satellite-passes");
if (t1 !== "on") fails.push(`toggling satellite-passes on returned "${t1}"`);
const on = await waitForSource("om-satellite-passes");
if (!on.ok) fails.push(`toggling a live layer ON after load did not add it to the map (waited ${Math.round(on.waited / 1000)}s; sources: ${(on.sources ?? []).join(", ")})`);
console.log("   added to map:", on.ok, "after ~" + Math.round((on.waited ?? 0) / 1000) + "s | features:", await featureCount("om-satellite-passes"));

// ---- 3. switching it OFF removes it -----------------------------------------
console.log("   toggling it back OFF...");
const t2 = await toggle("satellite-passes");
if (t2 !== "off") fails.push(`toggling satellite-passes off returned "${t2}"`);
await sleep(2000);
s = await probe();
const passesStillThere = (s.sources ?? []).includes("om-satellite-passes")
  || (s.layers ?? []).some((l) => l.startsWith("om-satellite-passes"));
if (passesStillThere) fails.push("toggling a live layer OFF left its source/layers on the map");
console.log("   removed from map:", !passesStillThere);

// ---- 4. it comes back when re-enabled ---------------------------------------
console.log("\n3. re-enabling satellite-passes (another 30 s poll)...");
const t3 = await toggle("satellite-passes");
if (t3 !== "on") fails.push(`re-enabling satellite-passes returned "${t3}"`);
const back = await waitForSource("om-satellite-passes");
if (!back.ok) fails.push(`re-enabling a live layer did not restore it (waited ${Math.round(back.waited / 1000)}s)`);
console.log("   restored:", back.ok, "| features:", await featureCount("om-satellite-passes"));

// ---- 5. what was on at load survived all of that ----------------------------
// The default enabled set is only the two lightweight context layers; every
// other layer is off by default. Ids are the registry's, not the filenames':
// toponyms.geojson is layer "toponyms".
s = await probe();
const statics = initialSources.filter((x) => (s.sources ?? []).includes(x));
console.log("\n4. layers on at load, still on:", statics.join(", ") || "(none)");
if (statics.length !== initialSources.length || initialSources.length === 0) {
  fails.push(`live-layer toggling disturbed the layer set that was on at load (was: ${initialSources.join(", ")}, now: ${statics.join(", ")})`);
}

// ---- 6. console stayed clean ------------------------------------------------
const noisy = consoleMsgs.filter((m) => !/Failed to load resource/.test(m));
console.log("\nconsole errors/warnings:", noisy.length);
for (const m of noisy.slice(0, 10)) console.log("   " + m);
if (noisy.length) fails.push(`${noisy.length} console error/warning(s)`);

console.log(fails.length ? `\nFAIL\n  ${fails.join("\n  ")}` : "\nPASS");
close();
process.exit(fails.length ? 1 : 0);
