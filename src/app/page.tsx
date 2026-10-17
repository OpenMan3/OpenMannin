"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GAPS, LAYERS } from "@/lib/layers";
import type { PickedFeature } from "@/components/MapView";
import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-page" aria-hidden="true" />,
});
import { LayerPanel } from "@/components/LayerPanel";
import { LayerDetailDrawer } from "@/components/LayerDetailDrawer";
import { FeaturePopup } from "@/components/FeaturePopup";
import { FeatureBrowser } from "@/components/FeatureBrowser";
import { GapsPanel } from "@/components/GapsPanel";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TransparencyPanel } from "@/components/TransparencyPanel";
import { LocateButton } from "@/components/LocateButton";
import { FollowModeButton } from "@/components/FollowModeButton";
import { VoiceButton } from "@/components/VoiceButton";
import { MeasureControl } from "@/components/MeasureControl";
import { MeasurePanel } from "@/components/MeasurePanel";
import { NavigationOverlay } from "@/components/NavigationOverlay";
import { PassWidget } from "@/components/PassWidget";
import { ThemeToggle } from "@/components/ThemeToggle";
import { loadLayer } from "@/lib/layer-data";
import { resolveFeatureLabel } from "@/lib/feature-label";
import {
  formatPickParam,
  formatToParam,
  nearestFeatureProperties,
  parsePickParam,
  parseToParam,
} from "@/lib/deep-link";



import {
  AlertIcon,
  CloseIcon,
  LayersIcon,
  ListIcon,
  MenuIcon,
  ShieldIcon,
} from "@/components/Icons";
import type { NavigationState, FollowMode } from "@/lib/navigation/host";
import type { RouteMode } from "@/lib/navigation/profiles";
import type { LayerDef } from "@/lib/types";
import { createMeasureState, type MeasurePoint } from "@/lib/measure";
import { releaseWakeLock, requestWakeLock } from "@/lib/screen-wake-lock";
import type { Map } from "maplibre-gl";

type Tab = "layers" | "browse" | "gaps" | "sources";

const TABS: { id: Tab; label: string; Icon: (p: { className?: string }) => React.JSX.Element }[] = [
  { id: "layers", label: "Layers", Icon: LayersIcon },
  { id: "browse", label: "Browse", Icon: ListIcon },
  { id: "gaps", label: "Gaps", Icon: AlertIcon },
  { id: "sources", label: "Sources", Icon: ShieldIcon },
];

const ASIDE_MIN = 272;
const ASIDE_MAX = 520;
const ASIDE_DEFAULT = 320;
const ASIDE_KEY = "om:asideWidth";
/** Persisted 3D-terrain preference. */
const TERRAIN_KEY = "om:terrain3d";

export default function Page() {
  return <PageContent />;
}

