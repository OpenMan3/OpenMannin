/**
 * Point-to-point routing, off the main thread.
 *
 * WHY A WORKER. The first route request parses the ~8 MB roads layer and builds
 * a graph from roughly 21,000 ways. That is hundreds of milliseconds to a couple
 * of seconds of work, and on the main thread it would drop the map to zero
 * frames while the user is looking at the spinner. Once built, the graph is
 * cached in the worker for the rest of the session and later queries are
 * milliseconds.
 *
 * WHY IT FETCHES THE DATA ITSELF. The graph is built from the same
 * /data/roads.geojson the map already serves, under the app's own origin. The
 * worker fetches and parses it directly so the multi-megabyte object never has
 * to be structured-cloned across the thread boundary.
 *
 * Build output: public/routing-worker.mjs, by scripts/build-routing-worker.mjs.
 * The bundler will not compile a module worker into a static export, so this is
 * hand-bundled the same way the MapLibre and pass workers are.
 */

import { buildGraph, routeBetween, type Graph } from "./graph.ts";
import { PROFILES, type RouteMode } from "./profiles.ts";

type Request = {
  id: number;
  start: { lon: number; lat: number };
  dest: { lon: number; lat: number };
  modes?: RouteMode[];
};

const ROADS_URL = "/data/roads.geojson";

/** Built once per worker. A rejected build is cleared so a retry can succeed. */
let graphPromise: Promise<Graph> | null = null;

function loadGraph(): Promise<Graph> {
  if (!graphPromise) {
    graphPromise = (async () => {
      const res = await fetch(ROADS_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error(`roads data unavailable (HTTP ${res.status})`);
      const fc = (await res.json()) as { features?: unknown[] };
      const graph = buildGraph(fc as never);
      if (graph.nodeCount === 0) throw new Error("roads data had no line geometry to route on");
      return graph;
    })().catch((err) => {
      graphPromise = null;
      throw err;
    });
  }
  return graphPromise;
}

self.addEventListener("message", (e: MessageEvent) => {
  const req = e.data as Request;
  if (!req || typeof req.id !== "number" || !req.start || !req.dest) return;

  const modes: RouteMode[] = req.modes?.length ? req.modes : ["driving", "walking"];

  void (async () => {
    try {
      const graph = await loadGraph();
      const routes: Record<string, unknown> = {};
      for (const mode of modes) {
        const profile = PROFILES[mode];
        if (!profile) continue;
        routes[mode] = routeBetween(graph, req.start, req.dest, profile);
      }
      (self as unknown as Worker).postMessage({ id: req.id, ok: true, result: routes });
    } catch (err) {
      (self as unknown as Worker).postMessage({
        id: req.id,
        ok: false,
        error: (err as Error).message,
      });
    }
  })();
});