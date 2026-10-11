"use client";

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

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="border-b border-line px-3 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Data sources &amp; transparency</h2>
        <p className="mt-1 text-[12px] leading-snug text-ink-3">
          Every feed, source and library, with its licence and the date it was last checked by
          hand. Nothing here is presented as open that is not.
        </p>
      </div>

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
          Basemap tiles: OpenTopoMap (CC-BY-SA) and OpenFreeMap (ODbL, light and
          dark). The OpenStreetMap Foundation&apos;s own raster tiles are not
          offered; their usage policy is incompatible with an always-on app.
          Tile attributions render on the map itself.
        </p>
      </section>

      {/* ---- recent OSM activity ---- */}
      <CommunityFeed embedded />
    </div>
  );
}