/**
 * Navigation host integration.
 *
 * The navigation host owns the locate dot, the drop-pin, and the route layers,
 * all of which live directly on the MapLibre map. This module provides a
 * thin wrapper to attach/detach the host and keep it in sync with the map.
 */

import { attachNavigation, type NavigationHost, type NavigationState } from "@/lib/navigation/host";
import type { Map } from "maplibre-gl";

export interface NavigationIntegration {
  host: NavigationHost | null;
  attach(map: Map, onState: (state: NavigationState) => void, suppressClickUntilRef: { current: number }): void;
  detach(): void;
  rehydrate(map: Map): void;
}

export function createNavigationIntegration(): NavigationIntegration {
  let host: NavigationHost | null = null;

  return {
    get host() { return host; },

    attach(map: Map, onState: (state: NavigationState) => void, suppressClickUntilRef: { current: number }): void {
      if (host) host.dispose();
      suppressClickUntilRef.current = 0;
      host = attachNavigation(map, {
        onState,
        suppressClickUntil: suppressClickUntilRef,
      });
    },

    detach(): void {
      if (host) {
        host.dispose();
        host = null;
      }
    },

    rehydrate(_map: Map): void {
      host?.rehydrate();
    },
  };
}