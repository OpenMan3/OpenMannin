"use client";

/**
 * Coordinate readout: shows the lat/lon under the cursor in decimal degrees
 * and OSGB format (the UK grid used on the Isle of Man).
 *
 * Updates on mouse move over the map; debounced to avoid excessive re-renders.
 * Click the button to toggle visibility.
 */

import { useEffect, useRef, useState } from "react";
import type { Map, MapMouseEvent } from "maplibre-gl";

const READOUT_KEY = "om:showCoordinates";

function deg2rad(deg: number): number {
  return deg * Math.PI / 180;
}

function toOSGB(lon: number, lat: number): { easting: number; northing: number } | null {
  // OSGB36 / British National Grid (EPSG:27700) approximation for Isle of Man
  // The island sits in the SC (South Coast) 100km square, false easting 200000, northing 500000
  // This is a simplified transverse mercator for display purposes only - NOT survey grade
  const a = 6377563.396; // Airy 1830 semi-major axis
  const b = 6356256.909; // Airy 1830 semi-minor axis
  const F0 = 0.9996012717; // scale factor on central meridian
  const lat0 = deg2rad(49); // true origin latitude
  const lon0 = deg2rad(-2); // true origin longitude
  const N0 = -100000; // false northing
  const E0 = 400000; // false easting

  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const nu = a * F0 / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * Math.sin(lat) * Math.sin(lat), 1.5);
  const eta2 = nu / rho - 1;

  const Ma = (1 + n + (5/4)*n*n + (5/4)*n*n*n) * (lat - lat0);
  const Mb = (3*n + 3*n*n + (21/8)*n*n*n) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
  const Mc = ((15/8)*n*n + (15/8)*n*n*n) * Math.sin(2*(lat - lat0)) * Math.cos(2*(lat + lat0));
  const Md = (35/24)*n*n*n * Math.sin(3*(lat - lat0)) * Math.cos(3*(lat + lat0));
  const M = a * F0 * (Ma - Mb + Mc - Md);

  const I = M + N0;
  const II = (nu/2) * Math.sin(lat) * Math.cos(lat);
  const III = (nu/24) * Math.sin(lat) * Math.pow(Math.cos(lat), 3) * (5 - Math.pow(Math.tan(lat), 2) + 9*eta2);
  const IIIA = (nu/720) * Math.sin(lat) * Math.pow(Math.cos(lat), 5) * (61 - 58*Math.pow(Math.tan(lat), 2) + Math.pow(Math.tan(lat), 4));
  const IV = nu * Math.cos(lat);
  const V = (nu/6) * Math.pow(Math.cos(lat), 3) * (nu/rho - Math.pow(Math.tan(lat), 2));
  const VI = (nu/120) * Math.pow(Math.cos(lat), 5) * (5 - 18*Math.pow(Math.tan(lat), 2) + Math.pow(Math.tan(lat), 4) + 14*eta2 - 58*Math.pow(Math.tan(lat), 2)*eta2);

  const dLon = lon - lon0;
  const N = I + II * dLon * dLon + III * Math.pow(dLon, 4) + IIIA * Math.pow(dLon, 6);
  const E = E0 + IV * dLon + V * Math.pow(dLon, 3) + VI * Math.pow(dLon, 5);

  return { easting: Math.round(E), northing: Math.round(N) };
}

interface CoordinateReadoutProps {
  map: Map | null;
  sidebarOpen?: boolean;
}

export function CoordinateReadout({ map, sidebarOpen }: CoordinateReadoutProps) {
  const [coords, setCoords] = useState<{ lon: number; lat: number } | null>(null);
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(READOUT_KEY) === "true";
  });
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!map || !visible) return;

    const onMove = (e: MapMouseEvent) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        setCoords({ lon: e.lngLat.lng, lat: e.lngLat.lat });
      }, 50);
    };

    const onLeave = () => setCoords(null);

    map.on("mousemove", onMove);
    map.on("mouseout", onLeave);

    return () => {
      map.off("mousemove", onMove);
      map.off("mouseout", onLeave);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [map, visible]);

  const toggle = () => {
    const next = !visible;
    setVisible(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(READOUT_KEY, String(next));
    }
  };

  if (!visible || sidebarOpen) return null;

  const osgb = coords ? toOSGB(coords.lon, coords.lat) : null;

  return (
    <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        aria-label={visible ? "Hide coordinates" : "Show coordinates"}
        className="btn-icon !h-8 !w-8 bg-page/95 backdrop-blur rounded border border-line text-ink shadow-lg"
      >
        {visible ? "✕" : "📍"}
      </button>
      {visible && (
        <div className="bg-page/95 backdrop-blur rounded border border-line px-2.5 py-1.5 text-[11px] font-mono text-ink shadow-lg pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="text-ink-3">Coords</span>
            {coords && (
              <>
                <span className="tabular-nums">
                  {coords.lat.toFixed(5)}°, {coords.lon.toFixed(5)}°
                </span>
                {osgb && (
                  <span className="text-ink-3 ml-2">
                    OSGB: {osgb.easting.toLocaleString()}, {osgb.northing.toLocaleString()}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}