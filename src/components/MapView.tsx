"use client";

/**
 * The MapLibre view.
 *
 * Basemap choice, which took some testing to get right:
 *
 *   - OpenFreeMap and CARTO's vector "dark matter" style both declare
 *     maxzoom 14. Overpass-quality infrastructure data wants z16+.
 *   - CARTO's raster dark_all endpoint returns a byte-identical blank tile at
 *     every zoom, so it is retired for anonymous use and silently useless.
 *   - Esri World Imagery serves real imagery to z18+ with `cors: *`.
 *
 * Esri is therefore the default. Its terms are the least certain thing in this
 * project and it is registered as such in SOURCES; the satellite alternative
 * (OpenTopoMap, CC-BY-SA derived) is offered in the basemap switch.
 *
 * Our own data is drawn as GeoJSON sources so the layer registry stays the one
 * source of truth, and every paint layer is registered in PICKABLE so a click
 * can be traced back to the LayerDef that produced it.
 */

import { useEffect, useRef, useState } from "react";
import type { LayerDef } from "@/lib/types";
import { geometryKindOf, loadLayer, type GeometryKind } from "@/lib/layer-data";

export interface PickedFeature {
  layer: LayerDef;
  properties: Record<string, unknown> | null;
  lon: number;
  lat: number;
}

export type BasemapId = "esri";

/** MapLibre layer id for a registry layer, e.g. toponyms + symbol -> om-toponyms-symbol. */
const layerIdFor = (id: string, suffix: string) => `om-${id}-${suffix}`;

/**
 * Resolve a clicked MapLibre layer id back to its registry entry.
 *
 * Ids are `om-<registry id>-<geometry suffix>`, so both the namespace prefix
 * and the suffix have to be removed. Forgetting the prefix silently makes every
 * click miss, which looks exactly like dead map.
 */
function layerByMapLayerId(mapLayerId: string, defs: LayerDef[]): LayerDef | undefined {
  const match = /^om-(.+)-(fill|line|circle|symbol)$/.exec(mapLayerId);
  if (!match) return undefined;
  return defs.find((l) => l.id === match[1]);
}

const BASEMAPS: Record<BasemapId, { tiles: string[]; attribution: string; maxzoom: number }> = {
  esri: {
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution:
      "Imagery &copy; Esri, Maxar, Earthstar Geographics. Basemap terms are the least certain licence in this project.",
    maxzoom: 19,
  },
}


const GLYPHS = "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf";

/**
 * Where the MapLibre worker bundle is served from. Written to public/ verbatim
 * by scripts/copy-maplibre-worker.mjs; the same directory so the worker's own
 * `import "./maplibre-gl-shared.mjs"` resolves.
 */
const WORKER_BASE = "/";

/** Centre on the Isle of Man, framed so the whole island is visible at z10. */
const INITIAL_CENTRE: [number, number] = [-4.4814, 54.1509];
const INITIAL_ZOOM = 10;

