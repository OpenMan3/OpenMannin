"use client";

import { useCallback, useEffect, useState } from "react";
import { GAPS, LAYERS } from "@/lib/layers";
import { MapView, type BasemapId, type PickedFeature } from "@/components/MapView";
import { LayerPanel } from "@/components/LayerPanel";
import { FeaturePopup } from "@/components/FeaturePopup";
import { FeatureBrowser } from "@/components/FeatureBrowser";
import { GapsPanel } from "@/components/GapsPanel";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TransparencyPanel } from "@/components/TransparencyPanel";
import { LocateButton } from "@/components/LocateButton";
import { DestinationSheet } from "@/components/DestinationSheet";
import {
  AlertIcon,
  CloseIcon,
  LayersIcon,
  ListIcon,
  MenuIcon,
  SearchIcon,
  ShieldIcon,
} from "@/components/Icons";
import type { NavigationState } from "@/lib/navigation/host";
import type { RouteMode } from "@/lib/navigation/profiles";
import { releaseWakeLock, requestWakeLock } from "@/lib/screen-wake-lock";

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

export default function Page() {
  return <PageContent />;
}

function PageContent() {
  const [tab, setTab] = useState<Tab>("layers");
  const [picked, setPicked] = useState<PickedFeature | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>("opentopo");
  const [panelOpen, setPanelOpen] = useState(true);
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
  const [sheetInset, setSheetInset] = useState(0);
  /** True once the user pressed Navigate; keeps the screen awake until cleared. */
  const [navigating, setNavigating] = useState(false);
  // Layers the registry lists but public/data does not have; populated by the map
  // as each failed fetch surfaces.
  const [missing, setMissing] = useState<Set<string>>(new Set());
  // Live layers that are on but failing, so the panel can badge them.
  const [feedErrors, setFeedErrors] = useState<Record<string, string>>({});

  // Start from whatever the registry marked defaultOn - which is everything.
  // Every layer is shown by default; weak and disputed ones carry their
  // caveats, and live-feed failures say so right in the layer row.
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(LAYERS.filter((l) => l.defaultOn).map((l) => l.id)),
  );

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
    setEnabled(on ? new Set(LAYERS.map((l) => l.id)) : new Set());
  }, []);

  // The feature browser turns a layer on so its features are visible while it
  // is being stepped through (a footprint you cannot see is still hard to find
  // even when the map has flown to it).
  const ensureEnabled = useCallback((id: string) => {
    setEnabled((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const onMissing = useCallback((next: Set<string>) => setMissing(next), []);
  const onFeedErrors = useCallback((next: Record<string, string>) => setFeedErrors(next), []);

  // The visible map centre + zoom, reported by MapView after each move. Used to
  // keep the URL in sync so a map state can be shared as a link.
  const [viewport, setViewport] = useState<{ lon: number; lat: number; zoom: number } | null>(null);

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
  // Read once on mount to restore the shared state; the map's own initial
  // viewport is read by MapView directly from the URL.
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
  }, []);

  // Write the current state back to the URL (debounced) so the address bar
  // always reflects what is on screen and can be copied as a shareable link.
  useEffect(() => {
    if (!viewport) return;
    const t = setTimeout(() => {
      const layers = LAYERS.filter((l) => enabled.has(l.id))
        .map((l) => l.id)
        .join(",");
      const p = new URLSearchParams();
      if (layers) p.set("layers", layers);
      p.set("z", viewport.zoom.toFixed(1));
      p.set("lon", viewport.lon.toFixed(5));
      p.set("lat", viewport.lat.toFixed(5));
      window.history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
    }, 500);
    return () => clearTimeout(t);
  }, [enabled, viewport]);

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
  const navigate = useCallback(() => {
    setNavigating(true);
    window.dispatchEvent(new CustomEvent("openmannin:navigate"));
  }, []);
  const clearNav = useCallback(() => {
    setNavigating(false);
    window.dispatchEvent(new CustomEvent("openmannin:clear-nav"));
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

  /** Mobile tab bar: open the drawer on that tab, or close it if already open. */
  const openMobileTab = useCallback(
    (id: Tab) => {
      setPanelOpen(true);
      setTab(id);
      setMobileOpen((open) => !(open && tab === id));
    },
    [tab],
  );

  return (
    <main className="flex h-dvh w-full overflow-hidden bg-page font-sans text-ink">
      {/* ---- mobile top app bar ---- */}
      <header className="absolute inset-x-0 top-0 z-30 flex h-11 items-center gap-2 border-b border-line bg-page/90 px-2 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => {
            setPanelOpen(true);
            setMobileOpen(true);
          }}
          aria-label="Open navigation panel"
          className="btn-icon !h-8 !w-8"
        >
          <MenuIcon className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight">
          Open<span className="text-accent">Mannin</span>
          <span className="ml-1 text-[11px] font-normal text-ink-3">
            Isle of Man infrastructure
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setPanelOpen(true);
            setMobileOpen(true);
            window.setTimeout(
              () => window.dispatchEvent(new Event("openmannin:focus-search")),
              120,
            );
          }}
          aria-label="Search all layers"
          className="btn-icon !h-8 !w-8 md:hidden"
        >
          <SearchIcon className="h-4 w-4" />
        </button>
      </header>

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
        className={`fixed top-0 bottom-14 left-0 z-40 flex w-[min(21rem,88vw)] shrink-0 flex-col border-r border-line bg-page shadow-2xl transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 md:shadow-none md:transition-[width] ${
          panelOpen ? "md:w-[var(--aside-w)]" : "md:w-12"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ ["--aside-w" as string]: `${asideWidth}px` }}
      >
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
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
          {panelOpen && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold tracking-tight">
                Open<span className="text-accent">Mannin</span>
              </div>
              <div className="truncate text-[10px] text-ink-3">Isle of Man infrastructure map</div>
            </div>
          )}
        </div>

        {panelOpen && (
          <>
            <div className="shrink-0 border-b border-line px-3 py-2">
              <GlobalSearch onSelect={searchSelect} />
            </div>

            <nav
              aria-label="Sections"
              className="flex shrink-0 border-b border-line"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex-1 px-1 py-2 text-[11px] font-medium transition-colors ${
                    tab === t.id
                      ? "border-b-2 border-accent text-accent"
                      : "text-ink-3 hover:text-ink-2"
                  }`}
                >
                  <t.Icon className="mx-auto mb-0.5 h-4 w-4 md:hidden" />
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1">
              {tab === "layers" && (
                <LayerPanel
                  layers={LAYERS}
                  enabled={enabled}
                  missing={missing}
                  feedErrors={feedErrors}
                  onToggle={toggle}
                  onToggleAll={setAll}
                />
              )}
              {tab === "browse" && (
                <FeatureBrowser
                  layers={LAYERS}
                  enabled={enabled}
                  onEnsureEnabled={ensureEnabled}
                  onLocate={centreOn}
                />
              )}
              {tab === "gaps" && <GapsPanel gaps={GAPS} />}
              {tab === "sources" && <TransparencyPanel />}
            </div>

            <div className="shrink-0 border-t border-line px-3 py-2">
              <label className="flex items-center justify-between gap-2 text-[11px] text-ink-3">
                Basemap
                <select
                  value={basemap}
                  onChange={(e) => setBasemap(e.target.value as BasemapId)}
                  className="rounded border border-line bg-panel px-1.5 py-1 text-[11px] text-ink focus:border-accent focus:outline-none"
                >
                  <option value="opentopo">OpenTopoMap</option>
                  <option value="osm">OpenStreetMap</option>
                  <option value="openfreemap">OpenFreeMap (Liberty)</option>
                </select>
              </label>
              <p className="mt-1 text-[10px] leading-snug text-ink-3">
                OpenTopoMap (CC-BY-SA), OpenStreetMap (ODbL), OpenFreeMap Liberty (ODbL).
              </p>
            </div>
          </>
        )}

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
          basemap={basemap}
          onPick={setPicked}
          onMissing={onMissing}
          onFeedErrors={onFeedErrors}
          onViewport={setViewport}
          onNav={setNav}
          insetBottom={nav?.destination && nav.routeStatus === "ready" ? sheetInset + 68 : 0}
        />

        <FeaturePopup picked={picked} onClose={() => setPicked(null)} onLocate={centreOn} />

        {nav && <LocateButton state={nav} onToggle={toggleLocate} />}
        {nav && (
          <DestinationSheet
            state={nav}
            onToggleMode={setNavMode}
            onNavigate={navigate}
            onClear={clearNav}
            stepsOpen={stepsOpen}
            onToggleSteps={() => setStepsOpen((v) => !v)}
            onInset={setSheetInset}
          />
        )}
      </section>

      {/* ---- mobile bottom tab bar ---- */}
      <nav
        aria-label="Sections"
        className="absolute inset-x-0 bottom-0 z-50 flex h-14 items-stretch border-t border-line bg-page/95 backdrop-blur md:hidden"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => openMobileTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
              tab === t.id ? "text-accent" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            <t.Icon className="h-5 w-5" />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}