/**
 * Confirms a PMTiles-backed layer actually streams over HTTP range requests
 * in a real browser. The unit test proves the source descriptor; this proves
 * MapLibre, the pmtiles protocol and the server's Range support agree.
 */

import fs from "node:fs";
import { startBrowser, sleep } from "./lib/chrome-driver.mjs";

const PORT = process.env.PORT ?? "3000";
const CDP_PORT = process.env.CDP_PORT ?? "9261";
const URL_BASE = `http://localhost:${PORT}`;
const PROFILE = "/tmp/opencode/chrome-tiles";
fs.rmSync(PROFILE, { recursive: true, force: true });

const fails = [];
const tileRequests = [];
const rangeResponses = [];
let browser;

try {
  browser = await startBrowser({
    port: CDP_PORT,
    userDataDir: PROFILE,
    flags: ["--disable-gpu-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
    domains: ["Runtime", "Page", "Network"],
    windowSize: "1280,900",
  });
  const { evaluate, navigate, onMessage } = browser;

  onMessage((msg) => {
    if (msg.method === "Network.requestWillBeSent") {
      const url = msg.params.request.url;
      if (url.includes("/tiles/") && url.endsWith(".pmtiles")) tileRequests.push(url);
    }
    if (msg.method === "Network.responseReceived") {
      const { url, status, headers } = msg.params.response;
      if (url.includes("/tiles/") && status === 206) {
        rangeResponses.push({ url, contentRange: headers["content-range"] ?? headers["Content-Range"] });
      }
    }
  });

  await navigate(URL_BASE);
  await sleep(8000);

  // Open the desktop sidebar, then switch the Roads layer on.
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Layers"));
    btn?.click();
    return !!btn;
  })()`);
  await sleep(600);
  const toggled = await evaluate(`(() => {
    const box = document.getElementById("layer-roads");
    if (!box) return false;
    if (!box.checked) box.click();
    return true;
  })()`);
  await sleep(8000);

  if (!toggled) fails.push("could not find the Roads layer checkbox");
  if (tileRequests.length === 0) fails.push("no /tiles/*.pmtiles requests observed");
  if (rangeResponses.length === 0) fails.push("no HTTP 206 range responses for pmtiles");

  console.log("\nOpenMannin PMTiles check");
  console.log(`  pmtiles requests   ${tileRequests.length}`);
  console.log(`  range (206)        ${rangeResponses.length}`);
  if (rangeResponses[0]) console.log(`  first range        ${rangeResponses[0].contentRange}`);
  console.log(fails.length ? `\nFAIL:\n  ${fails.join("\n  ")}` : "\nOK");
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error(`pmtiles check failed to run: ${e.message}`);
  process.exitCode = 2;
} finally {
  browser?.close();
}
