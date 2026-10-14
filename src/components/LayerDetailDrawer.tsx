"use client";

/**
 * Layer detail drawer.
 *
 * The registry carries a full prose `description` for every layer and the
 * ingests stamp an "as of" date onto each data file, but neither was reachable
 * from the UI: the panel only showed a label and a checkbox. This drawer is the
 * place a reader can actually read what a layer is, who published it, under
 * what licence, when it was captured, and what its caveats are — the evidence
 * behind the line on the map.
 *
 * It is a pure view. Zooming and toggling are dispatched up to the page, which
 * owns the map handle and the enabled set.
 */

import { useEffect } from "react";
import type { LayerDef } from "@/lib/types";
import { SOURCES } from "@/lib/sources";
import { LICENCES } from "@/lib/licences";
import { CrosshairIcon, CloseIcon } from "./Icons";
import { LicenceBadge } from "./LicenceBadge";

const GRADE_LABEL: Record<string, string> = {
  A: "Primary — operator, regulator or government",
  B: "Corroborated — two or more sources agree",
  C: "Single source or inferred",
  D: "Disputed or contradicted",
};

export function LayerDetailDrawer({
  layer,
  asOf,
  hasBounds,
  isOn,
  onClose,
  onToggle,
  onZoomToLayer,
}: {
  layer: LayerDef | null;
  /** The data file's `generated` stamp, where known. */
  asOf?: string;
  /** Whether a bounding box is available to zoom to. */
  hasBounds?: boolean;
  /** Whether the layer is currently shown. */
  isOn?: boolean;
  onClose: () => void;
  onToggle?: (id: string) => void;
  onZoomToLayer?: (layer: LayerDef) => void;
}) {
  useEffect(() => {
    if (!layer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layer, onClose]);

  if (!layer) return null;

  const src = SOURCES[layer.sourceId];
  const lic = src ? LICENCES[src.licence] : undefined;
  const generated = asOf ? new Date(asOf) : null;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-label={`About ${layer.label}`}
        className="om-sheet-in fixed inset-x-4 bottom-4 z-50 flex max-h-[82vh] flex-col rounded-3xl bg-panel shadow-[0_8px_32px_rgba(0,0,0,0.18)] sm:inset-y-4 sm:left-auto sm:right-4 sm:max-h-none sm:w-[min(28rem,calc(100vw-2rem))] sm:rounded-3xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="icon-badge" style={{ background: layer.color }} aria-hidden />
              <h2 className="truncate text-sm font-semibold text-ink">{layer.label}</h2>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-ink-3">{src?.name ?? layer.sourceId}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-icon !h-8 !w-8">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
            <div>
              <dt className="label">Confidence</dt>
              <dd className="text-ink" title={GRADE_LABEL[layer.confidence]}>
                <span className="font-mono font-semibold">{layer.confidence}</span>{" "}
                <span className="text-ink-3">{GRADE_LABEL[layer.confidence]}</span>
              </dd>
            </div>
            {layer.featureCount !== undefined && (
              <div>
                <dt className="label">Features</dt>
                <dd className="font-mono text-ink">{layer.featureCount.toLocaleString()}</dd>
              </div>
            )}
            {layer.minZoom !== undefined && (
              <div>
                <dt className="label">Appears at</dt>
                <dd className="font-mono text-ink">zoom {layer.minZoom}+</dd>
              </div>
            )}
            <div>
              <dt className="label">Licence</dt>
              <dd>
                <LicenceBadge id={src?.licence ?? "UNKNOWN"} />
              </dd>
            </div>
            {generated && !Number.isNaN(generated.getTime()) && (
              <div>
                <dt className="label">Data as of</dt>
                <dd className="font-mono text-ink">{generated.toISOString().slice(0, 10)}</dd>
              </div>
            )}
            {src?.lastChecked && (
              <div>
                <dt className="label">Source checked</dt>
                <dd className="font-mono text-ink">{src.lastChecked}</dd>
              </div>
            )}
          </dl>

          {lic && (
            <p className="text-[11px] leading-snug text-ink-3">
              {lic.obligation}
              {lic.requiresPermission && <span className="text-warn"> — permission required.</span>}
              {lic.url && (
                <a href={lic.url} target="_blank" rel="noopener noreferrer" className="link ml-1">
                  (licence)
                </a>
              )}
            </p>
          )}

          {layer.caveats && layer.caveats.length > 0 && (
            <div className="rounded-md border border-warn/30 bg-warn/5 p-2.5">
              <div className="mb-1 text-[11px] font-semibold text-warn">Read before trusting this</div>
              <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-ink-2">
                {layer.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {src?.url && (
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="link block break-all text-[11px]"
            >
              {src.url}
            </a>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-2 border-t border-line px-4 py-3">
          {onToggle && layer.kind !== "blocked" && (
            <button
              type="button"
              onClick={() => onToggle(layer.id)}
              className="btn flex-1"
            >
              {isOn ? "Hide layer" : "Show layer"}
            </button>
          )}
          {onZoomToLayer && (
            <button
              type="button"
              onClick={() => onZoomToLayer(layer)}
              disabled={!hasBounds}
              title={hasBounds ? "Zoom to this layer" : "No bounds available"}
              className="btn btn-primary flex flex-1 items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <CrosshairIcon className="h-4 w-4" />
              Zoom to layer
            </button>
          )}
        </div>
      </div>
    </>
  );
}
