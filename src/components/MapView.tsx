"use client";

/**
 * The MapLibre view - main component.
 *
 * This is now a thin orchestrator that delegates to specialized modules:
 * - map-style: basemap definitions and style creation
 * - map-layers: static GeoJSON layer sync
 * - map-live: live feed polling
 * - map-navigation: navigation host integration
 * - map-interactions: click, mousemove, fly-to handlers
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { LayerDef } from "@/lib/types";
import { installPbfGuard } from "@/lib/pbf-guard";
import { createNavigationIntegration } from "@/lib/map-navigation";
import {
  createInitialStyle,
  applyTerrain,

  BASEMAPS,
  type BasemapId,
  INITIAL_CENTRE,
  INITIAL_ZOOM,
} from "@/lib/map-style";
import { syncStaticLayers } from "@/lib/map-layers";
import {
  startLivePolls,
  stopAllLivePolls,
  resyncLiveLayers,
  type FeedErrorSetter,
} from "@/lib/map-live";
import { attachMapInteractions, attachWebGLHandlers, setMapLibreWorkerUrl } from "@/lib/map-interactions";
import { type NavigationState } from "@/lib/navigation/host";
import { AttributionControl, Map as MapLibreMap } from "maplibre-gl";

export interface PickedFeature {
  layer: LayerDef;
  properties: Record<string, unknown> | null;
  lon: number;
  lat: number;
  /** When the layer's source data was generated, for the details card. */
  asOf?: string;
}

