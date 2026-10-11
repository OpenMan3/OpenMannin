"use client";

/**
 * Legend: auto-generated from the layer registry.
 *
 * Shows only the layers that are currently visible on the map, grouped by
 * their registry group. Updates when layers are toggled.
 */

import { useState } from "react";
import type { Map } from "maplibre-gl";
import type { LayerDef } from "@/lib/types";

const LEGEND_KEY = "om:showLegend";

interface LegendProps {
  map: Map | null;
  layers: LayerDef[];
  enabled: Set<string>;
}

export function Legend({ layers, enabled }: LegendProps) {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(LEGEND_KEY) !== "false";
  });

  const visibleLayers = layers.filter((l) => enabled.has(l.id) && l.kind === "geojson");

  if (!visible) return null;
  if (visibleLayers.length === 0) return null;

  return (
    <div className="fixed top-3 right-3 z-20 max-w-xs bg-page/95 backdrop-blur rounded border border-line p-2.5 text-[11px] text-ink shadow-lg pointer-events-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-ink">Legend</span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Hide legend"
          className="btn-icon !h-6 !w-6 text-ink-3 hover:text-ink"
        >
          ✕
        </button>
      </div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {visibleLayers.map((layer) => (
          <div key={layer.id} className="flex items-center gap-2">
            <span
              className="icon-badge flex-shrink-0"
              style={{ background: layer.color }}
              aria-hidden
            />
            <span className="truncate">{layer.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}