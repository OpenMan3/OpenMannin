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
import {
  geometryKindsOf,
  loadLayer,
  type FeatureCollection,
  type GeometryKind,
} from "@/lib/layer-data";
import { fetchFeed, FEEDS_ON_HOLD, ON_HOLD_REASON } from "@/lib/feeds";
import { nextPollDelayMs } from "@/lib/feeds/backoff";
import { installPbfGuard } from "@/lib/pbf-guard";

export interface PickedFeature {
  layer: LayerDef;
  properties: Record<string, unknown> | null;
  lon: number;
  lat: number;
  /** When the layer's source data was generated, for the details card. */
  asOf?: string;
}

export type BasemapId = "esri" | "opentopo";

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
  opentopo: {
    // Direct, not proxied. OpenTopoMap serves `access-control-allow-origin: *`
    // on its raster tiles - verified by request against a.tile.opentopomap.org
    // with a foreign Origin header - so MapLibre can load it cross-origin and
    // the tile proxy has nothing left to do.
    //
    // The proxy existed to work around a CORS header that is in fact present.
    // That was a wrong reading of an earlier probe, and it cost a server route,
    // a bandwidth bill and a class of silent failure. Subdomains are cycled
    // because OpenTopoMap rate-limits per host.
    tiles: [
      "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
    ],
    attribution:
      "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap (CC-BY-SA)",
    maxzoom: 17,
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
  onFeedErrors,
  onViewport,
}: {
  layers: LayerDef[];
  enabled: Set<string>;
  basemap: BasemapId;
  onPick: (picked: PickedFeature | null) => void;
  /** Reports layers the registry lists but public/data does not have. */
  onMissing?: (missing: Set<string>) => void;
  /**
   * Reports live layers that are failing, keyed by layer id. A feed that
   * requires a licence you do not have is the single most confusing thing this
   * app can do, and it is invisible on the map: an empty layer and a working
   * one look identical.
   */
  onFeedErrors?: (errors: Record<string, string>) => void;
  /** Reports the visible map centre and zoom after each move, for deep links. */
  onViewport?: (v: { lon: number; lat: number; zoom: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const readyRef = useRef(false);
  const [status, setStatus] = useState<string>("loading map…");
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [feedErrors, setFeedErrors] = useState<Record<string, string>>({});

  /**
   * Set or clear one layer's badge, returning the SAME object when nothing
   * changed.
   *
   * These run every 30 s per live layer, and the previous `{ ...prev, [id] }`
   * pattern allocated a fresh object even for an identical message - which
   * re-rendered MapView, the page and the layer panel in a chain, forever, for
   * a badge that had not moved.
   */
  const setFeedError = (id: string, message: string | null): void => {
    setFeedErrors((prev) => {
      const current = prev[id];
      if (message === null) {
        if (current === undefined) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (current === message) return prev;
      return { ...prev, [id]: message };
    });
  };
  /**
   * Bumped once the map finishes loading. The live-layer effect below must not
   * run before the map exists, but it also cannot depend on `readyRef` (a ref
   * change does not re-render), so this counter is the signal that makes the
   * effect re-run at exactly the right moment.
   */
  const [liveReady, setLiveReady] = useState(0);

  // Keep the latest values reachable from the map event handlers without
  // re-registering listeners on every render.
  //
  // Assigned in an EFFECT, not in the render body. Writing a ref during render
  // publishes state from a render that React may later discard (concurrent
  // rendering, StrictMode double-invoke), which means the map's handlers can
  // read a value belonging to a version of the UI that never happened. The
  // effect runs before any user event can fire, so the ref is never stale when
  // it is read.
  const enabledRef = useRef(enabled);
  const layersRef = useRef(layers);
  const onPickRef = useRef(onPick);
  const onViewportRef = useRef(onViewport);
  useEffect(() => {
    enabledRef.current = enabled;
    layersRef.current = layers;
    onPickRef.current = onPick;
    onViewportRef.current = onViewport;
  }, [enabled, layers, onPick, onViewport]);

  /** `generated` stamp of each loaded layer's source, for the details card. */
  const layerAsOfRef = useRef<Map<string, string>>(new Map());

  /** The maplibre-gl module, captured at map creation for the live effect. */
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  /** Poller interval per live layer id. Presence in this map == "running". */
  const liveRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pollFailuresRef = useRef<Map<string, number>>(new Map());
  /** Layer ids with a request already in flight, to stop requests stacking. */
  const inFlightRef = useRef<Set<string>>(new Set());

  // Populated by the mount effect, called by the effects that react to
  // visibility and basemap changes. A ref rather than a map property so the
  // map object is never cast to an anonymous shape.
  const syncRef = useRef<(() => Promise<void>) | null>(null);
  /** The `openmannin:fly-to` listener, held so cleanup can detach it. */
  const flyToRef = useRef<((e: Event) => void) | null>(null);
  /** The `openmannin:highlight-feature` listener, held for the same reason. */
  const highlightRef = useRef<((e: Event) => void) | null>(null);
  /** Which basemap the current map object was last built or switched to. */
  const appliedBasemapRef = useRef<string | null>(null);

  // ---- create the map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      // Defence-in-depth for the tile pipeline: validate protobuf responses
      // before MapLibre's decoder loop ever sees their bytes.
      installPbfGuard();
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

      // Deep links carry ?z=&lon=&lat=; honour them when they are present and
      // sane. Read here, in the effect (never during render), so the URL cannot
      // break server-side prerender - this path only runs in the browser.
      let initialView: { center: [number, number]; zoom: number } | null = null;
      if (typeof window !== "undefined") {
        const p = new URLSearchParams(window.location.search);
        const z = Number(p.get("z"));
        const lon = Number(p.get("lon"));
        const lat = Number(p.get("lat"));
        const sane = [z, lon, lat].every(
          (v) => Number.isFinite(v) && (v === 0 || Math.abs(v) < 1e3),
        );
        if (sane && isFinite(z)) {
          const clamped = Math.min(Math.max(z, 8), bm.maxzoom);
          initialView = { center: [lon, lat] as [number, number], zoom: clamped };
        }
      }

      const map = new maplibregl.Map({
        container: containerRef.current,
        center: initialView?.center ?? INITIAL_CENTRE,
        zoom: initialView?.zoom ?? INITIAL_ZOOM,
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

      // The initial style already carries this basemap, so the switch effect
      // must not tear it down and rebuild it the moment the map reports ready.
      appliedBasemapRef.current = basemap;

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      map.addControl(
        new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }),
        "bottom-left",
      );

      // Tile, glyph and worker failures surface here rather than as thrown
      // exceptions, so without this listener they are invisible to the UI and
      // only ever seen in a console nobody has open. Logged, not fatal: a
      // single bad tile must not stop the map.
      map.on("error", (e) => {
        console.warn("[map]", e?.error?.message ?? e);
      });

      map.on("load", () => {
        readyRef.current = true;
        setStatus("ready");
        void syncLayers();
        // Re-render so the live-layer effect below re-runs now that the map is
        // genuinely usable. It has to happen HERE, on the load event, and not
        // where the Map is constructed: constructing the Map object and the map
        // being ready are different moments, and readyRef is still false when
        // the constructor returns. Signalling from the constructor therefore
        // made the live effect run once, early-return on `!readyRef.current`,
        // and never run again - so no default-on live layer ever started
        // polling and the page made no feed requests at all.
        setLiveReady((n) => n + 1);
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
            asOf: layerAsOfRef.current.get(layer.id),
          });
          return;
        }
        onPickRef.current(null);
      });

      // Publish the visible centre + zoom after each move so the page can keep
      // the URL in sync for shareable map links.
      map.on("moveend", () => {
        const c = map.getCenter();
        onViewportRef.current?.({
          lon: c.lng,
          lat: c.lat,
          zoom: map.getZoom(),
        });
      });

      // Show the cursor only over something we actually drew.
      //
      // Throttled to one query per animation frame. `queryRenderedFeatures`
      // walks every rendered feature layer - `roads` alone is 3,391 features -
      // and pointermove fires many times per frame during a pan, so running it
      // unthrottled was a measurable cost paid purely to toggle a cursor.
      let cursorFrame = 0;
      map.on("mousemove", (e: import("maplibre-gl").MapMouseEvent) => {
        if (cursorFrame) return;
        const { point } = e;
        cursorFrame = requestAnimationFrame(() => {
          cursorFrame = 0;
          // The map may have been torn down while the frame was pending.
          if (mapRef.current !== map) return;
          const hits = map.queryRenderedFeatures(point);
          const ours = hits.some(
            (h) => layerByMapLayerId(h.layer.id, layersRef.current) !== undefined,
          );
          map.getCanvas().style.cursor = ours ? "pointer" : "";
        });
      });

      mapRef.current = map;

      // Debug handle. Layer paint order is the kind of bug that is invisible
      // to any check which only asks "does this layer exist" - an opaque raster
      // basemap appended on top leaves every data layer present but hidden - so
      // scripts/verify-basemap.mjs asserts against real style order via this.
      // Named so it is obviously a debug surface rather than app state.
      (window as unknown as { __openmanninMap?: unknown }).__openmanninMap = map;

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
      // Detached in cleanup. An orphaned listener outlives the map it closes
      // over, so a dispatch after unmount - including React StrictMode's
      // double-mount in dev - called `flyTo` on a removed Map.
      flyToRef.current = onFlyTo;

      // The FeatureBrowser "cycle" tool asks the map to point at a specific
      // feature without going through the click path. A temporary marker on top
      // of every data layer keeps the step visible no matter what is enabled
      // underneath - stepping through a dense layer is exactly the case where
      // the feature is NOT otherwise identifiable.
      const onHighlight = (e: Event) => {
        const { geometry } = (e as CustomEvent).detail as { geometry?: unknown };
        if (!geometry) return;
        sinkHighlight(map, geometry as never);
      };
      window.addEventListener("openmannin:highlight-feature", onHighlight);
      highlightRef.current = onHighlight;

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
            layerAsOfRef.current.delete(def.id);
            continue;
          }

          try {
            const fc = await loadLayer(def.file);
            // The fetch can outlast a toggle. Without this re-check a layer
            // switched off mid-load still gets added, and nothing removes it
            // until the user toggles it on and off again - so the map paints a
            // layer the panel is simultaneously reporting as off.
            if (!enabledRef.current.has(def.id)) continue;
            const m = mapRef.current;
            if (m && !m.getSource(`om-${def.id}`)) {
              m.addSource(`om-${def.id}`, { type: "geojson", data: fc as never });
              addPaintLayers(maplibregl, m, def, geometryKindsOf(fc));
            }
            const asOf = fc.properties?.generated;
            if (typeof asOf === "string") layerAsOfRef.current.set(def.id, asOf);
            // Success clears an earlier failure. `missing` is otherwise
            // append-only, so one blip kept a layer greyed out as "no data"
            // for the rest of the session even after it loaded fine.
            setMissing((prev) => {
              if (!prev.has(def.id)) return prev;
              const next = new Set(prev);
              next.delete(def.id);
              return next;
            });
          } catch {
            // A layer the registry lists but public/data does not have must not
            // take the map down. Record it and let the panel grey it out.
            setMissing((prev) => new Set(prev).add(def.id));
          }
        }
      }
      syncRef.current = syncLayers;
      void syncLayers();

      // Live layers are NOT started here. They are driven by the reactive
      // effect below, which is keyed on `enabled`, so that toggling one on
      // after load actually starts it. See the note on that effect.
      //
      // Note there is deliberately no setLiveReady() call here: the map is not
      // usable yet. The signal is raised from the "load" handler instead.
      libRef.current = maplibregl;
    })().catch((e: unknown) => {
      // Without this, a failure anywhere in initialisation - the pbf guard, the
      // dynamic import, the CSS import, the constructor - surfaced as an
      // unhandled rejection and the status badge sat on "loading map…"
      // forever, which is indistinguishable from a slow network.
      console.error("[map] failed to initialise:", e);
      if (!cancelled) setStatus(`map failed: ${(e as Error)?.message ?? "unknown error"}`);
    });

    return () => {
      cancelled = true;
      for (const [, timer] of liveRef.current) clearTimeout(timer);
      liveRef.current.clear();
      pollFailuresRef.current.clear();
      syncRef.current = null;
      if (flyToRef.current) window.removeEventListener("openmannin:fly-to", flyToRef.current);
      flyToRef.current = null;
      if (highlightRef.current) window.removeEventListener("openmannin:highlight-feature", highlightRef.current);
      highlightRef.current = null;
      appliedBasemapRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      libRef.current = null;
      readyRef.current = false;
    };
    // Intentionally mount-only: layer changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- live layers ---------------------------------------------------------
  // Static layers are fetched once. Live layers are POLLED, because a bus, a
  // vessel or an aircraft moves and a snapshot would be a lie within the
  // minute. Where each feed runs - browser or server - is resolved inside
  // fetchFeed (see src/lib/feeds); this component only cares about the answer.
  //
  // WHY THIS IS A REACTIVE EFFECT AND NOT PART OF THE MOUNT EFFECT. It used to
  // live inside the mount-only effect above, which read the enabled set once at
  // mount and registered a timer per already-enabled live layer. Two things
  // followed from that, and both look like "the live layers are broken":
  //
  //   1. A live layer switched on AFTER load never started polling, and
  //      syncLayers() skips it too (it only handles kind === "geojson"), so it
  //      was never added to the map at all. Permanently invisible.
  //   2. A live layer switched OFF kept its timer running and kept painting,
  //      because nothing ever cleared it. The checkbox and the map disagreed.
  //
  // Driving it from `enabled` fixes both, and makes the poller's lifetime match
  // the layer's visibility rather than the component's.
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = libRef.current;
    if (!map || !maplibregl || !readyRef.current) return;

    // Feeds on hold are stripped out of the poll set: no interval, no
    // request, no console noise. They still show up in the panel as badged
    // (feedErrors below) so a switched-on held layer says "on hold" rather
    // than looking like an empty live feed.
    const wanted = new Set(
      layers
        .filter((d) => d.kind === "live" && d.endpoint && enabled.has(d.id) && !FEEDS_ON_HOLD.has(d.id))
        .map((d) => d.id),
    );

    // Seed (and prune) the on-hold entries in feedErrors, using the latest
    // enabled set. This runs in the same effect as the pollers, so the badge
    // appears for a held layer the moment it is switched on.
    setFeedErrors((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of FEEDS_ON_HOLD) {
        const isLiveHere = layersRef.current.some((l) => l.id === id && l.kind === "live");
        const on = isLiveHere && enabled.has(id);
        const want = on ? `503: ${ON_HOLD_REASON}` : undefined;
        if (want && next[id] !== want) {
          next[id] = want;
          changed = true;
        } else if (!want && id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    // Retire pollers for layers that are no longer wanted, and take their
    // source off the map. Leaving the source behind would keep the last set of
    // positions frozen on screen, which is the worst possible outcome: it looks
    // live and is not.
    for (const [id, timer] of [...liveRef.current]) {
      if (wanted.has(id)) continue;
      clearTimeout(timer);
      liveRef.current.delete(id);
      inFlightRef.current.delete(id);
      pollFailuresRef.current.delete(id);

      // Drop the badge with the poller. Nothing else will: polling has stopped,
      // so the success path that normally clears a stale error never runs again,
      // and the panel badges a layer the user switched OFF as "feed offline"
      // until the page is reloaded. Only ids that had a poller are here, so the
      // on-hold badges seeded above are untouched.
      setFeedError(id, null);

      const sourceId = `om-${id}`;
      for (const suffix of ["fill", "line", "circle", "symbol"]) {
        const layerId = layerIdFor(id, suffix);
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }

    // Start a poller for each newly wanted layer. The registry guarantees one
    // poller per id, so this cannot double up across re-renders.
    for (const id of wanted) {
      if (liveRef.current.has(id)) continue;
      const def = layers.find((d) => d.id === id);
      // `endpoint` marks this as a live feed. It is no longer the URL to fetch:
      // where a feed runs - browser or server - is resolved inside fetchFeed.
      // See src/lib/feeds.
      if (!def?.endpoint) continue;

      const poll = async (id: string) => {
        const current = mapRef.current;
        if (!current || !readyRef.current || !enabledRef.current.has(id)) return;

        // One request in flight per layer. The satellite pass computation runs
        // SGP4 over a 48-hour window for every crewed TLE and can outlast the
        // poll interval; without
        // this guard a slow response stacks requests until the tab falls over.
        if (inFlightRef.current.has(id)) return;
        inFlightRef.current.add(id);

        // A poll that returns healthy resets the failure streak; anything else
        // counts one against this feed and the next attempt is scheduled further
        // out (see backoff.ts). A 429 or an outage therefore stops hurting the
        // upstream after a few rounds, and self-heals the moment one call works.
        let healthy = true;

        try {
          // fetchFeed hides where this runs. The map does not care; the panel
          // reports the outcome.
          const result = await fetchFeed(id);

          // The layer may have been switched off while the request was in the
          // air. Painting anyway would put positions on the map that the panel
          // says are hidden - and the retire loop has already run, so no later
          // pass would remove them. Bail before touching the map or the badge.
          if (!enabledRef.current.has(id)) return;

          // A feed that refuses to run (no credentials, upstream down, function
          // not deployed) answers with a typed failure, not a FeatureCollection.
          // Say so rather than painting an empty source that looks like "nothing
          // is happening right now".
          if (!result.ok) {
            healthy = false;
            setFeedError(id, `${result.status}: ${result.reason}`);
            // `not-enabled` is a CONFIGURATION state, not a fault: the feed is
            // refusing to run because a permission has not been granted, which
            // is the correct behaviour until someone grants it. The layer panel
            // badges it. Warning about it here would put four lines in the
            // console every 30 seconds for a deploy that is working exactly as
            // designed, and would drown the warnings that matter. Anything else
            // - an upstream outage, a bad token, a missing function - is a real
            // fault and gets logged.
            if (result.error !== "not-enabled") {
              console.warn(`[live] ${id} unavailable (${result.status}):`, result.reason);
            }
            return;
          }
          // fetchFeed returns whatever the upstream produced, so the shape is only
          // known at runtime; the `features` guard above is what makes it usable.
          const fc = result.fc as FeatureCollection;
          if (!fc?.features) {
            // A malformed collection is a failure, not "nothing overhead".
            // Returning silently here is what made an upstream schema change
            // indistinguishable from a quiet sky.
            healthy = false;
            setFeedError(id, "502: upstream returned an unusable collection");
            console.warn(`[live] ${id} returned an unusable collection`);
            return;
          }

          // A stale answer is still worth showing, but it must be visible: the
          // feed served a cache because the network failed.
          if (result.stale) {
            setFeedError(id, "stale: cached copy, upstream unreachable");
          } else {
            setFeedError(id, null);
          }

          const sourceId = `om-${id}`;
          // Test for the SOURCE, not for a `-circle` layer. The old check only
          // matched point layers, so a live layer that came back as a line or a
          // polygon re-ran addSource on every poll and threw "source already
          // exists" into the console forever.
          const existing = current.getSource(sourceId) as
            | import("maplibre-gl").GeoJSONSource
            | undefined;
          if (existing) {
            existing.setData(fc as never);
            return;
          }
          current.addSource(sourceId, { type: "geojson", data: fc as never });
          addPaintLayers(maplibregl, current, def, geometryKindsOf(fc));
        } catch (e) {
          healthy = false;
          if (enabledRef.current.has(id)) {
            setFeedError(id, (e as Error).message);
          }
          console.warn(`[live] ${id} poll failed:`, (e as Error).message);
        } finally {
          inFlightRef.current.delete(id);
          // Retired while the request was in the air: the retire loop has
          // already cleared what it needs to, so no new timer for this layer.
          if (!enabledRef.current.has(id)) return;
          pollFailuresRef.current.set(
            id,
            healthy ? 0 : (pollFailuresRef.current.get(id) ?? 0) + 1,
          );
          const delay = nextPollDelayMs(pollFailuresRef.current.get(id) ?? 0);
          liveRef.current.set(id, setTimeout(() => void poll(id), delay));
        }
      };

      pollFailuresRef.current.set(id, 0);
      void poll(id);
    }
  }, [enabled, layers, liveReady]);

  // Hand the missing set up so the layer panel can grey those rows out.
  useEffect(() => {
    onMissing?.(missing);
  }, [missing, onMissing]);

  // Same idea for live feeds: a layer that is switched on but failing must say
  // so in the panel, because nothing about it is visible on the map.
  useEffect(() => {
    onFeedErrors?.(feedErrors);
  }, [feedErrors, onFeedErrors]);

  // ---- react to layer visibility changes -----------------------------------
  useEffect(() => {
    void syncRef.current?.();
  }, [enabled]);

  // ---- react to basemap changes --------------------------------------------
  // `liveReady` is in the deps deliberately. The first run of this effect
  // happens before the map finishes loading and bails out, so a switch made in
  // that first second was silently dropped - the selector said OpenTopoMap
  // while Esri imagery stayed on screen, and no later run ever corrected it
  // because `basemap` had not changed again. Re-running on load picks the
  // current value up; `appliedBasemapRef` keeps that re-run from tearing down
  // and rebuilding an already-correct source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const bm = BASEMAPS[basemap];
    if (appliedBasemapRef.current === basemap && map.getLayer("basemap")) return;

    // The raster source has to be REPLACED, not retargeted. Attribution in
    // MapLibre is a property of the source in the style, and setTiles() keeps
    // the original attribution - so switching basemaps that way leaves the
    // control crediting Esri while OpenTopoMap's CC-BY-SA tiles are on screen.
    // That is a licence-compliance bug, not a cosmetic one.
    if (map.getLayer("basemap")) map.removeLayer("basemap");
    if (map.getSource("basemap")) map.removeSource("basemap");

    map.addSource("basemap", {
      type: "raster",
      tiles: bm.tiles,
      tileSize: 256,
      attribution: bm.attribution,
    });

    // The basemap MUST be re-inserted at the bottom of the layer stack.
    // addLayer without a beforeId appends to the end, which would drop an
    // opaque raster layer on top of every data layer and make the whole map
    // look empty - and because the effect runs on both directions of the
    // switch, swapping back would not recover it either. Only a refresh
    // rebuilt the style with the basemap first, which is exactly the "it
    // fixes itself if I reload" symptom.
    const firstDataLayer = map
      .getStyle()
      .layers?.find((l) => l.id.startsWith("om-"))?.id;
    map.addLayer(
      { id: "basemap", type: "raster", source: "basemap" },
      // Sit directly above the background and below everything we drew.
      firstDataLayer ?? (map.getLayer("background") ? "background" : undefined),
    );

    map.setMaxZoom(bm.maxzoom);
    appliedBasemapRef.current = basemap;
    void syncRef.current?.();
  }, [basemap, liveReady]);

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
        // MERGE, do not replace. `setMissing(absent)` overwrote whatever had
        // accumulated, and a load failure recorded by syncLayers between the
        // fetch starting and this line landing was erased - so a layer whose
        // file genuinely failed to load stopped being greyed out.
        setMissing((prev) => {
          if (absent.size === 0) return prev;
          const next = new Set(prev);
          for (const id of absent) next.add(id);
          return next;
        });
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
 * ONE PAINT LAYER PER GEOMETRY KIND PRESENT IN THE COLLECTION. The previous
 * version picked a single kind from the first feature and registered only
 * that, so in a mixed collection everything else was dropped on the floor:
 * `circle` draws no polygons, `fill` draws no points. A layer may legitimately
 * mix kinds (the TT course is points, lines and polygons in one file), so all
 * present kinds are registered and MapLibre itself skips features that do not
 * match a layer's type.
 *
 * `minZoom` is pushed onto each layer so the registry's zoom guidance is
 * enforced by the renderer rather than by convention.
 */
