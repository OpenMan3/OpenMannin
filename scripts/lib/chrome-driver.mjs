/**
 * Minimal headless-Chromium CDP helper shared by the browser-driven checks:
 * smoke.mjs, smoke-live.mjs, verify-render.mjs and verify-basemap.mjs.
 *
 * Each of those used to carry ~70 lines of near-identical boilerplate: spawn
 * chromium, poll /json/version for the debug endpoint, open a browser-level
 * WebSocket, route responses by id against a pending map, attach a tab, enable
 * the CDP domains they need, optionally fix the viewport and navigate. That
 * plumbing is the same four times over; only the assertions and the choice of
 * domains differ. This module owns the plumbing.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export { sleep };

/**
 * Launch headless chromium, attach a fresh tab, enable the requested CDP
 * domains and (optionally) navigate. Resolves once the tab is ready.
 *
 * @param {object} opts
 * @param {string} [opts.port]         CDP debugging port (env CDP_PORT default).
 * @param {string} [opts.windowSize]   "WIDTH,HEIGHT" passed to --window-size.
 * @param {string} [opts.userDataDir]  Fresh profile per run; a reused cache
 *                                     makes tile "fetched from network"
 *                                     assertions meaningless.
 * @param {string[]} [opts.flags]      Extra chromium switches (GPU, scrollbars).
 * @param {string[]} [opts.stdio]      Chromium stdio triple; stdout/stderr are
 *                                     resumed so pipe backpressure cannot stall
 *                                     the browser.
 * @param {string[]} [opts.domains]    CDP domains to enable: Runtime, Page,
 *                                     Network, Log.
 * @param {[number, number]} [opts.viewport]  Emulation device metrics override.
 * @param {string} [opts.url]          If set, navigate here after attaching.
 * @returns {Promise<Driver>}
 */
export async function startBrowser({
  port = process.env.CDP_PORT ?? "9231",
  windowSize = "1280,900",
  userDataDir,
  flags = [],
  stdio = ["ignore", "pipe", "pipe"],
  domains = ["Runtime", "Page", "Network"],
  viewport = null,
  url = null,
} = {}) {
  const chrome = spawn("chromium", [
    "--headless=new",
    "--no-sandbox",
    `--remote-debugging-port=${port}`,
    `--window-size=${windowSize}`,
    ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),
    ...flags,
    "about:blank",
  ], { stdio });

  // Nobody reads chromium's own stdout/stderr; without resuming them the pipes
  // can fill and stall the browser before it ever answers CDP.
  if (chrome.stdout) chrome.stdout.resume();
  if (chrome.stderr) chrome.stderr.resume();

  let wsUrl = "";
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await r.json()).webSocketDebuggerUrl ?? "";
    } catch { /* not up yet */ }
  }
  if (!wsUrl) {
    chrome.kill();
    throw new Error(`chromium did not expose CDP on port ${port}`);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const subscriptions = new Set();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    // A response carries the id of the command that produced it; route it to
    // the caller's pending promise. Everything else is an event, handed to
    // every subscription so scripts keep their own console/network filters.
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    for (const sub of subscriptions) sub(msg);
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of domains) await send(`${domain}.enable`, {}, sessionId);
  if (viewport) {
    await send("Emulation.setDeviceMetricsOverride",
      { width: viewport[0], height: viewport[1], deviceScaleFactor: 1, mobile: false },
      sessionId);
  }
  if (url) await send("Page.navigate", { url }, sessionId);

  return {
    send,
    sessionId,
    /** Subscribe to every un-routed CDP event; returns an unsubscribe fn. */
    onMessage: (fn) => {
      subscriptions.add(fn);
      return () => subscriptions.delete(fn);
    },
    async evaluate(expression) {
      const r = await send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      );
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
      }
      return r.result.value;
    },
    navigate: (u) => send("Page.navigate", { url: u }, sessionId),
    async screenshot() {
      const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      return shot.data;
    },
    close() {
      chrome.kill();
      try { ws.close(); } catch {}
    },
  };
}