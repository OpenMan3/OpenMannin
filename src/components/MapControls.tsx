/**
 * Floating map controls: 3D terrain and OpenSeaMap seamark overlays.
 */

import { TerrainToggle } from "./TerrainToggle";
import { SeamarkToggle } from "./SeamarkToggle";

export function MapControls({
  terrain3d,
  onTerrainChange,
  seamarks,
  onSeamarksChange,
}: {
  terrain3d: boolean;
  onTerrainChange: (on: boolean) => void;
  seamarks: boolean;
  onSeamarksChange: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <TerrainToggle enabled={terrain3d} onToggle={onTerrainChange} />
      <SeamarkToggle enabled={seamarks} onToggle={onSeamarksChange} />
    </div>
  );
}
