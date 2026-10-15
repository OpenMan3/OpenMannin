"use client";

import { useEffect, useState } from "react";

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

export function TransparencyPanel() {
  const liveLayers = LAYERS.filter((l) => l.kind === "live");
  const [offlineState, setOfflineState] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [offlineProgress, setOfflineProgress] = useState(0);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);
  const [storageUsage, setStorageUsage] = useState<number | null>(null);
  const [storageQuota, setStorageQuota] = useState<number | null>(null);

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

  const checkOfflineReady = async () => {
    try {
      if (!("caches" in window)) return;
      const manifest = await (await fetch("/data/manifest.json")).json();
      const tileUrls = new Set<string>();
      const files = new Set<string>();
      for (const def of Object.values(manifest?.layers ?? {})) {
        if (def && typeof def === "object") {
          const d = def as { file?: unknown; pmtiles?: unknown };
          if (typeof d.pmtiles === "string") {
            tileUrls.add(new URL(d.pmtiles, window.location.origin).toString());
          }
          if (typeof d.file === "string") {
            files.add(d.file);
          }
        }
      }
      const keys = await caches.keys();
      const dataCacheKey = keys.find((k) => k.includes("-data"));
      const tilesCacheKey = keys.find((k) => k.includes("-tiles"));
      if (!dataCacheKey && !tilesCacheKey) return;
      const dataCache = dataCacheKey ? await caches.open(dataCacheKey) : null;
      const tilesCache = tilesCacheKey ? await caches.open(tilesCacheKey) : null;
      let ready = true;
      for (const file of files) {
        if (!dataCache || !(await dataCache.match(`/data/${file}`))) {
          ready = false;
          break;
        }
      }
      if (ready && tileUrls.size > 0) {
        for (const u of tileUrls) {
          if (!tilesCache || !(await tilesCache.match(u))) {
            ready = false;
            break;
          }
        }
      }
      setOfflineState(ready ? "done" : "idle");
    } catch {
      /* readiness probe is best-effort */
    }
  };

  useEffect(() => {
    void refreshStorage();
    void checkOfflineReady();
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
      const manifest = await (await fetch("/data/manifest.json")).json();
      const tileUrls = new Set<string>();
      const files = new Set<string>();
      for (const def of Object.values(manifest?.layers ?? {})) {
        if (def && typeof def === "object") {
          const d = def as { file?: unknown; pmtiles?: unknown };
          if (typeof d.pmtiles === "string") {
            tileUrls.add(new URL(d.pmtiles, window.location.origin).toString());
          }
          if (typeof d.file === "string") {
            files.add(d.file);
          }
        }
      }
      const list = [...files, ...tileUrls];
      let done = 0;
      await Promise.all(
        list.map(async (entry) => {
          await fetch(entry, { cache: "reload" });
          done += 1;
          setOfflineProgress(Math.round((done / list.length) * 100));
        }),
      );
      setOfflineState("done");
      await refreshStorage();
    } catch {
      setOfflineState("error");
    }
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto md:pb-16">
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
        <p className="mb-2 text-[12px] leading-snug text-ink-3">
          Cache all map data bundles locally for offline use.
        </p>
        {offlineState === "downloading" && (
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded bg-soft" aria-live="polite" aria-label="Offline download progress">
            <div className="h-full bg-accent transition-all" style={{ width: `${offlineProgress}%` }} />
          </div>
        )}
        {offlineState === "done" && (
          <p className="mb-2 text-[11px] text-ink-3" aria-live="polite">All offline data is cached</p>
        )}
        {offlineState === "error" && (
          <p className="mb-2 text-[11px] text-ink-3" aria-live="polite">Download failed</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void downloadOfflineData()}
            disabled={offlineState === "downloading"}
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
        OpenMannin 0.3.7
      </p>
    </div>
  );
}
