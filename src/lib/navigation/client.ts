/**
 * Client gateway to the routing Web Worker.
 *
 * Mirrors passes-client.ts (the same static-site worker pattern): the worker is
 * created once, replies are matched to requests by id, a late or missing reply
 * is bounded by a deadline, and a dead worker is discarded rather than reused.
 *
 * The routing layer depends on roads.geojson. The worker fetches that itself, so
 * the first call here can take a second or two while the graph is built; the
 * deadline below is sized accordingly and applies only to the first request.
 */

import type { RouteMode } from "./profiles";
import { ROUTE_MODES } from "./profiles";

export { ROUTE_MODES };

/** A completed route for one profile, or null when no road route exists. */
export interface RouteLeg {
  distanceM: number;
  durationS: number;
  coordinates: [number, number][];
  /**
   * Street name of each segment, parallel to `coordinates`: entry k names the
   * segment from coordinates[k] to coordinates[k+1]. `null` where the road is
   * unnamed. Empty when no names are known.
   */
  segmentNames: (string | null)[];
}

export type RouteMap = Partial<Record<RouteMode, RouteLeg | null>>;

export interface RoutesReply {
  ok: boolean;
  routes: RouteMap;
  error?: string;
}

const WORKER_URL = "/routing-worker.mjs";
const REPLY_TIMEOUT_MS = 90_000;

let worker: Worker | null = null;
let workerPromise: Promise<Worker> | null = null;

/** All waiters for the current worker, keyed by request id. */
const pending = new Map<number, { resolve: (v: RouteMap) => void; reject: (e: Error) => void }>();

function getWorker(): Promise<Worker> {
  if (worker) return Promise.resolve(worker);
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    const w = new Worker(WORKER_URL, { type: "module" });

    // THE REPLY LISTENER LIVES ON THE WORKER, NOT ON `window`. A worker's
    // self.postMessage is delivered to the Worker object that created it; the
    // two are not interchangeable (the pass worker learned this the hard way).
    w.addEventListener("message", (e: MessageEvent) => {
      const { id, ok, result, error } = (e.data ?? {}) as {
        id?: number;
        ok?: boolean;
        result?: RouteMap;
        error?: string;
      };
      if (typeof id !== "number") return;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok && result) entry.resolve(result);
      else entry.reject(new Error(error ?? "routing worker failed"));
    });

    // A dead worker must not be reused, and everyone waiting on it must learn
    // the reply is not coming. Clearing workerPromise as well as worker lets
    // the next call build a fresh one - clearing only `worker` hands every
    // later caller the same dead instance forever.
    w.addEventListener("error", (e) => {
      if (worker === w) {
        worker = null;
        workerPromise = null;
      }
      const err = new Error(`routing worker failed: ${e.message || "worker error"}`);
      for (const [, entry] of pending) entry.reject(err);
      pending.clear();
      console.warn("[nav]", err.message);
    });

    worker = w;
    return w;
  })();

  return workerPromise;
}

let seq = 0;

export async function computeRoutes(
  start: { lon: number; lat: number },
  dest: { lon: number; lat: number },
  modes: RouteMode[] = ["driving", "walking"],
): Promise<RoutesReply> {
  try {
    const w = await getWorker();
    const id = ++seq;
    const routes = await new Promise<RouteMap>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, start, dest, modes });
      setTimeout(() => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        entry.reject(new Error(`routing worker did not reply within ${REPLY_TIMEOUT_MS / 1000}s`));
      }, REPLY_TIMEOUT_MS);
    });
    return { ok: true, routes };
  } catch (e) {
    return { ok: false, routes: {}, error: (e as Error).message };
  }
}