function PageContent() {
  const [tab, setTab] = useState<Tab>("layers");
  const [picked, setPicked] = useState<PickedFeature | null>(null);
  /** 3D terrain + camera pitch, remembered between visits. */
  const [terrain3d, setTerrain3d] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(TERRAIN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [panelOpen, setPanelOpen] = useState(false);
  /** Mobile: the drawer is slid in from the left, or closed. */
  const [mobileOpen, setMobileOpen] = useState(false);
  /** Desktop: resizable sidebar width, remembered between visits. */
  const [asideWidth, setAsideWidth] = useState<number>(ASIDE_DEFAULT);
  // Navigation state (GPS dot, dropped pin, route), published by the map's
  // navigation host. Null until the map mounts and reports its initial state.
  const [nav, setNav] = useState<NavigationState | null>(null);
  // Whether the turn-by-turn step list inside the destination sheet is open.
  // Lifted so the map pad (and thus the visible route) tracks its height.
  const [stepsOpen, setStepsOpen] = useState(false);
  /** Measured pixel height of the destination sheet, for map bottom-padding. */
  /** Map top/bottom insets reported by the navigation overlay. */
  const [navTopInset, setNavTopInset] = useState(0);
  const [navBottomInset, setNavBottomInset] = useState(0);
  /** True once the user pressed Navigate; keeps the screen awake until cleared. */
  const [navigating, setNavigating] = useState(false);
  // Layers the registry lists but public/data does not have; populated by the map
  // as each failed fetch surfaces.
  const [missing, setMissing] = useState<Set<string>>(new Set());
  // Live layers that are on but failing, so the panel can badge them.
  const [feedErrors, setFeedErrors] = useState<Record<string, string>>({});
  // MapLibre instance, set when MapView is ready.
  const [map, setMap] = useState<Map | null>(null);
  // Measure tool: whether clicks add vertices, and the immutable point array
  // the map draws and the panel summarises. `measureRef` owns the collection
  // logic; the array is a fresh copy per change so React (and MapView's effect)
  // see a new reference.
  const [measureActive, setMeasureActive] = useState(false);
  const measureRef = useRef(createMeasureState());
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  // The layer whose detail drawer is open, if any.
  const [detail, setDetail] = useState<LayerDef | null>(null);
  // Per-layer metadata from the build manifest (data "as of" date and bounds),
  // so the drawer can show provenance and the map can zoom to a layer without
  // re-fetching its file.
  const [manifest, setManifest] = useState<{
    layers?: Record<string, { generated?: string; bbox?: [number, number, number, number] }>;
  } | null>(null);

  // Start from the registry's curated defaults: only a small amount of
  // lightweight context (toponyms + parishes) is on; the rest is off by
  // default so new users are not overwhelmed. Others remain one toggle away.
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(LAYERS.filter((l) => l.defaultOn).map((l) => l.id)),
  );

  // FeatureBrowser state lifted to survive tab switches and drawer close.
  const [browseLayerId, setBrowseLayerId] = useState("");
  const [browseQuery, setBrowseQuery] = useState("");
  const [browsePos, setBrowsePos] = useState(0);

  const toggle = useCallback((id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The "all on / all off" switch in the layer panel. Off is a blank map,
  // which is occasionally what you want before adding layers back one at a
  // time to isolate a render problem.
  const setAll = useCallback((on: boolean) => {
    const next: Set<string> = on ? new Set(LAYERS.map((l) => l.id)) : new Set();
    setEnabled(next);
  }, []);

  // The feature browser turns a layer on so its features are visible while it
  // is being stepped through (a footprint you cannot see is still hard to find
  // even when the map has flown to it).
  const ensureEnabled = useCallback((id: string) => {
    setEnabled((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const onMissing = useCallback((next: Set<string>) => setMissing(next), []);
  const onFeedErrors = useCallback((next: Record<string, string>) => setFeedErrors(next), []);

  // Load the build manifest once: it records each data file's "as of" date and
  // bounding box, so the detail drawer and "zoom to layer" need no extra fetch.
  useEffect(() => {
    let cancelled = false;
    fetch("/data/manifest.json", { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!cancelled && m) setManifest(m);
      })
      .catch(() => {
        /* the manifest is a convenience: the map works without it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Zoom the map to a layer's bounds and close the drawer. The map owns the
  // camera, so this only dispatches; map-interactions does the fitBounds.
  const zoomToLayer = useCallback(
    (layer: LayerDef) => {
      const bbox = manifest?.layers?.[layer.id]?.bbox;
      if (bbox) {
        window.dispatchEvent(new CustomEvent("openmannin:fit-layer", { detail: { bbox } }));
      }
      setDetail(null);
    },
    [manifest],
  );

  // The visible map centre + zoom (+ bounds), reported by MapView after each
  // move. Used to keep the URL in sync so a map state can be shared as a link,
  // and by the offline scope picker for the "current view" option.
  const [viewport, setViewport] = useState<{
    lon: number;
    lat: number;
    zoom: number;
    bounds?: { west: number; south: number; east: number; north: number };
  } | null>(null);

  // Restore the remember-the-sized sidebar width, once.
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(ASIDE_KEY));
      if (Number.isFinite(v) && v >= ASIDE_MIN && v <= ASIDE_MAX) setAsideWidth(v);
    } catch {
      /* private mode: fall back to the default width */
    }
  }, []);

  const rememberWidth = useCallback((w: number) => {
    setAsideWidth(w);
    try {
      localStorage.setItem(ASIDE_KEY, String(w));
    } catch {
      /* ignore */
    }
  }, []);

  // Persist the 3D-terrain choice so it survives a reload.
  useEffect(() => {
    try {
      localStorage.setItem(TERRAIN_KEY, terrain3d ? "1" : "0");
    } catch {
      /* private mode: the preference simply does not persist */
    }
  }, [terrain3d]);

  // Drag the sidebar's right edge to resize it (desktop only).
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = asideWidth;
      const onMove = (ev: PointerEvent) => {
        rememberWidth(Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, startW + (ev.clientX - startX))));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [asideWidth, rememberWidth],
  );

  // Deep links: ?layers=roads,postcodes&z=15&lon=-4.5&lat=54.2
  //            &to=lon,lat,title[,detail]&pick=layerId:lon:lat[:label]
  // Read once on mount to restore the shared state; the map's own initial
  // viewport is read by MapView directly from the URL. The destination and
  // pick are parked in refs: their restore effects wait for the nav host and
  // the map to exist, which happens well after mount.
  const pendingToRef = useRef<ReturnType<typeof parseToParam>>(null);
  const pendingPickRef = useRef<ReturnType<typeof parsePickParam>>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const layersParam = p.get("layers");
    if (layersParam) {
      const ids = layersParam
        .split(",")
        .map((s) => s.trim())
        .filter((id) => LAYERS.some((l) => l.id === id));
      if (ids.length > 0) setEnabled(new Set(ids));
    }
    pendingToRef.current = parseToParam(p.get("to"));
    pendingPickRef.current = parsePickParam(p.get("pick"));
  }, []);

  // ?to= — drop the shared destination once the nav host is listening. The
  // host's set-destination handler flies the camera and routes by itself.
  useEffect(() => {
    const dest = pendingToRef.current;
    if (!dest || !nav) return;
    pendingToRef.current = null;
    window.dispatchEvent(
      new CustomEvent("openmannin:set-destination", {
        detail: { lon: dest.lon, lat: dest.lat, title: dest.title, detail: dest.detail ?? "" },
      }),
    );
  }, [nav]);

  // ?pick= — reopen the feature popup once the map exists. The clicked
  // position alone is not enough for a popup (it needs the feature's
  // properties), so the layer file is reloaded and the nearest geometry is
  // resolved client-side; if that cannot load (offline first paint), the
  // label carried in the URL keeps the popup meaningful.
  useEffect(() => {
    const pk = pendingPickRef.current;
    if (!pk || !map) return;
    pendingPickRef.current = null;
    const layer = LAYERS.find((l) => l.id === pk.layerId);
    if (!layer) return;
    const asOf = manifest?.layers?.[layer.id]?.generated;
    const fallback = (): PickedFeature => ({
      layer,
      properties: pk.label ? { name: pk.label } : null,
      lon: pk.lon,
      lat: pk.lat,
      asOf,
    });
    window.dispatchEvent(
      new CustomEvent("openmannin:fly-to", { detail: { lon: pk.lon, lat: pk.lat, zoom: 16 } }),
    );
    if (!layer.file) {
      setPicked(fallback());
      return;
    }
    let cancelled = false;
    void loadLayer(layer.file)
      .then((fc) => {
        if (cancelled) return;
        setPicked({
          layer,
          properties:
            nearestFeatureProperties(fc, pk.lon, pk.lat) ??
            (pk.label ? { name: pk.label } : null),
          lon: pk.lon,
          lat: pk.lat,
          asOf,
        });
      })
      .catch(() => {
        if (!cancelled) setPicked(fallback());
      });
    return () => {
      cancelled = true;
    };
  }, [map, manifest]);

  // Write the current state back to the URL (debounced) so the address bar
  // always reflects what is on screen and can be copied as a shareable link.
  // Destination and pick are derived as strings so this effect keys off
  // values: the nav state object republishes on every GPS fix, and depending
  // on it would reset the debounce timer a second and never write.
  const destParam = nav?.destination
    ? formatToParam({
        lon: nav.destination.lon,
        lat: nav.destination.lat,
        title: nav.destination.title,
        detail: nav.destination.detail || undefined,
      })
    : null;
  const pickParam = picked
    ? formatPickParam({
        layerId: picked.layer.id,
        lon: picked.lon,
        lat: picked.lat,
        label: resolveFeatureLabel(picked.properties) || undefined,
      })
    : null;

  useEffect(() => {
    if (!viewport) return;
    const t = setTimeout(() => {
      const layers = LAYERS.filter((l) => enabled.has(l.id))
        .map((l) => l.id)
        .join(",");
      const p = new URLSearchParams();
      if (layers) p.set("layers", layers);
      if (destParam) p.set("to", destParam);
      if (pickParam) p.set("pick", pickParam);
      p.set("z", viewport.zoom.toFixed(1));
      p.set("lon", viewport.lon.toFixed(5));
      p.set("lat", viewport.lat.toFixed(5));
      window.history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
    }, 500);
    return () => clearTimeout(t);
  }, [enabled, viewport, destParam, pickParam]);

  const centreOn = useCallback((lon: number, lat: number) => {
    window.dispatchEvent(
      new CustomEvent("openmannin:fly-to", { detail: { lon, lat } }),
    );
  }, []);

  // The navigation host owns all the real work; the UI just relays intent.
  const toggleLocate = useCallback(() => {
    window.dispatchEvent(new CustomEvent("openmannin:locate"));
  }, []);
  const setNavMode = useCallback((mode: RouteMode) => {
    window.dispatchEvent(new CustomEvent("openmannin:nav-mode", { detail: { mode } }));
  }, []);
  const setFollowMode = useCallback((mode: FollowMode) => {
    window.dispatchEvent(new CustomEvent("openmannin:nav-follow", { detail: { mode } }));
  }, []);
  const setVoiceMuted = useCallback((muted: boolean) => {
    window.dispatchEvent(new CustomEvent("openmannin:nav-voice", { detail: { muted } }));
  }, []);
  const navigate = useCallback(() => {
    setNavigating(true);
    window.dispatchEvent(new CustomEvent("openmannin:navigate"));
  }, []);
  const clearNav = useCallback(() => {
    setNavigating(false);
    window.dispatchEvent(new CustomEvent("openmannin:clear-nav"));
  }, []);
  const endNav = useCallback(() => {
    setNavigating(false);
    setStepsOpen(false);
    window.dispatchEvent(new CustomEvent("openmannin:nav-end"));
  }, []);
  const overviewNav = useCallback(() => {
    window.dispatchEvent(new CustomEvent("openmannin:nav-overview"));
  }, []);

  // A pin-drop without an explicit Navigate press re-opens a stale step list
  // from the previous destination; fold it back in.
  useEffect(() => {
    if (!nav?.destination) setStepsOpen(false);
  }, [nav?.destination]);

  // Keep the display awake while following a route. The browser drops the lock
  // when the tab is hidden, so re-request it the moment it is visible again.
  const routeActive = !!nav?.destination && !!nav?.userLocation && nav.routeStatus === "ready";
  useEffect(() => {
    const active = navigating && routeActive;
    if (active) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
    const onVisibility = () => {
      if (!document.hidden && active) requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      releaseWakeLock();
    };
  }, [navigating, routeActive]);

  // A global-search hit turns its layer on before flying, so the thing you
  // searched for is actually visible when you arrive.
  const searchSelect = useCallback(
    (layerId: string, lon: number, lat: number) => {
      ensureEnabled(layerId);
      centreOn(lon, lat);
    },
    [ensureEnabled, centreOn],
  );

  // The measure panel needs a new array reference each change; the collection
  // maths lives in the state machine, so this only mirrors its points out.
  const syncMeasurePoints = useCallback(() => {
    setMeasurePoints([...measureRef.current.points]);
  }, []);
  const measureAdd = useCallback(
    (point: MeasurePoint) => {
      measureRef.current.add(point.lon, point.lat);
      syncMeasurePoints();
    },
    [syncMeasurePoints],
  );
  const measureUndo = useCallback(() => {
    measureRef.current.undo();
    syncMeasurePoints();
  }, [syncMeasurePoints]);
  const measureClear = useCallback(() => {
    measureRef.current.clear();
    syncMeasurePoints();
    setMeasureActive(false);
  }, [syncMeasurePoints]);
  const toggleMeasure = useCallback(() => {
    setMeasureActive((v) => !v);
    // The feature popup would sit under the drawing; drop it as we arm.
    setPicked(null);
  }, []);

  const measureSummary = measureRef.current.summary();

  return (
    <main className="flex h-dvh w-full overflow-hidden bg-page font-sans text-ink">
      {/* ---- drawer backdrop (mobile) ---- */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* ---- sidebar / drawer ---- */}
        <aside
        className={`fixed top-4 left-4 right-4 z-40 flex w-[min(21rem,88vw)] shrink-0 flex-col rounded-3xl border border-line bg-page shadow-[0_8px_32px_rgba(0,0,0,0.18)] transition-all duration-200 ease-out md:static md:z-auto md:translate-x-0 md:shadow-none md:transition-[width] md:rounded-none md:bg-page md:bottom-auto overflow-hidden ${
          panelOpen
            ? "md:w-[var(--aside-w)] md:border-r md:border-line"
            : "md:w-0 md:min-w-0 md:border-0"
        } ${mobileOpen
          ? "bottom-0 translate-x-0 pb-[calc(64px+env(safe-area-inset-bottom))]"
          : "bottom-16 -translate-x-[calc(100%+1rem)]"
        }`}
        style={{ ["--aside-w" as string]: `${asideWidth}px` }}
      >
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2" inert={!(panelOpen || mobileOpen)}>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-label={panelOpen ? "Collapse panel" : "Expand panel"}
            className={`hidden shrink-0 rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-raised hover:text-ink md:inline-flex ${
              panelOpen ? "" : "!px-0"
            }`}
          >
            {panelOpen ? (
              <MenuIcon className="h-4 w-4 -scale-x-100" />
            ) : (
              <MenuIcon className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation panel"
            className="btn-icon !h-8 !w-8 md:hidden"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

<div className="shrink-0 border-b border-line px-3 py-2" inert={!(panelOpen || mobileOpen)}>
                <GlobalSearch onSelect={searchSelect} />
              </div>

              <div className="min-h-0 flex-1 relative" inert={!(panelOpen || mobileOpen)}>
                {tab === "layers" && (
                  <div className="flex gap-2 border-b border-line px-3 py-2" role="group" aria-label="Layer display presets">
                    <button type="button" className="btn flex-1 text-xs" onClick={() => setEnabled(new Set(LAYERS.filter((l) => l.defaultOn).map((l) => l.id)))} aria-label="Show context layers">
                      Context
                    </button>
                    <button type="button" className="btn flex-1 text-xs" onClick={() => setAll(true)} aria-label="Show all layers">
                      All
                    </button>
                    <button type="button" className="btn flex-1 text-xs" onClick={() => setAll(false)} aria-label="Hide all layers">
                      None
                    </button>
                  </div>
                )}
                {tab === "layers" && (
                  <LayerPanel
                    layers={LAYERS}
                    enabled={enabled}
                    missing={missing}
                    feedErrors={feedErrors}
                    onToggle={toggle}
                    onToggleAll={setAll}
                    onShowDetail={setDetail}
                    terrain3d={terrain3d}
                    onTerrainChange={setTerrain3d}
                  />
                )}
                {tab === "browse" && (
                  <FeatureBrowser
                    layers={LAYERS}
                    enabled={enabled}
                    onEnsureEnabled={ensureEnabled}
                    onLocate={centreOn}
                    layerId={browseLayerId}
                    onLayerChange={setBrowseLayerId}
                    query={browseQuery}
                    onQueryChange={setBrowseQuery}
                    pos={browsePos}
                    onPosChange={setBrowsePos}
                  />
                )}
                {tab === "gaps" && <GapsPanel gaps={GAPS} />}
                {tab === "sources" && <TransparencyPanel viewport={viewport?.bounds ?? null} />}
              </div>

        {/* desktop resize handle */}
        <div
          onPointerDown={panelOpen ? startResize : undefined}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize"
          className={`absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize items-center justify-center ${
            panelOpen ? "md:flex" : ""
          }`}
        >
          <div className="h-8 w-0.5 rounded bg-line" />
        </div>
</aside>

      {/* ---- map ---- */}
      <section className="relative min-w-0 flex-1">
        <MapView
          layers={LAYERS}
          enabled={enabled}
          onPick={setPicked}
          onMissing={onMissing}
          onFeedErrors={onFeedErrors}
          onViewport={setViewport}
          onNav={setNav}
          onMapReady={setMap}
          insetBottom={navBottomInset + 8}
          insetTop={navTopInset}
          mobileBottomInset={64}
          terrain3d={terrain3d}
          measureMode={measureActive}
          measurePoints={measurePoints}
          onMeasurePoint={measureAdd}
        />

        <FeaturePopup picked={picked} onClose={() => setPicked(null)} onLocate={centreOn} />

        {/* Measure readout — top-centre, clear of the control stack and pills. */}
        {map && (measureActive || measurePoints.length > 0) && (
          <MeasurePanel
            summary={measureSummary}
            active={measureActive}
            onUndo={measureUndo}
            onClear={measureClear}
            onStop={() => setMeasureActive(false)}
            className="absolute left-1/2 top-4 z-20 -translate-x-1/2"
          />
        )}

        {/* Map overlays (always visible when map is ready) */}
        {map && (
          <div className="absolute right-4 top-[56px] z-20 flex flex-col items-end gap-2 md:top-[80px]">
            {nav && <LocateButton state={nav} onToggle={toggleLocate} />}
            {nav && nav.locationStatus === "active" && (
              <FollowModeButton followMode={nav.followMode} onToggle={setFollowMode} />
            )}
            {nav && nav.navigating && (
              <VoiceButton muted={nav.voiceMuted} onToggle={setVoiceMuted} />
            )}
            <MeasureControl active={measureActive} onToggle={toggleMeasure} />
            <ThemeToggle />
          </div>
        )}

        {/* Satellite pass pill — top-right, above the nav button stack. */}
        {map && (
          <div className="absolute right-12 top-4 z-20">
            <PassWidget />
          </div>
        )}

        {nav && (
          <NavigationOverlay
            state={nav}
            stepsOpen={stepsOpen}
            onToggleSteps={() => setStepsOpen((v) => !v)}
            onToggleMode={setNavMode}
            onNavigate={navigate}
            onEnd={endNav}
            onClear={clearNav}
            onOverview={overviewNav}
            onTopInset={setNavTopInset}
            onBottomInset={setNavBottomInset}
            minimized
          />
        )}

        <LayerDetailDrawer
          layer={detail}
          asOf={detail ? manifest?.layers?.[detail.id]?.generated : undefined}
          hasBounds={!!(detail && manifest?.layers?.[detail.id]?.bbox)}
          isOn={detail ? enabled.has(detail.id) : false}
          onClose={() => setDetail(null)}
          onToggle={toggle}
          onZoomToLayer={zoomToLayer}
        />
      </section>

{/* ---- unified bottom tab bar (always visible) ---- */}
      <nav
        aria-label="Primary sections"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full border border-line bg-page/90 backdrop-blur-xl shadow-lg px-3 py-2 md:px-4 md:py-2"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              if (tab === t.id) {
                setPanelOpen((v) => !v);
                setMobileOpen((v) => {
                  if (typeof window === 'undefined') return v;
                  return window.innerWidth < 768 ? !v : false;
                });
              } else {
                setTab(t.id);
                setPanelOpen(true);
                setMobileOpen(true);
              }
            }}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-accent text-accent-ink shadow-md"
                : "text-ink-3 hover:bg-raised hover:text-ink"
            }`}
          >
            <t.Icon className="h-5 w-5 shrink-0" />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}