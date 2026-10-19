"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Data sources & transparency.
 *
 * The verification layer: every feed, every source and every library this app
 * uses, with its licence, its obligation and the date a human last checked.
 * The register (src/lib/sources.ts, src/lib/licences.ts) is the single source
 * of truth the layer panel and feature popups already read; this panel renders
 * the same data in full, so a reader can audit the whole stack without
 * opening devtools.
 *
 * Libraries are listed too, because "every library used must have its license
 * verified and explicitly displayed" includes the ones that draw the map.
 */

import { SOURCES } from "@/lib/sources";
import { LICENCES } from "@/lib/licences";
import { LAYERS } from "@/lib/layers";
import {
  collectTargets,
  formatBytes,
  parseManifest,
  scopeLayers,
  totalBytes,
  type OfflineManifest,
  type OfflineScope,
} from "@/lib/offline-scope";
import { coverageFeatureCollection, summarizeCoverage } from "@/lib/offline-coverage";
import { summarizeHealth, type HealthSummary } from "@/lib/health-summary";
import { CommunityFeed } from "./CommunityFeed";
import { LicenceBadge } from "./LicenceBadge";

/**
 * Third-party libraries shipped to the browser, with licences verified against
 * each project's own licence file. Dev-only tools (TypeScript, esbuild) are
 * omitted: they never reach the reader.
 */
const LIBRARIES: { name: string; licence: string; url: string; licenceUrl: string }[] = [
  {
    name: "MapLibre GL JS",
    licence: "BSD 3-Clause",
    url: "https://maplibre.org/",
    licenceUrl: "https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt",
  },
  {
    name: "satellite.js",
    licence: "MIT",
    url: "https://github.com/shashwatak/satellite.js",
    licenceUrl: "https://github.com/shashwatak/satellite.js/blob/master/LICENSE.md",
  },
  {
    name: "React",
    licence: "MIT",
    url: "https://react.dev/",
    licenceUrl: "https://github.com/facebook/react/blob/main/LICENSE",
  },
  {
    name: "Next.js",
    licence: "MIT",
    url: "https://nextjs.org/",
    licenceUrl: "https://github.com/vercel/next.js/blob/canary/license.md",
  },
  {
    name: "Tailwind CSS",
    licence: "MIT",
    url: "https://tailwindcss.com/",
    licenceUrl: "https://github.com/tailwindlabs/tailwindcss/blob/master/LICENSE",
  },
  {
    name: "proj4js",
    licence: "MIT",
    url: "https://proj4js.org/",
    licenceUrl: "https://github.com/proj4js/proj4js/blob/master/LICENSE.md",
  },
];

/**
 * Remembered layer selection for the "Choose layers…" scope. The `om:` prefix
 * keeps every key this app writes in one namespace, and the value stays a plain
 * array of layer ids so it can be read straight out of devtools.
 */
const SELECTION_KEY = "om:offline.layers";

/** Parallel downloads while caching for offline use. Keeps the connection pool
 * and peak memory bounded regardless of how many bundles are selected. */
const OFFLINE_CONCURRENCY = 4;

/** Scope choices. "Current view" renders disabled until a viewport is passed in. */
const SCOPE_OPTIONS: { id: OfflineScope; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "selected", label: "Choose layers…" },
  { id: "viewport", label: "Current view" },
];

/**
 * The stored selection, or null when nothing was ever stored - which the panel
 * reads as "every layer ticked", so the first-time reader is not faced with an
 * empty download they did not ask for.
 */
function loadSelection(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(SELECTION_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    /* a corrupt selection falls back to "everything ticked" */
  }
  return null;
}

function saveSelection(ids: readonly string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify([...ids]));
  } catch {
    /* private-mode storage must not break the download */
  }
}

/** Fetch the build manifest; `ok` is the only trustable signal because a static host answers 404s with the app shell. */
async function fetchManifest(): Promise<OfflineManifest> {
  const res = await fetch("/data/manifest.json");
  if (!res.ok) throw new Error(`HTTP ${res.status} for /data/manifest.json`);
  return parseManifest(await res.json());
}

