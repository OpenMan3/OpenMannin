"use client";

/**
 * OpenSeaMap seamark overlay toggle.
 *
 * Off by default: the nautical marks (buoys, beacons, lights, harbour detail)
 * are useful on the water but clutter a land-focused map. The preference is
 * remembered between visits, like the 3D-terrain toggle.
 */

import { AnchorIcon } from "./Icons";

export function SeamarkToggle({
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
      aria-label={enabled ? "Hide OpenSeaMap seamarks" : "Show OpenSeaMap seamarks"}
      title={
        enabled
          ? "OpenSeaMap seamarks on — click to hide"
          : "OpenSeaMap seamarks off — click to show nautical marks"
      }
      className={`btn-icon transition-colors ${
        enabled ? "!border-accent/60 !bg-accent/15 !text-accent" : ""
      }`}
    >
      <AnchorIcon className="h-5 w-5" />
    </button>
  );
}