export function MapView({
  layers,
  enabled,
  basemap,
  onPick,
  onMissing,
}: {
  layers: LayerDef[];
  enabled: Set<string>;
  basemap: BasemapId;
  onPick: (picked: PickedFeature | null) => void;
  /** Reports layers the registry lists but public/data does not have. */
  onMissing?: (missing: Set<string>) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const readyRef = useRef(false);
  const [status, setStatus] = useState<string>("loading map…");
  const [missing, setMissing] = useState<Set<string>>(new Set());

  // Keep the latest values reachable from the map event handlers without
  // re-registering listeners on every render.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // Populated by the mount effect, called by the effects that react to
  // visibility and basemap changes. A ref rather than a map property so the
  // map object is never cast to an anonymous shape.
  const syncRef = useRef<(() => Promise<void>) | null>(null);

  // ---- create the map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const maplibregl = (await import("maplibre-gl")) as typeof import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      await import("maplibre-gl/dist/maplibre-gl.css");

      // MapLibre derives its worker URL from `import.meta.url`, which is not an
      // http(s) URL once bundled. It then gets "" back and calls new Worker(""),
      // which the browser resolves to the site root, is handed our HTML page,
      // and refuses as text/html. The map still renders the raster basemap, so
      // the failure looks like "no data layers" rather than "no worker" - every
      // GeoJSON source is processed in that worker and fails silently.
      // Point it at the copy in public/ instead. See scripts/copy-maplibre-worker.mjs.
      maplibregl.setWorkerUrl(`${WORKER_BASE}maplibre-gl-worker.mjs`);

      const bm = BASEMAPS[basemap];
      const map = new maplibregl.Map({
        container: containerRef.current,
        center: INITIAL_CENTRE,
        zoom: INITIAL_ZOOM,
        minZoom: 8,
        maxZoom: bm.maxzoom,
        attributionControl: { compact: true },
        // The island is small; a hard pitch limit stops users tilting the
        // basemap into a wall while looking for a subsea cable.
        pitchWithRotate: false,
        dragRotate: false,
        style: {
          version: 8,
          glyphs: GLYPHS,
          sources: {
            basemap: { type: "raster", tiles: bm.tiles, tileSize: 256, attribution: bm.attribution },
          },
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#0b0f14" } },
            { id: "basemap", type: "raster", source: "basemap" },
          ],
        },
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      map.addControl(
        new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }),
        "bottom-left",
      );

      map.on("load", () => {
        readyRef.current = true;
        setStatus("ready");
        void syncLayers();
      });


      map.on("click", (e: import("maplibre-gl").MapMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point);
        for (const hit of hits) {
          const layer = layerByMapLayerId(hit.layer.id, layersRef.current);
          if (!layer) continue;
          onPickRef.current({
            layer,
            properties: hit.properties ?? null,
            lon: e.lngLat.lng,
            lat: e.lngLat.lat,
          });
          return;
        }
        onPickRef.current(null);
      });

      // Show the cursor only over something we actually drew.
      map.on("mousemove", (e: import("maplibre-gl").MapMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point);
        const ours = hits.some((h) => layerByMapLayerId(h.layer.id, layersRef.current) !== undefined);
        map.getCanvas().style.cursor = ours ? "pointer" : "";
      });

      mapRef.current = map;

      // Lets an ancestor panel ask the map to recentre without holding a ref to
      // the MapLibre instance, which is created asynchronously below.
      const onFlyTo = (e: Event) => {
        const { lon, lat, zoom } = (e as CustomEvent).detail as {
          lon: number;
          lat: number;
          zoom?: number;
        };
        map.flyTo({
          center: [lon, lat],
          zoom: zoom ?? Math.max(map.getZoom(), 15),
          duration: 700,
        });
      };
      window.addEventListener("openmannin:fly-to", onFlyTo);

      // ---- add or remove our layers to match `enabled` ----------------------
      async function syncLayers() {
        const map = mapRef.current;
        if (!map || !readyRef.current) return;
        const defs = layersRef.current;

        for (const def of defs) {
          if (def.kind !== "geojson" || !def.file) continue;
          const wanted = enabledRef.current.has(def.id);
          const present = map.getSource(`om-${def.id}`) !== undefined;
          if (wanted === present) continue;

          if (!wanted) {
            for (const suffix of ["fill", "line", "circle", "symbol"]) {
              const id = layerIdFor(def.id, suffix);
              if (map.getLayer(id)) map.removeLayer(id);
            }
            map.removeSource(`om-${def.id}`);
            continue;
          }

          try {
            const fc = await loadLayer(def.file);
            if (!mapRef.current?.getSource(`om-${def.id}`)) {
              map.addSource(`om-${def.id}`, { type: "geojson", data: fc as never });
              addPaintLayers(maplibregl, map, def, geometryKindOf(fc));
            }
          } catch {
            // A layer the registry lists but public/data does not have must not
            // take the map down. Record it and let the panel grey it out.
            setMissing((prev) => new Set(prev).add(def.id));
          }
        }
      }
      syncRef.current = syncLayers;
      void syncLayers();
    })();

    return () => {
      cancelled = true;
      syncRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // Intentionally mount-only: layer changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hand the missing set up so the layer panel can grey those rows out.
  useEffect(() => {
    onMissing?.(missing);
  }, [missing, onMissing]);

  // ---- react to layer visibility changes -----------------------------------
  useEffect(() => {
    void syncRef.current?.();
  }, [enabled]);

  // ---- react to basemap changes --------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const bm = BASEMAPS[basemap];
    const src = map.getSource("basemap") as import("maplibre-gl").RasterTileSource | undefined;
    if (!src) return;
    src.setTiles(bm.tiles);
    map.setMaxZoom(bm.maxzoom);
    void syncRef.current?.();
  }, [basemap]);

  // ---- load the data manifest ----------------------------------------------
  // The manifest is written by scripts/build-manifest.mjs at ingest time. Asking
  // the server what exists costs one small request, where probing each layer
  // from the browser cost eleven 404s on first paint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/data/manifest.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const manifest = (await res.json()) as { layers: Record<string, { present: boolean }> };
        if (cancelled) return;

        const absent = new Set<string>();
        for (const l of layersRef.current) {
          if (l.kind !== "geojson" || !l.file) continue;
          if (!manifest.layers[l.id]?.present) absent.add(l.id);
        }
        setMissing(absent);
      } catch (err) {
        // Without a manifest we cannot grey anything out, but the map must still
        // work: individual load failures below already degrade gracefully.
        console.warn("data manifest unavailable:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {status !== "ready" && (
        <div className="absolute top-3 left-3 rounded bg-black/70 px-3 py-1.5 text-xs text-[#7d8f9d]">
          {status}
        </div>
      )}
    </div>
  );
}

