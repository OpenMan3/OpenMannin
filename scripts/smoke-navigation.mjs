/**
 * Headless navigation smoke test.
 *
 * Flies a fake GPS fix from Douglas to Peel through the sat-nav guidance UI.
 */

import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { startBrowser } from "./lib/chrome-driver.mjs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3111/";
const PORT = process.env.CDP_PORT ?? "9231";

function fail(message) {
  throw new Error(message);
}

async function waitFor(testExpression, budget = 12_000, interval = 300) {
  const started = Date.now();
  while (Date.now() - started < budget) {
    const ok = await evaluate(testExpression);
    if (ok) return true;
    await sleep(interval);
  }
  return false;
}

const { send, sessionId, evaluate, navigate, screenshot, close } = await startBrowser({
  port: PORT,
  windowSize: "1440,900",
  stdio: ["ignore", "ignore", "pipe"],
  flags: ["--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars"],
  domains: ["Runtime", "Page", "Network"],
  viewport: [1440, 900],
});

try {
  // Chromium's CDP emulation is unreliable for this geolocation watch in headless
  // mode, so provide a deterministic GPS fix before the app starts.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `navigator.geolocation.watchPosition = (success) => {
      success({ coords: { latitude: 54.14977, longitude: -4.4779, accuracy: 10, heading: 0, speed: 0 }, timestamp: Date.now() });
      return 1;
    };`,
  }, sessionId);
  await send("Emulation.setGeolocationOverride", {
    latitude: 54.14977,
    longitude: -4.4779,
    accuracy: 10,
  }, sessionId);

  await navigate(URL_UNDER_TEST);
  await sleep(12_000);

  await evaluate(`window.dispatchEvent(new CustomEvent("openmannin:locate"))`);
  // Give the first fix and route preflight time to arrive.
  await sleep(6_000);

  await evaluate(`window.dispatchEvent(new CustomEvent("openmannin:set-destination", {
    detail: { lon: -4.69015, lat: 54.22195, title: "Peel", detail: "" }
  }))`);

  const canNavigate = await waitFor(`(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Navigate"
    );
    return !!btn && !btn.disabled;
  })()`, 15_000);

  if (!canNavigate) {
    fail("destination preview did not become navigable");
  }

  await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Navigate"
    );
    btn?.click();
    return !!btn;
  })()`);

  const guided = await waitFor(`document.body.innerText.includes("ahead")`, 20_000);
  if (!guided) {
    fail("sat-nav guidance banner did not appear");
  }

  await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "End"
    );
    btn?.click();
    return !!btn;
  })()`);

  const stopped = await waitFor(`(() => {
    return [...document.querySelectorAll("button")].some(
      (b) => b.textContent?.trim() === "Navigate"
    );
  })()`, 15_000);

  if (!stopped) fail("End did not restore the preview screen");

  const shot = await screenshot();
  const png = Buffer.from(shot, "base64");
  fs.mkdirSync("/tmp/opencode", { recursive: true });
  fs.writeFileSync("/tmp/opencode/navigation-smoke.png", png);
  console.log("navigation smoke: OK");
} catch (err) {
  try {
    const shot = await screenshot();
    fs.mkdirSync("/tmp/opencode", { recursive: true });
    fs.writeFileSync("/tmp/opencode/navigation-smoke-failed.png", Buffer.from(shot, "base64"));
  } catch {}
  close();
  throw err;
} finally {
  close();
}
