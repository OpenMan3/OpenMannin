"use client";

/**
 * Floating map controls: 3D terrain toggle only.
 */

import { TerrainToggle } from "./TerrainToggle";

export function MapControls({
  terrain3d,
  onTerrainChange,
}: {
  terrain3d: boolean;
  onTerrainChange: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <TerrainToggle enabled={terrain3d} onToggle={onTerrainChange} />
    </div>
  );
}