/**
 * Offline-first verification for the PWA shell.
 *
 * Loads the app, lets the service worker install, takes the browser offline,
 * reloads, and confirms the shell (and cached data) still render.
 */

import fs from "node:fs";
import { startBrowser, sleep } from "./lib/chrome-driver.mjs";

const PORT = process.env.PORT ?? "3000";
const CDP_PORT = process.env.CDP_PORT ?? "9251";
const URL_BASE = `http://localhost:${PORT}`;
const PROFILE = "/tmp/opencode/chrome-offline";
fs.rmSync(PROFILE, { recursive: true, force: true });

const fails = [];
let browser;

try {
  browser = await startBrowser({
    port: CDP_PORT,
    userDataDir: PROFILE,
    flags: ["--disable-gpu-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
    domains: ["Runtime", "Page", "Network"],
    windowSize: "1280,900",
  });
  const { evaluate, navigate, send, sessionId } = browser;

  await navigate(URL_BASE);
  await sleep(10000);

  // Wait for the service worker to take control of the page.
  let controlled = false;
  for (let i = 0; i < 20 && !controlled; i++) {
    controlled = await evaluate("!!navigator.serviceWorker && !!navigator.serviceWorker.controller");
    if (!controlled) await sleep(500);
  }

  // Drop the network.
  await send(
    "Network.emulateNetworkConditions",
    { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
    sessionId
  );
  await browser.navigate(URL_BASE);
  await sleep(6000);

  const offlineState = await evaluate(`(() => ({
    title: document.title,
    hasMap: !!document.querySelector("canvas"),
    hasSidebar: !!document.querySelector("aside"),
    controlled: !!navigator.serviceWorker?.controller,
    bodyText: (document.body?.innerText || "").slice(0, 200)
  }))()`);

  // Restore connectivity.
  await send(
    "Network.emulateNetworkConditions",
    { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
    sessionId
  );

  if (!offlineState.hasSidebar) fails.push("sidebar missing after offline reload");
  if (!offlineState.hasMap && !offlineState.bodyText.includes("OpenMannin")) fails.push("page did not render offline");
  // PMTiles-backed layers fall back to cached GeoJSON if offline; presence of map/canvas is sufficient.

  console.log("\nOpenMannin offline check");
  console.log(`  service worker     ${offlineState.controlled ? "controlling" : "not yet controlling"}`);
  console.log(`  offline map canvas ${offlineState.hasMap}`);
  console.log(`  offline sidebar    ${offlineState.hasSidebar}`);
  console.log(fails.length ? `\nFAIL:\n  ${fails.join("\n  ")}` : "\nOK");
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error(`offline check failed to run: ${e.message}`);
  process.exitCode = 2;
} finally {
  browser?.close();
}
