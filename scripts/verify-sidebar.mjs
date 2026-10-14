/**
 * Focused check for the desktop sidebar collapse and bottom-bar clearance
 * issues reported during user testing.
 *
 * Run with a served build: `node scripts/verify-sidebar.mjs`.
 */

import fs from "node:fs";
import { startBrowser, sleep } from "./lib/chrome-driver.mjs";

const PORT = process.env.PORT ?? "3000";
const CDP_PORT = process.env.CDP_PORT ?? "9241";
const URL_BASE = `http://localhost:${PORT}`;
const PROFILE = "/tmp/opencode/chrome-sidebar";
fs.rmSync(PROFILE, { recursive: true, force: true });

const fails = [];
let browser;

try {
  browser = await startBrowser({
    port: CDP_PORT,
    userDataDir: PROFILE,
    flags: ["--disable-gpu-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
    domains: ["Runtime", "Page"],
    windowSize: "1280,900",
  });
  const { evaluate, navigate } = browser;

  await navigate(URL_BASE);
  await sleep(8000);

  const clickTab = async () => {
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Layers"));
      btn?.click();
      return !!btn;
    })()`);
    await sleep(400);
  };

  // Desktop sidebar starts collapsed. Expand it, then collapse again so the
  // width transition runs and we can measure the closed state.
  await clickTab(); // expand
  await clickTab(); // collapse

  const sidebarClosed = await evaluate(`(() => {
    const aside = document.querySelector("aside");
    if (!aside) return { ok: false, reason: "no aside" };
    const r = aside.getBoundingClientRect();
    return { ok: true, width: Math.round(r.width), visibleRightEdge: Math.round(r.right) };
  })()`);
  if (!sidebarClosed.ok) fails.push(sidebarClosed.reason);
  else if (sidebarClosed.width > 4) fails.push(`desktop sidebar still ${sidebarClosed.width}px wide when collapsed`);

  // Reopen and scroll its layer list to the bottom.
  await clickTab();
  await sleep(300);
  const scrollResult = await evaluate(`(() => {
    const scroller = document.querySelector(".scroll-thin.flex-1, .scroll-thin.h-full");
    if (!scroller) return { ok: false, reason: "no scroller" };
    scroller.scrollTop = scroller.scrollHeight;
    const padBottom = parseFloat(getComputedStyle(scroller).paddingBottom || "0");
    return { ok: true, padBottom, scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight };
  })()`);
  if (!scrollResult.ok) fails.push(scrollResult.reason);

  console.log("\nOpenMannin sidebar check");
  console.log(`  collapsed width     ${sidebarClosed.width ?? "?"}px`);
  console.log(`  bottom padding     ${scrollResult.padBottom ?? "?"}px`);
  console.log(fails.length ? `\nFAIL:\n  ${fails.join("\n  ")}` : "\nOK");
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error(`sidebar check failed to run: ${e.message}`);
  process.exitCode = 2;
} finally {
  browser?.close();
}
