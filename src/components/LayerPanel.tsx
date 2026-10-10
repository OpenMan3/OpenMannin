"use client";

/**
 * Layer list.
 *
 * The point of this panel is not just to switch things on and off. Every layer
 * shows its confidence grade and licence state, because a reader deciding
 * whether to trust a line on the map needs to know whether it came from the
 * operator, from OpenStreetMap, or from a feed nobody has permission to use.
 *
 * Layers listed in the registry but absent from public/data are shown greyed
 * out with the reason, rather than silently hidden. A layer that 404s and a
 * layer that does not exist are different problems and the user should see
 * which is which.
 */

import { useMemo, useState } from "react";
import type { LayerDef, LayerGroup } from "@/lib/types";
import { SOURCES } from "@/lib/sources";
import { LICENCES } from "@/lib/licences";

const GROUP_LABELS: Record<LayerGroup, string> = {
  geography: "Geography",
  transport: "Transport",
  trails: "Trails & walking",
  infrastructure: "Infrastructure",
  cables: "Subsea cables",
  energy: "Energy",
  environment: "Environment",
  aviation: "Aviation",
  surveillance: "Surveillance & environment",
  live: "Live feeds",
  gaps: "Documented gaps",
};

const GROUP_ORDER: LayerGroup[] = [
  "geography",
  "infrastructure",
  "cables",
  "energy",
  "transport",
  "trails",
  "environment",
  "surveillance",
  "aviation",
  "live",
];

const GRADE_CLASS: Record<string, string> = {
  A: "text-ok",
  B: "text-gps-soft",
  C: "text-warn",
  D: "text-danger",
};

export function LayerPanel({
  layers,
  enabled,
  missing,
  feedErrors,
  onToggle,
  onToggleAll,
}: {
  layers: LayerDef[];
  enabled: Set<string>;
  missing: Set<string>;
  /**
   * Live layers that are switched on but failing, keyed by layer id. Shown as a
   * badge because a live feed that cannot run is completely invisible on the
   * map: an empty layer and a working one are the same picture.
   */
  feedErrors: Record<string, string>;
  onToggle: (id: string) => void;
  /** Flip every layer on or off in one switch. */
  onToggleAll?: (on: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<LayerGroup, LayerDef[]>();
    for (const l of layers) {
      if (!map.has(l.group)) map.set(l.group, []);
      map.get(l.group)!.push(l);
    }
    return map;
  }, [layers]);

  const toggleDetail = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onCount = layers.filter((l) => enabled.has(l.id)).length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Layers</h2>
          <span className="text-xs text-ink-3">
            {onCount} of {layers.length} shown
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ink-3">
          Grade A is operator or government data. C is a single unconfirmed source.
        </p>
        {onToggleAll && (
          <button
            type="button"
            onClick={() => onToggleAll(onCount < layers.length)}
            className="mt-2 w-full rounded-md border border-line bg-panel px-2 py-1.5 font-mono text-[11px] text-ink-2 transition-colors hover:border-accent/50 hover:text-ink"
          >
            {onCount === layers.length
              ? `> all visible — click to blank the map`
              : onCount === 0
                ? `> blank map — click to show everything`
                : `> apply to all: ${onCount}/${layers.length} on`}
          </button>
        )}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
          <section key={group}>
            <h3 className="sticky top-0 z-10 bg-page/95 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase backdrop-blur">
              {GROUP_LABELS[group]}
            </h3>

            {grouped.get(group)!.map((layer) => {
              const isMissing = missing.has(layer.id);
              const isLive = layer.kind === "live";
              const feedError = isLive ? feedErrors[layer.id] : undefined;
              const isOn = enabled.has(layer.id) && !isMissing;
              const src = SOURCES[layer.sourceId];
              const lic = src ? LICENCES[src.licence] : undefined;
              const needsPermission = lic?.requiresPermission ?? false;
              const isOpen = expanded.has(layer.id);

              return (
                <div key={layer.id} className="border-b border-line-soft">
                  <div className="flex items-start gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      id={`layer-${layer.id}`}
                      checked={isOn}
                      disabled={isMissing}
                      onChange={() => onToggle(layer.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-accent disabled:opacity-40"
                    />

                    <label
                      htmlFor={`layer-${layer.id}`}
                      className="min-w-0 flex-1 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="icon-badge"
                          style={{ background: layer.color }}
                          aria-hidden
                        />
                        <span
                          className={`truncate text-[13px] ${
                            isMissing ? "text-ink-3 line-through" : "text-ink"
                          }`}
                        >
                          {layer.label}
                        </span>
                      </span>

                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-3">
                        <span className={`font-mono font-semibold ${GRADE_CLASS[layer.confidence]}`}>
                          {layer.confidence}
                        </span>
                        {layer.featureCount !== undefined && (
                          <span className="font-mono">{layer.featureCount.toLocaleString()}</span>
                        )}
                        {layer.minZoom !== undefined && layer.minZoom > 0 && (
                          <span>z{layer.minZoom}+</span>
                        )}
                        {needsPermission && (
                          <span className="chip bg-warn/10 text-warn">permission needed</span>
                        )}
                        {isLive && <span className="chip bg-info/10 text-info">live route</span>}
                        {feedError && (
                          <span
                            className="chip bg-danger/10 text-danger"
                            title={feedError}
                          >
                            feed offline
                          </span>
                        )}
                        {isMissing && (
                          <span className="chip bg-danger/10 text-danger">no data</span>
                        )}
                      </span>
                    </label>

                    <button
                      type="button"
                      onClick={() => toggleDetail(layer.id)}
                      aria-label={`Details for ${layer.label}`}
                      aria-pressed={isOpen}
                      className="btn-icon !h-7 !w-7 !rounded-md text-xs"
                    >
                      {isOpen ? "−" : "+"}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="space-y-2 px-3 pb-3 text-[12px] leading-relaxed text-ink-2">
                      <p className="pl-8">{layer.description}</p>

                      {feedError && (
                        <div className="rounded-md border border-danger/30 bg-danger/5 p-2">
                          <div className="mb-1 font-semibold text-danger">
                            This live feed is not running
                          </div>
                          <p className="break-words">{feedError}</p>
                        </div>
                      )}

                      {layer.caveats && layer.caveats.length > 0 && (
                        <div className="rounded-md border border-warn/30 bg-warn/5 p-2">
                          <div className="mb-1 font-semibold text-warn">
                            Caveats — read before relying on this
                          </div>
                          <ul className="list-disc space-y-1 pl-4">
                            {layer.caveats.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="border-t border-line pt-2 text-ink-3">
                        <div>
                          Source:{" "}
                          {src ? (
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="link"
                            >
                              {src.name}
                            </a>
                          ) : (
                            <span className="text-danger">unregistered: {layer.sourceId}</span>
                          )}
                        </div>
                        {lic && (
                          <div className="mt-0.5">
                            Licence:{" "}
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
                          </div>
                        )}
                        {lic && <div className="mt-0.5">{lic.obligation}</div>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}