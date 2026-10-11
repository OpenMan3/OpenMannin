"use client";

/**
 * 3D terrain toggle.
 *
 * Controlled, not self-contained: the map has to know whether terrain is on so
 * it can re-apply it after a basemap style swap (a style swap drops the DEM
 * source and silently flattens the map). The page owns the flag, persists it,
 * and hands it to both this button and MapView.
 */

import { TerrainIcon } from "./Icons";

export function TerrainToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!enabled)}
      aria-pressed={enabled}
      aria-label={enabled ? "Disable 3D terrain" : "Enable 3D terrain"}
      title={
        enabled
          ? "3D terrain on — click for flat map"
          : "3D terrain off — click to tilt and raise the hills"
      }
      className={`btn-icon !h-8 !w-8 transition-colors ${
        enabled ? "!border-accent/60 !bg-accent/15 !text-accent" : ""
      }`}
    >
      <TerrainIcon className="h-4 w-4" />
    </button>
  );
}