function addPaintLayers(
  maplibregl: typeof import("maplibre-gl"),
  map: import("maplibre-gl").Map,
  def: LayerDef,
  kinds: ReadonlySet<GeometryKind>,
) {
  const id = `om-${def.id}`;
  const minzoom = def.minZoom ?? 0;

  if (kinds.has("polygon")) {
    map.addLayer({
      id: `${id}-fill`,
      type: "fill",
      source: id,
      minzoom,
      paint: { "fill-color": def.color, "fill-opacity": 0.22 },
    });
  }

  // Exactly ONE line layer, covering both jobs: outlining polygon features and
  // drawing LineStrings. Two layers would need two ids, which would break the
  // id grammar the click handler and the retire loop parse. When the
  // collection has real lines the richer paint is used (it reads well as an
  // outline too); a polygon-only collection keeps the flat 1.2px outline it
  // has always had.
  if (kinds.has("polygon") || kinds.has("line")) {
    const outlineOnly = !kinds.has("line");
    map.addLayer({
      id: `${id}-line`,
      type: "line",
      source: id,
      minzoom,
      ...(outlineOnly
        ? {}
        : { layout: { "line-cap": "round" as const, "line-join": "round" as const } }),
      paint: outlineOnly
        ? { "line-color": def.color, "line-width": 1.2, "line-opacity": 0.85 }
        : {
            "line-color": def.color,
            "line-width": ["interpolate", ["linear"], ["zoom"], minzoom, 1.2, 16, 3.5] as [
              "interpolate",
              ["linear"],
              ["zoom"],
              number,
              number,
              number,
              number,
            ],
            "line-opacity": 0.9,
            ...(def.dashed ? { "line-dasharray": [3, 2] } : {}),
          },
    });
  }

  if (!kinds.has("point")) return;

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
    liftHighlight(map);
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
  liftHighlight(map);
}

