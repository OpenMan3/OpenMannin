"use client";

/**
 * Floating map controls.
 *
 * A single positioned cluster for the basemap and 3D-terrain toggles. They were
 * rendered loose in the map section before, which left them in normal flow
 * below a full-height canvas — technically present, visually off-screen. The
 * cluster sits top-centre so it clears the compass and locate stack on the
 * right and the feature popup in the top-left corner.
 */

import type { BasemapId } from "@/components/MapView";
import { BasemapToggle } from "./BasemapToggle";
import { TerrainToggle } from "./TerrainToggle";

export function MapControls({
  basemap,
  onBasemapChange,
  terrain3d,
  onTerrainChange,
}: {
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  terrain3d: boolean;
  onTerrainChange: (on: boolean) => void;
}) {
  return (
    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2">
      <BasemapToggle basemap={basemap} onBasemapChange={onBasemapChange} />
      <TerrainToggle enabled={terrain3d} onToggle={onTerrainChange} />
    </div>
  );
}
