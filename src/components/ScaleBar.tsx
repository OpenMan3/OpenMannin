"use client";

/**
 * Scale bar: shows distance in both metric (km) and imperial (miles).
 *
 * Updates on zoom/pan; uses the map's projection to compute the correct
 * ground distance for a fixed pixel width (100px).
 */

import { useEffect, useState } from "react";
import type { Map } from "maplibre-gl";

const SCALE_KEY = "om:showScale";

interface ScaleBarProps {
  map: Map | null;
  sidebarOpen?: boolean;
}

export function ScaleBar({ map, sidebarOpen }: ScaleBarProps) {
  const [scales, setScales] = useState<{ km: number; miles: number } | null>(null);
  const [visible] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(SCALE_KEY) !== "false";
  });

  useEffect(() => {
    if (!map || !visible) return;

    const update = () => {
      const center = map.getCenter();
      // 100px in map units at the center latitude
      const bounds = map.getBounds();
      const topLeft = map.project([bounds.getWest(), bounds.getNorth()]);
      const topRight = map.project([bounds.getEast(), bounds.getNorth()]);
      const pxWidth = Math.abs(topRight.x - topLeft.x);
      const degreesPerPx = (bounds.getEast() - bounds.getWest()) / pxWidth;

      // At this latitude, 1 degree longitude ≈ 111.32 * cos(lat) km
      const latRad = center.lat * Math.PI / 180;
      const kmPerDegreeLon = 111.32 * Math.cos(latRad);
      const kmPerPx = degreesPerPx * kmPerDegreeLon;

      // 100px scale bar
      const km = kmPerPx * 100;
      const miles = km / 1.609344;

      // Round to nice values
      const roundScale = (val: number) => {
        const magnitude = Math.pow(10, Math.floor(Math.log10(val)));
        const normalized = val / magnitude;
        let rounded: number;
        if (normalized < 1.5) rounded = 1;
        else if (normalized < 3) rounded = 2;
        else if (normalized < 7) rounded = 5;
        else rounded = 10;
        return rounded * magnitude;
      };

      setScales({ km: roundScale(km), miles: roundScale(miles) });
    };

    update();
    map.on("moveend", update);
    map.on("zoomend", update);

    return () => {
      map.off("moveend", update);
      map.off("zoomend", update);
    };
  }, [map, visible]);

  if (!visible || !scales || sidebarOpen) return null;

  // Bar width: 100px max, min 50px
  const maxKm = Math.max(scales.km, 0.01);
  const pxPerKm = 100 / maxKm;
  const barWidthKm = Math.min(100, pxPerKm * scales.km);
  const barWidthMiles = Math.min(100, pxPerKm * scales.miles);

  return (
    <div className="absolute bottom-3 left-3 z-20 bg-page/95 backdrop-blur rounded border border-line p-2 text-[10px] font-mono text-ink shadow-lg pointer-events-none">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-end gap-2">
          <div className="flex flex-col items-end">
            <span className="text-ink-3">{scales.km >= 1 ? `${scales.km} km` : `${Math.round(scales.km * 1000)} m`}</span>
            <div className="h-1 w-full min-w-[50px] max-w-[100px] bg-line rounded" style={{ width: `${Math.max(50, barWidthKm)}px` }}>
              <div className="h-full bg-ink rounded" style={{ width: `${Math.max(50, barWidthKm)}px` }} />
            </div>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col items-end">
            <span className="text-ink-3">{scales.miles >= 1 ? `${scales.miles} mi` : `${Math.round(scales.miles * 1760)} yd`}</span>
            <div className="h-1 w-full min-w-[50px] max-w-[100px] bg-line rounded" style={{ width: `${Math.max(50, barWidthMiles)}px` }}>
              <div className="h-full bg-ink rounded" style={{ width: `${Math.max(50, barWidthMiles)}px` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}