export function TransparencyPanel({
  viewport = null,
}: {
  /**
   * The map's current footprint in degrees, when the parent can supply it.
   * Enables the "Current view" offline scope; without it that option is
   * rendered disabled instead of quietly downloading everything.
   */
  viewport?: { west: number; south: number; east: number; north: number } | null;
}) {
  const liveLayers = LAYERS.filter((l) => l.kind === "live");
  const [offlineState, setOfflineState] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [offlineProgress, setOfflineProgress] = useState(0);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);
  const [storageUsage, setStorageUsage] = useState<number | null>(null);
  const [storageQuota, setStorageQuota] = useState<number | null>(null);
  /** Fetched once on mount and shared by the probe, the scope list and the download. */
  const [manifest, setManifest] = useState<OfflineManifest | null>(null);
  const [scope, setScope] = useState<OfflineScope>("all");
  /** null = nothing stored yet, read as "every layer ticked". */
  const [storedSelection, setStoredSelection] = useState<string[] | null>(() => loadSelection());
  /** Raw /health.json, or null when it never answered - the badge stays hidden. */
  const [healthReport, setHealthReport] = useState<unknown>(null);
  /** Ids of layers whose data is present in the service worker's caches. */
  const [cachedIds, setCachedIds] = useState<Set<string> | null>(null);
  /** Whether the coverage boxes are currently drawn on the map. */
  const [coverageOn, setCoverageOn] = useState(false);

  // Labels live in the registry (src/lib/layers.ts); the manifest only carries
  // ids, and a checkbox list of raw ids is unreadable.
  const manifestLayers = useMemo(() => {
    if (!manifest) return [];
    const labels = new Map(LAYERS.map((l) => [l.id, l.label]));
    return manifest.layers.map((entry) => ({
      ...entry,
      label: entry.label ?? labels.get(entry.id) ?? entry.id,
    }));
  }, [manifest]);

  const effectiveSelection = useMemo(
    () => storedSelection ?? manifestLayers.map((l) => l.id),
    [storedSelection, manifestLayers],
  );
  const selectedSet = useMemo(() => new Set(effectiveSelection), [effectiveSelection]);

  const scopedLayers = useMemo(
    () => scopeLayers(manifestLayers, scope, { selected: effectiveSelection, viewport }),
    [manifestLayers, scope, effectiveSelection, viewport],
  );

  const coverage = useMemo(
    () => summarizeCoverage(manifestLayers, cachedIds ?? new Set()),
    [manifestLayers, cachedIds],
  );

  const healthSummary: HealthSummary | null = useMemo(
    () =>
      healthReport === null
        ? null
        : summarizeHealth(healthReport, { manifestGenerated: manifest?.generated ?? null }),
    [healthReport, manifest],
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const refreshStorage = async () => {
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        setStorageUsage(typeof est.usage === "number" ? est.usage : null);
        setStorageQuota(typeof est.quota === "number" ? est.quota : null);
      }
    } catch {
      /* storage estimate is optional */
    }
  };

  /**
   * Per-layer cache probe: for each manifest layer, are its GeoJSON and PMTiles
   * targets already in the service worker's caches? This feeds the coverage
   * readout and the "show on map" overlay, and it also decides "Offline data
   * ready" - which has always meant every layer is present, not just the scope.
   */
  const probeCaches = async (m: OfflineManifest) => {
    try {
      if (!("caches" in window)) {
        setCachedIds(null);
        return;
      }
      const keys = await caches.keys();
      const dataCacheKey = keys.find((k) => k.includes("-data"));
      const tilesCacheKey = keys.find((k) => k.includes("-tiles"));
      if (!dataCacheKey && !tilesCacheKey) {
        setCachedIds(new Set());
        return;
      }
      const dataCache = dataCacheKey ? await caches.open(dataCacheKey) : null;
      const tilesCache = tilesCacheKey ? await caches.open(tilesCacheKey) : null;
      const cached = new Set<string>();
      for (const layer of m.layers) {
        const targets = collectTargets([layer], window.location.origin);
        if (targets.length === 0) continue;
        let present = true;
        for (const url of targets) {
          // GeoJSON is cached under /data and PMTiles under /tiles; the
          // pathname decides which of the two caches to look in.
          const { pathname } = new URL(url);
          const cache = pathname.startsWith("/data/") ? dataCache : tilesCache;
          if (!cache || !(await cache.match(url))) {
            present = false;
            break;
          }
        }
        if (present) cached.add(layer.id);
      }
      setCachedIds(cached);
      setOfflineState(cached.size === m.layers.length && m.layers.length > 0 ? "done" : "idle");
    } catch {
      /* readiness probe is best-effort */
    }
  };

  useEffect(() => {
    void refreshStorage();
  }, []);

  // The manifest is fetched exactly once and shared: the readiness probe, the
  // scope list and the download all read these bytes instead of each re-hitting
  // /data/manifest.json. A failure here is survivable - the download re-fetches
  // on demand, so a retry after a bad first load is still a real attempt.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const m = await fetchManifest();
        if (cancelled) return;
        setManifest(m);
        await probeCaches(m);
      } catch {
        /* the panel renders without a manifest; only the scope list needs it */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // The health badge is optional by design: a host that does not ship
  // health.json, or answers with anything unparseable, gets no line at all
  // rather than an error state dressed up as a status.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/health.json");
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (!cancelled) setHealthReport(data);
      } catch {
        /* silent: no badge beats a broken badge */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearOfflineData = async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.includes("-data") || k.includes("-tiles")).map((k) => caches.delete(k)));
      }
      setOfflineState("idle");
      setOfflineProgress(0);
      await refreshStorage();
    } catch {
      setOfflineState("error");
    }
  };

  const downloadOfflineData = async () => {
    setOfflineState("downloading");
    setOfflineProgress(0);
    try {
      let m = manifest;
      if (!m) {
        m = await fetchManifest();
        setManifest(m);
      }
      // No stored selection means "everything ticked" - the same default the
      // checkbox list shows - so an untouched choice downloads the full app.
      const selected = storedSelection ?? m.layers.map((l) => l.id);
      const scoped = scopeLayers(m.layers, scope, { selected, viewport });
      const list = collectTargets(scoped, window.location.origin);
      if (list.length > 0) {
        // Bounded concurrency: fetching every bundle at once floods the
        // connection pool (and holds every response in memory), so run a fixed
        // number of workers pulling from a shared queue instead.
        let done = 0;
        let failed = false;
        const queue = [...list];
        const worker = async () => {
          while (!failed) {
            const entry = queue.shift();
            if (!entry) return;
            try {
              // A 404/500 used to count as downloaded: every response
              // incremented `done`, so the panel reported "All offline data is
              // cached" while the network was failing. Fail loudly instead.
              const res = await fetch(entry, { cache: "reload" });
              if (!res.ok) throw new Error(`HTTP ${res.status} for ${entry}`);
            } catch (err) {
              // Signal the sibling workers to stop so none throws after the
              // first rejection is already handled.
              failed = true;
              throw err;
            }
            done += 1;
            setOfflineProgress(Math.round((done / list.length) * 100));
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(OFFLINE_CONCURRENCY, list.length) }, worker),
        );
      }
      setOfflineState("done");
      await refreshStorage();
      // Re-probe so the coverage readout and overlay reflect what just landed.
      await probeCaches(m);
    } catch {
      setOfflineState("error");
    }
  };

  const persistSelection = (ids: string[]) => {
    setStoredSelection(ids);
    saveSelection(ids);
  };

  const toggleLayer = (id: string) => {
    const next = new Set(effectiveSelection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistSelection([...next]);
  };

  // Draw (or clear) the coverage boxes whenever the toggle or the cached set
  // changes. The cleanup clears the overlay on unmount so a closed panel does
  // not leave stale boxes on the map.
  useEffect(() => {
    if (!coverageOn) return;
    window.dispatchEvent(
      new CustomEvent("openmannin:coverage", {
        detail: coverageFeatureCollection(manifestLayers, cachedIds ?? new Set(), 0.0005),
      }),
    );
    return () => {
      window.dispatchEvent(new CustomEvent("openmannin:coverage", { detail: null }));
    };
  }, [coverageOn, manifestLayers, cachedIds]);

  const scopeDescription =
    scope === "selected"
      ? "Cache only the layers you tick below. Your choice stays on this device."
      : scope === "viewport"
        ? "Cache only the layers whose data reaches the map view you are looking at."
        : "Cache all map data bundles locally for offline use.";

  return (
    <div className="scroll-thin h-full overflow-y-auto md:pb-16">
      {/* Freshness strip: quiet when the build is provably healthy, amber when it
          is stale or warned, red when it is broken. Absent entirely when
          health.json did not answer. */}
      {healthSummary && (
        <p
          className={`border-b border-line-soft px-3 py-2 text-[11px] ${
            healthSummary.tone === "danger"
              ? "text-danger"
              : healthSummary.tone === "warn"
                ? "text-warn"
                : "text-ink-3"
          }`}
          title={healthSummary.title}
          aria-live="polite"
        >
          {healthSummary.text}
        </p>
      )}
      <div className="border-b border-line px-3 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Data sources &amp; transparency</h2>
        <p className="mt-1 text-[12px] leading-snug text-ink-3">
          Every feed, source and library, with its licence and the date it was last checked by
          hand. Nothing here is presented as open that is not.
        </p>
      </div>

      <section className="border-b border-line-soft px-3 py-2.5">
        <h3 className="label mb-2">Offline data</h3>
        <div className="mb-2 flex items-center justify-between text-[11px] text-ink-3">
          <span aria-live="polite" aria-label="Network status">{isOnline ? "Online" : "Offline"}</span>
          {storageUsage !== null && storageQuota !== null && (
            <span>
              {(storageUsage / (1024 * 1024)).toFixed(1)} / {(storageQuota / (1024 * 1024)).toFixed(0)} MB cached
            </span>
          )}
        </div>
        {/* Scope: what to fetch. The filtering rules live in src/lib/offline-scope.ts. */}
        <div role="radiogroup" aria-label="Offline download scope" className="mb-2 flex flex-wrap gap-1.5">
          {SCOPE_OPTIONS.map((opt) => {
            const unavailable = opt.id === "viewport" && viewport === null;
            const active = scope === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={unavailable}
                title={unavailable ? "Available once this panel knows the map viewport" : undefined}
                onClick={() => setScope(opt.id)}
                className={`chip cursor-pointer border transition-colors ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-line-soft text-ink-3 hover:bg-raised"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <p className="mb-2 text-[12px] leading-snug text-ink-3">{scopeDescription}</p>

        {manifest && scope !== "selected" && (
          <p className="mb-2 text-[11px] text-ink-3">
            {scope === "viewport" && scopedLayers.length === 0
              ? "No layers reach the current view"
              : `${scopedLayers.length} layer${scopedLayers.length === 1 ? "" : "s"} · ${formatBytes(totalBytes(scopedLayers))}`}
          </p>
        )}

        {scope === "selected" &&
          (manifest ? (
            <div className="mb-2">
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-ink-3">
                <span>
                  {effectiveSelection.length} of {manifestLayers.length} selected ·{" "}
                  {formatBytes(totalBytes(scopedLayers))}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="link"
                    onClick={() => persistSelection(manifestLayers.map((l) => l.id))}
                  >
                    All
                  </button>
                  <button type="button" className="link" onClick={() => persistSelection([])}>
                    None
                  </button>
                </span>
              </div>
              <div className="scroll-thin max-h-44 overflow-y-auto rounded-md border border-line-soft">
                {manifestLayers.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex cursor-pointer items-center gap-2 border-b border-line-soft px-2.5 py-1.5 last:border-b-0 hover:bg-raised"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(entry.id)}
                      onChange={() => toggleLayer(entry.id)}
                      className="h-4 w-4 shrink-0 accent-accent"
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                      {entry.label ?? entry.id}
                    </span>
                    {cachedIds?.has(entry.id) && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok"
                        title="Cached for offline use"
                        aria-label="Cached for offline use"
                        role="img"
                      />
                    )}
                    <span className="shrink-0 font-mono text-[10px] text-ink-3">
                      {formatBytes(entry.bytes)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="mb-2 text-[11px] text-ink-3">Layer list unavailable</p>
          ))}

        {offlineState === "downloading" && (
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded bg-soft" aria-live="polite" aria-label="Offline download progress">
            <div className="h-full bg-accent transition-all" style={{ width: `${offlineProgress}%` }} />
          </div>
        )}
        {offlineState === "done" && (
          <p className="mb-2 text-[11px] text-ink-3" aria-live="polite">
            {scope === "all"
              ? "All offline data is cached"
              : scope === "selected"
                ? "Selected offline data is cached"
                : "Data for this view is cached"}
          </p>
        )}
        {offlineState === "error" && (
          <p className="mb-2 text-[11px] text-ink-3" aria-live="polite">Download failed</p>
        )}
        {cachedIds && coverage.totalLayers > 0 && (
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-ink-3">
            <span aria-live="polite">
              Coverage: {coverage.cachedLayers} / {coverage.totalLayers} layers ·{" "}
              {formatBytes(coverage.cachedBytes)}
            </span>
            <button
              type="button"
              className="link shrink-0"
              onClick={() => setCoverageOn((v) => !v)}
              aria-pressed={coverageOn}
            >
              {coverageOn ? "Hide on map" : "Show on map"}
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void downloadOfflineData()}
            disabled={offlineState === "downloading" || (manifest !== null && scopedLayers.length === 0)}
            title={manifest !== null && scopedLayers.length === 0 ? "Nothing in this scope to download" : undefined}
            className="btn flex-1 text-xs"
          >
            {offlineState === "downloading"
              ? `Downloading… ${offlineProgress}%`
              : offlineState === "done"
                ? "Offline data ready"
                : "Download offline data"}
          </button>
          <button
            type="button"
            onClick={() => void clearOfflineData()}
            disabled={offlineState === "downloading"}
            className="btn text-xs"
            title="Clear cached offline data"
          >
            Clear
          </button>
        </div>
        {offlineState === "error" && (
          <p className="mt-2 text-[11px] text-danger">Download failed. Try again.</p>
        )}
      </section>

      {/* ---- live feeds ---- */}
      <section className="border-b border-line-soft px-3 py-2.5">
        <h3 className="label mb-2">Live feeds</h3>
        <div className="space-y-1.5">
          {liveLayers.map((l) => {
            const src = SOURCES[l.sourceId];
            const runsWhere =
              l.endpoint?.startsWith("client:") ? "your browser" : "needs a server";
            return (
              <div key={l.id} className="card px-2.5 py-2 !shadow-none">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] text-ink">{l.label}</span>
                  <LicenceBadge id={src?.licence ?? "UNKNOWN"} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-3">
                  <span className="text-accent">{runsWhere}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- data sources ---- */}
      <section className="border-b border-line-soft px-3 py-2.5">
        <h3 className="label mb-2">Data sources ({Object.keys(SOURCES).length})</h3>
        <div className="space-y-1.5">
          {Object.values(SOURCES).map((s) => {
            const lic = LICENCES[s.licence];
            const usedBy = LAYERS.filter((l) => l.sourceId === s.id).length;
            return (
              <details key={s.id} className="card group !shadow-none overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2.5 hover:bg-raised/60">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.name}</span>
                  <LicenceBadge id={s.licence} />
                </summary>
                <div className="space-y-1.5 border-t border-line px-2.5 py-2.5 text-[12px] leading-relaxed text-ink-2">
                  <div>
                    <span className="text-ink-3">Publisher: </span>
                    {s.publisher}
                  </div>
                  <div>
                    <span className="text-ink-3">Last checked: </span>
                    {s.lastChecked}
                    {usedBy > 0 && (
                      <span className="text-ink-3">
                        {" "}· used by {usedBy} layer{usedBy === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  {lic && (
                    <div>
                      <span className="text-ink-3">Licence: </span>
                      {lic.url ? (
                        <a
                          href={lic.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link"
                        >
                          {lic.name}
                        </a>
                      ) : (
                        lic.name
                      )}
                      {lic.requiresPermission && (
                        <span className="text-warn"> — permission required</span>
                      )}
                    </div>
                  )}
                  {lic && <div className="text-ink-3">{lic.obligation}</div>}
                  {s.notes && <div className="text-ink-3">{s.notes}</div>}
                  <div>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link break-all"
                    >
                      {s.url}
                    </a>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      {/* ---- libraries ---- */}
      <section className="px-3 py-2.5">
        <h3 className="label mb-2">Libraries shipped to your browser</h3>
        <div className="space-y-1">
          {LIBRARIES.map((lib) => (
            <div
              key={lib.name}
              className="card flex items-center justify-between gap-2 px-2.5 py-2 !shadow-none"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{lib.name}</span>
              <a
                href={lib.licenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="chip shrink-0 bg-ok/10 font-mono text-ok hover:underline"
              >
                {lib.licence}
              </a>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-snug text-ink-3">
          Basemap tiles: OpenFreeMap vector styles (ODbL, © OpenMapTiles) and
          AWS Open Data terrain. The OpenStreetMap Foundation&apos;s own raster
          tiles are not offered; their usage policy is incompatible with an
          always-on app. Tile attributions render on the map itself.
        </p>
      </section>

      {/* ---- recent OSM activity ---- */}
      <CommunityFeed embedded />
      <p className="border-t border-line px-3 py-2 text-[10px] text-ink-3">
        OpenMannin 0.3.8
      </p>
    </div>
  );
}