/**
 * The amber browse marker, drawn on top of everything.
 *
 * The FeatureBrowser steps through a layer and calls this with each feature's
 * geometry. It is a point ring for a Point (a big, obvious circle at the exact
 * spot) and an outlined translucent fill for a polygon or line, so a building
 * footprint stays recognisable while the layer underneath is what it is.
 */
function sinkHighlight(
  map: import("maplibre-gl").Map,
  geometry: { type: string; coordinates?: unknown },
) {
  const id = HIGHLIGHT_SOURCE;
  // The library types keep Feature minimal (geometry + properties only), so the
  // GeoJSON envelopes are written loose and cast at the only two call sites
  // that the API accepts them.
  const fc: unknown = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry }],
  };

  if (map.getSource(id)) {
    (map.getSource(id) as import("maplibre-gl").GeoJSONSource).setData(fc as never);
    liftHighlight(map);
    return;
  }

  map.addSource(id, { type: "geojson", data: fc as never });
  const point = geometry.type === "Point" || geometry.type === "MultiPoint";
  if (point) {
    map.addLayer({
      id,
      type: "circle",
      source: id,
      paint: {
        "circle-radius": 10,
        "circle-color": "#fbbf24",
        "circle-opacity": 0.95,
        "circle-stroke-color": "#0b0f14",
        "circle-stroke-width": 2,
      },
    });
  } else {
    map.addLayer({
      id: `${id}-fill`,
      type: "fill",
      source: id,
      paint: { "fill-color": "#fbbf24", "fill-opacity": 0.28 },
    });
    map.addLayer({
      id: `${id}-line`,
      type: "line",
      source: id,
      paint: { "line-color": "#fbbf24", "line-width": 2.5, "line-opacity": 0.95 },
    });
  }
}

/**
 * Keep the browse marker above every data layer.
 *
 * MapLibre paints layers in style order (last = top), and our data layers are
 * appended when they are first enabled. If the browse marker already exists
 * when a heavy layer arrives, that layer silently sits on TOP of the marker
 * and the whole point - "here is the feature you are stepping through" - is
 * defeated. moveLayer with no beforeId moves a layer to the end of the stack.
 */
function liftHighlight(map: import("maplibre-gl").Map) {
  for (const layer of [`${HIGHLIGHT_SOURCE}-fill`, `${HIGHLIGHT_SOURCE}-line`, HIGHLIGHT_SOURCE]) {
    if (map.getLayer(layer)) map.moveLayer(layer);
  }
}

const HIGHLIGHT_SOURCE = "om-browse-highlight";