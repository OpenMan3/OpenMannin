/* eslint-disable no-restricted-globals */
const VERSION = "openmannin-0.3.6";
const SHELL_CACHE = VERSION + "-shell";
const DATA_CACHE = VERSION + "-data";
const TILES_CACHE = VERSION + "-tiles";
const SHELL_ASSETS = ["/", "/manifest.webmanifest", "/icon.svg", "/layer-loader-worker.mjs"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith("openmannin-"))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await networkPromise) || Response.error();
}

async function getFullTileUrl(req) {
  try {
    const u = new URL(req.url);
    u.search = "";
    return u.toString();
  } catch {
    return req.url;
  }
}

async function tilesHandler(request) {
  const fullUrl = await getFullTileUrl(request);
  const tilesCache = await caches.open(TILES_CACHE);
  const range = request.headers.get("range");
  const cachedFull = await tilesCache.match(fullUrl);
  if (cachedFull && cachedFull.body) {
    if (range) {
      try {
        const pos = range.replace(/bytes=/, "").split("-");
        const start = parseInt(pos[0] || "0");
        const endStr = pos[1];
        const buf = await cachedFull.arrayBuffer();
        const total = buf.byteLength;
        const end = endStr ? Math.min(parseInt(endStr), total - 1) : total - 1;
        if (start <= end && start < total) {
          const sliced = buf.slice(start, end + 1);
          const headers = new Headers(cachedFull.headers);
          headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
          headers.set("Accept-Ranges", "bytes");
          headers.set("Content-Length", String(sliced.byteLength));
          return new Response(sliced, { status: 206, statusText: "Partial Content", headers });
        }
      } catch {
        /* fall through to network */
      }
    }
    return cachedFull.clone();
  }
  try {
    const res = await fetch(request);
    if (res && res.status === 200 && res.url && res.url.startsWith(self.location.origin)) {
      try {
        await tilesCache.put(fullUrl, res.clone());
      } catch {}
    }
    return res;
  } catch (err) {
    if (cachedFull) return cachedFull.clone();
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/tiles/") && url.pathname.endsWith(".pmtiles")) {
    event.respondWith(tilesHandler(request));
    return;
  }
  if (url.pathname.startsWith("/data/")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});
