/**
 * Client-side layer data loading.
 *
 * Everything here runs in the browser. The static layers are small (the whole
 * public/data directory is around 10 MB, and any single layer is well under
 * 1 MB), so they are fetched on demand and cached for the session rather than
 * bundled or proxied. MapLibre is then handed the parsed object directly
 * instead of a URL, which keeps the layer list the single source of truth for
 * what exists.
 */

import type { LayerDef } from "./types";

export type GeometryKind = "point" | "line" | "polygon";

interface Feature {
  geometry?: { type: string } | null;
  properties?: Record<string, unknown> | null;
}

interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

const cache = new Map<string, FeatureCollection>();
const inflight = new Map<string, Promise<FeatureCollection>>();

export async function loadLayer(file: string): Promise<FeatureCollection> {
  const cached = cache.get(file);
  if (cached) return cached;

  const pending = inflight.get(file);
  if (pending) return pending;

  const promise = (async () => {
    const res = await fetch(`/data/${file}`, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for /data/${file}`);
    const fc = (await res.json()) as FeatureCollection;
    cache.set(file, fc);
    inflight.delete(file);
    return fc;
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
 * Decide how to draw a layer from its first feature.
 *
 * LayerDef deliberately carries no geometry hint: the registry describes what a
 * layer *is*, and inferring from the data keeps the two from drifting apart.
 * Defaults to points, which is the safe render for an unknown geometry.
 */
export function geometryKindOf(fc: FeatureCollection): GeometryKind {
  for (const f of fc.features) {
    const t = f.geometry?.type;
    if (!t) continue;
    if (t === "Point" || t === "MultiPoint") return "point";
    if (t === "LineString" || t === "MultiLineString") return "line";
    if (t === "Polygon" || t === "MultiPolygon") return "polygon";
  }
  return "point";
}

/** Human-readable label for a feature, trying the fields our ingests actually set. */
export function featureLabel(props: Record<string, unknown> | null | undefined): string {
  if (!props) return "(no properties)";
  for (const key of ["name", "label", "title", "Name", "NAME", "plot"]) {
    const v = props[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const asn = props.asn;
  if (typeof asn === "number") return `AS${asn}`;
  return "(unnamed)";
}

/** True when the ingests wrote a caveat block onto the collection. */
export function collectionCaveats(fc: FeatureCollection): string[] {
  const meta = (fc as unknown as { properties?: { caveats?: unknown } }).properties;
  if (meta && Array.isArray(meta.caveats)) {
    return meta.caveats.filter((c): c is string => typeof c === "string");
  }
  return [];
}

export function layersWithFiles(layers: LayerDef[]): LayerDef[] {
  return layers.filter((l): l is LayerDef & { file: string } => l.kind === "geojson" && !!l.file);
}