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
  marine: "Marine",
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
  "marine",
  "live",
];

const GRADE_CLASS: Record<string, string> = {
  A: "text-[#34d399]",
  B: "text-[#60a5fa]",
  C: "text-[#fbbf24]",
  D: "text-[#f87171]",
};

export function LayerPanel({
  layers,
  enabled,
  missing,
  onToggle,
}: {
  layers: LayerDef[];
  enabled: Set<string>;
  missing: Set<string>;
  onToggle: (id: string) => void;
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
      <div className="border-b border-[#1e2a35] px-3 py-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Layers</h2>
          <span className="text-xs text-[#7d8f9d]">
            {onCount} of {layers.length} shown
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-[#7d8f9d]">
          Grade A is operator or government data. C is a single unconfirmed source.
        </p>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
          <section key={group}>
            <h3 className="sticky top-0 z-10 bg-[#0b0f14]/95 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-[#7d8f9d] uppercase backdrop-blur">
              {GROUP_LABELS[group]}
            </h3>

            {grouped.get(group)!.map((layer) => {
              const isMissing = missing.has(layer.id);
              const isLive = layer.kind === "live";
              const isOn = enabled.has(layer.id) && !isMissing;
              const src = SOURCES[layer.sourceId];
              const lic = src ? LICENCES[src.licence] : undefined;
              const needsPermission = lic?.requiresPermission ?? false;
              const isOpen = expanded.has(layer.id);

              return (
                <div key={layer.id} className="border-b border-[#131b23]">
                  <div className="flex items-start gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      id={`layer-${layer.id}`}
                      checked={isOn}
                      disabled={isMissing}
                      onChange={() => onToggle(layer.id)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#35c9d4] disabled:opacity-40"
                    />

                    <label htmlFor={`layer-${layer.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: layer.color }}
                          aria-hidden
                        />
                        <span
                          className={`truncate text-[13px] ${isMissing ? "text-[#55636e] line-through" : "text-[#d7e3ec]"}`}
                        >
                          {layer.label}
                        </span>
                      </span>

                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[#7d8f9d]">
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
                          <span className="rounded bg-[#3a2a12] px-1 text-[#fbbf24]">
                            permission needed
                          </span>
                        )}
                        {isLive && (
                          <span className="rounded bg-[#12283a] px-1 text-[#7dd3fc]">
                            live route
                          </span>
                        )}
                        {isMissing && (
                          <span className="rounded bg-[#3a1414] px-1 text-[#f87171]">no data</span>
                        )}
                      </span>
                    </label>

                    <button
                      type="button"
                      onClick={() => toggleDetail(layer.id)}
                      aria-label={`Details for ${layer.label}`}
                      className="shrink-0 px-1 text-xs text-[#55636e] hover:text-[#d7e3ec]"
                    >
                      {isOpen ? "−" : "i"}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="space-y-2 px-3 pb-3 pl-8 text-[11px] leading-relaxed text-[#9fb0bd]">
                      <p>{layer.description}</p>

                      {layer.caveats && layer.caveats.length > 0 && (
                        <div className="rounded border border-[#3a2a12] bg-[#1a1408] p-2">
                          <div className="mb-1 font-semibold text-[#fbbf24]">
                            Caveats — read before relying on this
                          </div>
                          <ul className="list-disc space-y-1 pl-4">
                            {layer.caveats.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="border-t border-[#1e2a35] pt-2 text-[#7d8f9d]">
                        <div>
                          Source:{" "}
                          {src ? (
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#35c9d4] hover:underline"
                            >
                              {src.name}
                            </a>
                          ) : (
                            <span className="text-[#f87171]">unregistered: {layer.sourceId}</span>
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
                                className="text-[#35c9d4] hover:underline"
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