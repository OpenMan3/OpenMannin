"use client";

/**
 * Feature detail card.
 *
 * Shown for whatever was last clicked on the map. It always shows the layer's
 * provenance underneath the feature's own attributes, so a screenshot of this
 * panel carries its own citation.
 *
 * It is a DIALOG, and keyboard users can reach it: `role="dialog"`, focus moves
 * in when it opens, Escape closes it. Without that the panel was mouse-only -
 * feature picking itself is a click on the canvas, but once open, a keyboard
 * user had no way to dismiss it.
 *
 * On small screens it docks to the bottom of the map (clearing the tab bar);
 * on desktop it is a card in the top-left corner.
 */

import { useEffect, useRef, useState } from "react";
import { SOURCES } from "@/lib/sources";
import { LICENCES } from "@/lib/licences";
import { featureLabel } from "@/lib/layer-data";
import { formatValue, humanise, HIDDEN_KEYS } from "@/lib/feature-format";
import type { PickedFeature } from "./MapView";
import { CloseIcon } from "./Icons";

/** Attribute rows shown before the "and N more" line. */
const MAX_ENTRIES = 14;

/** OSM object ids look like "node/123", "way/456", "relation/789". */
const OSM_ID = /^(node|way|relation)\/\d+$/;

function osmUrl(properties: Record<string, unknown> | null, lon: number, lat: number): string {
  const id =
    typeof properties?.osm === "string" && OSM_ID.test(properties.osm)
      ? properties.osm
      : typeof properties?.id === "string" && OSM_ID.test(properties.id)
        ? properties.id
        : null;
  if (id) return `https://www.openstreetmap.org/${id}`;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

function formatAsOf(asOf: string): string | null {
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function FeaturePopup({
  picked,
  onClose,
  onLocate,
}: {
  picked: PickedFeature | null;
  onClose: () => void;
  onLocate?: (lon: number, lat: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);

  // Hooks first: the early return below would otherwise make the hook count
  // depend on whether something is picked, which is a rules-of-hooks violation
  // the moment two clicks alternate.
  useEffect(() => {
    if (!picked) return;
    setCopied(false);
    rootRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picked, onClose]);

  if (!picked) return null;

  const { layer, properties, lon, lat } = picked;
  const src = SOURCES[layer.sourceId];
  const lic = src ? LICENCES[src.licence] : undefined;

  const visible = Object.entries(properties ?? {}).filter(
    ([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== "" && v !== undefined,
  );
  const entries = visible.slice(0, MAX_ENTRIES);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${layer.label}: ${featureLabel(properties)}`}
      tabIndex={-1}
      className="om-sheet-in absolute inset-x-3 bottom-16 z-20 max-h-[62vh] overflow-hidden rounded-xl border border-line bg-panel/95 shadow-2xl backdrop-blur focus:outline-none sm:inset-x-auto sm:bottom-auto sm:left-3 sm:top-3 sm:max-h-none sm:w-[min(22rem,calc(100vw-1.5rem))]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
            {layer.label}
          </div>
          <div className="truncate text-sm font-semibold text-ink">{featureLabel(properties)}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close feature details"
          className="btn-icon !h-8 !w-8"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {typeof properties?.safety === "string" && properties.safety && (
        <p className="border-b border-danger/30 bg-danger/10 px-3 py-2 text-[12px] font-semibold leading-snug text-danger">
          {properties.safety}
        </p>
      )}

      <div className="scroll-thin max-h-[45vh] overflow-y-auto sm:max-h-[50vh]">
        {entries.length > 0 && (
          <dl className="divide-y divide-line-soft">
            {entries.map(([k, v]) => (
              <div key={k} className="flex gap-2 px-3 py-1 text-[12px]">
                <dt className="w-28 shrink-0 text-ink-3">{humanise(k)}</dt>
                <dd className="min-w-0 flex-1 break-words text-ink">{formatValue(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {visible.length > entries.length && (
          <p className="px-3 py-1 text-[10px] text-ink-3">
            Showing {entries.length} of {visible.length} attributes.
          </p>
        )}

        {typeof properties?.nearestPlace === "string" && (
          <p className="border-t border-line px-3 py-2 text-[12px] text-ink-2">
            <span className="font-semibold text-ink">Located near</span>{" "}
            {properties.nearestPlace}
            <span className="mt-1 block text-[10px] text-ink-3">
              This is derived context, not the asset&apos;s name. No naming source
              exists for it, so nothing has been invented &mdash; use this to find it
              on the map, then check OpenStreetMap for its tags.
            </span>
          </p>
        )}

        {typeof properties?.coordGrade === "string" && (
          <p className="border-t border-line px-3 py-2 text-[12px] text-warn">
            Coordinate grade {properties.coordGrade}
            {typeof properties.coordSource === "string" ? `: ${properties.coordSource}` : ""}
          </p>
        )}

        {layer.caveats && layer.caveats.length > 0 && (
          <div className="border-t border-line px-3 py-2 text-[12px] leading-relaxed">
            <div className="mb-1 font-semibold text-warn">Caveats</div>
            <ul className="list-disc space-y-1 pl-4 text-ink-2">
              {layer.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1 border-t border-line px-3 py-2 text-[11px] text-ink-3">
          {picked.asOf && (
            <div>
              Data as of <span className="text-ink-2">{formatAsOf(picked.asOf) ?? picked.asOf}</span>
            </div>
          )}
          <div>
            Confidence{" "}
            <span
              className={
                layer.confidence === "A"
                  ? "text-ok"
                  : layer.confidence === "B"
                    ? "text-gps-soft"
                    : layer.confidence === "C"
                      ? "text-warn"
                      : "text-danger"
              }
            >
              {layer.confidence}
            </span>{" "}
            &middot; {lon.toFixed(5)}, {lat.toFixed(5)}
          </div>
          {src && (
            <div>
              Source:{" "}
              <a href={src.url} target="_blank" rel="noopener noreferrer" className="link">
                {src.name}
              </a>
            </div>
          )}
          {lic && (
            <div>
              Licence:{" "}
              {lic.url ? (
                <a href={lic.url} target="_blank" rel="noopener noreferrer" className="link">
                  {lic.name}
                </a>
              ) : (
                lic.name
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <a href={osmUrl(properties, lon, lat)} target="_blank" rel="noopener noreferrer" className="link">
              Open in OSM
            </a>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(`${lat.toFixed(5)}, ${lon.toFixed(5)}`)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
              className="link"
            >
              {copied ? "Copied" : "Copy coords"}
            </button>
            {onLocate && (
              <button type="button" onClick={() => onLocate(lon, lat)} className="link">
                Centre map here
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}