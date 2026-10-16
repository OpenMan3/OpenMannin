"use client";

/**
 * Layer list.
 *
 * Two navigations live side by side. The five reader-facing categories
 * (heritage, rights of way, infrastructure, civic, points of interest) form a
 * two-level tree — theme, then drawer — because that is how a person looking
 * for "the old mine shafts" or "public footpaths" actually searches. Layers
 * that belong to no theme (aviation, live feeds, the sea-borne and
 * environmental layers) keep their stable register group as a section, so the
 * taxonomy never invents a home for them.
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
 *
 * Sections remember their collapse state in localStorage. Default: everything
 * expanded, so a first visit shows the evidence rather than a wall of +
 * signs. We store the COLLAPSED set, so a newly added theme is expanded by
 * default without a migration.
 */

import { useEffect, useMemo, useState } from "react";
import type { LayerDef, LayerGroup, LayerCategory, LayerSubcategory } from "@/lib/types";
import { SOURCES } from "@/lib/sources";
import { LICENCES } from "@/lib/licences";
import {
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  SUBCATEGORY_LABELS,
  orderSubcategories,
} from "@/lib/taxonomy";
import { buildLayerTree } from "@/lib/layer-tree";
import { InfoIcon, TerrainIcon } from "./Icons";

const GROUP_LABELS: Record<LayerGroup, string> = {
  geography: "Geography",
  transport: "Transport",
  trails: "Trails & walking",
  infrastructure: "Infrastructure",
  cables: "Subsea cables",
  energy: "Energy",
  environment: "Environment",
  poi: "Points of interest",
  aviation: "Aviation",
  surveillance: "Surveillance & environment",
  live: "Live feeds",
  gaps: "Documented gaps",
};

/** Groups shown for layers that carry no category, in reading order. */
const GROUP_ORDER: LayerGroup[] = [
  "geography",
  "trails",
  "transport",
  "energy",
  "cables",
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

const COLLAPSED_KEY = "om:layerNavCollapsed";

const catKey = (c: LayerCategory) => `cat:${c}`;
const subKey = (c: LayerCategory, s: LayerSubcategory) => `sub:${c}:${s}`;
const grpKey = (g: LayerGroup) => `grp:${g}`;

function loadCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

function saveCollapsed(collapsed: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    /* ignore */
  }
}