/**
 * Translate a LayerDef into MapLibre paint layers.
 *
 * Polygons get a fill and an outline, everything else one layer. `minZoom` is
 * pushed onto the layer so the registry's zoom guidance is enforced by the
 * renderer rather than by convention.
 */
function addPaintLayers(
  maplibregl: typeof import("maplibre-gl"),
  map: import("maplibre-gl").Map,
  def: LayerDef,
  kind: GeometryKind,
) {
  const id = `om-${def.id}`;
  const minzoom = def.minZoom ?? 0;

  if (kind === "polygon") {
    map.addLayer({
      id: `${id}-fill`,
      type: "fill",
      source: id,
      minzoom,
      paint: { "fill-color": def.color, "fill-opacity": 0.22 },
    });
    map.addLayer({
      id: `${id}-line`,
      type: "line",
      source: id,
      minzoom,
      paint: { "line-color": def.color, "line-width": 1.2, "line-opacity": 0.85 },
    });
    return;
  }

  if (kind === "line") {
    map.addLayer({
      id: `${id}-line`,
      type: "line",
      source: id,
      minzoom,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": def.color,
        "line-width": ["interpolate", ["linear"], ["zoom"], minzoom, 1.2, 16, 3.5],
        "line-opacity": 0.9,
        ...(def.dashed ? { "line-dasharray": [3, 2] } : {}),
      },
    });
    return;
  }

  // Points. Label the toponyms, because a gazetteer with no labels is just dots.
  const isLabels = def.id === "toponyms";
  if (isLabels) {
    map.addLayer({
      id: `${id}-circle`,
      type: "circle",
      source: id,
      minzoom,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], minzoom, 1.6, 16, 4],
        "circle-color": def.color,
        "circle-opacity": 0.75,
      },
    });
    map.addLayer({
      id: `${id}-symbol`,
      type: "symbol",
      source: id,
      minzoom,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], minzoom, 10, 16, 14],
        "text-offset": [0, 0.9],
        "text-anchor": "top",
        // Features arrive sorted by significance, so MapLibre's own collision
        // handling keeps the important names on screen at low zoom.
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#e8f1f7",
        "text-halo-color": "#0b0f14",
        "text-halo-width": 1.4,
      },
    });
    return;
  }

  map.addLayer({
    id: `${id}-circle`,
    type: "circle",
    source: id,
    minzoom,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], minzoom, 3, 16, 7],
      "circle-color": def.color,
      "circle-opacity": 0.9,
      "circle-stroke-color": "#0b0f14",
      "circle-stroke-width": 1,
    },
  });
}