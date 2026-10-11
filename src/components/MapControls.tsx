"use client";

/**
 * Floating map controls: basemap theme + 3D terrain toggles.
 *
 * A vertical mini-cluster that lives at the bottom of the right-hand control
 * rail (under the locate/follow buttons; see page.tsx). OpenTopoMap is
 * raster-only so the light/dark toggle hides itself when it is active.
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
    <div className="flex flex-col items-center gap-2">
      <BasemapToggle basemap={basemap} onBasemapChange={onBasemapChange} />
      <TerrainToggle enabled={terrain3d} onToggle={onTerrainChange} />
    </div>
  );
}