function LayerRow({
  layer,
  enabled,
  missing,
  feedErrors,
  onToggle,
  onShowDetail,
}: {
  layer: LayerDef;
  enabled: Set<string>;
  missing: Set<string>;
  feedErrors: Record<string, string>;
  onToggle: (id: string) => void;
  onShowDetail?: (layer: LayerDef) => void;
}) {
  const isMissing = missing.has(layer.id);
  const isLive = layer.kind === "live";
  const feedError = isLive ? feedErrors[layer.id] : undefined;
  const isOn = enabled.has(layer.id) && !isMissing;
  const src = SOURCES[layer.sourceId];
  const lic = src ? LICENCES[src.licence] : undefined;
  const needsPermission = lic?.requiresPermission ?? false;

  return (
    <div className="border-b border-line-soft">
      <div className="flex items-start gap-2 px-3 py-2">
        <input
          type="checkbox"
          id={`layer-${layer.id}`}
          checked={isOn}
          disabled={isMissing}
          onChange={() => onToggle(layer.id)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-accent disabled:opacity-40"
        />

        <label htmlFor={`layer-${layer.id}`} className="min-w-0 flex-1 cursor-pointer">
          <span className="flex items-center gap-1.5">
            <span className="icon-badge" style={{ background: layer.color }} aria-hidden />
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
            {needsPermission && <span className="chip bg-warn/10 text-warn">permission needed</span>}
            {isLive && <span className="chip bg-info/10 text-info">live route</span>}
            {feedError && (
              <span className="chip bg-danger/10 text-danger" title={feedError}>
                feed offline
              </span>
            )}
            {isMissing && <span className="chip bg-danger/10 text-danger">no data</span>}
          </span>
        </label>

        {onShowDetail && (
          <button
            type="button"
            onClick={() => onShowDetail(layer)}
            aria-label={`About ${layer.label}`}
            title="About this layer"
            className="mt-0.5 shrink-0 rounded-md p-1 text-ink-3 transition-colors hover:bg-raised hover:text-ink"
          >
            <InfoIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {feedError && (
        <div className="space-y-2 px-3 pb-3 text-[12px] leading-relaxed text-ink-2">
          <div className="rounded-md border border-danger/30 bg-danger/5 p-2 pl-8">
            <div className="mb-1 font-semibold text-danger">This live feed is not running</div>
            <p className="break-words">{feedError}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function LayerPanel({
  layers,
  enabled,
  missing,
  feedErrors,
  onToggle,
  onToggleAll,
  onShowDetail,
  terrain3d,
  onTerrainChange,
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
  /** Open the detail drawer for a layer. */
  onShowDetail?: (LayerDef: LayerDef) => void;
  /** 3D terrain state. */
  terrain3d: boolean;
  onTerrainChange: (on: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());

  useEffect(() => {
    saveCollapsed(collapsed);
  }, [collapsed]);

  const isExpanded = (key: string) => !collapsed.has(key);
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { byCategory, byGroup } = useMemo(() => buildLayerTree(layers), [layers]);

  const onCount = layers.filter((l) => enabled.has(l.id)).length;

  const countOn = (defs: LayerDef[]) => defs.filter((l) => enabled.has(l.id)).length;

  const rowProps = { enabled, missing, feedErrors, onToggle, onShowDetail };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Layers</h2>
          <span className="text-xs text-ink-3">
            {onCount} of {layers.length} shown
          </span>
        </div>
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

      <div className="scroll-thin flex-1 overflow-y-auto pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-16">
        {/* Map Display section */}
        <section className="border-b border-line-soft">
          <div className="px-3 py-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={terrain3d}
                onChange={(e) => onTerrainChange(e.target.checked)}
                className="h-4 w-4 shrink-0 cursor-pointer accent-accent"
              />
              <span className="flex items-center gap-1.5">
                <TerrainIcon className="h-4 w-4 text-accent" aria-hidden="true" />
                <span className="text-[13px] text-ink">3D Terrain</span>
              </span>
            </label>
          </div>
        </section>

        {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => {
          const subs = byCategory.get(category)!;
          const catDefs = [...subs.values()].flat();
          const catExpanded = isExpanded(catKey(category));
          const subOrder = orderSubcategories(category, [...subs.keys()]);

          return (
            <section key={category}>
              <button
                type="button"
                onClick={() => toggleSection(catKey(category))}
                className="sticky top-0 z-10 flex w-full items-center justify-between bg-page/95 px-3 py-2 text-left backdrop-blur"
                aria-expanded={catExpanded}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-accent">{catExpanded ? "−" : "+"}</span>
                  <span className="text-[12px] font-bold tracking-wide text-ink uppercase">
                    {CATEGORY_LABELS[category]}
                  </span>
                </span>
                <span className="text-[10px] text-ink-3">
                  {countOn(catDefs)} / {catDefs.length}
                </span>
              </button>

              {catExpanded &&
                subOrder.map((sub) => {
                  const defs = subs.get(sub)!;
                  const subExpanded = isExpanded(subKey(category, sub));
                  return (
                    <div key={sub}>
                      <button
                        type="button"
                        onClick={() => toggleSection(subKey(category, sub))}
                        className="flex w-full items-center justify-between border-b border-line-soft bg-panel/60 px-3 py-1 pl-5 text-left"
                        aria-expanded={subExpanded}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="text-ink-3">{subExpanded ? "−" : "+"}</span>
                          <span className="text-[11px] font-semibold text-ink-2">
                            {SUBCATEGORY_LABELS[sub]}
                          </span>
                        </span>
                        <span className="font-mono text-[10px] text-ink-3">
                          {countOn(defs)} / {defs.length}
                        </span>
                      </button>

                      {subExpanded &&
                        defs.map((layer) => (
                          <LayerRow key={layer.id} layer={layer} {...rowProps} />
                        ))}
                    </div>
                  );
                })}
            </section>
          );
        })}

        {GROUP_ORDER.some((g) => byGroup.has(g)) && (
          <div>
            <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-ink-3">
              Not in a theme
            </div>
            {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => {
              const defs = byGroup.get(group)!;
              const groupExpanded = isExpanded(grpKey(group));
              return (
                <section key={group}>
                  <button
                    type="button"
                    onClick={() => toggleSection(grpKey(group))}
                    aria-expanded={groupExpanded}
                    className="flex w-full items-center justify-between gap-1.5 px-3 py-1.5 text-left"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-ink-3">{groupExpanded ? "−" : "+"}</span>
                      <span className="text-[12px] font-semibold text-ink-2">
                        {GROUP_LABELS[group]}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-ink-3">
                      {countOn(defs)} / {defs.length}
                    </span>
                  </button>

                  {groupExpanded &&
                    defs.map((layer) => <LayerRow key={layer.id} layer={layer} {...rowProps} />)}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