export function MapView({
  layers,
  enabled,
  basemap,
  onPick,
  onMissing,
  onFeedErrors,
  onViewport,
  onNav,
  onMapReady,
  insetBottom = 0,
  mobileBottomInset = 0,
  terrain3d = false,
}: {
  layers: LayerDef[];
  enabled: Set<string>;
  basemap: BasemapId;
  onPick: (picked: { layer: LayerDef; properties: Record<string, unknown> | null; lon: number; lat: number; asOf?: string } | null) => void;
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
  /** Navigation state (GPS dot, dropped destination, route), published by the host. */
  onNav?: (state: NavigationState) => void;
  /** Called when the MapLibre instance is created and ready. */
  onMapReady?: (map: MapLibreMap) => void;
  /**
   * Pixels of the map's bottom edge covered by an overlay (the destination /
   * turn-by-turn sheet). Fed straight into MapLibre's persistent padding so
   * fit/fly/follow all keep the user marker and the active route above it.
   */
  insetBottom?: number;
  /**
   * Extra bottom padding for mobile (e.g., floating tab bar height) so
   * attribution and map controls stay visible above it.
   */
  mobileBottomInset?: number;
  /** Whether 3D terrain is on. Re-applied after a basemap style swap. */
  terrain3d?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [feedErrors, setFeedErrors] = useState<Record<string, string>>({});

  // Navigation integration
  const navIntegrationRef = useRef<ReturnType<typeof createNavigationIntegration> | null>(null);
  if (!navIntegrationRef.current) {
    navIntegrationRef.current = createNavigationIntegration();
  }

  // Refs for live-layer polling
  const enabledRef = useRef(enabled);
  const layersRef = useRef(layers);
  const onPickRef = useRef(onPick);
  const onViewportRef = useRef(onViewport);
  const onNavRef = useRef(onNav);
  /**
   * Shared between the navigation host (which stamps it on a long-press that
   * drops a pin) and the click handler (which swallows the next click until it
   * passes). Two separate objects would look like two separate long-presses.
   */
  const suppressClickUntilRef = useRef<{ current: number }>({ current: 0 });
  /**
   * The loaded/missing state as a ref, so an in-flight layer load can re-read
   * it after its await. State alone is a snapshot of the render that started
   * the fetch, which is precisely the stale value that makes a late load
   * re-add a layer the user has since switched off.
   */
  const missingRef = useRef<Set<string>>(new Set());
  const layerAsOfRef = useRef<Map<string, string>>(new Map());
  /** Latest terrain flag, so the mount-time load handler reads the current value. */
  const terrain3dRef = useRef(terrain3d);

  useEffect(() => {
    enabledRef.current = enabled;
    layersRef.current = layers;
    onPickRef.current = onPick;
    onViewportRef.current = onViewport;
    onNavRef.current = onNav;
    missingRef.current = missing;
    terrain3dRef.current = terrain3d;
  }, [enabled, layers, onPick, onViewport, onNav, missing, terrain3d]);

  // Report a single layer's load outcome. Updates the ref immediately as well
  // as the state, so a sync that finishes while this is in flight sees it.
  const reportMissing = useCallback((id: string, isMissing: boolean) => {
    const prev = missingRef.current;
    if (prev.has(id) === isMissing) return;
    const next = new Set(prev);
    if (isMissing) next.add(id);
    else next.delete(id);
    missingRef.current = next;
    setMissing(next);
  }, []);

  const reportAsOf = useCallback((id: string, asOf: string | undefined) => {
    if (typeof asOf === "string") layerAsOfRef.current.set(id, asOf);
    else layerAsOfRef.current.delete(id);
  }, []);

  // Set the feed error for a single layer
  const setFeedError: FeedErrorSetter = useCallback((id: string, message: string | null) => {
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
  }, []);

  // Keep the latest feed errors synced to the panel
  useEffect(() => {
    onFeedErrors?.(feedErrors);
  }, [feedErrors, onFeedErrors]);

  // Sync static layers when visibility changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    void syncStaticLayers(map, layers, {
      enabledRef,
      missingRef,
      onMissing: reportMissing,
      onAsOf: reportAsOf,
    });
  }, [enabled, missing, layers, reportMissing, reportAsOf]);

  // Live feed polls - start/retire as enabled layers change. No cleanup here:
  // startLivePolls retires the pollers it no longer wants, and the mount
  // effect owns teardown, so a static-layer toggle does not stop and restart
  // every live feed.
  useEffect(() => {
    if (!mapRef.current || !readyRef.current) return;
    startLivePolls(enabledRef, layersRef, mapRef, setFeedError);
  }, [enabled, setFeedError]);

  // React to basemap changes. The style basemap is loaded by URL; the
  // "style.load" event handler runs the post-swap resync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const bm = BASEMAPS[basemap];
    map.setStyle(bm.styleUrl, { diff: false });
    map.setMaxZoom(bm.maxzoom);
  }, [basemap]);

  // React to the 3D terrain toggle. The map 'load' handler applies the initial
  // value; this only has to handle changes made after the map is ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyTerrain(map, terrain3d);
  }, [terrain3d]);

  // Keep the overlay sheet clear of the route
  // Base 24px keeps attribution visible on all screen sizes; mobileBottomInset
  // adds extra space for the floating tab bar on mobile.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setPadding({
      top: 0,
      bottom: 24 + insetBottom + mobileBottomInset,
      left: 0,
      right: 0,
    });
  }, [insetBottom, mobileBottomInset]);

  // ---- create the map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initMap = async () => {
      // Defence-in-depth for the tile pipeline: validate protobuf responses
      // before MapLibre's decoder loop ever sees their bytes.
      installPbfGuard();

      const bm = BASEMAPS[basemap];

      // Deep links carry ?z=&lon=&lat=; honour them when they are present and
      // sane. Read here, in the effect (never during render), so the URL cannot
      // break server-side prerender - this path only runs in the browser.
      let initialView: { center: [number, number]; zoom: number } | null = null;
      if (typeof window !== "undefined") {
        const p = new URLSearchParams(window.location.search);
        if (p.has("z") && p.has("lon") && p.has("lat")) {
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
      }

      // Set MapLibre worker URL before creating the map
      await setMapLibreWorkerUrl();

      const initialStyle = createInitialStyle(bm);

      const map = new MapLibreMap({
        container: containerRef.current!,
        center: initialView?.center ?? INITIAL_CENTRE,
        zoom: initialView?.zoom ?? INITIAL_ZOOM,
        minZoom: 8,
        maxZoom: bm.maxzoom,
        // Attribution is added manually at "top-left" below. The default
        // bottom-right slot sits underneath the floating tab bar, and CSS
        // cannot move a control between corners.
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
        style: initialStyle,
      });

      // Publish the instance before anything else. Every update effect below -
      // layer visibility, basemap swap, terrain, padding, live polls - gates on
      // mapRef.current; without this assignment they all silently no-op and the
      // map looks frozen at its first render.
      mapRef.current = map;

      // Collapsible attribution, top-left: compact: true collapses the
      // attribution text into a toggleable "i" button (via a <details> element),
      // expanded on click. Still clear of the bottom tab bar and destination sheet.
      map.addControl(
        new AttributionControl({
          compact: true,
          customAttribution: "",
        }),
        "top-left",
      );

      map.addControl(new (await import("maplibre-gl")).NavigationControl({ visualizePitch: false, showZoom: false }), "top-right");

      // Error handler
      map.on("error", (e) => {
        const tt = e as unknown as {
          error?: Error;
          sourceId?: string;
          tile?: { tileID?: { canonical: { z: number; x: number; y: number } } };
        };
        const tile = tt.tile?.tileID?.canonical;
        const stack = (tt.error && 'stack' in tt.error ? String((tt.error as Error).stack) : "")
          .split("\n").slice(0, 3).join(" | ");
        console.warn(
          "[map] " +
            String(tt.error?.message ?? e) +
            " " + (tt.sourceId ?? "") + " " + (tile ? `z${tile.z}/${tile.x}/${tile.y}` : "") +
            " :: " + stack,
        );
      });

      map.on("load", () => {
        readyRef.current = true;
        if (terrain3dRef.current) applyTerrain(map, true);

        void syncStaticLayers(map, layersRef.current, {
          enabledRef,
          missingRef,
          onMissing: reportMissing,
          onAsOf: reportAsOf,
        });
        startLivePolls(enabledRef, layersRef, mapRef, setFeedError);
        // Notify parent that the map is ready
        onMapReady?.(map);
        // E2E hook: the verify/smoke scripts inspect layer order through this
        // handle (scripts/verify-basemap.mjs, scripts/smoke-live.mjs).
        (window as unknown as { __openmanninMap?: MapLibreMap }).__openmanninMap = map;
      });

      map.on("style.load", () => {
        if (!readyRef.current) return;
        // A style swap (OpenFreeMap liberty et al.) drops every source we
        // added. Re-add the static layers, the cached live feeds, and the
        // navigation host's own markers/route, in that order, so the map comes
        // back looking the same rather than empty-but-for-the-basemap.
        void resyncAfterStyleChange(map);
      });

      // Initialize navigation integration
      navIntegrationRef.current!.attach(map, onNavRef.current ?? (() => {}), suppressClickUntilRef.current);

      // Attach interaction handlers
      const cleanupInteractions = attachMapInteractions(map, layersRef, onPickRef, onViewportRef, suppressClickUntilRef.current, layerAsOfRef);
      const cleanupWebGL = attachWebGLHandlers(map);

      // Rebuild everything a style swap tears down, from cached data.
      async function resyncAfterStyleChange(m: MapLibreMap) {
        // A style swap drops the DEM source too; restore terrain before the
        // data layers so the map does not briefly render flat then pop up.
        if (terrain3dRef.current) applyTerrain(m, true);

        await syncStaticLayers(m, layersRef.current, {
          enabledRef,
          missingRef,
          onMissing: reportMissing,
          onAsOf: reportAsOf,
        });
        await resyncLiveLayers(m, layersRef.current, enabledRef.current);
        navIntegrationRef.current?.rehydrate(m);
      }

      // Cleanup function
      return () => {
        stopAllLivePolls(map);
        cleanupInteractions();
        cleanupWebGL();
        navIntegrationRef.current?.detach();
        map.remove();
        mapRef.current = null;
        readyRef.current = false;
      };
    };

    initMap().catch(console.error);
    // Intentionally mount-only. The initial basemap is read once, and later
    // basemap changes are handled by the switch effect above; depending on
    // `basemap` here would run this effect's cleanup (map.remove()) on every
    // basemap change and tear the map down. The callbacks passed in are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hand the missing set up so the layer panel can grey those rows out
  useEffect(() => {
    onMissing?.(missing);
  }, [missing, onMissing]);

  return (
    <div ref={containerRef} className="relative h-full w-full" />
  );
}

export type { BasemapId, BasemapDef } from "@/lib/map-style";
export type { NavigationState } from "@/lib/navigation/host";