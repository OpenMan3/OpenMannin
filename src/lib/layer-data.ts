/**
 * Client-side layer data loading.
 *
 * Everything here runs in the browser. The static layers live in public/data
 * (a few MB across the registry) and are fetched on demand and cached for the
 * session rather than bundled or proxied. Sizes are not uniform: most are
 * tens of KB, but `roads` and `house-numbers` run to hundreds of KB, parsed
 * on the main thread, so heavy layers are the cost of this arrangement rather
 * than an accident of it. MapLibre is then handed the parsed object directly
 * instead of a URL, which keeps the layer list the single source of truth for
 * what exists.
 */

import type { LayerDef } from "./types";
import { resolveFeatureLabel } from "./feature-label.ts";

export type GeometryKind = "point" | "line" | "polygon";

export interface Feature {
  geometry?: { type: string } | null;
  properties?: Record<string, unknown> | null;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
  /** Collection-level metadata the ingests write: `generated`, caveats, licence. */
  properties?: Record<string, unknown> | null;
}

let loaderWorker: Worker | null | undefined;
let loaderSeq = 0;
function getLoaderWorker(): Worker | null {
  if (loaderWorker !== undefined) return loaderWorker;
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    loaderWorker = null;
    return null;
  }
  try {
    loaderWorker = new Worker("/layer-loader-worker.mjs");
  } catch {
    loaderWorker = null;
  }
  return loaderWorker;
}

async function fetchLayerInWorker(file: string): Promise<FeatureCollection> {
  const worker = getLoaderWorker();
  if (!worker) {
    const res = await fetch(`/data/${file}`, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for /data/${file}`);
    return (await res.json()) as FeatureCollection;
  }
  const id = ++loaderSeq;
  return new Promise<FeatureCollection>((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.id !== id) return;
      worker.removeEventListener("message", onMessage);
      if (ev.data.ok) resolve(ev.data.data as FeatureCollection);
      else reject(new Error(ev.data.error ?? `worker failed for /data/${file}`));
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ id, file });
  });
}

const cache = new Map<string, FeatureCollection>();
const inflight = new Map<string, Promise<FeatureCollection>>();

export async function loadLayer(file: string): Promise<FeatureCollection> {
  const cached = cache.get(file);
  if (cached) return cached;

  const pending = inflight.get(file);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const fc = await fetchLayerInWorker(file);
      cache.set(file, fc);
      return fc;
    } finally {
      // ALWAYS clear the in-flight entry, including on failure. Deleting only
      // on success - the previous behaviour - left the rejected promise in the
      // map forever, so one flaky request made the layer permanently
      // un-loadable for the rest of the session: every later `loadLayer`
      // returned the same rejection, the panel marked it "no data", and the
      // checkbox stayed disabled with no retry path short of a reload.
      inflight.delete(file);
    }
  })();

  inflight.set(file, promise);
  return promise;
}

/** Probe whether a file exists, so the UI can grey out layers it cannot load. */
export async function layerExists(file: string): Promise<boolean> {
  try {
    await loadLayer(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every geometry kind present in a collection - not just the first one.
 *
 * LayerDef deliberately carries no geometry hint: the registry describes what a
 * layer *is*, and inferring from the data keeps the two from drifting apart.
 *
 * Reading only the FIRST feature, as this used to do, silently hides the rest
 * of a mixed collection. MapLibre's `circle` layer draws nothing for a
 * LineString, and a `fill` draws nothing for a Point, so whichever kind came
 * first won and the others were never rendered. Measured against the shipped
 * data: `power` opens with a Polygon, so none of its 20 substations drew; `ports`
 * lost 2 points. A collection may legitimately mix kinds, so the renderer has
 * to be told about all of them.
 *
 * Returns `point` for an empty or geometry-less collection, which draws
 * nothing and is harmless - the same default as before.
 */
export function geometryKindsOf(fc: FeatureCollection): Set<GeometryKind> {
  const kinds = new Set<GeometryKind>();
  for (const f of fc.features) {
    const t = f.geometry?.type;
    if (!t) continue;
    if (t === "Point" || t === "MultiPoint") kinds.add("point");
    else if (t === "LineString" || t === "MultiLineString") kinds.add("line");
    else if (t === "Polygon" || t === "MultiPolygon") kinds.add("polygon");
  }
  if (kinds.size === 0) kinds.add("point");
  return kinds;
}

/**
 * Human-readable label for a feature. Delegates to the shared resolver so the
 * popup heading and the Browse list can never disagree.
 */
export function featureLabel(props: Record<string, unknown> | null | undefined): string {
  return resolveFeatureLabel(props);
}

/** True when the ingests wrote a caveat block onto the collection. */
export function collectionCaveats(fc: FeatureCollection): string[] {
  const meta = (fc as unknown as { properties?: { caveats?: unknown } }).properties;
  if (meta && Array.isArray(meta.caveats)) {
    return meta.caveats.filter((c): c is string => typeof c === "string");
  }
  return [];
}

export function layersWithFiles(layers: LayerDef[]): (LayerDef & { file: string })[] {
  return layers.filter((l): l is LayerDef & { file: string } => l.kind === "geojson" && !!l.file);
}