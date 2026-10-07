"use client";

/**
 * Feature detail card.
 *
 * Shown for whatever was last clicked on the map. It always shows the layer's
 * provenance underneath the feature's own attributes, so a screenshot of this
 * panel carries its own citation. Webcam features additionally show the live
 * snapshot, which is the whole point of a webcam layer.
 *
 * It is a DIALOG, and keyboard users can reach it: `role="dialog"`, focus moves
 * in when it opens, Escape closes it. Without that the panel was mouse-only -
 * feature picking itself is a click on the canvas, but once open, a keyboard
 * user had no way to dismiss it.
 */

import { useEffect, useRef, useState } from "react";
import type { LayerDef } from "@/lib/types";
import { SOURCES } from "@/lib/sources";
import { LICENCES } from "@/lib/licences";
import { featureLabel } from "@/lib/layer-data";
import { formatValue, humanise, HIDDEN_KEYS } from "@/lib/feature-format";
import type { PickedFeature } from "./MapView";

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
  const [imageFailed, setImageFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Hooks first: the early return below would otherwise make the hook count
  // depend on whether something is picked, which is a rules-of-hooks violation
  // the moment two clicks alternate.
  useEffect(() => {
    if (!picked) return;
    setImageFailed(false);
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

  const image = typeof properties?.image === "string" ? properties.image : null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${layer.label}: ${featureLabel(properties)}`}
      tabIndex={-1}
      className="absolute top-3 left-3 z-20 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-[#1e2a35] bg-[#0d141a]/95 shadow-2xl backdrop-blur focus:outline-none"
    >
      <div className="flex items-start justify-between gap-2 border-b border-[#1e2a35] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] tracking-wide text-[#7d8f9d] uppercase">{layer.label}</div>
          <div className="truncate text-sm font-semibold text-[#d7e3ec]">
            {featureLabel(properties)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close feature details"
          className="shrink-0 px-1 text-lg leading-none text-[#9fb0bd] hover:text-[#d7e3ec]"
        >
          &times;
        </button>
      </div>

      {image && !imageFailed && (
        <a href={image} target="_blank" rel="noopener noreferrer" className="block">
          {/* Snapshot only. The publisher serves no video stream, and there is no
              published grant for reusing these images, so this is a hotlink. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={featureLabel(properties)}
            className="block max-h-48 w-full bg-black object-cover"
            loading="lazy"
            // Hotlinks break: the webcam publisher sits behind a WAF that
            // rejects some requests (see the layer's own caveats), and any
            // rotated URL leaves a broken-image glyph where the snapshot was.
            // The card is still useful without the picture, so drop the image
            // rather than advertise the failure.
            onError={() => setImageFailed(true)}
          />
        </a>
      )}

      <div className="scroll-thin max-h-[45vh] overflow-y-auto">
        {entries.length > 0 && (
          <dl className="divide-y divide-[#131b23]">
            {entries.map(([k, v]) => (
              <div key={k} className="flex gap-2 px-3 py-1 text-[11px]">
                <dt className="w-28 shrink-0 text-[#7d8f9d]">{humanise(k)}</dt>
                <dd className="min-w-0 flex-1 break-words text-[#d7e3ec]">{formatValue(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {visible.length > entries.length && (
          <p className="px-3 py-1 text-[10px] text-[#7d8f9d]">
            Showing {entries.length} of {visible.length} attributes.
          </p>
        )}

        {typeof properties?.nearestPlace === "string" && (
          <p className="border-t border-[#1e2a35] px-3 py-2 text-[11px] text-[#9fb0bd]">
            <span className="font-semibold text-[#d7e3ec]">Located near</span>{" "}
            {properties.nearestPlace}
            <span className="mt-1 block text-[10px] text-[#7d8f9d]">
              This is derived context, not the asset&apos;s name. No naming source
              exists for it, so nothing has been invented &mdash; use this to find it
              on the map, then check OpenStreetMap for its tags.
            </span>
          </p>
        )}

        {typeof properties?.coordGrade === "string" && (
          <p className="border-t border-[#1e2a35] px-3 py-2 text-[11px] text-[#fbbf24]">
            Coordinate grade {properties.coordGrade}
            {typeof properties.coordSource === "string" ? `: ${properties.coordSource}` : ""}
          </p>
        )}

        {layer.caveats && layer.caveats.length > 0 && (
          <div className="border-t border-[#1e2a35] px-3 py-2 text-[11px] leading-relaxed">
            <div className="mb-1 font-semibold text-[#fbbf24]">Caveats</div>
            <ul className="list-disc space-y-1 pl-4 text-[#9fb0bd]">
              {layer.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1 border-t border-[#1e2a35] px-3 py-2 text-[11px] text-[#7d8f9d]">
          {picked.asOf && (
            <div>
              Data as of{" "}
              <span className="text-[#9fb0bd]">
                {formatAsOf(picked.asOf) ?? picked.asOf}
              </span>
            </div>
          )}
          <div>
            Confidence{" "}
            <span
              className={
                layer.confidence === "A"
                  ? "text-[#34d399]"
                  : layer.confidence === "B"
                    ? "text-[#60a5fa]"
                    : layer.confidence === "C"
                      ? "text-[#fbbf24]"
                      : "text-[#f87171]"
              }
            >
              {layer.confidence}
            </span>{" "}
            &middot; {lon.toFixed(5)}, {lat.toFixed(5)}
          </div>
          {src && (
            <div>
              Source:{" "}
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#35c9d4] hover:underline"
              >
                {src.name}
              </a>
            </div>
          )}
          {lic && (
            <div>
              Licence:{" "}
              {lic.url ? (
                <a
                  href={lic.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#35c9d4] hover:underline"
                >
                  {lic.name}
                </a>
              ) : (
                lic.name
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <a
              href={osmUrl(properties, lon, lat)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#35c9d4] hover:underline"
            >
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
              className="text-[#35c9d4] hover:underline"
            >
              {copied ? "Copied" : "Copy coords"}
            </button>
            {onLocate && (
              <button
                type="button"
                onClick={() => onLocate(lon, lat)}
                className="text-[#35c9d4] hover:underline"
              >
                Centre map here
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}